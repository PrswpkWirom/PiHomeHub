from sqlalchemy.orm import Session

from app.models.task import Task
from app.schemas.tasks import TaskCreate, TaskUpdate


def list_tasks(db: Session) -> list[Task]:
    return db.query(Task).order_by(Task.is_complete.asc(), Task.id.asc()).all()


def create_task(db: Session, payload: TaskCreate) -> Task:
    task = Task(title=payload.title, due_label=payload.due_label, is_complete=False)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, task_id: int, payload: TaskUpdate) -> Task | None:
    task = db.query(Task).filter(Task.id == task_id).one_or_none()
    if task is None:
        return None
    if payload.title is not None:
        task.title = payload.title
    if payload.due_label is not None:
        task.due_label = payload.due_label
    if payload.is_complete is not None:
        task.is_complete = payload.is_complete
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: int) -> bool:
    count = db.query(Task).filter(Task.id == task_id).delete()
    db.commit()
    return count > 0
