from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.schemas.tasks import TaskCreate, TaskItem, TaskUpdate
from app.services.auth_service import get_current_user
from app.services.task_service import create_task, delete_task, list_tasks, update_task

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[TaskItem])
async def tasks(db: Session = Depends(get_db)):
    return list_tasks(db)


@router.post("", response_model=TaskItem, status_code=status.HTTP_201_CREATED)
async def add_task(payload: TaskCreate, db: Session = Depends(get_db)):
    return create_task(db, payload)


@router.patch("/{task_id}", response_model=TaskItem)
async def patch_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = update_task(db, task_id, payload)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_task(task_id: int, db: Session = Depends(get_db)):
    deleted = delete_task(db, task_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
