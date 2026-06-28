from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.db import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    due_label: Mapped[str | None] = mapped_column(String(64))
    is_complete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
