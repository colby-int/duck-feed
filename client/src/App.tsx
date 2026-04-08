import type { ReactElement } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AdminShell } from './components/AdminShell';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/use-auth';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { EpisodeDetailPage } from './pages/EpisodeDetailPage';
import { EpisodesPage } from './pages/EpisodesPage';
import { IngestPage } from './pages/IngestPage';
import { LoginPage } from './pages/LoginPage';
import { PlayerPage } from './pages/PlayerPage';
import { StreamPage } from './pages/StreamPage';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment text-ink">
        <div className="rounded-[1.5rem] bg-card px-6 py-4 shadow-ringwarm shadow-whisper">Loading admin…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate replace state={{ from: location }} to="/admin/login" />;
  }

  return children;
}

function AdminAuthBoundary() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<PlayerPage />} path="/" />
      <Route element={<AdminAuthBoundary />} path="/admin">
        <Route element={<LoginPage />} path="login" />
        <Route
          element={
            <RequireAuth>
              <AdminShell />
            </RequireAuth>
          }
        >
          <Route element={<AdminDashboardPage />} index />
          <Route element={<EpisodesPage />} path="episodes" />
          <Route element={<EpisodeDetailPage />} path="episodes/:id" />
          <Route element={<IngestPage />} path="ingest" />
          <Route element={<StreamPage />} path="stream" />
        </Route>
      </Route>
    </Routes>
  );
}
