import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AppShell } from "./components/layout/AppShell";
import { PageSkeleton } from "./components/investigation";

const MissionControl = lazy(() => import("./pages/MissionControl"));
const TimePortal = lazy(() => import("./pages/TimePortal"));
const Timeline = lazy(() => import("./pages/Timeline"));
const Breakage = lazy(() => import("./pages/Breakage"));
const Divergence = lazy(() => import("./pages/Divergence"));
const InfectionMap = lazy(() => import("./pages/InfectionMap"));
const Gemma = lazy(() => import("./pages/Gemma"));
const RestoreLab = lazy(() => import("./pages/RestoreLab"));
const Reports = lazy(() => import("./pages/Reports"));
const Health = lazy(() => import("./pages/Health"));
const Saved = lazy(() => import("./pages/Saved"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Docs = lazy(() => import("./pages/Docs"));

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } } });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/mission" replace />} />
        {(
          [
            ["/mission", MissionControl],
            ["/portal", TimePortal],
            ["/timeline", Timeline],
            ["/breakage", Breakage],
            ["/divergence", Divergence],
            ["/infection", InfectionMap],
            ["/gemma", Gemma],
            ["/restore", RestoreLab],
            ["/reports", Reports],
            ["/health", Health],
            ["/saved", Saved],
            ["/settings", SettingsPage],
            ["/docs", Docs],
          ] as const
        ).map(([path, Page]) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<PageSkeleton />}>
                <Page />
              </Suspense>
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/mission" replace />} />
      </Route>
    </Routes>
  );
}

const client = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: "#101E29", border: "1px solid #1d3343", color: "#EDF7F5" } }} />
    </QueryClientProvider>
  );
}
