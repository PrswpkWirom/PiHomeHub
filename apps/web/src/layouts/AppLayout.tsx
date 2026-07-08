import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, ListChecks, LogOut, Monitor, Router, Settings, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { OfflineIndicator } from "../components/OfflineIndicator";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../contexts/AuthContext";

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/devices", label: "Devices", icon: Monitor },
  { to: "/services", label: "Services", icon: Server },
  { to: "/planner", label: "Planner", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings }
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-app text-mist">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-line bg-deep/90 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[14px] border border-line bg-accent-soft text-accent">
            <Router size={22} strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted">Private network</p>
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-[-0.01em] text-mist">PiHomeHub</h1>
          </div>
        </div>
        <nav className="mt-8 grid gap-1.5" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-3 rounded-[14px] px-3 text-sm font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus ${
                    isActive
                      ? "bg-accent text-white shadow-lift"
                      : "text-muted hover:bg-accent-soft hover:text-mist"
                  }`
                }
              >
                <Icon size={18} strokeWidth={2.1} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-4">
          <ThemeToggle />
          <div className="rounded-[18px] border border-line bg-card/80 p-4">
            <p className="text-xs text-muted">Signed in as</p>
            <p className="mt-1 truncate text-sm font-semibold text-mist">{user?.username}</p>
            <button
              className="btn-secondary mt-4 w-full"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-line bg-deep/90 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-line bg-accent-soft text-accent">
              <Router size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted">Private network</p>
              <h1 className="truncate font-display text-xl font-semibold text-mist">PiHomeHub</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle compact />
            <button
              className="icon-button h-10 w-10"
              aria-label="Sign out"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-focus ${
                  isActive ? "bg-accent text-white" : "border border-line bg-raised text-muted"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="main-content" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:ml-72 lg:px-8 lg:py-10">
        <Outlet />
      </main>
      <OfflineIndicator />
    </div>
  );
}
