import type { ReactNode } from "react";

import { useAuth } from "../contexts/AuthContext";

export function usePermissions() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  return {
    isAdmin,
    roleLabel: isAdmin ? "Administrator" : "Viewer",
    deniedReason: "Administrator access required"
  };
}

export function AdminOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { isAdmin } = usePermissions();
  return isAdmin ? children : fallback;
}

export function AdminActionButton({
  children,
  onClick,
  className = "btn-secondary",
  disabled = false,
  type = "button",
  label
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  label: string;
}) {
  const { isAdmin } = usePermissions();
  const reasonId = `admin-required-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        className={className}
        type={type}
        disabled={!isAdmin || disabled}
        aria-describedby={!isAdmin ? reasonId : undefined}
        onClick={isAdmin ? onClick : undefined}
      >
        {children}
      </button>
      {!isAdmin ? <span id={reasonId} className="text-xs text-muted">Administrator access required</span> : null}
    </div>
  );
}
