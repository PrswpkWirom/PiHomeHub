#!/usr/bin/env python3
"""Generate a small, non-secret service catalog and fixed Compose manifest."""

from __future__ import annotations

import json
import ipaddress
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INFRA = ROOT / "infra"
OUT = INFRA / "generated"
ALLOWED = {"adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"}
SERVICE_KEYS = {
    "profiles", "container_name", "image", "logging", "networks", "ports",
    "restart", "volumes", "environment",
}
SERVICE_ENV_KEYS = {"gitea": {"USER_UID", "USER_GID"}}
TAILSCALE_NETWORKS = (
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("fd7a:115c:a1e0::/48"),
)
PORT_KEYS = {
    "adguard-home": {3000: "web", 53: "dns"},
    "gitea": {3000: "http", 22: "ssh"},
    "uptime-kuma": {3001: "http"},
    "vaultwarden": {80: "http"},
    "mosquitto": {1883: "mqtt"},
}


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    if not (INFRA / ".env").is_file():
        raise SystemExit("infra/.env is required to generate service configuration")
    command = [
        "docker", "compose", "--env-file", str(INFRA / ".env"), "-f",
        str(INFRA / "docker-compose.yml"), "--profile", "*", "config", "--format", "json",
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)
    resolved = json.loads(result.stdout)
    if resolved.get("name") != "infra":
        raise SystemExit("Resolved Compose project must be infra")

    services = resolved.get("services", {})
    if not ALLOWED.issubset(services):
        raise SystemExit("Resolved Compose configuration is missing an allowlisted service")
    manifest_services: dict[str, dict] = {}
    catalog: list[dict] = []
    bind_ip: str | None = None
    for slug in sorted(ALLOWED):
        source = services[slug]
        ports = source.get("ports", [])
        host_ips = {port.get("host_ip") for port in ports if port.get("host_ip")}
        if not ports or len(host_ips) != 1 or any(not port.get("host_ip") for port in ports):
            raise SystemExit(f"{slug} must bind every published port to one Tailscale address")
        service_ip = next(iter(host_ips))
        try:
            parsed_ip = ipaddress.ip_address(service_ip)
        except ValueError as exc:
            raise SystemExit(f"{slug} has an invalid host bind address") from exc
        if not any(parsed_ip in network for network in TAILSCALE_NETWORKS):
            raise SystemExit(f"{slug} must bind published ports to a Tailscale address")
        if bind_ip is None:
            bind_ip = service_ip
        if service_ip != bind_ip:
            raise SystemExit("Optional services must share one private bind address")
        manifest_service = {key: source[key] for key in SERVICE_KEYS if key in source and key != "environment"}
        environment = source.get("environment", {})
        allowed_environment = SERVICE_ENV_KEYS.get(slug, set())
        if not isinstance(environment, dict) or set(environment) - allowed_environment:
            raise SystemExit(f"{slug} has environment values outside the non-secret allowlist")
        if environment:
            manifest_service["environment"] = environment
        manifest_services[slug] = manifest_service
        published: dict[str, int] = {}
        for port in ports:
            key = PORT_KEYS[slug].get(port.get("target"))
            if key:
                published[key] = int(port["published"])
        password_file = INFRA / "mosquitto/generated/passwords"
        acl_file = INFRA / "mosquitto/generated/acl"
        password_users = set()
        acl_users = set()
        if slug == "mosquitto" and password_file.is_file() and acl_file.is_file():
            password_users = {line.split(":", 1)[0] for line in password_file.read_text(encoding="utf-8").splitlines() if ":" in line}
            acl_users = {line.strip().split(None, 1)[1] for line in acl_file.read_text(encoding="utf-8").splitlines()
                         if line.strip().startswith("user ") and len(line.strip().split(None, 1)) == 2}
        catalog.append({
            "slug": slug,
            "host_ip": service_ip,
            "ports": published,
            "requires_setup": slug == "mosquitto",
            "setup_ready": slug != "mosquitto" or bool(password_users & acl_users),
        })

    volumes = {
        name: resolved.get("volumes", {}).get(name, {})
        for name in sorted({
            str(mount["source"])
            for service in manifest_services.values()
            for mount in service.get("volumes", [])
            if mount.get("type") == "volume"
        })
    }
    networks = {"default": resolved.get("networks", {}).get("default", {})}
    manifest = {"name": "infra", "services": manifest_services, "volumes": volumes, "networks": networks}
    OUT.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chmod(OUT, 0o755)
    atomic_json(OUT / "services.compose.json", manifest)
    atomic_json(OUT / "services.json", {"project": "infra", "services": catalog})


if __name__ == "__main__":
    main()
