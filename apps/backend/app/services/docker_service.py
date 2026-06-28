from __future__ import annotations

import subprocess

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.services import ServiceStatusRead

settings = get_settings()


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
