from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.services.auth_service import get_current_user, require_admin
from app.models.user import User
from app.services.audit_service import record_audit_event
from app.services.wol_service import wake_device

router = APIRouter(prefix="/wol", tags=["wol"], dependencies=[Depends(get_current_user)])


@router.post("/wake", dependencies=[Depends(require_admin)])
async def wake(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    device_id = payload.get("device_id")
    if not isinstance(device_id, int):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="device_id is required")
    wake_device(db, device_id)
    record_audit_event(
        db,
        event="wake_on_lan",
        success=True,
        request=request,
        actor_user_id=actor.id,
        target_type="device",
        target_identifier=device_id,
    )
    return {"status": "sent"}
