import json
import os
from pathlib import Path
import subprocess

import yaml


ROOT = Path(__file__).parents[4]


def test_production_compose_has_single_ingress_and_isolates_docker_socket():
    compose = yaml.safe_load((ROOT / "infra" / "docker-compose.yml").read_text())
    services = compose["services"]
    assert "ports" not in services["backend"]
    assert "ports" not in services["web"]
    assert "ports" not in services["control-agent"]
    assert services["caddy"]["ports"] == [
        "${PIHOMEHUB_INGRESS_BIND_ADDRESS:-127.0.0.1}:${PIHOMEHUB_HTTPS_PORT:-443}:443"
    ]
    assert all("docker.sock" not in str(volume) for volume in services["backend"].get("volumes", []))
    assert any("docker.sock" in str(volume) for volume in services["control-agent"]["volumes"])
    assert services["control-agent"]["networks"] == ["control"]
    assert services["control-agent"]["group_add"] == ["${DOCKER_GID:-999}"]
    assert services["caddy"]["networks"]["edge"]["ipv4_address"] == "172.30.0.2"
    assert services["backend"]["environment"]["PIHOMEHUB_TRUSTED_PROXY_IPS"] == "172.30.0.2"
    assert services["backend"]["environment"]["PIHOMEHUB_PORT_CONFIGURATION_MODE"] == "operator"
    compose_env_mount = next(
        volume for volume in services["backend"]["volumes"]
        if isinstance(volume, dict) and volume.get("target") == "/run/pihomehub/infra.env"
    )
    assert compose_env_mount["read_only"] is True
    assert compose_env_mount["bind"]["create_host_path"] is False
    assert compose["networks"]["control"]["internal"] is True


def test_production_frontend_is_static_and_backend_has_no_docker_cli():
    web_dockerfile = (ROOT / "apps" / "web" / "Dockerfile").read_text()
    backend_dockerfile = (ROOT / "apps" / "backend" / "Dockerfile").read_text()
    assert "npm run dev" not in web_dockerfile
    assert "COPY --from=build /app/dist" in web_dockerfile
    assert "docker-cli" not in backend_dockerfile
    assert "USER pihomehub" in backend_dockerfile
    control_agent_dockerfile = (ROOT / "apps" / "control_agent" / "Dockerfile").read_text()
    assert "USER control-agent" in control_agent_dockerfile
    ingress = (ROOT / "infra" / "caddy" / "Caddyfile").read_text()
    assert "header_up -Cookie" in ingress
    assert "header_up -Authorization" in ingress
    assert "header_up -X-CSRF-Token" in ingress


def test_service_worker_invalidates_old_caches_and_never_caches_api():
    worker = (ROOT / "apps" / "web" / "public" / "sw.js").read_text()
    assert 'CACHE_VERSION = "pihomehub-shell-v2"' in worker
    assert "caches.delete" in worker
    assert 'pathname.startsWith("/api/")' in worker
    assert "CLEAR_AUTH_CACHES" in worker
    assert '"/dashboard"' not in worker


def test_mqtt_disables_anonymous_access_and_requires_acl():
    config = (ROOT / "infra" / "mosquitto" / "mosquitto.conf").read_text()
    assert "allow_anonymous false" in config
    assert "password_file " in config
    assert "acl_file " in config
    compose = yaml.safe_load((ROOT / "infra" / "docker-compose.yml").read_text())
    assert compose["services"]["mosquitto"]["profiles"] == ["mqtt"]


def test_production_images_use_exact_version_tags():
    compose = yaml.safe_load((ROOT / "infra" / "docker-compose.yml").read_text())
    for service in ("caddy", "adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"):
        image = compose["services"][service]["image"]
        assert "@sha256:" in image
        assert ":latest" not in image
        tag = image.rsplit(":", 1)[-1]
        assert any(character.isdigit() for character in tag)
        assert tag not in {"1", "2", "alpine"}

    dockerfiles = [
        ROOT / "apps" / "backend" / "Dockerfile",
        ROOT / "apps" / "control_agent" / "Dockerfile",
        ROOT / "apps" / "web" / "Dockerfile",
    ]
    for dockerfile in dockerfiles:
        for line in dockerfile.read_text().splitlines():
            if line.startswith("FROM "):
                assert "@sha256:" in line.split()[1]
                assert any(character.isdigit() for character in line.split()[1].rsplit(":", 1)[-1])


def test_dev_compose_does_not_require_production_environment():
    env = os.environ.copy()
    for key in (
        "PIHOMEHUB_SECRET_KEY",
        "PIHOMEHUB_CONTROL_AGENT_SECRET",
        "PIHOMEHUB_PUBLIC_BASE_URL",
        "PIHOMEHUB_ALLOWED_ORIGINS",
    ):
        env.pop(key, None)
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            "/dev/null",
            "-f",
            str(ROOT / "infra" / "docker-compose.yml"),
            "-f",
            str(ROOT / "infra" / "docker-compose.dev.yml"),
            "config",
            "--format",
            "json",
        ],
        cwd=ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    config = json.loads(result.stdout)
    backend_environment = config["services"]["backend"]["environment"]
    agent_environment = config["services"]["control-agent"]["environment"]
    web_command = config["services"]["web"]["command"]
    assert backend_environment["PIHOMEHUB_ENV"] == "development"
    assert backend_environment["PIHOMEHUB_PUBLIC_BASE_URL"] == "http://localhost:5173"
    assert backend_environment["PIHOMEHUB_ALLOWED_ORIGINS"] == (
        "http://localhost:5173,http://127.0.0.1:5173"
    )
    assert backend_environment["PIHOMEHUB_CONTROL_AGENT_SECRET"] == agent_environment[
        "PIHOMEHUB_CONTROL_AGENT_SECRET"
    ]
    assert web_command == ["sh", "-c", "npm ci && npm run dev -- --host 0.0.0.0"]
