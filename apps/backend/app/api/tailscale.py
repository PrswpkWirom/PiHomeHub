from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.tailscale import (
    TailscaleConnectionResult,
    TailscaleDeviceRead,
    TailscaleSettingsWrite,
    TailscaleStatus,
    TailscaleWolUpdate,
)
from app.services.auth_service import get_current_user
from app.services.tailscale_service import (
    get_tailscale_status,
    list_tailscale_devices,
    save_tailscale_settings,
    sync_tailscale_devices,
    test_tailscale_connection,
    update_tailscale_wol,
    wake_tailscale_device,
)

router = APIRouter(prefix="/tailscale", tags=["tailscale"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=TailscaleStatus)
async def status(db: Session = Depends(get_db)):
    return get_tailscale_status(db)


@router.post("/settings", response_model=TailscaleStatus)
async def settings(payload: TailscaleSettingsWrite, db: Session = Depends(get_db)):
    return save_tailscale_settings(db, payload)


@router.post("/test", response_model=TailscaleConnectionResult)
async def test_connection(db: Session = Depends(get_db)):
    return await test_tailscale_connection(db)


@router.post("/sync", response_model=list[TailscaleDeviceRead])
async def sync(db: Session = Depends(get_db)):
    return await sync_tailscale_devices(db)


@router.get("/devices", response_model=list[TailscaleDeviceRead])
async def devices(db: Session = Depends(get_db)):
    return list_tailscale_devices(db)


@router.patch("/devices/{device_id}/wol", response_model=TailscaleDeviceRead)
async def configure_wol(device_id: int, payload: TailscaleWolUpdate, db: Session = Depends(get_db)):
    return update_tailscale_wol(db, device_id, payload)


@router.post("/devices/{device_id}/wake")
async def wake(device_id: int, db: Session = Depends(get_db)):
    wake_tailscale_device(db, device_id)
    return {"status": "sent"}
