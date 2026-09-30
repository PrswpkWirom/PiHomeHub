from __future__ import annotations

import asyncio
from contextlib import contextmanager
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import sqlite3
# This service deliberately invokes Docker only with fixed, allowlisted arguments.
import subprocess  # nosec B404
import threading
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PIHOMEHUB_CONTROL_AGENT_", extra="ignore")
    secret: str
    services: str = "adguard-home,gitea,uptime-kuma,vaultwarden,mosquitto"
    compose_file: str = "/run/pihomehub/services.compose.json"
    catalog_file: str = "/run/pihomehub/services.json"
    operations_db: str = "/data/operations.db"

    @property
    def allowlist(self) -> frozenset[str]:
        return frozenset(item.strip() for item in self.services.split(",") if item.strip())

    @model_validator(mode="after")
    def validate_security(self) -> "Settings":
        supported = {"adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"}
        if len(self.secret) < 32:
            raise ValueError("control-agent secret must contain at least 32 characters")
        if not self.allowlist.issubset(supported):
            raise ValueError("control-agent services must come from the fixed Phase 1 allowlist")
        return self


settings = Settings()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_recent_nonces: deque[tuple[float, str]] = deque(maxlen=4096)
ALLOWED_ACTIONS = frozenset({"start", "stop", "restart", "create"})
ACTIVE_STATES = ("queued", "running", "verifying", "unknown")
TERMINAL_STATES = ("succeeded", "failed")
_db_lock = threading.RLock()


def _connect() -> sqlite3.Connection:
    path = Path(settings.operations_db)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=10000")
    if connection.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
        connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("""CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        action TEXT NOT NULL,
        state TEXT NOT NULL,
        stage TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        before_started_at TEXT,
        actor_user_id INTEGER,
        error_code TEXT,
        message TEXT
    )""")
    columns = {row[1] for row in connection.execute("PRAGMA table_info(operations)")}
    if "actor_user_id" not in columns:
        connection.execute("ALTER TABLE operations ADD COLUMN actor_user_id INTEGER")
    connection.execute("CREATE INDEX IF NOT EXISTS ix_operations_slug_created ON operations(slug, created_at DESC)")
    return connection


@contextmanager
def _connection():
    connection = _connect()
    try:
        yield connection
    finally:
        connection.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _operation(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def _authenticate(request: Request, body: bytes) -> None:
    timestamp = request.headers.get("x-control-timestamp", "")
    nonce = request.headers.get("x-control-nonce", "")
    supplied = request.headers.get("x-control-signature", "")
    try:
        request_time = int(timestamp)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    now = time.time()
    if abs(now - request_time) > 30 or not nonce or len(nonce) > 128:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    while _recent_nonces and _recent_nonces[0][0] < now - 60:
        _recent_nonces.popleft()
    if any(seen == nonce for _, seen in _recent_nonces):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    canonical = "\n".join((timestamp, nonce, request.method.upper(), request.url.path, hashlib.sha256(body).hexdigest()))
    expected = hmac.new(settings.secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    _recent_nonces.append((now, nonce))


def _docker(args: list[str], timeout: int = 10) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(["/usr/bin/docker", *args], capture_output=True, text=True, check=False, timeout=timeout)  # nosec B603
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Docker is unavailable") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=503, detail="Docker did not respond") from exc


def _inspect(slug: str) -> dict[str, Any]:
    result = _docker(["inspect", slug], timeout=8)
    if result.returncode != 0:
        if "no such object" in result.stderr.lower() or "no such container" in result.stderr.lower():
            return {"slug": slug, "status": "missing", "detail": "Container not installed", "health_status": None,
                    "ports": [], "started_at": None, "labels": {}}
        logger.error("Docker inspect failed for allowlisted service %s", slug)
        raise HTTPException(status_code=503, detail="Docker status is unavailable")
    try:
        payload = json.loads(result.stdout)[0]
    except (json.JSONDecodeError, IndexError, TypeError):
        raise HTTPException(status_code=503, detail="Docker returned an invalid status")
    state = payload.get("State", {})
    status_name = str(state.get("Status", "unknown"))[:32]
    ports: list[dict[str, Any]] = []
    configured = payload.get("NetworkSettings", {}).get("Ports") or payload.get("HostConfig", {}).get("PortBindings") or {}
    for binding, host_bindings in configured.items():
        if "/" not in binding:
            continue
        target, protocol = binding.split("/", 1)
        for host_binding in host_bindings or []:
            try:
                ports.append({"container_port": int(target), "host_port": int(host_binding["HostPort"]), "protocol": protocol,
                              "host_ip": host_binding.get("HostIp")})
            except (KeyError, TypeError, ValueError):
                continue
    health = state.get("Health")
    health_status = health.get("Status") if isinstance(health, dict) else None
    if health_status not in {"healthy", "unhealthy", "starting"}:
        health_status = None
    return {"slug": slug, "status": status_name, "health_status": health_status, "detail": status_name.title(),
            "ports": ports, "started_at": state.get("StartedAt"), "labels": payload.get("Config", {}).get("Labels", {}) or {}}


def _catalog() -> dict[str, dict[str, Any]]:
    try:
        content = json.loads(Path(settings.catalog_file).read_text(encoding="utf-8"))
        if content.get("project") != "infra":
            raise ValueError("wrong project")
        values = {entry["slug"]: entry for entry in content.get("services", []) if entry.get("slug") in settings.allowlist}
        if set(values) != set(settings.allowlist):
            raise ValueError("missing allowlisted service")
        return values
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Service configuration is unavailable")


def _manifest_service(slug: str) -> dict[str, Any]:
    try:
        content = json.loads(Path(settings.compose_file).read_text(encoding="utf-8"))
        if content.get("name") != "infra" or slug not in content.get("services", {}):
            raise ValueError("service configuration mismatch")
        service = content["services"][slug]
        safe_keys = {"profiles", "container_name", "image", "logging", "networks", "ports", "restart", "volumes", "environment"}
        if service.get("container_name") != slug or not str(service.get("image", "")).split("@sha256:")[-1].isalnum():
            raise ValueError("unsafe service configuration")
        if not service.get("image", "").count("@sha256:") == 1:
            raise ValueError("unpinned service image")
        return {key: value for key, value in service.items() if key in safe_keys}
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Service creation configuration is unavailable")


def _check_setup(slug: str, catalog: dict[str, Any]) -> None:
    if slug == "mosquitto" and not catalog.get("setup_ready"):
        raise HTTPException(status_code=409, detail="Mosquitto setup required: create credentials and an ACL before installation")


def _check_ownership(info: dict[str, Any], slug: str) -> None:
    if info["status"] == "missing":
        return
    labels = info.get("labels", {})
    if labels.get("com.docker.compose.project") != "infra" or labels.get("com.docker.compose.service") != slug:
        raise HTTPException(status_code=409, detail="A container with this name exists outside the PiHomeHub service project")


def _read_operation(operation_id: str) -> dict[str, Any] | None:
    with _connection() as connection:
        row = connection.execute("SELECT * FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
        return _operation(row)


def _enqueue(slug: str, action: str, operation_id: str, actor_user_id: int) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", operation_id):
        raise HTTPException(status_code=422, detail="Invalid operation id")
    with _connection() as connection:
        existing = connection.execute("SELECT * FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
        if existing:
            if existing["slug"] != slug or existing["action"] != action:
                raise HTTPException(status_code=409, detail="Operation id was already used for another action")
            return _operation(existing) or {}
    catalog = _catalog()
    info = _inspect(slug)
    _check_ownership(info, slug)
    if action == "create":
        if info["status"] != "missing":
            raise HTTPException(status_code=409, detail="Service is already installed")
        _check_setup(slug, catalog[slug])
        _manifest_service(slug)
    elif action == "start" and info["status"] not in {"created", "exited", "dead", "stopped"}:
        raise HTTPException(status_code=409, detail="Only a stopped installed service can be started")
    elif action == "stop" and info["status"] != "running":
        raise HTTPException(status_code=409, detail="Only a running service can be stopped")
    elif action == "restart" and info["status"] != "running":
        raise HTTPException(status_code=409, detail="Only a running service can be restarted")

    with _db_lock, _connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute("SELECT * FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
        if existing:
            if existing["slug"] != slug or existing["action"] != action:
                raise HTTPException(status_code=409, detail="Operation id was already used for another action")
            connection.commit()
            return _operation(existing) or {}
        active = connection.execute(
            "SELECT operation_id FROM operations WHERE slug=? AND state IN ('queued','running','verifying','unknown') ORDER BY created_at DESC LIMIT 1",
            (slug,),
        ).fetchone()
        if active:
            raise HTTPException(status_code=409, detail="Another service operation needs to finish or be checked first")
        now = _now()
        connection.execute(
            "INSERT INTO operations(operation_id,slug,action,state,stage,created_at,updated_at,before_started_at,actor_user_id) VALUES(?,?,?,?,?,?,?,?,?)",
            (operation_id, slug, action, "queued", "queued", now, now, info.get("started_at"), actor_user_id),
        )
        row = connection.execute("SELECT * FROM operations WHERE operation_id=?", (operation_id,)).fetchone()
        connection.commit()
    threading.Thread(target=_execute, args=(operation_id,), name=f"service-{slug}-{action}", daemon=True).start()
    return _operation(row) or {}


def _update(operation_id: str, *, state: str | None = None, stage: str | None = None,
            error_code: str | None = None, message: str | None = None, terminal: bool = False) -> None:
    fields = ["updated_at=?"]
    values: list[Any] = [_now()]
    if state is not None:
        fields.append("state=?")
        values.append(state)
        if state == "succeeded":
            fields.append("error_code=NULL")
    if stage is not None:
        fields.append("stage=?")
        values.append(stage)
    if error_code is not None:
        fields.append("error_code=?")
        values.append(error_code)
    if message is not None:
        fields.append("message=?")
        values.append(message[:240])
    if terminal:
        fields.append("finished_at=?")
        values.append(_now())
    values.append(operation_id)
    with _connection() as connection:
        connection.execute(f"UPDATE operations SET {','.join(fields)} WHERE operation_id=?", values)


def _docker_command(operation_id: str, action: str, slug: str) -> tuple[str, str]:
    if action == "create":
        deadline = time.monotonic() + 600

        def run_compose(args: list[str], stage: str, maximum_seconds: int) -> subprocess.CompletedProcess[str]:
            remaining = int(deadline - time.monotonic())
            if remaining <= 0:
                raise RuntimeError("CREATE_TIMEOUT:Image acquisition and container creation exceeded 10 minutes.")
            _update(operation_id, stage=stage)
            command = ["compose", "--project-name", "infra", "--profile", "*", "-f", settings.compose_file, *args, slug]
            result = _docker(command, timeout=min(remaining, maximum_seconds))
            if result.returncode != 0:
                code, message = _safe_error(result.stderr)
                raise RuntimeError(f"{code}:{message}")
            return result

        _update(operation_id, state="running", stage="downloading")
        run_compose(["pull"], "downloading", 600)
        run_compose(["create"], "creating", 600)
        run_compose(["start"], "starting", 120)
        return "", ""
    _update(operation_id, state="running", stage={"start": "starting", "stop": "stopping", "restart": "restarting"}[action])
    result = _docker([action, slug], timeout=120)
    if result.returncode != 0:
        code, message = _safe_error(result.stderr)
        raise RuntimeError(f"{code}:{message}")
    return "", ""




def _safe_error(stderr: str) -> tuple[str, str]:
    value = (stderr or "").lower()
    if "unknown flag" in value or "unknown command" in value:
        return "COMPOSE_COMMAND_INVALID", "The installed Docker Compose plugin rejected the service command."
    if "address already in use" in value or "port is already allocated" in value:
        return "PORT_IN_USE", "A configured host port is already in use."
    if "no such container" in value:
        return "CONTAINER_MISSING", "The service container is no longer installed."
    if "permission denied" in value or "permission" in value and "docker.sock" in value:
        return "DOCKER_ACCESS", "PiHomeHub cannot access Docker. Check the Docker socket group configuration."
    if "pull access denied" in value or "manifest unknown" in value or "not found" in value:
        return "IMAGE_UNAVAILABLE", "The configured service image could not be downloaded."
    return "DOCKER_FAILED", "Docker could not complete the service operation."


def _expected(operation: dict[str, Any], info: dict[str, Any]) -> bool:
    action = operation["action"]
    if action == "stop":
        return info["status"] in {"exited", "dead", "stopped"}
    if action == "restart":
        return bool(info.get("started_at") and info.get("started_at") != operation.get("before_started_at") and info["status"] == "running")
    return info["status"] == "running"


def _execute(operation_id: str) -> None:
    operation = _read_operation(operation_id)
    if not operation:
        return
    try:
        _docker_command(operation_id, operation["action"], operation["slug"])
        _update(operation_id, state="verifying", stage="verifying")
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            info = _inspect(operation["slug"])
            if _expected(operation, info):
                _update(operation_id, state="succeeded", stage="complete", terminal=True, message="Operation completed and verified.")
                return
            time.sleep(2)
        _update(operation_id, state="unknown", stage="verifying", error_code="VERIFY_TIMEOUT",
                message="Docker accepted the operation, but the final service state could not be confirmed.")
    except HTTPException as exc:
        code, message = _safe_error(str(exc.detail))
        uncertain = exc.status_code == 503
        _update(operation_id, state="unknown" if uncertain else "failed", stage="verifying" if uncertain else "failed", error_code=code, message=message, terminal=not uncertain)
    except RuntimeError as exc:
        parts = str(exc).split(":", 1)
        code, message = (parts[0], parts[1]) if len(parts) == 2 else ("DOCKER_FAILED", "Docker could not complete the operation.")
        _update(operation_id, state="failed", stage="failed", error_code=code, message=message, terminal=True)
    except Exception as exc:  # keep worker failures safe and visible
        logger.error("Service operation %s failed (%s)", operation_id, type(exc).__name__)
        _update(operation_id, state="unknown", stage="verifying", error_code="OUTCOME_UNKNOWN",
                message="PiHomeHub could not confirm the operation result. Check service status before retrying.")


def _reconcile(operation: dict[str, Any]) -> dict[str, Any]:
    if operation["state"] not in ACTIVE_STATES:
        return operation
    try:
        info = _inspect(operation["slug"])
    except HTTPException:
        _update(operation["operation_id"], state="unknown", stage="verifying", error_code="STATUS_UNAVAILABLE",
                message="Docker status is unavailable. Check the service again before retrying.")
        return _read_operation(operation["operation_id"]) or operation
    if _expected(operation, info):
        _update(operation["operation_id"], state="succeeded", stage="complete", terminal=True,
                message="Operation completed and verified after reconnecting.")
    elif operation["state"] != "unknown":
        _update(operation["operation_id"], state="unknown", stage="verifying", error_code="AGENT_RESTARTED",
                message="The control agent restarted during this operation. Check status before retrying.")
    latest = _read_operation(operation["operation_id"])
    return latest or operation


def _operations_for_services() -> dict[str, list[dict[str, Any]]]:
    with _connection() as connection:
        rows = connection.execute("""SELECT * FROM (
            SELECT operations.*, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at DESC, rowid DESC) AS position
            FROM operations WHERE created_at >= datetime('now', '-7 days')
        ) WHERE position <= 50 ORDER BY slug, created_at ASC, operation_id ASC""").fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row["slug"], []).append(_operation(row) or {})
        return grouped


def _snapshot() -> list[dict[str, Any]]:
    catalog = _catalog()
    operations = _operations_for_services()
    result = []
    for slug in sorted(settings.allowlist):
        info = _inspect(slug)
        service_operations = operations.get(slug, [])
        operation = service_operations[-1] if service_operations else None
        if operation and operation["state"] == "unknown":
            operation = _reconcile(operation)
            service_operations[-1] = operation
        entry = catalog[slug]
        info["operation"] = operation
        info["operations"] = service_operations
        info["host_ip"] = entry.get("host_ip")
        info["host_ports"] = entry.get("ports", {})
        info["setup_required"] = bool(entry.get("requires_setup") and not entry.get("setup_ready"))
        web_key = {"adguard-home": "web", "gitea": "http", "uptime-kuma": "http", "vaultwarden": "http"}.get(slug)
        info["url"] = f"http://{entry['host_ip']}:{entry['ports'][web_key]}" if web_key and entry.get("host_ip") and web_key in entry.get("ports", {}) else None
        result.append(info)
    return result


def _initialize() -> None:
    with _connection() as connection:
        connection.execute("SELECT 1")


@app.on_event("startup")
def recover_after_restart() -> None:
    with _connection() as connection:
        connection.execute("UPDATE operations SET error_code=NULL WHERE state='succeeded' AND error_code IS NOT NULL")
        rows = connection.execute("SELECT * FROM operations WHERE state IN ('queued','running','verifying')").fetchall()
    for row in rows:
        operation = _operation(row)
        if operation:
            _reconcile(operation)


@app.get("/health", include_in_schema=False)
async def healthcheck():
    try:
        await asyncio.to_thread(_initialize)
        return {"status": "ok"}
    except (OSError, sqlite3.Error):
        raise HTTPException(status_code=503, detail="Operation journal unavailable")


@app.get("/v1/services")
async def service_status(request: Request):
    await request.body()
    _authenticate(request, b"")
    return {"services": await asyncio.to_thread(_snapshot)}


@app.post("/v1/services/{slug}/actions/{action}")
async def service_action(slug: str, action: str, request: Request):
    body = await request.body()
    _authenticate(request, body)
    if slug not in settings.allowlist or action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service or action is not allowed")
    try:
        payload = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid operation request")
    operation_id = payload.get("operation_id") if isinstance(payload, dict) else None
    actor_user_id = payload.get("actor_user_id") if isinstance(payload, dict) else None
    if not isinstance(actor_user_id, int) or isinstance(actor_user_id, bool):
        raise HTTPException(status_code=422, detail="Invalid operator identity")
    result = await asyncio.to_thread(_enqueue, slug, action, str(operation_id or ""), actor_user_id)
    return {"operation": result}


@app.get("/v1/operations/{operation_id}")
async def operation_status(operation_id: str, request: Request):
    await request.body()
    _authenticate(request, b"")
    result = await asyncio.to_thread(_read_operation, operation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Operation not found")
    if result["state"] == "unknown":
        result = await asyncio.to_thread(_reconcile, result)
    return {"operation": result}
