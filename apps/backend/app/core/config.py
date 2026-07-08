import json
from functools import lru_cache
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("apps/backend/.env", ".env"), env_prefix="PIHOMEHUB_", extra="ignore")

    env: str = "development"
    secret_key: str = "change-me"
    database_url: str = "sqlite:///./pihomehub.db"
    admin_username: str = "admin"
    admin_password: str = "change-me-now"
    monitored_services: str = "adguard-home,gitea,uptime-kuma,vaultwarden,mosquitto"
    compose_file: str | None = None
    compose_project_directory: str | None = None
    compose_env_file: str | None = None
    host_proc_net_path: str = "/proc/net"
    allowed_origins: str = "http://localhost:5173"
    service_links_json: str = "[]"
    known_devices_json: str = "[]"

    @property
    def monitored_service_names(self) -> list[str]:
        return [item.strip() for item in self.monitored_services.split(",") if item.strip()]

    @property
    def allowed_origins_list(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

    @property
    def service_links_seed(self) -> list[dict[str, Any]]:
        return json.loads(self.service_links_json or "[]")

    @property
    def known_devices_seed(self) -> list[dict[str, Any]]:
        return json.loads(self.known_devices_json or "[]")


@lru_cache
def get_settings() -> Settings:
    return Settings()
