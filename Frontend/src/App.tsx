import { Link, Navigate, Route, Routes } from 'react-router'
import { RequireAuth, RequireDesktop, RequireField, RequireHead } from './auth/guards'
import { AppShell } from './components/AppShell'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ClientDetailPage } from './pages/clients/ClientDetailPage'
import { ClientDirectoryPage } from './pages/clients/ClientDirectoryPage'
import { EnquiriesPage } from './pages/enquiries/EnquiriesPage'
import { FieldRunPage } from './pages/field/FieldRunPage'
import { FieldStopPage } from './pages/field/FieldStopPage'
import { FollowUpsPage } from './pages/followUps/FollowUpsPage'
import { VisaCasePage } from './pages/enquiries/case/VisaCasePage'
import { NewEnquiryPage } from './pages/enquiries/NewEnquiryPage'
import { LoginPage } from './pages/LoginPage'
import { ChecklistEditorPage } from './pages/settings/masters/checklists/ChecklistEditorPage'
import { ChecklistsPage } from './pages/settings/masters/checklists/ChecklistsPage'
import { CompanyPage } from './pages/settings/company/CompanyPage'
import { MasterListsPage } from './pages/settings/masters/lists/MasterListsPage'
import { StickerPrintPage } from './pages/print/StickerPrintPage'
import { MastersPage } from './pages/settings/masters/MastersPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'
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
              <FieldRunPage />
            </RequireField>
          </RequireAuth>
        }
      />
      <Route
        path="/tasks/:jobId"
        element={
          <RequireAuth>
            <RequireField>
              <FieldStopPage />
            </RequireField>
          </RequireAuth>
        }
      />
      {/* Print pages: outside the app shell, so only the document prints. */}
      <Route
        path="/print/sticker/:caseNo"
        element={
          <RequireAuth>
            <RequireDesktop>
              <StickerPrintPage />
            </RequireDesktop>
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
        <Route path="enquiries" element={<EnquiriesPage />} />
        <Route path="enquiries/new" element={<NewEnquiryPage />} />
        {/* Only visa cases exist so far; Stage 2 departments get their own case pages. */}
        <Route path="enquiries/:caseNo" element={<VisaCasePage />} />
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route path="clients" element={<ClientDirectoryPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        {/* Settings (demo screen 29). Masters are readable by the Head and office staff; the rest is the Head's. */}
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="masters" replace />} />
          <Route path="masters" element={<MastersPage />} />
          <Route path="masters/checklists" element={<ChecklistsPage />} />
          <Route path="masters/checklists/:offeringId" element={<ChecklistEditorPage />} />
          <Route path="masters/lists" element={<MasterListsPage />} />
          <Route path="company" element={<CompanyPage />} />
          <Route
            path="users"
            element={
              <RequireHead>
                <UsersPage />
              </RequireHead>
            }
          />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
