from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.models.device import Device
from app.models.notification import MonitorState
from app.services.control_agent_client import get_service_snapshot
from app.services.device_service import _ping_host
from app.services.docker_service import CONTROLLABLE_SERVICES
from app.services.notification_service import create_notification, resolve_incident
from app.services.system_service import get_pi_status

logger = logging.getLogger(__name__)


def _lock_path(database_url: str) -> Path:
    if database_url.startswith("sqlite:////"):
        database = Path("/" + database_url.removeprefix("sqlite:////").split("?", 1)[0])
    elif database_url.startswith("sqlite:///"):
        database = Path(database_url.removeprefix("sqlite:///").split("?", 1)[0]).resolve()
    else:
        database = Path("/tmp/pihomehub-monitor")
    return database.with_name(database.name + ".notification-monitor.lock")


def claim_monitor_lock(database_url: str):
    path = _lock_path(database_url)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    return handle


def _state(db: Session, key: str) -> dict[str, Any]:
    row = db.get(MonitorState, key)
    if row is None:
        return {}
    try:
        result = json.loads(row.value_json)
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def _save_state(db: Session, key: str, value: dict[str, Any], now: datetime) -> None:
    row = db.get(MonitorState, key)
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"))[:4096]
    if row is None:
        db.add(MonitorState(key=key, value_json=serialized, updated_at=now))
    else:
        row.value_json = serialized
        row.updated_at = now
    db.flush()


def _incident_event_key(state: dict[str, Any], prefix: str) -> str:
    return f"{prefix}:{state.get('incident', 0)}"


def _new_incident(state: dict[str, Any], prefix: str) -> str:
    state["incident"] = int(state.get("incident", 0)) + 1
    return _incident_event_key(state, prefix)


def _record_active_event(state: dict[str, Any], event_key: str) -> None:
    active_events = state.get("active_events")
    if not isinstance(active_events, list):
        active_events = [state["active_event"]] if state.get("active_event") else []
    if event_key not in active_events:
        active_events.append(event_key)
    state["active_events"] = active_events[-16:]
    state["active_event"] = event_key


def _resolve_active_events(db: Session, state: dict[str, Any], now: datetime) -> None:
    active_events = state.get("active_events")
    if not isinstance(active_events, list):
        active_events = [state["active_event"]] if state.get("active_event") else []
    for event_key in active_events:
        resolve_incident(db, event_key, now)
    state.pop("active_events", None)
    state.pop("active_event", None)
    state.pop("active_severity", None)


def _notify(
    db: Session, *, event_key: str, event_type: str, category: str, severity: str,
    title: str, message: str, source_type: str, source_id: str | int,
    target_path: str, metadata: dict[str, Any] | None = None, now: datetime,
):
    create_notification(
        db, event_key=event_key, event_type=event_type, category=category,
        severity=severity, title=title, message=message, source_type=source_type,
        source_id=source_id, target_path=target_path, metadata=metadata, created_at=now,
    )


def _device_sample(db: Session, device: Device, status: str, now: datetime, settings: Settings) -> None:
    key = f"device:{device.id}"
    state = _state(db, key)
    address = device.ip_address or device.tailscale_name or ""
    if state.get("address") != address:
        if state.get("active_event"):
            _resolve_active_events(db, state, now)
        state = {"address": address, "stable": None, "failures": 0, "successes": 0, "incident": state.get("incident", 0)}
    state["last_cycle"] = now.isoformat()
    if status == "unknown":
        state["failures"] = state["successes"] = 0
        _save_state(db, key, state, now)
        return
    old = state.get("stable")
    threshold = settings.notification_offline_failures if status == "offline" else settings.notification_recovery_successes
    counter = "failures" if status == "offline" else "successes"
    other = "successes" if counter == "failures" else "failures"
    state[counter] = int(state.get(counter, 0)) + 1
    state[other] = 0
    if state[counter] >= threshold and old is None:
        # Quiet baseline: even a confirmed initial outage is not a transition.
        state["stable"] = status
    elif state[counter] >= threshold and old != status:
        state["stable"] = status
        if old == "online" and status == "offline":
            event_key = _new_incident(state, f"device-offline:{device.id}")
            _record_active_event(state, event_key)
            _notify(db, event_key=event_key, event_type="device_offline", category="device", severity="warning",
                title=f"{device.name} went offline", message=f"{device.name} has not responded to three consecutive checks.",
                source_type="device", source_id=device.id, target_path="/devices", now=now)
        elif old == "offline" and status == "online":
            active = state.get("active_event")
            if active:
                _resolve_active_events(db, state, now)
            event_key = _new_incident(state, f"device-recovered:{device.id}")
            _notify(db, event_key=event_key, event_type="device_recovered", category="device", severity="success",
                title=f"{device.name} came online", message=f"{device.name} responded to consecutive checks again.",
                source_type="device", source_id=device.id, target_path="/devices", now=now)
            state.pop("active_event", None)
    _save_state(db, key, state, now)


def _service_sample(db: Session, slug: str, raw: dict[str, Any], now: datetime, settings: Settings) -> None:
    key = f"service:{slug}"
    state = _state(db, key)
    status = str(raw.get("status", "unknown")).lower()
    health = raw.get("health_status") if raw.get("health_status") in {"healthy", "unhealthy", "starting"} else None
    if status == "running":
        observed = health if health in {"unhealthy", "starting"} else "running"
    elif status in {"exited", "dead", "stopped"}:
        observed = "stopped"
    else:
        observed = "missing" if status == "missing" else "unknown"
    if state.get("stable") in {"exited", "dead"}:
        state["stable"] = "stopped"
    state["last_cycle"] = now.isoformat()
    if observed == "unknown":
        if isinstance(state.get("pending_action"), dict):
            state["pending_action"]["successes"] = 0
        state["candidate"] = None
        state["count"] = 0
        _save_state(db, key, state, now)
        return
    pending = state.get("pending_action")
    if isinstance(pending, dict):
        requested_at = datetime.fromisoformat(pending.get("requested_at", now.isoformat()))
        if now - requested_at <= timedelta(minutes=3):
            action = pending.get("action", "service")
            if action == "restart" and observed != "running":
                pending["saw_transition"] = True
            expected_observed = (
                observed in {"stopped", "exited", "dead"}
                if action == "stop"
                else observed == "running"
            )
            if expected_observed and (action != "restart" or pending.get("saw_transition")):
                pending["successes"] = int(pending.get("successes", 0)) + 1
                if pending["successes"] >= settings.notification_recovery_successes:
                    state["stable"] = "stopped" if action == "stop" else "running"
                    state["ever_running"] = observed == "running" or state.get("ever_running", False)
                    state.pop("pending_action", None)
                    state["candidate"] = None
                    state["count"] = 0
                    _resolve_active_events(db, state, now)
                    service_name = slug.replace("-", " ").title()
                    action_title = {"start": "started", "stop": "stopped", "restart": "recovered"}.get(action, "updated")
                    _notify(db, event_key=f"service-action-completed:{slug}:{pending.get('id')}",
                        event_type="service_action_completed", category="service",
                        severity="info" if action == "stop" else "success",
                        title=f"{service_name} {action_title}",
                        message=f"The requested {action} action completed successfully.",
                        source_type="service", source_id=slug, target_path="/services", now=now)
                _save_state(db, key, state, now)
                return
            pending["successes"] = 0
            state["candidate"] = None
            state["count"] = 0
            _save_state(db, key, state, now)
            return
        timed_out = state.pop("pending_action", None)
        if timed_out:
            _notify(db, event_key=f"service-action-failed:{slug}:{timed_out.get('id')}",
                event_type="service_failure", category="service", severity="warning",
                title=f"{slug.replace('-', ' ').title()} action not confirmed",
                message=f"The requested {timed_out.get('action', 'service')} action was not confirmed within three minutes.",
                source_type="service", source_id=slug, target_path="/services", now=now)
    if observed == "missing" and not state.get("ever_running"):
        _save_state(db, key, state, now)
        return
    if state.get("stable") is None:
        if observed == "running":
            state["stable"] = "running"
            state["ever_running"] = True
        _save_state(db, key, state, now)
        return
    if observed == "running":
        state["ever_running"] = True
    if observed == state.get("stable"):
        state["candidate"] = None
        state["count"] = 0
        _save_state(db, key, state, now)
        return
    if state.get("candidate") != observed:
        state["candidate"] = observed
        state["count"] = 1
    else:
        state["count"] = int(state.get("count", 0)) + 1
    transition_threshold = settings.notification_offline_failures if observed in {"unhealthy", "exited", "dead", "stopped", "missing"} else settings.notification_recovery_successes
    if state["count"] >= transition_threshold:
        old = state.get("stable")
        state["stable"] = observed
        state["candidate"] = None
        state["count"] = 0
        service_name = slug.replace("-", " ").title()
        if observed in {"unhealthy", "exited", "dead", "stopped", "missing"}:
            unhealthy = observed == "unhealthy"
            severity = "warning" if unhealthy else "critical"
            active_severity = state.get("active_severity")
            if active_severity is None or (active_severity == "warning" and severity == "critical"):
                event_key = _new_incident(state, f"service-failure:{slug}")
                _record_active_event(state, event_key)
                state["active_severity"] = severity
                _notify(db, event_key=event_key, event_type="service_failure", category="service",
                    severity=severity,
                    title=f"{service_name} {'health check failed' if unhealthy else 'stopped'}",
                    message=f"{service_name} has remained {observed} for three checks.",
                    source_type="service", source_id=slug, target_path="/services", now=now)
        elif old in {"unhealthy", "exited", "dead", "stopped", "missing", "starting"} and observed == "running":
            _resolve_active_events(db, state, now)
            event_key = _new_incident(state, f"service-recovered:{slug}")
            _notify(db, event_key=event_key, event_type="service_recovered", category="service", severity="success",
                title=f"{service_name} recovered", message=f"{service_name} is running again.",
                source_type="service", source_id=slug, target_path="/services", now=now)
            state.pop("active_event", None)
            state.pop("active_severity", None)
    _save_state(db, key, state, now)


def _metric_transition(
    db: Session, *, key: str, value: float | None, now: datetime, duration: int,
    trigger: Any, recovery: Any, warning_event: str, title: str, metric_name: str,
    recovery_title: str, path: str, settings: Settings, critical_trigger: Any = None,
    degraded: Any = None, critical_event: str | None = None, degraded_event: str | None = None,
    recovery_duration: int | None = None,
):
    state = _state(db, key)
    if value is None or not math.isfinite(value):
        if state:
            for field in ("candidate", "candidate_since", "candidate_level", "recover_since"):
                state.pop(field, None)
            _save_state(db, key, state, now)
        return
    previous_sample = state.get("last_sample")
    if previous_sample:
        then = datetime.fromisoformat(previous_sample)
        if now - then > timedelta(seconds=max(settings.notification_monitor_interval_seconds * 2, 60)):
            state["candidate"] = None
            state["candidate_since"] = None
            state["recover_since"] = None
    state["last_sample"] = now.isoformat()
    level = state.get("level", "normal")
    if level == "normal":
        next_level = "critical" if critical_trigger and critical_trigger(value) else "warning" if trigger(value) else "normal"
        candidate_field, predicate = "candidate_since", next_level != "normal"
    elif recovery(value):
        next_level, candidate_field, predicate = "normal", "recover_since", True
    elif level == "warning" and critical_trigger and critical_trigger(value):
        next_level, candidate_field, predicate = "critical", "candidate_since", True
    elif level == "critical" and degraded and degraded(value):
        next_level, candidate_field, predicate = "warning", "candidate_since", True
    else:
        next_level, candidate_field, predicate = level, "candidate_since", False
    if not predicate:
        for field in ("candidate_since", "recover_since", "candidate_level"):
            state.pop(field, None)
        _save_state(db, key, state, now)
        return
    if next_level != level and state.get("candidate_level") != next_level:
        state[candidate_field] = now.isoformat()
        state["candidate_level"] = next_level
    started = state.get(candidate_field)
    if not started:
        state[candidate_field] = now.isoformat()
        _save_state(db, key, state, now)
        return
    required_duration = recovery_duration if next_level == "normal" and recovery_duration is not None else duration
    if now - datetime.fromisoformat(started) < timedelta(seconds=required_duration):
        _save_state(db, key, state, now)
        return
    state[candidate_field] = None
    state.pop("candidate_level", None)
    if next_level == level:
        _save_state(db, key, state, now)
        return
    state["level"] = next_level
    if next_level == "normal":
        _resolve_active_events(db, state, now)
        event_key = _new_incident(state, f"{key}:recovered")
        _notify(db, event_key=event_key, event_type=f"{metric_name}_recovered", category="system", severity="success",
            title=recovery_title, message=f"Current reading is {value:.1f}{'°C' if metric_name == 'temperature' else '%'}.",
            source_type="system", source_id=metric_name, target_path=path, now=now)
    else:
        is_downgrade = level == "critical" and next_level == "warning"
        event_type = critical_event if next_level == "critical" else degraded_event if is_downgrade and degraded_event else warning_event
        event_key = _new_incident(state, f"{key}:{next_level}")
        suffix = "°C" if metric_name == "temperature" else "%"
        label = "critical" if next_level == "critical" else "improved but remains high" if is_downgrade else "high"
        _notify(db, event_key=event_key, event_type=event_type, category="system",
            severity="critical" if next_level == "critical" else "warning",
            title=f"{title} {label}",
            message=f"{metric_name.capitalize()} {'improved to' if is_downgrade else 'is'} {value:.1f}{suffix}.", source_type="system",
            source_id=metric_name, target_path=path, metadata={"temperature_c": value, "usage_percent": value}, now=now)
        _record_active_event(state, event_key)
    _save_state(db, key, state, now)


async def _probe_devices(devices: list[Device]) -> dict[int, str]:
    semaphore = asyncio.Semaphore(8)

    async def probe(device: Device):
        async with semaphore:
            return device.id, await asyncio.to_thread(_ping_host, device.ip_address or device.tailscale_name)

    rows = await asyncio.gather(*(probe(device) for device in devices), return_exceptions=True)
    return {row[0]: row[1] for row in rows if isinstance(row, tuple)}


async def run_monitor_cycle(session_factory: sessionmaker, settings: Settings | None = None, now: datetime | None = None) -> None:
    settings = settings or get_settings()
    now = now or datetime.now(UTC)
    with session_factory() as db:
        devices = db.query(Device).order_by(Device.id).all()
        device_descriptors = [Device(id=d.id, name=d.name, ip_address=d.ip_address, tailscale_name=d.tailscale_name, device_type=d.device_type) for d in devices]
        db.expunge_all()

    results: dict[str, Any] = {}
    try:
        results["devices"] = await _probe_devices(device_descriptors)
    except Exception as exc:
        logger.warning("Notification monitor device collection failed (%s)", type(exc).__name__)
    try:
        snapshot = await asyncio.to_thread(get_service_snapshot)
        results["services"] = {str(item.get("slug")): item for item in snapshot if isinstance(item, dict)}
    except Exception as exc:
        logger.warning("Notification monitor service collection failed (%s)", type(exc).__name__)
    try:
        results["metrics"] = await asyncio.to_thread(get_pi_status)
    except Exception as exc:
        logger.warning("Notification monitor system collection failed (%s)", type(exc).__name__)

    with session_factory() as db:
        state_rows = db.query(MonitorState).all()
        for row in state_rows:
            try:
                state = json.loads(row.value_json)
                last_sample = state.get("last_sample") or state.get("last_cycle")
                if last_sample and now - datetime.fromisoformat(last_sample) > timedelta(seconds=settings.notification_monitor_interval_seconds * 2):
                    for field in ("candidate", "candidate_since", "recover_since", "failures", "successes", "count"):
                        state.pop(field, None)
                    if isinstance(state.get("pending_action"), dict):
                        state["pending_action"]["successes"] = 0
                    row.value_json = json.dumps(state, sort_keys=True, separators=(",", ":"))
            except (ValueError, TypeError):
                continue

        for device in device_descriptors:
            _device_sample(db, device, results.get("devices", {}).get(device.id, "unknown"), now, settings)
        for slug in settings.monitored_service_names:
            if slug in CONTROLLABLE_SERVICES:
                raw = results.get("services", {}).get(slug, {"status": "unknown"})
                _service_sample(db, slug, raw, now, settings)
        metrics = results.get("metrics")
        _metric_transition(db, key="metric:temperature", value=getattr(metrics, "temperature_c", None), now=now,
            duration=settings.notification_temperature_duration_seconds,
            recovery_duration=settings.notification_metric_recovery_seconds,
            trigger=lambda v: v > settings.notification_temperature_high_c,
            recovery=lambda v: v <= settings.notification_temperature_recovery_c,
            warning_event="temperature_high", title="Raspberry Pi temperature", metric_name="temperature",
            recovery_title="Raspberry Pi temperature returned to normal", path="/settings/system", settings=settings)
        _metric_transition(db, key="metric:disk", value=getattr(metrics, "disk_percent", None), now=now,
            duration=settings.notification_disk_duration_seconds,
            recovery_duration=settings.notification_metric_recovery_seconds,
            trigger=lambda v: v > settings.notification_disk_warning_percent,
            critical_trigger=lambda v: v > settings.notification_disk_critical_percent,
            degraded=lambda v: v <= settings.notification_disk_degraded_percent, degraded_event="disk_degraded",
            recovery=lambda v: v <= settings.notification_disk_recovery_percent,
            warning_event="disk_high", critical_event="disk_critical", title="Disk usage",
            metric_name="disk", recovery_title="Disk usage returned to normal", path="/settings/system", settings=settings)
        _metric_transition(db, key="metric:memory", value=getattr(metrics, "memory_percent", None), now=now,
            duration=settings.notification_memory_duration_seconds,
            recovery_duration=settings.notification_metric_recovery_seconds,
            trigger=lambda v: v > settings.notification_memory_high_percent,
            recovery=lambda v: v <= settings.notification_memory_recovery_percent,
            warning_event="memory_high", title="Memory usage", metric_name="memory",
            recovery_title="Memory usage returned to normal", path="/settings/system", settings=settings)

        collection_failed = any(source not in results for source in ("devices", "services", "metrics")) or metrics is None
        monitor_state = _state(db, "monitor:availability")
        previous_cycle = monitor_state.get("last_cycle")
        if previous_cycle:
            try:
                if now - datetime.fromisoformat(previous_cycle) > timedelta(
                    seconds=max(settings.notification_monitor_interval_seconds * 2, 60)
                ):
                    monitor_state["failures"] = 0
                    monitor_state["successes"] = 0
            except (ValueError, TypeError):
                monitor_state["failures"] = 0
                monitor_state["successes"] = 0
        monitor_state["last_cycle"] = now.isoformat()
        if collection_failed:
            monitor_state["failures"] = int(monitor_state.get("failures", 0)) + 1
            monitor_state["successes"] = 0
            if monitor_state["failures"] >= 3 and not monitor_state.get("active_event"):
                event_key = _new_incident(monitor_state, "monitor-unavailable")
                monitor_state["active_event"] = event_key
                _notify(db, event_key=event_key, event_type="monitoring_unavailable", category="system", severity="warning",
                    title="Infrastructure monitoring unavailable", message="PiHomeHub could not collect complete infrastructure status for three checks.",
                    source_type="system", source_id="monitor", target_path="/settings/system", now=now)
        else:
            monitor_state["successes"] = int(monitor_state.get("successes", 0)) + 1
            monitor_state["failures"] = 0
            if monitor_state["successes"] >= 2 and monitor_state.get("active_event"):
                resolve_incident(db, monitor_state["active_event"], now)
                event_key = _new_incident(monitor_state, "monitor-recovered")
                _notify(db, event_key=event_key, event_type="monitoring_recovered", category="system", severity="success",
                    title="Infrastructure monitoring recovered", message="PiHomeHub can collect infrastructure status again.",
                    source_type="system", source_id="monitor", target_path="/settings/system", now=now)
                monitor_state.pop("active_event", None)
        _save_state(db, "monitor:availability", monitor_state, now)
        db.commit()


async def monitor_loop(session_factory: sessionmaker, interval: int | None = None) -> None:
    settings = get_settings()
    interval = interval or settings.notification_monitor_interval_seconds
    while True:
        try:
            await run_monitor_cycle(session_factory, settings)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Notification monitor cycle failed (%s)", type(exc).__name__)
        await asyncio.sleep(interval)
