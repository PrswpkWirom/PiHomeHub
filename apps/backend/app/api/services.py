from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.services import ServiceLinkRead, ServiceStatusRead
from app.services.auth_service import get_current_user
from app.services.docker_service import get_service_statuses
from app.services.links_service import get_service_links

router = APIRouter(prefix="/services", tags=["services"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=list[ServiceStatusRead])
async def services_status(db: Session = Depends(get_db)):
    return get_service_statuses(db)


@router.get("/links", response_model=list[ServiceLinkRead])
async def service_links(db: Session = Depends(get_db)):
    return get_service_links(db)
