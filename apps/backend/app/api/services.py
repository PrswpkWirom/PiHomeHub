from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.services import (
    ServiceActionResult,
    ServiceCapabilityRead,
    ServiceLinkRead,
    ServicePortConfigRead,
    ServicePortConfigUpdate,
    ServiceStatusRead,
)
from app.services.auth_service import get_current_user, require_recent_admin
from app.models.user import User
from app.services.audit_service import audited_operation
from app.services.docker_service import get_service_capabilities, get_service_statuses, recreate_service, run_service_action
from app.services.links_service import get_service_links
from app.services.service_ports import get_service_port_configs, update_service_port_config

router = APIRouter(prefix="/services", tags=["services"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=list[ServiceStatusRead])
def services_status(db: Session = Depends(get_db)):
    return get_service_statuses(db)


@router.get("/capabilities", response_model=list[ServiceCapabilityRead])
async def service_capabilities(db: Session = Depends(get_db)):
    return get_service_capabilities(db)


@router.get("/links", response_model=list[ServiceLinkRead])
async def service_links(db: Session = Depends(get_db)):
    return get_service_links(db)


@router.get("/ports", response_model=list[ServicePortConfigRead])
async def service_ports(db: Session = Depends(get_db)):
    return get_service_port_configs(db)


@router.patch("/{slug}/ports", response_model=ServicePortConfigRead, dependencies=[Depends(require_recent_admin)])
async def update_service_ports(
    slug: str, payload: ServicePortConfigUpdate, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(require_recent_admin),
):
    with audited_operation(
        db, event="service_port_configuration", request=request, actor_user_id=actor.id,
        target_type="service", target_identifier=slug,
    ):
        return update_service_port_config(db, slug, payload)


@router.post("/{slug}/ports/apply", response_model=ServiceActionResult, dependencies=[Depends(require_recent_admin)])
async def apply_service_ports(
    slug: str, request: Request, db: Session = Depends(get_db),
    actor: User = Depends(require_recent_admin),
):
    with audited_operation(
        db, event="service_port_apply", request=request, actor_user_id=actor.id,
        target_type="service", target_identifier=slug,
    ):
        return recreate_service(db, slug)


@router.post("/{slug}/actions/{action}", response_model=ServiceActionResult)
def service_action(
    slug: str,
    action: str,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_recent_admin),
):
    with audited_operation(
        db, event=f"service_{action}", request=request, actor_user_id=actor.id,
        target_type="service", target_identifier=slug,
    ):
        result = run_service_action(db, slug, action)
    return result
