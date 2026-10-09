import { Outlet } from 'react-router'
import { useMe } from '../../auth/useAuth'
import { TabStrip, type Tab } from '../../components/TabStrip'
import './settings.css'

/**
 * Settings, as in the demo: tabs across the top, then the tab's page.
 * Portal logins (the credential vault) isn't built yet. Staff & roles is the Head's.
 */
export function SettingsLayout() {
  const { data: me } = useMe()
  const tabs: Tab[] = [{ label: 'Portal logins' }, { label: 'Masters & holiday calendar', to: '/settings/masters' }]
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
