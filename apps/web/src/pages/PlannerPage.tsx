import { FormEvent, useState } from "react";

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
    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <Panel title="Add Task">
        <form className="space-y-4" onSubmit={createTask}>
          <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Due label" value={dueLabel} onChange={(e) => setDueLabel(e.target.value)} />
          <button className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">Create task</button>
        </form>
      </Panel>
      <Panel title="Task List">
        {loading ? <p>Loading tasks…</p> : null}
        {error ? <p className="text-red-700">{error}</p> : null}
        <div className="space-y-3">
          {data?.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-clay p-4">
              <div>
                <p className={`font-semibold ${task.is_complete ? "line-through text-slate-500" : "text-ink"}`}>{task.title}</p>
                <p className="text-sm text-slate-500">{task.due_label ?? "No due label"}</p>
              </div>
              <div className="flex gap-2">
                <button className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink" onClick={() => void toggleTask(task)}>
                  {task.is_complete ? "Undo" : "Done"}
                </button>
                <button className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700" onClick={() => void removeTask(task.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
