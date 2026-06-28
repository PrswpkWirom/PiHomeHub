from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    due_label: str | None = Field(default=None, max_length=64)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    due_label: str | None = Field(default=None, max_length=64)
    is_complete: bool | None = None


class TaskItem(BaseModel):
    id: int
    title: str
    due_label: str | None
    is_complete: bool

    model_config = {"from_attributes": True}
