from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.devices import DeviceCreate, DeviceSummary, DeviceUpdate
from app.services.auth_service import get_current_user, require_admin
from app.services.device_service import create_device, delete_device, get_devices, update_device

router = APIRouter(prefix="/devices", tags=["devices"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[DeviceSummary])
async def list_devices(db: Session = Depends(get_db)):
    return get_devices(db)


@router.post("", response_model=DeviceSummary, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def add_device(payload: DeviceCreate, db: Session = Depends(get_db)):
    device = create_device(db, payload)
    return DeviceSummary(
        id=device.id,
        name=device.name,
        device_type=device.device_type,
        ip_address=device.ip_address,
        tailscale_name=device.tailscale_name,
        mac_address=device.mac_address,
        supports_wol=device.supports_wol,
        status="unknown",
        description=device.description,
    )


@router.patch("/{device_id}", response_model=DeviceSummary, dependencies=[Depends(require_admin)])
async def patch_device(device_id: int, payload: DeviceUpdate, db: Session = Depends(get_db)):
    device = update_device(db, device_id, payload)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return DeviceSummary(
        id=device.id,
        name=device.name,
        device_type=device.device_type,
        ip_address=device.ip_address,
        tailscale_name=device.tailscale_name,
        mac_address=device.mac_address,
        supports_wol=device.supports_wol,
        status="unknown",
        description=device.description,
    )


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def remove_device(device_id: int, db: Session = Depends(get_db)):
    deleted = delete_device(db, device_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
