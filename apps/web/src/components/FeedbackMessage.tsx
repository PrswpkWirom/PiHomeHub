import { AlertCircle, CheckCircle2, Clock3, Info, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type FeedbackKind = "progress" | "success" | "warning" | "error";

export type Feedback = {
  kind: FeedbackKind;
  text: string;
  persistent?: boolean;
};

type FeedbackMessageProps = {
  feedback: Feedback | null | undefined;
  className?: string;
  onDismiss?: () => void;
  action?: ReactNode;
};

const icons = {
  progress: Clock3,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle
};

const classes = {
  progress: "info-callout",
  success: "success-callout",
  warning: "warning-callout",
  error: "error-callout"
};

export function FeedbackMessage({ feedback, className = "", onDismiss, action }: FeedbackMessageProps) {
  const [exiting, setExiting] = useState(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    setExiting(false);
    const isTransientOutcome = feedback?.kind === "success" || feedback?.kind === "error";
    if (!isTransientOutcome || feedback.persistent || !onDismissRef.current) {
      return;
    }
    const prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const exitTimeout = prefersReducedMotion ? undefined : window.setTimeout(() => setExiting(true), 4_500);
    const dismissTimeout = window.setTimeout(() => onDismissRef.current?.(), 5_000);
    return () => {
      if (exitTimeout !== undefined) {
        window.clearTimeout(exitTimeout);
      }
      window.clearTimeout(dismissTimeout);
    };
  }, [feedback]);

  if (!feedback) {
    return null;
  }

  const Icon = icons[feedback.kind] ?? Info;
  const role = feedback.kind === "error" ? "alert" : "status";
  return (
    <div
      className={`feedback-message ${className}`}
      data-feedback-state={exiting ? "exiting" : "visible"}
      style={exiting ? { marginBlock: 0 } : undefined}
    >
      <div className="feedback-message__clip">
        <div
          className={`${classes[feedback.kind]} feedback-message__surface flex items-start gap-2.5`}
          role={role}
          aria-live={role === "status" ? "polite" : undefined}
        >
          <Icon className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span>{feedback.text}</span>
            {action ? <div className="mt-3">{action}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function errorFeedback(error: unknown, fallback: string): Feedback {
  return { kind: "error", text: error instanceof Error ? error.message : fallback };
}
