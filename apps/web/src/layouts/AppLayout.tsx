import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, ListChecks, LogOut, Monitor, Router, Settings, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-line bg-deep/88 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
            <Router size={22} strokeWidth={2.2} />
          </div>
          <div>
            <p className="eyebrow">Private network</p>
            <h1 className="font-display text-2xl font-semibold leading-tight text-white">PiHomeHub</h1>
          </div>
        </div>
        <nav className="mt-8 grid gap-2" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isActive
                      ? "bg-accent-soft text-white shadow-glow"
                      : "text-muted hover:bg-white/[0.04] hover:text-white"
                  }`
                }
              >
                <Icon size={18} strokeWidth={2.1} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-line bg-card/70 p-4">
          <p className="text-xs text-muted">Signed in as</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{user?.username}</p>
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
      </aside>

      <header className="sticky top-0 z-20 border-b border-line bg-deep/90 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
              <Router size={20} />
            </div>
            <div className="min-w-0">
              <p className="eyebrow">Private network</p>
              <h1 className="truncate font-display text-xl font-semibold text-white">PiHomeHub</h1>
            </div>
          </div>
          <button
            className="btn-secondary min-h-10 px-3"
            aria-label="Sign out"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition duration-200 ${
                  isActive ? "bg-accent text-deep" : "bg-white/[0.04] text-muted"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="main-content" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:ml-72 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
