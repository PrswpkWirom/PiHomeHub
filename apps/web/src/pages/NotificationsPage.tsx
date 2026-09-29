import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Circle, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { PageIntro } from "../components/PageIntro";
import { Panel } from "../components/Panel";
import { invalidateCachePrefix, useFetch } from "../hooks/useFetch";
import type { HubNotification, NotificationCategory, NotificationPageResponse, NotificationSeverity } from "../types/api";

type Shortcut = "all" | "unread" | "critical" | "system";

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateHeading(value: string) {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (localDateKey(value) === localDateKey(now.toISOString())) return "Today";
  if (localDateKey(value) === localDateKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function NotificationRow({ item, busy, onRead }: { item: HubNotification; busy: boolean; onRead: (id: number) => void }) {
  const tone = item.severity === "critical" ? "text-red-400" : item.severity === "warning" ? "text-amber-400" : item.severity === "success" ? "text-emerald-400" : "text-sky-400";
  return (
    <article className={`flex gap-3 border-b border-line px-4 py-4 last:border-0 sm:px-5 ${item.read_at ? "" : "bg-raised/30"}`}>
      <Circle size={11} aria-hidden="true" className={`mt-1.5 shrink-0 fill-current ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-mist">{item.title}</h3>
          <span className={`rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>{item.severity}</span>
          <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold capitalize text-muted">{item.category}</span>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted">{item.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <time dateTime={item.created_at}>{dateHeading(item.created_at)} · {timeLabel(item.created_at)}</time>
          {item.resolved_at ? <span>Resolved {timeLabel(item.resolved_at)}</span> : null}
          {item.target_path ? <Link className="inline-flex items-center gap-1 font-semibold text-accent hover:text-mist" to={item.target_path}>Open {item.category} <ExternalLink size={12} /></Link> : null}
        </div>
      </div>
      {!item.read_at ? <button type="button" aria-label={`Mark ${item.title} as read`} disabled={busy} onClick={() => onRead(item.id)} className="self-start rounded-xl border border-line p-2 text-muted hover:bg-raised hover:text-mist disabled:opacity-50"><Check size={16} /></button> : <span className="self-start px-2 py-2 text-xs text-muted">Read</span>}
    </article>
  );
}

export function NotificationsPage() {
  const [shortcut, setShortcut] = useState<Shortcut>("all");
  const [category, setCategory] = useState<NotificationCategory | "">("");
  const [severity, setSeverity] = useState<NotificationSeverity | "">("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<number | null>>([]);
  const [busyId, setBusyId] = useState<number | "all" | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("before_id", String(cursor));
  if (shortcut === "unread") params.set("unread", "true");
  if (shortcut === "critical") params.set("severity", "critical");
  if (shortcut === "system") params.set("category", "system");
  if (category) params.set("category", category);
  if (severity) params.set("severity", severity);
  const path = `/api/notifications?${params.toString()}`;
  const page = useFetch<NotificationPageResponse>(path);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && cursor === null) void page.refetch().catch(() => undefined); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [page.refetch, cursor]);

  const grouped = useMemo(() => {
    const groups = new Map<string, HubNotification[]>();
    for (const item of page.data?.items ?? []) {
      const label = dateHeading(item.created_at);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    }
    return [...groups.entries()];
  }, [page.data]);

  const markRead = async (id: number) => {
    setBusyId(id); setMutationError(null);
    try { await api.patch(`/api/notifications/${id}/read`, {}); invalidateCachePrefix("/api/notifications"); }
    catch (error) { setMutationError(error instanceof Error ? error.message : "Could not mark this notification as read."); }
    finally { setBusyId(null); }
  };

  const markAll = async () => {
    setBusyId("all"); setMutationError(null);
    try { await api.post("/api/notifications/read-all"); invalidateCachePrefix("/api/notifications"); }
    catch (error) { setMutationError(error instanceof Error ? error.message : "Could not mark notifications as read."); }
    finally { setBusyId(null); }
  };

  const resetPagination = () => { setCursor(null); setCursorHistory([]); };
  const setShortcutAndReset = (value: Shortcut) => { resetPagination(); setCategory(""); setSeverity(""); setShortcut(value); };
  const changeCategory = (value: NotificationCategory | "") => {
    resetPagination(); setCategory(value); if (shortcut === "system") setShortcut("all");
  };
  const changeSeverity = (value: NotificationSeverity | "") => {
    resetPagination(); setSeverity(value); if (shortcut === "critical") setShortcut("all");
  };
  const goOlder = () => {
    if (!page.data?.next_before_id) return;
    setCursorHistory((items) => [...items, cursor]);
    setCursor(page.data.next_before_id);
  };
  const goNewer = () => {
    if (!cursorHistory.length) return;
    setCursor(cursorHistory[cursorHistory.length - 1]);
    setCursorHistory((items) => items.slice(0, -1));
  };

  return (
    <div className="page-stack">
      <PageIntro eyebrow="Infrastructure" title="Notifications" description="A persistent history of important changes across your home hub." />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Notification shortcuts">
        {(["all", "unread", "critical", "system"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={shortcut === item} onClick={() => setShortcutAndReset(item)} className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize ${shortcut === item ? "bg-accent-soft text-accent" : "border border-line bg-panel text-muted hover:text-mist"}`}>{item}</button>
        ))}
        <label className="sr-only" htmlFor="notification-category">Category</label>
        <select id="notification-category" value={category} onChange={(event) => changeCategory(event.target.value as NotificationCategory | "")} className="input-field min-h-10 w-auto">
          <option value="">All categories</option>{(["device", "service", "system", "security", "tailscale", "planner"] as const).map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
        </select>
        <label className="sr-only" htmlFor="notification-severity">Severity</label>
        <select id="notification-severity" value={severity} onChange={(event) => changeSeverity(event.target.value as NotificationSeverity | "")} className="input-field min-h-10 w-auto">
          <option value="">All severities</option>{(["critical", "warning", "info", "success"] as const).map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
        </select>
        <button type="button" className="btn-secondary ml-auto" disabled={busyId !== null || !page.data?.items.some((item) => !item.read_at)} onClick={() => void markAll()}>{busyId === "all" ? "Marking…" : "Mark all read"}</button>
      </div>
      {mutationError ? <FeedbackMessage feedback={{ kind: "error", persistent: true, text: mutationError }} /> : null}
      {page.loading && !page.data ? <div className="skeleton h-64" aria-label="Loading notifications" /> : null}
      {page.error && !page.data ? <Panel title="Notifications could not be loaded" description="Your history is still saved. Check the connection and retry."><button className="btn-secondary" onClick={() => void page.refetch().catch(() => undefined)}>Retry</button></Panel> : null}
      {page.error && page.data ? <FeedbackMessage feedback={{ kind: "warning", persistent: true, text: "Refresh failed. Showing the notifications already loaded." }} action={<button className="btn-secondary" onClick={() => void page.refetch().catch(() => undefined)}>Retry</button>} /> : null}
      {page.data?.items.length === 0 ? <Panel title="You’re all caught up" description="No notifications match these filters."><p className="text-sm text-muted">Try another filter or come back when PiHomeHub has an update.</p></Panel> : null}
      {grouped.map(([heading, items]) => <section key={heading} aria-label={heading}><h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.16em] text-muted">{heading}</h2><div className="overflow-hidden rounded-2xl border border-line bg-panel">{items.map((item) => <NotificationRow key={item.id} item={item} busy={busyId !== null} onRead={(id) => void markRead(id)} />)}</div></section>)}
      {cursorHistory.length > 0 || !!page.data?.items.length ? <nav aria-label="Notification pages" className="flex justify-between"><button className="btn-secondary" disabled={!cursorHistory.length || page.loading} onClick={goNewer}><ChevronLeft size={16} /> Newer</button><button className="btn-secondary" disabled={!page.data?.next_before_id || page.loading} onClick={goOlder}>Older <ChevronRight size={16} /></button></nav> : null}
    </div>
  );
}
