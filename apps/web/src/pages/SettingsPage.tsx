import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { Panel } from "../components/Panel";
import { usePermissions } from "../components/AdminOnly";

const sections = [
  { path: "general", label: "General" },
  { path: "account", label: "Account" },
  { path: "access", label: "Access" },
  { path: "users", label: "Users", admin: true },
  { path: "security", label: "Security", admin: true },
  { path: "system", label: "System" },
  { path: "notifications", label: "Notifications" }
] as const;

export function SettingsPage() {
  const { isAdmin } = usePermissions();
  const location = useLocation();
  const pathParts = location.pathname.split("/").filter(Boolean);
  const section = pathParts[pathParts.length - 1] ?? "account";
  const title = sections.find((item) => item.path === section)?.label ?? "Settings";

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-copy">Manage your account, private access, and PiHomeHub preferences.</p>
        </div>
      </div>
      <nav aria-label="Settings" className="flex gap-2 overflow-x-auto rounded-[18px] border border-line bg-panel p-2">
        {sections.filter((item) => !("admin" in item) || !item.admin || isAdmin).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            aria-current={section === item.path ? "page" : undefined}
            className={({ isActive }) => `shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-mist"}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <section aria-label={`${title} settings`}>
        <Outlet />
      </section>
    </div>
  );
}

export function SettingsAdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin } = usePermissions();
  if (isAdmin) return children;
  return (
    <Panel title="Administrator access required" description="Users and security events are available to administrators.">
      <Link className="btn-secondary inline-flex" to="/settings/account">Return to Account</Link>
    </Panel>
  );
}
