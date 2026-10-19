import { Outlet } from 'react-router'
import { can } from '../../auth/permissions'
import { useMe } from '../../auth/useAuth'
import { TabStrip, type Tab } from '../../components/TabStrip'
import './settings.css'

/**
 * Settings, as in the demo: tabs across the top, then the tab's page.
 * Portal logins (the credential vault) isn't built yet. Company & invoice is everyone's to read (0009). Visa, the
 * timings and the warnings' values, is the Visa department's to read (19 Oct 2026). Staff & roles is the Head's.
 */
export function SettingsLayout() {
  const { data: me } = useMe()
  const tabs: Tab[] = [
    { label: 'Portal logins' },
    { label: 'Masters & holiday calendar', to: '/settings/masters' },
    { label: 'Company & invoice', to: '/settings/company' },
  ]
  if (me && can(me, 'VISA', 'VIEW')) {
    tabs.push({ label: 'Visa', to: '/settings/visa' })
  }
  if (me?.type === 'HEAD') {
    tabs.push({ label: 'Staff & roles', to: '/settings/users' })
  }
  return (
    <>
      <TabStrip tabs={tabs} label="Settings" />
      <Outlet />
    </>
  )
}
