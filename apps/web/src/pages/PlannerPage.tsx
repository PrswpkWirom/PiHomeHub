import { FormEvent, useState } from "react";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";

import { api } from "../api/client";
import { Panel } from "../components/Panel";
import { useFetch } from "../hooks/useFetch";
import type { TaskItem } from "../types/api";

export function PlannerPage() {
  const { data, loading, error, setData } = useFetch<TaskItem[]>("/api/tasks");
  const [title, setTitle] = useState("");
  const [dueLabel, setDueLabel] = useState("");

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const newTask = await api.post<TaskItem>("/api/tasks", { title, due_label: dueLabel || null });
    setData([...(data ?? []), newTask]);
    setTitle("");
    setDueLabel("");
  };

  const toggleTask = async (task: TaskItem) => {
    const updated = await api.patch<TaskItem>(`/api/tasks/${task.id}`, { is_complete: !task.is_complete });
    setData((data ?? []).map((item) => (item.id === task.id ? updated : item)));
  };

  const removeTask = async (taskId: number) => {
    await api.delete(`/api/tasks/${taskId}`);
    setData((data ?? []).filter((item) => item.id !== taskId));
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Planner</p>
          <h1 className="page-title">Tasks for the hub</h1>
          <p className="page-copy">Keep small maintenance tasks beside the services and devices they support.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <Panel title="Add task" description="Create short, operational reminders with optional due labels.">
        <form className="space-y-4" onSubmit={createTask}>
          <input className="input-field" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <input className="input-field" placeholder="Due label" value={dueLabel} onChange={(e) => setDueLabel(e.target.value)} />
          <button className="btn-primary">
            <Plus size={17} />
            Create task
          </button>
        </form>
      </Panel>
      <Panel title="Task list" description="Completed tasks stay readable without competing with active work.">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
          </div>
        ) : null}
        {error ? <p className="error-callout">{error}</p> : null}
        <div className="space-y-3">
          {data?.map((task) => (
            <div key={task.id} className={`raised-card flex flex-wrap items-center justify-between gap-3 ${task.is_complete ? "opacity-70" : ""}`}>
              <div className="min-w-0">
                <p className={`font-semibold ${task.is_complete ? "text-muted line-through" : "text-white"}`}>{task.title}</p>
                <p className="mt-1 text-sm text-muted">{task.due_label ?? "No due label"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => void toggleTask(task)}>
                  {task.is_complete ? <RotateCcw size={16} /> : <Check size={16} />}
                  {task.is_complete ? "Undo" : "Done"}
                </button>
                <button className="btn-danger" onClick={() => void removeTask(task.id)}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
          ))}
          {data?.length === 0 ? <p className="empty-state">No tasks yet. Add a maintenance reminder when something needs follow-up.</p> : null}
        </div>
      </Panel>
      </div>
    </div>
  );
}
