from __future__ import annotations

from pathlib import Path
import subprocess

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.services import ServiceActionResult, ServiceCapabilityRead, ServiceStatusRead

settings = get_settings()
COMPOSE_PROFILE = "home-services"


def _find_repo_root(start: Path, workspace_root: Path = Path("/workspace")) -> Path:
    start_path = start.resolve()
    search_roots = [start_path if start_path.is_dir() else start_path.parent, workspace_root, Path.cwd().resolve()]

    for root in search_roots:
        for candidate in (root, *root.parents):
            if (candidate / "infra" / "docker-compose.yml").exists():
                return candidate.resolve()

    return search_roots[0]


def _default_compose_paths(
    module_file: Path = Path(__file__),
    workspace_root: Path = Path("/workspace"),
) -> tuple[Path, Path]:
    repo_root = _find_repo_root(module_file, workspace_root)
    project_dir = repo_root / "infra"
    return project_dir / "docker-compose.yml", project_dir


DEFAULT_COMPOSE_FILE, DEFAULT_COMPOSE_PROJECT_DIR = _default_compose_paths()
COMPOSE_FILE = Path(settings.compose_file).resolve() if getattr(settings, "compose_file", None) else DEFAULT_COMPOSE_FILE
COMPOSE_PROJECT_DIR = (
    Path(settings.compose_project_directory).resolve()
    if getattr(settings, "compose_project_directory", None)
    else DEFAULT_COMPOSE_PROJECT_DIR
)
CONTROLLABLE_SERVICES: dict[str, tuple[str, ...]] = {
    "adguard-home": ("build", "start", "stop", "restart"),
    "gitea": ("build", "start", "stop", "restart"),
    "mosquitto": ("build", "start", "stop", "restart"),
    "uptime-kuma": ("build", "start", "stop", "restart"),
    "vaultwarden": ("build", "start", "stop", "restart"),
}
ACTION_MESSAGES = {
    "build": "Service image prepared.",
    "start": "Service start requested.",
    "stop": "Service stop requested.",
    "restart": "Service restart requested.",
}


def _docker_rows() -> dict[str, tuple[str, str]]:
    try:
        result = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {}

    rows: dict[str, tuple[str, str]] = {}
    for line in result.stdout.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            rows[parts[0]] = (parts[1], parts[2])
    return rows


def get_service_statuses(_: Session) -> list[ServiceStatusRead]:
    docker_rows = _docker_rows()
    statuses: list[ServiceStatusRead] = []
    for slug in settings.monitored_service_names:
        state, detail = docker_rows.get(slug, ("missing", "Container not found"))
        statuses.append(
            ServiceStatusRead(
                name=slug.replace("-", " ").title(),
                slug=slug,
                status=state,
                detail=detail,
            )
        )
    return statuses


def get_service_capabilities(_: Session) -> list[ServiceCapabilityRead]:
    return [
        ServiceCapabilityRead(slug=slug, actions=list(actions))
        for slug, actions in sorted(CONTROLLABLE_SERVICES.items())
    ]


def _compose_base_command() -> list[str]:
    return [
        "docker",
        "compose",
        "-f",
        str(COMPOSE_FILE),
        "--project-directory",
        str(COMPOSE_PROJECT_DIR),
    ]


def _compose_command(slug: str, action: str) -> list[str]:
    base = _compose_base_command()
    if action == "build":
        return base + ["--profile", COMPOSE_PROFILE, "pull", slug]
    if action == "start":
        return base + ["--profile", COMPOSE_PROFILE, "up", "-d", slug]
    if action == "stop":
        return base + ["stop", slug]
    if action == "restart":
        return base + ["--profile", COMPOSE_PROFILE, "up", "-d", "--build", "--force-recreate", slug]
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported service action")


def run_service_action(_: Session, slug: str, action: str) -> ServiceActionResult:
    allowed_actions = CONTROLLABLE_SERVICES.get(slug)
    if allowed_actions is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service is not controllable")
    if action not in allowed_actions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported service action")

    try:
        result = subprocess.run(
            _compose_command(slug, action),
            cwd=COMPOSE_PROJECT_DIR,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Docker CLI is not available") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Docker action timed out") from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Docker action failed").strip().splitlines()
        message = detail[-1] if detail else "Docker action failed"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message[:300])

    return ServiceActionResult(
        slug=slug,
        action=action,
        ok=True,
        message=ACTION_MESSAGES[action],
    )
