from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.models.user import User
from app.services.audit_service import audited_operation
from app.schemas.tailscale import (
    TailscaleConnectionResult,
    TailscaleDeviceSettingsUpdate,
    TailscaleDeviceRead,
    TailscaleSettingsWrite,
    TailscaleStatus,
    TailscaleWolUpdate,
)
from app.services.auth_service import get_current_user, require_admin, require_recent_admin
from app.services.tailscale_service import (
    get_tailscale_status,
    list_tailscale_devices,
    save_tailscale_settings,
    sync_tailscale_devices,
    test_tailscale_connection,
    update_tailscale_device_settings,
    update_tailscale_wol,
    wake_tailscale_device,
)

router = APIRouter(prefix="/tailscale", tags=["tailscale"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=TailscaleStatus)
async def status(db: Session = Depends(get_db)):
    return get_tailscale_status(db)


@router.post("/settings", response_model=TailscaleStatus, dependencies=[Depends(require_recent_admin)])
async def settings(
    payload: TailscaleSettingsWrite, request: Request, db: Session = Depends(get_db),
    actor: User = Depends(require_recent_admin),
):
    with audited_operation(
        db, event="tailscale_settings_change", request=request, actor_user_id=actor.id,
        target_type="integration", target_identifier="tailscale",
    ):
        return save_tailscale_settings(db, payload)


@router.post("/test", response_model=TailscaleConnectionResult, dependencies=[Depends(require_admin)])
async def test_connection(
    request: Request, db: Session = Depends(get_db), actor: User = Depends(require_admin),
):
    with audited_operation(
        db, event="tailscale_connection_test", request=request, actor_user_id=actor.id,
        target_type="integration", target_identifier="tailscale",
    ):
        return await test_tailscale_connection(db)


@router.post("/sync", response_model=list[TailscaleDeviceRead], dependencies=[Depends(require_admin)])
async def sync(
    request: Request, db: Session = Depends(get_db), actor: User = Depends(require_admin),
):
    with audited_operation(
        db, event="tailscale_sync", request=request, actor_user_id=actor.id,
        target_type="integration", target_identifier="tailscale",
    ):
        return await sync_tailscale_devices(db)


@router.get("/devices", response_model=list[TailscaleDeviceRead])
async def devices(db: Session = Depends(get_db)):
    return list_tailscale_devices(db)


@router.patch("/devices/{device_id}/wol", response_model=TailscaleDeviceRead, dependencies=[Depends(require_admin)])
async def configure_wol(
    device_id: int, payload: TailscaleWolUpdate, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(require_admin),
):
    with audited_operation(
        db, event="tailscale_device_wol_change", request=request, actor_user_id=actor.id,
        target_type="tailscale_device", target_identifier=device_id,
    ):
        return update_tailscale_wol(db, device_id, payload)


@router.patch("/devices/{device_id}/settings", response_model=TailscaleDeviceRead, dependencies=[Depends(require_admin)])
async def configure_device_settings(
    device_id: int, payload: TailscaleDeviceSettingsUpdate, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(require_admin),
):
    with audited_operation(
        db, event="tailscale_device_settings_change", request=request, actor_user_id=actor.id,
        target_type="tailscale_device", target_identifier=device_id,
    ):
        return update_tailscale_device_settings(db, device_id, payload)


@router.post("/devices/{device_id}/wake", dependencies=[Depends(require_admin)])
async def wake(
    device_id: int, request: Request, db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    with audited_operation(
        db, event="tailscale_wake_on_lan", request=request, actor_user_id=actor.id,
        target_type="tailscale_device", target_identifier=device_id,
    ):
        wake_tailscale_device(db, device_id)
    return {"status": "sent"}
