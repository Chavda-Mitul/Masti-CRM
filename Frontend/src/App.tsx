import { Link, Route, Routes } from 'react-router'
import { RequireAuth, RequireDesktop, RequireField, RequireHead } from './auth/guards'
import { AppShell } from './components/AppShell'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ClientDetailPage } from './pages/clients/ClientDetailPage'
import { ClientDirectoryPage } from './pages/clients/ClientDirectoryPage'
import { LoginPage } from './pages/LoginPage'
import { TasksPage } from './pages/TasksPage'
import { TodayPage } from './pages/TodayPage'
import { UsersPage } from './pages/UsersPage'

function NotFound() {
  return (
    <div className="card pad" style={{ maxWidth: 480 }}>
      <h1 className="h2">Page not found</h1>
      <p className="muted">
        <Link to="/">Go to Today</Link>
      </p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tasks"
        element={
          <RequireAuth>
            <RequireField>
              <TasksPage />
            </RequireField>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <RequireDesktop>
              <AppShell />
            </RequireDesktop>
          </RequireAuth>
        }
      >
        <Route index element={<TodayPage />} />
        <Route path="clients" element={<ClientDirectoryPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route
          path="settings/users"
          element={
            <RequireHead>
              <UsersPage />
            </RequireHead>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
