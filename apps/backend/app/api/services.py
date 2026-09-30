import asyncio
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.services import (
    ServiceActionRequest,
    ServiceActionResult,
    ServiceOperationRead,
    ServiceCapabilityRead,
    ServiceLinkRead,
    ServiceLinkWrite,
    ServicePortConfigRead,
    ServicePortConfigUpdate,
    ServiceStatusRead,
)
from app.services.auth_service import get_current_user, require_admin, require_recent_admin
from app.models.user import User
from app.models.service_link import ServiceLink
from app.core.config import get_settings
from app.services.audit_service import audited_operation
from app.services.control_agent_client import ControlAgentError, get_service_operation
from app.services.docker_service import get_service_capabilities, get_service_statuses, run_service_action
from app.services.links_service import get_service_links
from app.services.service_ports import get_service_port_configs, update_service_port_config

router = APIRouter(prefix="/services", tags=["services"], dependencies=[Depends(get_current_user)])


@router.get("/status", response_model=list[ServiceStatusRead])
async def services_status(db: Session = Depends(get_db)):
    return await asyncio.to_thread(get_service_statuses, db)


@router.get("/capabilities", response_model=list[ServiceCapabilityRead])
async def service_capabilities(db: Session = Depends(get_db)):
    return await asyncio.to_thread(get_service_capabilities, db)


@router.get("/links", response_model=list[ServiceLinkRead])
async def service_links(db: Session = Depends(get_db)):
    return get_service_links(db)


@router.post("/links", response_model=ServiceLinkRead, status_code=201)
def create_service_link(payload: ServiceLinkWrite, request: Request, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    with audited_operation(db, event="service_link_created", request=request, actor_user_id=actor.id, target_type="service_link"):
        link = ServiceLink(slug=f"custom-{uuid4().hex}", **payload.model_dump(), url_override=True)
        db.add(link)
        db.flush()
    db.refresh(link)
    return link


@router.patch("/links/{slug}", response_model=ServiceLinkRead)
def update_service_link(slug: str, payload: ServiceLinkWrite, request: Request, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    with audited_operation(db, event="service_link_updated", request=request, actor_user_id=actor.id, target_type="service_link", target_identifier=slug):
        link = db.query(ServiceLink).filter(ServiceLink.slug == slug).one_or_none()
        if link is None:
            if slug not in get_settings().monitored_service_names:
                raise HTTPException(status_code=404, detail="Service link not found")
            link = ServiceLink(slug=slug)
            db.add(link)
        for key, value in payload.model_dump().items():
            setattr(link, key, value)
        link.url_override = True
        db.flush()
    db.refresh(link)
    return link


@router.get("/ports", response_model=list[ServicePortConfigRead])
async def service_ports(db: Session = Depends(get_db)):
    return await asyncio.to_thread(get_service_port_configs, db)


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


@router.get("/operations/{operation_id}", response_model=ServiceOperationRead)
async def service_operation(operation_id: str):
    try:
        payload = await asyncio.to_thread(get_service_operation, operation_id)
    except ControlAgentError as exc:
        raise HTTPException(status_code=503, detail="Operation status is temporarily unavailable") from exc
    operation = payload.get("operation") if isinstance(payload, dict) else None
    if not isinstance(operation, dict):
        raise HTTPException(status_code=404, detail="Operation not found")
    return ServiceOperationRead.model_validate(operation)


@router.post("/{slug}/actions/{action}", response_model=ServiceActionResult)
def service_action(
    slug: str,
    action: str,
    request: Request,
    payload: ServiceActionRequest,
    response: Response,
    db: Session = Depends(get_db),
    actor: User = Depends(require_recent_admin),
):
    with audited_operation(
        db, event=f"service_{action}_submitted", request=request, actor_user_id=actor.id,
        target_type="service", target_identifier=slug,
    ):
        result = run_service_action(db, slug, action, payload.operation_id, actor.id)
    response.status_code = 202
    return result
