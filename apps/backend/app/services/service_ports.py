from __future__ import annotations

from dataclasses import dataclass
import json
import logging
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.services import ServicePortConfigRead, ServicePortConfigUpdate, ServicePortRead
from app.services import docker_service

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ServicePortDefinition:
    key: str
    label: str
    env_var: str
    container_port: int
    protocols: tuple[str, ...]
    default_host_port: int


SERVICE_PORTS: dict[str, tuple[ServicePortDefinition, ...]] = {
    "adguard-home": (
        ServicePortDefinition("web", "Web UI", "ADGUARD_WEB_PORT", 3000, ("tcp",), 3001),
        ServicePortDefinition("dns", "DNS", "ADGUARD_DNS_PORT", 53, ("tcp", "udp"), 53),
    ),
    "gitea": (
        ServicePortDefinition("http", "Web UI", "GITEA_HTTP_PORT", 3000, ("tcp",), 3002),
        ServicePortDefinition("ssh", "SSH", "GITEA_SSH_PORT", 22, ("tcp",), 2222),
    ),
    "uptime-kuma": (
        ServicePortDefinition("http", "Web UI", "UPTIME_KUMA_HTTP_PORT", 3001, ("tcp",), 3003),
    ),
    "vaultwarden": (
        ServicePortDefinition("http", "Web UI", "VAULTWARDEN_HTTP_PORT", 80, ("tcp",), 3004),
    ),
    "mosquitto": (
        ServicePortDefinition("mqtt", "MQTT", "MOSQUITTO_MQTT_PORT", 1883, ("tcp",), 1883),
    ),
}


def _compose_env_file() -> Path:
    settings = get_settings()
    if settings.compose_env_file:
        return Path(settings.compose_env_file).resolve()
    return docker_service.COMPOSE_PROJECT_DIR / ".env"


def _read_env_file(path: Path | None = None) -> dict[str, str]:
    env_path = path or _compose_env_file()
    if not env_path.exists():
        return {}

    values: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _write_env_values(updates: dict[str, int], path: Path | None = None) -> None:
    env_path = path or _compose_env_file()
    env_path.parent.mkdir(parents=True, exist_ok=True)

    update_strings = {key: str(value) for key, value in updates.items()}
    seen: set[str] = set()
    next_lines: list[str] = []

    if env_path.exists():
        for line in env_path.read_text().splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key = stripped.split("=", 1)[0].strip()
                if key in update_strings:
                    next_lines.append(f"{key}={update_strings[key]}")
                    seen.add(key)
                    continue
            next_lines.append(line)

    for key in sorted(update_strings):
        if key not in seen:
            next_lines.append(f"{key}={update_strings[key]}")

    env_path.write_text("\n".join(next_lines).rstrip() + "\n")


def _desired_ports(env_values: dict[str, str] | None = None) -> dict[str, dict[str, int]]:
    values = env_values if env_values is not None else _read_env_file()
    desired: dict[str, dict[str, int]] = {}
    for slug, definitions in SERVICE_PORTS.items():
        desired[slug] = {}
        for definition in definitions:
            raw = values.get(definition.env_var)
            try:
                desired[slug][definition.key] = int(raw) if raw is not None and raw != "" else definition.default_host_port
            except ValueError:
                desired[slug][definition.key] = definition.default_host_port
    return desired


def _docker_running_ports(slug: str) -> dict[tuple[int, str], int]:
    return docker_service.get_running_ports(slug)


def _all_managed_running_ports() -> dict[tuple[str, int], tuple[str, str]]:
    managed: dict[tuple[str, int], tuple[str, str]] = {}
    for slug, definitions in SERVICE_PORTS.items():
        running = _docker_running_ports(slug)
        for definition in definitions:
            for protocol in definition.protocols:
                host_port = running.get((definition.container_port, protocol))
                if host_port is not None:
                    managed[(protocol, host_port)] = (slug, definition.key)
    return managed


def _host_listeners() -> dict[str, set[int]]:
    proc_net = Path(get_settings().host_proc_net_path)
    listeners: dict[str, set[int]] = {"tcp": set(), "udp": set()}
    files = {
        "tcp": ("tcp", "tcp6"),
        "udp": ("udp", "udp6"),
    }

    for protocol, names in files.items():
        for name in names:
            path = proc_net / name
            if not path.exists():
                continue
            for line in path.read_text().splitlines()[1:]:
                parts = line.split()
                if len(parts) < 4:
                    continue
                state = parts[3]
                if protocol == "tcp" and state != "0A":
                    continue
                try:
                    port = int(parts[1].rsplit(":", 1)[1], 16)
                except (IndexError, ValueError):
                    continue
                listeners[protocol].add(port)

    return listeners


def _validate_port_number(value: int, label: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} must be a number")
    if value < 1 or value > 65535:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{label} must be between 1 and 65535")


def _validate_desired_ports(slug: str, proposed: dict[str, int]) -> None:
    definitions = {definition.key: definition for definition in SERVICE_PORTS.get(slug, ())}
    if not definitions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service is not configurable")

    unknown_keys = set(proposed) - set(definitions)
    if unknown_keys:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown port setting: {sorted(unknown_keys)[0]}",
        )

    current_desired = _desired_ports()
    merged = {service_slug: dict(ports) for service_slug, ports in current_desired.items()}
    for key, value in proposed.items():
        _validate_port_number(value, definitions[key].label)
        merged[slug][key] = value

    desired_usage: dict[tuple[str, int], tuple[str, str]] = {}
    for service_slug, ports in merged.items():
        service_definitions = {definition.key: definition for definition in SERVICE_PORTS.get(service_slug, ())}
        for key, host_port in ports.items():
            definition = service_definitions.get(key)
            if not definition:
                continue
            for protocol in definition.protocols:
                previous = desired_usage.get((protocol, host_port))
                if previous and previous != (service_slug, key):
                    other_slug, other_key = previous
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Port {host_port}/{protocol} is already configured for {other_slug} {other_key}",
                    )
                desired_usage[(protocol, host_port)] = (service_slug, key)

    managed_running = _all_managed_running_ports()
    host_listeners = _host_listeners()
    for key, host_port in proposed.items():
        definition = definitions[key]
        for protocol in definition.protocols:
            owner = managed_running.get((protocol, host_port))
            if owner and owner[0] != slug:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Port {host_port}/{protocol} is already used by {owner[0]}",
                )
            if host_port in host_listeners.get(protocol, set()) and owner != (slug, key):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Port {host_port}/{protocol} is already in use on this host",
                )


def get_service_port_configs(_: Session) -> list[ServicePortConfigRead]:
    docker_rows = docker_service._docker_rows()
    desired = _desired_ports()
    configs: list[ServicePortConfigRead] = []

    for slug in get_settings().monitored_service_names:
        definitions = SERVICE_PORTS.get(slug)
        if not definitions:
            continue

        state, detail = docker_rows.get(slug, ("missing", "Container not found"))
        running = _docker_running_ports(slug)
        ports: list[ServicePortRead] = []
        has_pending = False

        for definition in definitions:
            desired_host_port = desired[slug][definition.key]
            running_host_ports = {
                protocol: running.get((definition.container_port, protocol))
                for protocol in definition.protocols
            }
            pending = state == "running" and any(
                running_port != desired_host_port
                for running_port in running_host_ports.values()
            )
            has_pending = has_pending or pending
            ports.append(
                ServicePortRead(
                    key=definition.key,
                    label=definition.label,
                    env_var=definition.env_var,
                    container_port=definition.container_port,
                    protocols=list(definition.protocols),
                    default_host_port=definition.default_host_port,
                    desired_host_port=desired_host_port,
                    running_host_ports=running_host_ports,
                    pending=pending,
                )
            )

        configs.append(
            ServicePortConfigRead(
                slug=slug,
                name=slug.replace("-", " ").title(),
                status=state,
                detail=detail,
                has_pending_port_change=has_pending,
                ports=ports,
            )
        )

    return configs


def update_service_port_config(_: Session, slug: str, payload: ServicePortConfigUpdate) -> ServicePortConfigRead:
    if get_settings().is_production:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Production port changes are operator-managed; edit infra/.env and redeploy with Docker Compose",
        )
    definitions = {definition.key: definition for definition in SERVICE_PORTS.get(slug, ())}
    if not definitions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service is not configurable")

    _validate_desired_ports(slug, payload.ports)
    updates = {definitions[key].env_var: value for key, value in payload.ports.items()}
    _write_env_values(updates)

    configs = {config.slug: config for config in get_service_port_configs(_)}
    return configs[slug]
