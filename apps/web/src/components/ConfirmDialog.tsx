import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const root = document.getElementById("root");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hadInert = root?.hasAttribute("inert") ?? false;
    const previousAriaHidden = root?.getAttribute("aria-hidden") ?? null;
    root?.setAttribute("inert", "");
    root?.setAttribute("aria-hidden", "true");
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      } else if (event.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (root) {
        if (!hadInert) root.removeAttribute("inert");
        if (previousAriaHidden === null) root.removeAttribute("aria-hidden");
        else root.setAttribute("aria-hidden", previousAriaHidden);
      }
      const canRestoreFocus = previousFocus?.isConnected
        && !previousFocus.hasAttribute("disabled")
        && (previousFocus.tabIndex >= 0 || previousFocus.matches("a[href], button, input, select, textarea, [contenteditable='true']"));
      if (canRestoreFocus) previousFocus.focus();
      else document.querySelector<HTMLElement>("[data-dialog-focus-fallback]")?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" role="presentation">
      <section
        ref={dialogRef}
        className="app-panel w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <h2 id="confirm-dialog-title" className="panel-title">{title}</h2>
        <p id="confirm-dialog-description" className="mt-3 text-sm leading-6 text-muted">{description}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button ref={cancelRef} className="btn-secondary" type="button" onClick={onCancel}>Cancel</button>
          <button
            className="btn-danger"
            type="button"
            onClick={() => {
              if (confirmed.current) return;
              confirmed.current = true;
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
