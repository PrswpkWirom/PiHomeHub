from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.services import ServiceActionResult, ServiceCapabilityRead, ServiceLinkRead, ServiceStatusRead
from app.services.auth_service import get_current_user
from app.services.docker_service import get_service_capabilities, get_service_statuses, run_service_action
from app.services.links_service import get_service_links

router = APIRouter(prefix="/services", tags=["services"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=list[ServiceStatusRead])
async def services_status(db: Session = Depends(get_db)):
    return get_service_statuses(db)


@router.get("/capabilities", response_model=list[ServiceCapabilityRead])
async def service_capabilities(db: Session = Depends(get_db)):
    return get_service_capabilities(db)


@router.get("/links", response_model=list[ServiceLinkRead])
async def service_links(db: Session = Depends(get_db)):
    return get_service_links(db)


@router.post("/{slug}/actions/{action}", response_model=ServiceActionResult)
async def service_action(slug: str, action: str, db: Session = Depends(get_db)):
    return run_service_action(db, slug, action)
