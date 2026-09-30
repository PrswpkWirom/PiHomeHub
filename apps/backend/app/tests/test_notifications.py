from datetime import UTC, datetime, timedelta
import json
from types import SimpleNamespace

import pytest
from unittest.mock import AsyncMock
from httpx import ASGITransport

from app.core.config import get_settings
from app.models.device import Device
from app.models.notification import MonitorState, Notification, NotificationRecipient
from app.models.user import User
from app.services.notification_monitor import _device_sample, _metric_transition, _service_sample, claim_monitor_lock, run_monitor_cycle
from app.services.notification_service import create_notification
from app.services.tailscale_service import _record_sync_failure, _record_sync_success
from app.tests.conftest import AsyncClient


async def _login(client):
    response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
    assert response.status_code == 200


@pytest.mark.anyio
async def test_notification_api_auth_pagination_read_and_preferences(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as anon:
        assert (await anon.get("/api/notifications")).status_code == 401

    db = app.state.testing_session_local()
    try:
        for index in range(3):
            create_notification(
                db, event_key=f"test-page-{index}", event_type="device_offline", category="device",
                severity="warning", title=f"Device {index} offline", message="Device did not respond.",
                source_type="device", source_id=str(index), target_path="/devices",
                created_at=datetime.now(UTC) + timedelta(seconds=index),
            )
        db.commit()
    finally:
        db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        first = await client.get("/api/notifications?limit=2&severity=warning&category=device")
        assert first.status_code == 200
        assert len(first.json()["items"]) == 2
        assert first.json()["next_before_id"] is not None
        older = await client.get(f"/api/notifications?limit=2&before_id={first.json()['next_before_id']}")
        assert len(older.json()["items"]) == 1
        assert (await client.get("/api/notifications/unread-count")).json() == {"count": 3}

        notification_id = first.json()["items"][0]["id"]
        assert (await client.patch(f"/api/notifications/{notification_id}/read", json={})).status_code == 204
        assert (await client.patch(f"/api/notifications/{notification_id}/read", json={})).status_code == 204
        assert (await client.get("/api/notifications/unread-count")).json() == {"count": 2}

        preferences = (await client.get("/api/notifications/preferences")).json()
        assert preferences["device_offline"] is True
        preferences["device_offline"] = False
        assert (await client.patch("/api/notifications/preferences", json=preferences)).json()["device_offline"] is False
        partial = await client.patch("/api/notifications/preferences", json={"disk": False})
        assert partial.status_code == 200
        assert partial.json()["device_offline"] is False
        assert partial.json()["disk"] is False

        db = app.state.testing_session_local()
        try:
            event = create_notification(
                db, event_key="muted-for-admin", event_type="device_offline", category="device", severity="warning",
                title="Muted device", message="This event is not delivered to the administrator.",
            )
            db.commit()
            assert event is not None
            assert db.query(NotificationRecipient).filter(
                NotificationRecipient.notification_id == event.id,
                NotificationRecipient.user_id == 1,
            ).count() == 0
        finally:
            db.close()

        result = await client.post("/api/notifications/read-all")
        assert result.status_code == 200
        assert result.json()["updated"] == 2
        assert (await client.post("/api/notifications/read-all")).json()["updated"] == 0
        assert (await client.get("/api/notifications/unread-count")).json() == {"count": 0}

        assert (await client.patch("/api/notifications/999999/read", json={})).status_code == 404


def test_notification_delivery_is_per_user_and_event_keys_deduplicate(app):
    db = app.state.testing_session_local()
    try:
        viewer = User(username="viewer", password_hash="not-used", is_admin=False, is_active=True)
        db.add(viewer)
        db.commit()
        event = create_notification(
            db, event_key="dedupe-event", event_type="device_offline", category="device", severity="warning",
            title="Device offline", message="The device is unreachable.", source_type="device", source_id="7",
        )
        db.commit()
        assert event is not None
        assert create_notification(
            db, event_key="dedupe-event", event_type="device_offline", category="device", severity="warning",
            title="Duplicate", message="Duplicate event.",
        ) is None
        deliveries = db.query(NotificationRecipient).filter(NotificationRecipient.notification_id == event.id).all()
        assert {row.user_id for row in deliveries} == {user.id for user in db.query(User).filter(User.is_active.is_(True)).all()}
        assert db.query(Notification).filter(Notification.event_key == "dedupe-event").count() == 1
    finally:
        db.close()


def test_device_and_service_alerts_only_follow_debounced_transitions(app):
    db = app.state.testing_session_local()
    now = datetime.now(UTC)
    try:
        device = db.query(Device).first()
        assert device is not None
        settings = get_settings()
        _device_sample(db, device, "online", now, settings)
        _device_sample(db, device, "online", now + timedelta(seconds=15), settings)
        for sample in range(3):
            _device_sample(db, device, "offline", now + timedelta(seconds=30 + sample * 30), settings)
        _device_sample(db, device, "offline", now + timedelta(seconds=120), settings)
        assert db.query(Notification).filter(Notification.event_type == "device_offline").count() == 1
        _device_sample(db, device, "online", now + timedelta(seconds=150), settings)
        _device_sample(db, device, "online", now + timedelta(seconds=180), settings)
        assert db.query(Notification).filter(Notification.event_type == "device_recovered").count() == 1

        _service_sample(db, "gitea", {"status": "missing"}, now, settings)
        assert db.query(Notification).filter(Notification.source_id == "gitea").count() == 0
        _service_sample(db, "gitea", {"status": "running"}, now + timedelta(seconds=30), settings)
        for sample in range(3):
            _service_sample(db, "gitea", {"status": "exited"}, now + timedelta(seconds=60 + sample * 30), settings)
        assert db.query(Notification).filter(Notification.source_id == "gitea", Notification.event_type == "service_failure").count() == 1
        for sample in range(3):
            _service_sample(db, "gitea", {"status": "running", "health_status": "healthy"}, now + timedelta(seconds=150 + sample * 30), settings)
        assert db.query(Notification).filter(Notification.source_id == "gitea", Notification.event_type == "service_recovered").count() == 1
    finally:
        db.rollback()
        db.close()


def test_journal_drives_deduplicated_action_notifications_and_stop_is_informational(app):
    db = app.state.testing_session_local()
    settings = get_settings()
    now = datetime.now(UTC)
    try:
        restart = {
            "operation_id": "operation-gitea-restart-complete-0001", "slug": "gitea", "action": "restart",
            "state": "succeeded", "finished_at": now.isoformat(), "actor_user_id": 1,
            "message": "Operation completed and verified.",
        }
        raw = {"status": "running", "operation": restart, "operations": [restart]}
        _service_sample(db, "gitea", raw, now, settings)
        _service_sample(db, "gitea", raw, now + timedelta(seconds=30), settings)
        completed = db.query(Notification).filter(Notification.event_type == "service_action_completed").filter(
            Notification.source_id == "gitea"
        ).one()
        assert completed.severity == "success"
        assert completed.title == "Gitea restart completed"

        stop = {
            "operation_id": "operation-mosquitto-stop-complete-0001", "slug": "mosquitto", "action": "stop",
            "state": "succeeded", "finished_at": now.isoformat(), "actor_user_id": 1,
            "message": "Operation completed and verified.",
        }
        stopped = {"status": "exited", "operation": stop, "operations": [stop]}
        _service_sample(db, "mosquitto", stopped, now + timedelta(seconds=30), settings)
        _service_sample(db, "mosquitto", stopped, now + timedelta(seconds=60), settings)
        stop_notice = db.query(Notification).filter(Notification.event_type == "service_action_completed").filter(
            Notification.source_id == "mosquitto"
        ).one()
        assert stop_notice.severity == "info"
        assert stop_notice.title == "Mosquitto stop completed"
        assert db.query(Notification).filter(Notification.event_type == "service_failure").filter(
            Notification.source_id == "mosquitto"
        ).count() == 0
    finally:
        db.rollback()
        db.close()


def test_failed_action_journal_does_not_duplicate_generic_service_failure(app):
    db = app.state.testing_session_local()
    settings = get_settings()
    now = datetime.now(UTC)
    try:
        db.add(MonitorState(key="service:gitea", value_json=json.dumps({
            "stable": "running", "ever_running": True,
        }), updated_at=now))
        db.commit()
        failed = {
            "operation_id": "operation-gitea-restart-failed-0001", "slug": "gitea", "action": "restart",
            "state": "failed", "finished_at": now.isoformat(), "actor_user_id": 1,
            "message": "Docker could not complete the operation.",
        }
        raw = {"status": "exited", "operation": failed, "operations": [failed]}
        for sample in range(4):
            _service_sample(db, "gitea", raw, now + timedelta(seconds=sample * 30), settings)
        failures = db.query(Notification).filter(Notification.event_type == "service_failure").filter(
            Notification.source_id == "gitea"
        ).all()
        assert len(failures) == 1
        assert failures[0].title == "Gitea restart failed"
    finally:
        db.rollback()
        db.close()


def test_service_escalation_and_recovery_resolve_all_events_in_the_incident(app):
    db = app.state.testing_session_local()
    settings = get_settings()
    now = datetime.now(UTC)
    try:
        first = create_notification(
            db, event_key="service-failure:uptime-kuma:1", event_type="service_failure", category="service",
            severity="warning", title="Uptime Kuma health check failed", message="Uptime Kuma is unhealthy.",
            source_type="service", source_id="uptime-kuma", target_path="/services", created_at=now,
        )
        db.add(MonitorState(key="service:uptime-kuma", value_json=json.dumps({
            "stable": "unhealthy", "ever_running": True, "candidate": None, "count": 0,
            "incident": 1, "active_event": first.event_key, "active_events": [first.event_key],
            "active_severity": "warning",
        }), updated_at=now))
        db.commit()

        for sample in range(3):
            _service_sample(db, "uptime-kuma", {"status": "exited"}, now + timedelta(seconds=30 * (sample + 1)), settings)
        alerts = db.query(Notification).filter(Notification.source_id == "uptime-kuma", Notification.event_type == "service_failure").all()
        assert len(alerts) == 2
        assert {event.severity for event in alerts} == {"warning", "critical"}
        assert all(event.resolved_at is None for event in alerts)

        _service_sample(db, "uptime-kuma", {"status": "running", "health_status": "healthy"}, now + timedelta(seconds=120), settings)
        _service_sample(db, "uptime-kuma", {"status": "running", "health_status": "healthy"}, now + timedelta(seconds=150), settings)
        assert all(event.resolved_at is not None for event in alerts)
    finally:
        db.rollback()
        db.close()


def test_temperature_alert_waits_for_threshold_and_emits_recovery(app):
    from app.core.config import Settings

    db = app.state.testing_session_local()
    settings = Settings(**get_settings().model_dump())
    settings.notification_temperature_duration_seconds = 60
    now = datetime.now(UTC)
    try:
        for offset, value in ((0, 76.0), (30, 77.0), (60, 76.5)):
            _metric_transition(
                db, key="metric:temperature", value=value, now=now + timedelta(seconds=offset), duration=60,
                trigger=lambda sample: sample > 75, recovery=lambda sample: sample <= 70,
                warning_event="temperature_high", title="Raspberry Pi temperature", metric_name="temperature",
                recovery_title="Raspberry Pi temperature returned to normal", path="/settings/system", settings=settings,
            )
        assert db.query(Notification).filter(Notification.event_type == "temperature_high").count() == 1
        for offset, value in ((90, 69.0), (150, 64.0)):
            _metric_transition(
                db, key="metric:temperature", value=value, now=now + timedelta(seconds=offset), duration=60,
                trigger=lambda sample: sample > 75, recovery=lambda sample: sample <= 70,
                warning_event="temperature_high", title="Raspberry Pi temperature", metric_name="temperature",
                recovery_title="Raspberry Pi temperature returned to normal", path="/settings/system", settings=settings,
            )
        recovered = db.query(Notification).filter(Notification.event_type == "temperature_recovered").one()
        assert recovered.severity == "success"
        assert recovered.target_path == "/settings/system"
    finally:
        db.rollback()
        db.close()


def test_tailscale_sync_failure_is_deduplicated_and_resolves_without_secrets(app):
    db = app.state.testing_session_local()
    try:
        _record_sync_failure(db, "Tailscale could not reach its API. Try synchronization again later.")
        _record_sync_failure(db, "Tailscale could not reach its API. Try synchronization again later.")
        failure = db.query(Notification).filter(Notification.event_type == "tailscale_sync_failed").one()
        assert "token" not in failure.message.lower()
        assert db.query(Notification).filter(Notification.event_type == "tailscale_sync_failed").count() == 1
        _record_sync_success(db)
        recovery = db.query(Notification).filter(Notification.event_type == "tailscale_sync_recovered").one()
        assert recovery.severity == "success"
        db.refresh(failure)
        assert failure.resolved_at is not None
    finally:
        db.close()


@pytest.mark.anyio
async def test_monitor_cycle_persists_debounced_device_transitions(app, monkeypatch):
    from app.services import notification_monitor as monitor

    settings = get_settings()
    times = [datetime.now(UTC) + timedelta(seconds=step * 30) for step in range(7)]
    samples = iter(["online", "online", "offline", "offline", "offline", "online", "online"])
    monkeypatch.setattr(monitor, "_probe_devices", AsyncMock(side_effect=lambda _: {1: next(samples)}))
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: [])
    monkeypatch.setattr(monitor, "get_pi_status", lambda: SimpleNamespace(temperature_c=55.0, disk_percent=40.0, memory_percent=35.0))

    for now in times:
        await run_monitor_cycle(app.state.testing_session_local, settings, now)
    db = app.state.testing_session_local()
    try:
        assert db.query(Notification).filter(Notification.event_type == "device_offline").count() == 1
        assert db.query(Notification).filter(Notification.event_type == "device_recovered").count() == 1
    finally:
        db.close()


@pytest.mark.anyio
async def test_monitor_gaps_reset_debounce_evidence_and_recover_availability(app, monkeypatch):
    from app.services import notification_monitor as monitor

    settings = get_settings()
    db = app.state.testing_session_local()
    try:
        device = db.query(Device).first()
        assert device is not None
        device_id = device.id
    finally:
        db.close()

    times = [datetime.now(UTC) + timedelta(seconds=value) for value in (0, 30, 60, 300, 330, 360)]
    samples = iter(["online", "online", "offline", "offline", "offline", "offline"])
    monkeypatch.setattr(monitor, "_probe_devices", AsyncMock(side_effect=lambda _: {device_id: next(samples)}))
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: [])
    monkeypatch.setattr(monitor, "get_pi_status", lambda: SimpleNamespace(temperature_c=55.0, disk_percent=40.0, memory_percent=35.0))
    for now in times[:5]:
        await run_monitor_cycle(app.state.testing_session_local, settings, now)

    db = app.state.testing_session_local()
    try:
        assert db.query(Notification).filter(Notification.event_type == "device_offline").count() == 0
    finally:
        db.close()
    await run_monitor_cycle(app.state.testing_session_local, settings, times[5])

    monkeypatch.setattr(monitor, "_probe_devices", AsyncMock(side_effect=RuntimeError("probe unavailable")))
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: (_ for _ in ()).throw(RuntimeError("agent unavailable")))
    monkeypatch.setattr(monitor, "get_pi_status", lambda: (_ for _ in ()).throw(RuntimeError("metrics unavailable")))
    for offset in (0, 30, 60):
        await run_monitor_cycle(app.state.testing_session_local, settings, times[5] + timedelta(seconds=600 + offset))

    monkeypatch.setattr(monitor, "_probe_devices", AsyncMock(return_value={device_id: "online"}))
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: [])
    monkeypatch.setattr(monitor, "get_pi_status", lambda: SimpleNamespace(temperature_c=55.0, disk_percent=40.0, memory_percent=35.0))
    await run_monitor_cycle(app.state.testing_session_local, settings, times[5] + timedelta(seconds=1200))
    db = app.state.testing_session_local()
    try:
        assert db.query(Notification).filter(Notification.event_type == "monitoring_recovered").count() == 0
    finally:
        db.close()
    await run_monitor_cycle(app.state.testing_session_local, settings, times[5] + timedelta(seconds=1230))
    db = app.state.testing_session_local()
    try:
        assert db.query(Notification).filter(Notification.event_type == "monitoring_unavailable").count() == 1
        assert db.query(Notification).filter(Notification.event_type == "monitoring_recovered").count() == 1
    finally:
        db.close()


def test_monitor_process_lock_has_single_owner(tmp_path):
    database = f"sqlite:///{tmp_path / 'hub.db'}"
    owner = claim_monitor_lock(database)
    assert owner is not None
    try:
        assert claim_monitor_lock(database) is None
    finally:
        owner.close()
    next_owner = claim_monitor_lock(database)
    assert next_owner is not None
    next_owner.close()


def test_intentional_stop_stays_quiet_and_missing_service_recovers(app):
    db = app.state.testing_session_local()
    settings = get_settings()
    now = datetime.now(UTC)
    try:
        db.add(MonitorState(key="service:gitea", value_json=json.dumps({
            "stable": "stopped", "ever_running": True,
        }), updated_at=now))
        db.flush()
        for sample in range(5):
            _service_sample(db, "gitea", {"status": "exited"}, now + timedelta(seconds=sample * 30), settings)
        assert db.query(Notification).filter(Notification.source_id == "gitea").count() == 0
        for sample in range(2):
            _service_sample(db, "gitea", {"status": "running"}, now + timedelta(seconds=150 + sample * 30), settings)
        for sample in range(3):
            _service_sample(db, "gitea", {"status": "missing"}, now + timedelta(seconds=210 + sample * 30), settings)
        alert = db.query(Notification).filter(Notification.source_id == "gitea", Notification.event_type == "service_failure").one()
        for sample in range(2):
            _service_sample(db, "gitea", {"status": "running"}, now + timedelta(seconds=300 + sample * 30), settings)
        assert alert.resolved_at is not None
    finally:
        db.rollback()
        db.close()


def test_metric_recovery_requires_a_fresh_shorter_confirmation_window(app):
    db = app.state.testing_session_local()
    settings = get_settings()
    now = datetime.now(UTC)
    def sample(offset, value):
        _metric_transition(db, key="metric:temperature", value=value, now=now + timedelta(seconds=offset),
            duration=300, recovery_duration=120, trigger=lambda v: v > 75, recovery=lambda v: v <= 70,
            warning_event="temperature_high", title="Temperature", metric_name="temperature",
            recovery_title="Temperature recovered", path="/settings/system", settings=settings)
    try:
        for offset in range(0, 301, 30):
            sample(offset, 78)
        sample(330, 69)
        sample(360, None)
        sample(390, 69)
        sample(420, 72)
        for offset in (450, 480, 510, 540):
            sample(offset, 69)
        assert db.query(Notification).filter(Notification.event_type == "temperature_recovered").count() == 0
        sample(570, 69)
        assert db.query(Notification).filter(Notification.event_type == "temperature_recovered").count() == 1
    finally:
        db.rollback()
        db.close()


@pytest.mark.anyio
async def test_failed_metric_collection_interrupts_confirmation_window(app, monkeypatch):
    from app.services import notification_monitor as monitor

    now = datetime.now(UTC)
    settings = get_settings().model_copy(update={"notification_temperature_duration_seconds": 120})
    monkeypatch.setattr(monitor, "_probe_devices", AsyncMock(return_value={}))
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: [])
    def metrics():
        return SimpleNamespace(temperature_c=80.0, disk_percent=40.0, memory_percent=35.0)
    monkeypatch.setattr(monitor, "get_pi_status", metrics)
    await run_monitor_cycle(app.state.testing_session_local, settings, now)
    monkeypatch.setattr(monitor, "get_pi_status", lambda: (_ for _ in ()).throw(RuntimeError("private failure")))
    await run_monitor_cycle(app.state.testing_session_local, settings, now + timedelta(seconds=30))
    monkeypatch.setattr(monitor, "get_pi_status", metrics)
    for offset in (60, 90, 120, 150):
        await run_monitor_cycle(app.state.testing_session_local, settings, now + timedelta(seconds=offset))
    with app.state.testing_session_local() as db:
        assert db.query(Notification).filter(Notification.event_type == "temperature_high").count() == 0
    await run_monitor_cycle(app.state.testing_session_local, settings, now + timedelta(seconds=180))
    with app.state.testing_session_local() as db:
        assert db.query(Notification).filter(Notification.event_type == "temperature_high").count() == 1


@pytest.mark.anyio
async def test_control_agent_outage_warns_while_other_collectors_keep_working(app, monkeypatch):
    from app.services import notification_monitor as monitor

    now = datetime.now(UTC)
    monkeypatch.setattr(monitor, "_probe_devices", AsyncMock(return_value={}))
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: (_ for _ in ()).throw(RuntimeError("private failure")))
    monkeypatch.setattr(monitor, "get_pi_status", lambda: SimpleNamespace(temperature_c=55.0, disk_percent=40.0, memory_percent=35.0))
    for offset in (0, 30, 60, 90):
        await run_monitor_cycle(app.state.testing_session_local, get_settings(), now + timedelta(seconds=offset))
    with app.state.testing_session_local() as db:
        warning = db.query(Notification).filter(Notification.event_type == "monitoring_unavailable").one()
        assert "private failure" not in warning.message
        assert db.query(Notification).filter(Notification.event_type == "service_failure").count() == 0
    monkeypatch.setattr(monitor, "get_service_snapshot", lambda: [])
    for offset in (120, 150):
        await run_monitor_cycle(app.state.testing_session_local, get_settings(), now + timedelta(seconds=offset))
    with app.state.testing_session_local() as db:
        assert db.query(Notification).filter(Notification.event_type == "monitoring_recovered").count() == 1
