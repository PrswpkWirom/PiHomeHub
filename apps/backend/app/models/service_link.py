from sqlalchemy import Boolean, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database.db import Base


class ServiceLink(Base):
    __tablename__ = "service_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    url: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    url_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
