import json
from ipaddress import ip_address, ip_network
from functools import lru_cache
from urllib.parse import urlparse
from typing import Any, Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("apps/backend/.env", ".env"), env_prefix="PIHOMEHUB_", extra="ignore")

    env: str = "development"
    access_mode: Literal["https", "private-http"] = "https"
    secret_key: str = "development-only-change-me"
    database_url: str = "sqlite:///./pihomehub.db"
    admin_username: str = ""
    admin_password: str = ""
    monitored_services: str = "adguard-home,gitea,uptime-kuma,vaultwarden,mosquitto"
    compose_file: str | None = None
    compose_project_directory: str | None = None
    compose_env_file: str | None = None
    service_config_file: str | None = None
    host_proc_net_path: str = "/proc/net"
    host_meminfo_path: str = "/proc/meminfo"
    host_thermal_path: str = "/sys/class/thermal/thermal_zone0/temp"
    host_root_probe_path: str = "/"
    notification_monitor_interval_seconds: int = Field(default=30, ge=10, le=300)
    notification_offline_failures: int = Field(default=3, ge=2, le=10)
    notification_recovery_successes: int = Field(default=2, ge=1, le=10)
    notification_temperature_high_c: float = 75.0
    notification_temperature_recovery_c: float = 70.0
    notification_temperature_duration_seconds: int = 300
    notification_disk_warning_percent: float = 85.0
    notification_disk_critical_percent: float = 95.0
    notification_disk_degraded_percent: float = 90.0
    notification_disk_recovery_percent: float = 80.0
    notification_disk_duration_seconds: int = 120
    notification_memory_high_percent: float = 90.0
    notification_memory_recovery_percent: float = 85.0
    notification_memory_duration_seconds: int = 300
    notification_metric_recovery_seconds: int = Field(default=120, ge=30, le=3600)
    allowed_origins: str = "http://localhost:5173"
    public_base_url: str = "http://localhost:5173"
    session_idle_timeout_seconds: int = Field(default=43_200, ge=300)
    session_absolute_timeout_seconds: int = Field(default=604_800, ge=600)
    recent_authentication_seconds: int = Field(default=600, ge=60)
    login_rate_limit_attempts: int = Field(default=5, ge=2, le=100)
    login_rate_limit_window_seconds: int = Field(default=300, ge=10)
    control_agent_url: str = "http://control-agent:9000"
    control_agent_secret: str = "development-control-agent-secret"
    wol_agent_url: str = ""
    trusted_proxy_ips: str = "127.0.0.1,::1"
    service_links_json: str = "[]"
    known_devices_json: str = "[]"
    port_configuration_mode: Literal["web", "operator"] = "web"
    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    @property
    def is_testing(self) -> bool:
        return self.env.lower() == "testing"

    @property
    def uses_private_http(self) -> bool:
        return self.is_production and self.access_mode == "private-http"

    @property
    def cookie_name(self) -> str:
        if self.uses_private_http:
            return "pihomehub_private_session"
        return "__Host-pihomehub_session" if self.is_production else "pihomehub_session"

    @property
    def csrf_cookie_name(self) -> str:
        if self.uses_private_http:
            return "pihomehub_private_csrf"
        return "__Host-pihomehub_csrf" if self.is_production else "pihomehub_csrf"

    @property
    def cookie_secure(self) -> bool:
        return self.is_production and not self.uses_private_http

    @property
    def monitored_service_names(self) -> list[str]:
        return [item.strip() for item in self.monitored_services.split(",") if item.strip()]

    @property
    def allowed_origins_list(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

    @property
    def trusted_proxy_ip_list(self) -> list[str]:
        return [item.strip() for item in self.trusted_proxy_ips.split(",") if item.strip()]

    @property
    def service_links_seed(self) -> list[dict[str, Any]]:
        return json.loads(self.service_links_json or "[]")

    @property
    def known_devices_seed(self) -> list[dict[str, Any]]:
        return json.loads(self.known_devices_json or "[]")

    @model_validator(mode="after")
    def validate_security_posture(self) -> "Settings":
        supported_services = {"adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"}
        if not set(self.monitored_service_names).issubset(supported_services):
            raise ValueError("monitored services must come from the fixed Phase 1 allowlist")
        if self.session_idle_timeout_seconds >= self.session_absolute_timeout_seconds:
            raise ValueError("session idle timeout must be shorter than the absolute timeout")
        if any(origin == "*" for origin in self.allowed_origins_list):
            raise ValueError("wildcard CORS origins are not allowed with cookie authentication")
        if self.is_production:
            weak_values = {
                "",
                "change-me",
                "change-me-now",
                "development-only-change-me",
                "development-control-agent-secret",
            }
            if self.secret_key in weak_values or len(self.secret_key) < 32:
                raise ValueError("production PIHOMEHUB_SECRET_KEY must be a strong, unique value")
            if self.control_agent_secret in weak_values or len(self.control_agent_secret) < 32:
                raise ValueError("production control-agent secret must be a strong, unique value")
            if self.uses_private_http:
                origins = [self.public_base_url, *self.allowed_origins_list]
                private_networks = tuple(ip_network(network) for network in (
                    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                    "100.64.0.0/10", "127.0.0.0/8", "::1/128", "fc00::/7",
                ))
                for origin in origins:
                    parsed = urlparse(origin)
                    try:
                        address = ip_address(parsed.hostname or "")
                        allowed_host = any(address in network for network in private_networks)
                    except ValueError:
                        allowed_host = parsed.hostname == "localhost"
                    if (parsed.scheme != "http" or not allowed_host or parsed.username or parsed.password
                            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
                        raise ValueError("private-http requires HTTP origins on private IPs or localhost")
                if not self.allowed_origins_list:
                    raise ValueError("private-http requires an explicit allowed origin")
            else:
                if urlparse(self.public_base_url).scheme != "https":
                    raise ValueError("production public base URL must use HTTPS")
                if any(urlparse(origin).scheme != "https" for origin in self.allowed_origins_list):
                    raise ValueError("production allowed origins must use HTTPS")
            if self.admin_password:
                raise ValueError("production administrators must be created with the CLI, not environment passwords")
            if self.port_configuration_mode != "operator":
                raise ValueError("production service ports must be operator-managed")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
