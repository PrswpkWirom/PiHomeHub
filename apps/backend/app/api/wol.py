from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.services.auth_service import get_current_user
from app.services.wol_service import wake_device

router = APIRouter(prefix="/wol", tags=["wol"], dependencies=[Depends(get_current_user)])


@router.post("/wake")
async def wake(payload: dict, db: Session = Depends(get_db)):
    device_id = payload.get("device_id")
    if not isinstance(device_id, int):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="device_id is required")
    wake_device(db, device_id)
    return {"status": "sent"}
