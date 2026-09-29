import { FormEvent, useState } from "react";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";

import { api } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { errorFeedback, FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { Field } from "../components/Field";
import { Panel } from "../components/Panel";
import { useFetch } from "../hooks/useFetch";
import type { TaskItem } from "../types/api";
import { useRef } from "react";

export function PlannerPage() {
  const { data, loading, error, setData, refetch } = useFetch<TaskItem[]>("/api/tasks");
  const [title, setTitle] = useState("");
  const [dueLabel, setDueLabel] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TaskItem | null>(null);
  const busyRef = useRef(false);

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    setFeedback(null);
    try {
      const newTask = await api.post<TaskItem>("/api/tasks", { title, due_label: dueLabel || null });
      setData([...(data ?? []), newTask]);
      setTitle("");
      setDueLabel("");
      setFeedback({ kind: "success", text: `Task “${newTask.title}” created.` });
    } catch (error) {
      setFeedback(errorFeedback(error, "The task could not be created."));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const toggleTask = async (task: TaskItem) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    setFeedback(null);
    try {
      const updated = await api.patch<TaskItem>(`/api/tasks/${task.id}`, { is_complete: !task.is_complete });
      setData((data ?? []).map((item) => (item.id === task.id ? updated : item)));
      setFeedback({
        kind: "success",
        text: updated.is_complete ? `Task “${updated.title}” completed.` : `Task “${updated.title}” reopened.`
      });
    } catch (error) {
      setFeedback(errorFeedback(error, `Task “${task.title}” could not be updated.`));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const removeTask = async (task: TaskItem) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    setFeedback(null);
    try {
      await api.delete(`/api/tasks/${task.id}`);
      setData((data ?? []).filter((item) => item.id !== task.id));
      setFeedback({ kind: "success", text: `Task “${task.title}” deleted.` });
    } catch (error) {
      setFeedback(errorFeedback(error, `Task “${task.title}” could not be deleted.`));
    } finally {
      busyRef.current = false; setBusy(false);
    }
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
          <Field label="Task title" value={title} onChange={(e) => { setTitle(e.target.value); setFeedback(null); }} required />
          <Field label="Due label" help="Optional short timing note, such as This weekend." value={dueLabel} onChange={(e) => { setDueLabel(e.target.value); setFeedback(null); }} />
          <button className="btn-primary" disabled={busy}>
            <Plus size={17} />
            Create task
          </button>
        </form>
        <FeedbackMessage feedback={feedback} className="mt-4" onDismiss={() => setFeedback(null)} />
      </Panel>
      <Panel title="Task list" description="Completed tasks stay readable without competing with active work.">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
          </div>
        ) : null}
        <FeedbackMessage
          feedback={error ? { kind: "error", persistent: true, text: error } : null}
          action={<button className="btn-secondary min-h-9 px-3 py-1" onClick={() => void refetch()}>Retry task list</button>}
        />
        <div className="space-y-3">
          {data?.map((task) => (
            <div key={task.id} className={`raised-card flex flex-wrap items-center justify-between gap-3 ${task.is_complete ? "opacity-70" : ""}`}>
              <div className="min-w-0">
                <p className={`font-semibold ${task.is_complete ? "text-muted line-through" : "text-mist"}`}>{task.title}</p>
                <p className="mt-1 text-sm text-muted">{task.due_label ?? "No due label"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" disabled={busy} onClick={() => void toggleTask(task)}>
                  {task.is_complete ? <RotateCcw size={16} /> : <Check size={16} />}
                  {task.is_complete ? "Undo" : "Done"}
                </button>
                <button className="btn-danger" disabled={busy} onClick={() => setPendingDelete(task)}>
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
      {pendingDelete ? <ConfirmDialog title={`Delete “${pendingDelete.title}”?`} description="This removes the task from the shared PiHomeHub planner." confirmLabel="Delete task" onCancel={() => setPendingDelete(null)} onConfirm={() => { const task = pendingDelete; setPendingDelete(null); void removeTask(task); }} /> : null}
    </div>
  );
}
