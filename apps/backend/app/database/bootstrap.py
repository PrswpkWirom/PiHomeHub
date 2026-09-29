import json

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.database.db import Base, SessionLocal, engine
from app.models.device import Device
from app.models.service_link import ServiceLink
from app.models.tailscale_device import TailscaleDevice
from app.models.task import Task
from app.models.user import AppSetting, User

settings = get_settings()
DELETED_KNOWN_DEVICES_KEY = "deleted_known_device_names"


def _deleted_known_device_names(db: Session) -> set[str]:
    setting = db.query(AppSetting).filter(AppSetting.key == DELETED_KNOWN_DEVICES_KEY).one_or_none()
    if setting is None:
        return set()
    try:
        return set(json.loads(setting.value))
    except json.JSONDecodeError:
        return set()


def bootstrap_database() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_defaults(db)
        if settings.is_production and not db.query(User).filter(User.is_admin.is_(True), User.is_active.is_(True)).first():
            raise RuntimeError("No active administrator exists; run python -m app.cli create-admin")
    finally:
        db.close()


def seed_defaults(db: Session) -> None:
    existing_slugs = {row.slug for row in db.query(ServiceLink).all()}
    for item in settings.service_links_seed:
        slug = item.get("slug")
        if slug and slug not in existing_slugs:
            db.add(
                ServiceLink(
                    name=item.get("name", slug),
                    slug=slug,
                    url=item.get("url", ""),
                    description=item.get("description"),
                )
            )

    existing_devices = {row.name for row in db.query(Device).all()}
    deleted_known_devices = _deleted_known_device_names(db)
    for item in settings.known_devices_seed:
        name = item.get("name")
        if name and name not in existing_devices and name not in deleted_known_devices:
            db.add(
                Device(
                    name=name,
                    device_type=item.get("device_type", "unknown"),
                    ip_address=item.get("ip_address"),
                    tailscale_name=item.get("tailscale_name"),
                    mac_address=item.get("mac_address"),
                    broadcast_address=item.get("broadcast_address"),
                    supports_wol=bool(item.get("supports_wol", False)),
                    description=item.get("description"),
                )
            )

    if db.query(Task).count() == 0:
        db.add(Task(title="Build PiHomeHub", due_label="Today", is_complete=False))

    if db.query(AppSetting).count() == 0:
        db.add(AppSetting(key="dashboard_title", value="PiHomeHub"))

    db.commit()
