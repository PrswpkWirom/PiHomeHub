import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./layouts/AppLayout";
import { ProtectedRoute } from "./layouts/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicesPage } from "./pages/DevicesPage";
import { PlannerPage } from "./pages/PlannerPage";
import { ServicesPage } from "./pages/ServicesPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
