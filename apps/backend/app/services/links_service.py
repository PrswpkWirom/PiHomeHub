from sqlalchemy.orm import Session

from app.models.service_link import ServiceLink


def get_service_links(db: Session) -> list[ServiceLink]:
    return db.query(ServiceLink).order_by(ServiceLink.name.asc()).all()
