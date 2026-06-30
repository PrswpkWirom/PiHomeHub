import { Navigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-app px-4 text-mist">
        <div className="app-panel w-full max-w-sm text-center">
          <div className="skeleton mx-auto h-12 w-12 rounded-xl" />
          <p className="mt-4 text-sm font-semibold text-white">Loading PiHomeHub...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
