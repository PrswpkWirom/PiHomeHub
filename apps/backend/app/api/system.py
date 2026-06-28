from fastapi import APIRouter, Depends

from app.schemas.system import PiStatus
from app.services.auth_service import get_current_user
from app.services.system_service import get_pi_status

router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(get_current_user)])


@router.get("/pi", response_model=PiStatus)
async def pi_status():
    return get_pi_status()
