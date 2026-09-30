from __future__ import annotations

from dataclasses import dataclass
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.services import ServiceActionResult, ServiceCapabilityRead, ServiceOperationRead, ServiceStatusRead
from app.services.control_agent_client import ControlAgentError, get_service_snapshot, request_service_action

logger = logging.getLogger(__name__)
CONTROLLABLE_SERVICES = {slug: ("create", "start", "stop", "restart") for slug in get_settings().monitored_service_names}


@dataclass(frozen=True)
class ServiceRuntimeSnapshot:
    status: str
    health_status: str | None
    detail: str
    ports: tuple[dict[str, Any], ...]
    started_at: str | None


def _find_repo_root(start: Path, workspace_root: Path = Path("/workspace")) -> Path:
    start_path = start.resolve()
    search_roots = [start_path if start_path.is_dir() else start_path.parent, workspace_root, Path.cwd().resolve()]
    for root in search_roots:
        for candidate in (root, *root.parents):
            if (candidate / "infra" / "docker-compose.yml").exists():
                return candidate.resolve()
    return search_roots[0]


def _default_compose_paths(
    module_file: Path = Path(__file__), workspace_root: Path = Path("/workspace")
) -> tuple[Path, Path]:
    repo_root = _find_repo_root(module_file, workspace_root)
    project_dir = repo_root / "infra"
    return project_dir / "docker-compose.yml", project_dir


DEFAULT_COMPOSE_FILE, DEFAULT_COMPOSE_PROJECT_DIR = _default_compose_paths()


def _snapshot_by_slug(snapshot: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    try:
        items = snapshot if snapshot is not None else get_service_snapshot()
    except ControlAgentError as exc:
        raise HTTPException(status_code=503, detail="Docker service status is temporarily unavailable") from exc
    return {str(item.get("slug")): item for item in items if isinstance(item, dict) and item.get("slug") in CONTROLLABLE_SERVICES}


def _docker_rows(snapshot: list[dict[str, Any]] | None = None) -> dict[str, ServiceRuntimeSnapshot]:
    values = _snapshot_by_slug(snapshot)
    return {
        slug: ServiceRuntimeSnapshot(
            status=str(item.get("status", "unknown")),
            health_status=item.get("health_status") if item.get("health_status") in {"healthy", "unhealthy", "starting"} else None,
            detail=str(item.get("detail", "Status unavailable"))[:160],
            ports=tuple(item.get("ports", ())) if isinstance(item.get("ports", ()), list) else (),
            started_at=item.get("started_at") if isinstance(item.get("started_at"), str) else None,
        )
        for slug, item in values.items()
    }


def get_running_ports(slug: str, snapshot: list[dict[str, Any]] | None = None) -> dict[tuple[int, str], int]:
    item = _snapshot_by_slug(snapshot).get(slug, {})
    raw_ports = item.get("ports", [])
    result: dict[tuple[int, str], int] = {}
    for port in raw_ports if isinstance(raw_ports, list) else []:
        if not isinstance(port, dict):
            continue
        container_port = port.get("container_port")
        host_port = port.get("host_port")
        protocol = port.get("protocol")
        if isinstance(container_port, int) and isinstance(host_port, int) and protocol in {"tcp", "udp"}:
            result[(container_port, protocol)] = host_port
    return result


def get_service_statuses(_: Session) -> list[ServiceStatusRead]:
    rows = _snapshot_by_slug()
    result = []
    for slug in get_settings().monitored_service_names:
        item = rows.get(slug, {})
        operation = item.get("operation")
        result.append(ServiceStatusRead(
            name=slug.replace("-", " ").title(), slug=slug,
            status=str(item.get("status", "unknown")), health_status=item.get("health_status"),
            detail=str(item.get("detail", "Control agent unavailable"))[:160],
            host_ip=item.get("host_ip"), host_ports=item.get("host_ports", {}), url=item.get("url"),
            setup_required=bool(item.get("setup_required", False)),
            operation=ServiceOperationRead.model_validate(operation) if operation else None,
            recent_operations=[ServiceOperationRead.model_validate(item) for item in item.get("operations", [])
                               if isinstance(item, dict)],
        ))
    return result


def get_service_capabilities(_: Session) -> list[ServiceCapabilityRead]:
    try:
        values = get_service_snapshot()
    except ControlAgentError as exc:
        raise HTTPException(status_code=503, detail="Service controls are temporarily unavailable") from exc
    catalog = {item.get("slug"): item for item in values if isinstance(item, dict)}
    return [ServiceCapabilityRead(
        slug=slug,
        actions=list(actions),
        setup_required=bool(catalog.get(slug, {}).get("setup_required", False)),
    ) for slug, actions in sorted(CONTROLLABLE_SERVICES.items())]


def run_service_action(db: Session, slug: str, action: str, operation_id: str, actor_user_id: int) -> ServiceActionResult:
    allowed_actions = CONTROLLABLE_SERVICES.get(slug)
    if allowed_actions is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service is not controllable")
    if action not in allowed_actions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported service action")
    try:
        result = request_service_action(slug, action, operation_id, actor_user_id)
    except ControlAgentError as exc:
        # The request may already be journaled and executing. Keep the caller's idempotency key
        # so the client can recover by querying status or resubmitting the same request.
        logger.warning("Control-agent request failed for %s:%s", slug, action)
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail="The service changed or another operation is active. Refresh service status.") from exc
        if exc.status_code is not None:
            raise HTTPException(status_code=exc.status_code, detail="Docker could not accept the service operation. Check service status before retrying.") from exc
        raise HTTPException(status_code=503, detail="Operation was submitted or may still be running; refresh service status before retrying") from exc
    operation = result.get("operation") if isinstance(result, dict) else None
    if not isinstance(operation, dict):
        raise HTTPException(status_code=502, detail="Control agent returned an invalid operation status")
    return ServiceActionResult(slug=slug, action=action, ok=True, message="Service operation accepted.",
                               operation=ServiceOperationRead.model_validate(operation))
