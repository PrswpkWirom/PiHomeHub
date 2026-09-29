import { Navigate } from "react-router-dom";

import { FeedbackMessage } from "../components/FeedbackMessage";
import { useAuth } from "../contexts/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, authError, refresh } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-app px-4 text-mist">
        <div className="app-panel w-full max-w-sm text-center">
          <div className="skeleton mx-auto h-12 w-12 rounded-[14px]" />
          <p className="mt-4 text-sm font-semibold text-mist">Loading PiHomeHub...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (authError) {
      return (
        <main className="grid min-h-dvh place-items-center bg-app px-4 text-mist">
          <section className="app-panel w-full max-w-md">
            <h1 className="text-xl font-semibold">Unable to verify sign-in</h1>
            <FeedbackMessage feedback={{ kind: "error", persistent: true, text: authError }} action={<button className="btn-secondary" type="button" onClick={() => void refresh()}>Retry connection</button>} />
          </section>
        </main>
      );
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
