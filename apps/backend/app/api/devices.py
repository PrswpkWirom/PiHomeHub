from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.devices import DeviceSummary
from app.services.auth_service import get_current_user
from app.services.device_service import get_devices

router = APIRouter(prefix="/devices", tags=["devices"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[DeviceSummary])
async def list_devices(db: Session = Depends(get_db)):
    return get_devices(db)
