from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.services import ServiceActionResult, ServiceCapabilityRead, ServiceStatusRead
from app.services.control_agent_client import ControlAgentError, get_service_snapshot, request_service_action

logger = logging.getLogger(__name__)
settings = get_settings()
COMPOSE_PROFILE = "home-services"
CONTROLLABLE_SERVICES: dict[str, tuple[str, ...]] = {
    slug: ("start", "stop", "restart") for slug in settings.monitored_service_names
}
ACTION_MESSAGES = {
    "start": "Service start requested.",
    "stop": "Service stop requested.",
    "restart": "Service restart requested.",
}


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
COMPOSE_FILE = Path(settings.compose_file).resolve() if settings.compose_file else DEFAULT_COMPOSE_FILE
COMPOSE_PROJECT_DIR = (
    Path(settings.compose_project_directory).resolve() if settings.compose_project_directory else DEFAULT_COMPOSE_PROJECT_DIR
)


def _snapshot_by_slug() -> dict[str, dict]:
    try:
        return {
            str(item.get("slug")): item
            for item in get_service_snapshot()
            if isinstance(item, dict) and item.get("slug") in CONTROLLABLE_SERVICES
        }
    except ControlAgentError:
        return {}


def _docker_rows() -> dict[str, tuple[str, str]]:
    return {
        slug: (str(item.get("status", "unknown")), str(item.get("detail", "Status unavailable"))[:160])
        for slug, item in _snapshot_by_slug().items()
    }


def get_running_ports(slug: str) -> dict[tuple[int, str], int]:
    item = _snapshot_by_slug().get(slug, {})
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
    rows = _docker_rows()
    return [
        ServiceStatusRead(
            name=slug.replace("-", " ").title(),
            slug=slug,
            status=rows.get(slug, ("unknown", "Control agent unavailable"))[0],
            detail=rows.get(slug, ("unknown", "Control agent unavailable"))[1],
        )
        for slug in settings.monitored_service_names
    ]


def get_service_capabilities(_: Session) -> list[ServiceCapabilityRead]:
    return [ServiceCapabilityRead(slug=slug, actions=list(actions)) for slug, actions in sorted(CONTROLLABLE_SERVICES.items())]


def run_service_action(_: Session, slug: str, action: str) -> ServiceActionResult:
    allowed_actions = CONTROLLABLE_SERVICES.get(slug)
    if allowed_actions is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service is not controllable")
    if action not in allowed_actions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported service action")
    try:
        result = request_service_action(slug, action)
    except ControlAgentError as exc:
        logger.warning("Control-agent operation failed for %s:%s", slug, action)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Control agent operation failed") from exc
    return ServiceActionResult(slug=slug, action=action, ok=bool(result.get("ok")), message=ACTION_MESSAGES[action])


def recreate_service(_: Session, slug: str) -> ServiceActionResult:
    if slug not in CONTROLLABLE_SERVICES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service is not controllable")
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Port changes require an operator-controlled Docker Compose redeployment",
    )
