import { useRef, useState } from "react";

import { api } from "../api/client";
import { errorFeedback, FeedbackMessage, type Feedback } from "./FeedbackMessage";
import type { ServiceLink } from "../types/api";
import { serviceLinkHref } from "../utils/serviceLinks";

export function ServiceLinkEditor({ link, onSave, onCancel }: {
  link: ServiceLink | null;
  onSave: (link: ServiceLink) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(link?.name ?? "");
  const [url, setUrl] = useState(link ? serviceLinkHref(link) : "");
  const [description, setDescription] = useState(link?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lock = useRef(false);

  return <form className="raised-card mb-4 space-y-4" aria-label={link ? "Edit dashboard link" : "Add quick link"} onSubmit={async (event) => {
    event.preventDefault();
    if (lock.current) return;
    try {
      const parsed = new URL(url.trim());
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch {
      setFeedback({ kind: "error", text: "Enter a complete http:// or https:// URL without embedded credentials." });
      return;
    }
    lock.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const payload = { name: name.trim(), url: url.trim(), description: description.trim() || null };
      const saved = link
        ? await api.patch<ServiceLink>(`/api/services/links/${encodeURIComponent(link.slug)}`, payload)
        : await api.post<ServiceLink>("/api/services/links", payload);
      onSave(saved);
    } catch (error) {
      setFeedback(errorFeedback(error, "The link could not be saved."));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }}>
    <h3 className="font-semibold text-mist">{link ? "Edit dashboard link" : "Add quick link"}</h3>
    {link ? <p className="break-all text-xs text-muted">Current link: {serviceLinkHref(link)}</p> : null}
    <label className="field-label">Name<input autoFocus className="input-field" required maxLength={128} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="Hall aircon" /></label>
    <label className="field-label">Dashboard URL<input className="input-field" type="url" required maxLength={255} value={url} disabled={saving} onChange={(event) => setUrl(event.target.value)} placeholder="https://vault.example.com" />
      <span className="field-help">Use the full HTTP or HTTPS address, including any port or path. Your saved address takes priority over the automatic link.</span>
    </label>
    <label className="field-label">Description (optional)<input className="input-field" maxLength={1000} value={description} disabled={saving} onChange={(event) => setDescription(event.target.value)} /></label>
    <FeedbackMessage feedback={feedback} />
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary" type="submit" disabled={saving || !name.trim()}>{saving ? "Saving..." : "Save link"}</button>
      <button className="btn-secondary" type="button" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
