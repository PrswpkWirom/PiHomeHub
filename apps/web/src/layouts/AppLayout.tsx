import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/devices", label: "Devices" },
  { to: "/services", label: "Services" },
  { to: "/planner", label: "Planner" },
  { to: "/settings", label: "Settings" }
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(231,111,81,0.18),_transparent_28%),linear-gradient(180deg,_#f3ede2_0%,_#eef1eb_100%)] text-slate-800">
      <header className="border-b border-ink/10 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-ember">Private Home Server</p>
            <h1 className="font-display text-3xl text-ink">PiHomeHub</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.username}</span>
            <button
              className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-2 overflow-auto px-4 pb-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-full px-4 py-2 text-sm font-semibold ${isActive ? "bg-ink text-white" : "bg-white text-ink"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
