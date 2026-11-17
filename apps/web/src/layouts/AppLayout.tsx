import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Home, ListChecks, LogOut, Monitor, Server, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AsciiArtwork } from "../components/AsciiArtwork";
import { BrandMark } from "../components/BrandMark";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { ThemeToggle } from "../components/ThemeToggle";
import { usePermissions } from "../components/AdminOnly";
import { FeedbackMessage, type Feedback } from "../components/FeedbackMessage";
import { useAuth } from "../contexts/AuthContext";
import { NotificationControl } from "../components/NotificationControl";

const navItems: { to: string; label: string; shortLabel: string; icon: LucideIcon }[] = [
  { to: "/dashboard", label: "Overview", shortLabel: "Home", icon: Home },
  { to: "/devices", label: "Devices", shortLabel: "Devices", icon: Monitor },
  { to: "/services", label: "Services", shortLabel: "Services", icon: Server },
  { to: "/planner", label: "Planner", shortLabel: "Planner", icon: ListChecks },
  { to: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings }
];

export function AppLayout() {
  const { user, logout, authError, refresh } = useAuth();
  const { roleLabel } = usePermissions();
  const [signOutFeedback, setSignOutFeedback] = useState<Feedback | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPage = location.pathname.startsWith("/notifications")
    ? "Notifications"
    : navItems.find((item) => location.pathname.startsWith(item.to))?.label ?? "Overview";

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setSignOutFeedback({ kind: "error", text: error instanceof Error ? error.message : "Sign out failed." });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="app-shell min-h-dvh bg-app text-mist">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <aside className="desktop-sidebar">
        <BrandMark />
        <nav className="sidebar-nav" aria-label="Primary navigation" data-active-index={navItems.findIndex((item) => location.pathname.startsWith(item.to))}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <Icon size={18} strokeWidth={2} />
                <span>{item.label}</span>
                <span className="nav-item__pip" />
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <AsciiArtwork variant="rack" />
          <ThemeToggle />
          <div className="user-card">
            <div className="user-avatar">{user?.username?.slice(0, 1).toUpperCase() || "A"}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-mist">{user?.username}</p>
              <p className="text-xs text-muted">{roleLabel}</p>
            </div>
            <button className="icon-button h-9 w-9" aria-label="Sign out" disabled={signingOut} onClick={() => void signOut()}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="lg:hidden"><BrandMark compact /></div>
          <div className="hidden lg:block">
            <p className="topbar-location">Home <ChevronRight size={13} /><span>{currentPage}</span></p>
          </div>
          <div className="topbar-actions">
            <span className="topbar-context">Private workspace</span>
            <NotificationControl />
            <div className="lg:hidden"><ThemeToggle compact /></div>
            <button className="icon-button lg:hidden" aria-label="Sign out" disabled={signingOut} onClick={() => void signOut()}><LogOut size={16} /></button>
          </div>
        </header>

        <main id="main-content" className="main-content" data-dialog-focus-fallback tabIndex={-1}>
          <FeedbackMessage feedback={authError ? { kind: "error", persistent: true, text: authError } : null} action={<button className="btn-secondary" type="button" onClick={() => void refresh()}>Retry session check</button>} />
          <FeedbackMessage feedback={signOutFeedback} onDismiss={() => setSignOutFeedback(null)} />
          <div key={location.pathname} className="route-content">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="mobile-dock" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `mobile-dock__item ${isActive ? "mobile-dock__item--active" : ""}`}>
              <Icon size={20} strokeWidth={2} />
              <span>{item.shortLabel}</span>
            </NavLink>
          );
        })}
      </nav>
      <OfflineIndicator />
    </div>
  );
}
