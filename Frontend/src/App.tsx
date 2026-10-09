import { Link, Navigate, Route, Routes } from 'react-router'
import { RequireAuth, RequireDesktop, RequireField, RequireHead } from './auth/guards'
import { AppShell } from './components/AppShell'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ClientDetailPage } from './pages/clients/ClientDetailPage'
import { ClientDirectoryPage } from './pages/clients/ClientDirectoryPage'
import { LoginPage } from './pages/LoginPage'
import { MachineAccountsPage } from './pages/settings/machineAccounts/MachineAccountsPage'
import { ChecklistEditorPage } from './pages/settings/masters/checklists/ChecklistEditorPage'
import { ChecklistsPage } from './pages/settings/masters/checklists/ChecklistsPage'
import { MasterListsPage } from './pages/settings/masters/lists/MasterListsPage'
import { MastersPage } from './pages/settings/masters/MastersPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'
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
        {/* Settings (demo screen 29). Masters are readable by the Head and office staff; the rest is the Head's. */}
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="masters" replace />} />
          <Route path="masters" element={<MastersPage />} />
          <Route path="masters/checklists" element={<ChecklistsPage />} />
          <Route path="masters/checklists/:offeringId" element={<ChecklistEditorPage />} />
          <Route path="masters/lists" element={<MasterListsPage />} />
          <Route
            path="users"
            element={
              <RequireHead>
                <UsersPage />
              </RequireHead>
            }
          />
          <Route
            path="machine-accounts"
            element={
              <RequireHead>
                <MachineAccountsPage />
              </RequireHead>
            }
          />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
