import { Bell, Check, Circle, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { invalidateCachePrefix, useFetch } from "../hooks/useFetch";
import type { HubNotification, NotificationPageResponse, NotificationUnreadCount } from "../types/api";

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

function severityIcon(item: HubNotification) {
  const color = item.severity === "critical" ? "text-red-400" : item.severity === "warning" ? "text-amber-400" : item.severity === "success" ? "text-emerald-400" : "text-sky-400";
  return <Circle size={10} aria-hidden="true" className={`fill-current ${color}`} />;
}

export function NotificationControl() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const count = useFetch<NotificationUnreadCount>("/api/notifications/unread-count");
  const recent = useFetch<NotificationPageResponse>("/api/notifications?limit=10", { enabled: open });

  const refresh = () => {
    if (document.visibilityState !== "visible") return;
    void count.refetch().catch(() => undefined);
    if (open) void recent.refetch().catch(() => undefined);
  };

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void count.refetch().catch(() => undefined);
      if (open) void recent.refetch().catch(() => undefined);
    };
    const interval = window.setInterval(refresh, 30_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, count.refetch, recent.refetch]);

  useEffect(() => {
    if (!open) return;
    void recent.refetch().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (id: number) => {
    setBusy(true); setMutationError(null);
    try {
      await api.patch(`/api/notifications/${id}/read`, {});
      invalidateCachePrefix("/api/notifications");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not mark notification as read.");
    } finally { setBusy(false); }
  };

  const markAllRead = async () => {
    setBusy(true); setMutationError(null);
    try {
      await api.post("/api/notifications/read-all");
      invalidateCachePrefix("/api/notifications");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not mark notifications as read.");
    } finally { setBusy(false); }
  };

  const unread = count.data?.count ?? 0;
  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef} className="icon-button relative h-10 w-10" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open} aria-controls="notification-popover" title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={17} />
        {unread > 0 ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <section id="notification-popover" role="dialog" aria-label="Recent notifications" className="app-panel absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] p-0 shadow-2xl">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-semibold text-mist">Notifications</h2>
            <button type="button" className="text-xs font-semibold text-accent disabled:opacity-50" disabled={!unread || busy} onClick={() => void markAllRead()}>Mark all read</button>
          </header>
          {mutationError ? <p role="alert" className="px-4 pt-3 text-sm text-red-300">{mutationError}</p> : null}
          {recent.loading && !recent.data ? <p className="px-4 py-7 text-center text-sm text-muted">Loading notifications…</p> : null}
          {recent.error && !recent.data ? <div className="px-4 py-6 text-center"><p role="alert" className="text-sm text-red-300">Notifications could not be loaded.</p><button className="btn-secondary mt-3" onClick={() => void recent.refetch()}>Retry</button></div> : null}
          {recent.data?.items.length === 0 ? <p className="px-4 py-7 text-center text-sm text-muted">You’re all caught up.</p> : null}
          <ul className="max-h-[min(65vh,26rem)] divide-y divide-line overflow-y-auto">
            {recent.data?.items.map((item) => (
              <li key={item.id} className={`flex gap-3 px-4 py-3 ${item.read_at ? "opacity-75" : "bg-raised/40"}`}>
                <span className="mt-1.5">{severityIcon(item)}</span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { if (item.target_path) { setOpen(false); navigate(item.target_path); } }}>
                  <span className="block truncate text-sm font-semibold text-mist">{item.title}</span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted">{item.message}</span>
                  <time className="mt-1 block text-[11px] text-muted" dateTime={item.created_at}>{relativeTime(item.created_at)}</time>
                </button>
                {!item.read_at ? <button type="button" aria-label={`Mark ${item.title} as read`} title="Mark as read" disabled={busy} className="self-start rounded-lg p-1.5 text-muted hover:bg-raised hover:text-mist disabled:opacity-50" onClick={() => void markRead(item.id)}><Check size={15} /></button> : null}
              </li>
            ))}
          </ul>
          <footer className="border-t border-line px-4 py-3">
            <Link to="/notifications" onClick={() => setOpen(false)} className="flex items-center justify-between text-sm font-semibold text-accent hover:text-mist">View all notifications <ExternalLink size={14} /></Link>
            {recent.error && recent.data ? <button className="mt-2 inline-flex items-center gap-1 text-xs text-muted" onClick={() => void recent.refetch()}><RefreshCw size={12} /> Retry refresh</button> : null}
          </footer>
        </section>
      ) : null}
    </div>
  );
}
