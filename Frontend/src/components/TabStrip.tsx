import { NavLink } from 'react-router'

export interface Tab {
  label: string
  /** A route (NavLink, active on its sub-routes too). Leave it out for a tab that isn't built yet. */
  to?: string
}

/** Page tabs, as in the demo's Settings header ("Portal logins · Masters & holiday calendar"). */
export function TabStrip({ tabs, label }: { tabs: Tab[]; label: string }) {
  return (
    <nav className="tabstrip" aria-label={label}>
      {tabs.map((tab) =>
        tab.to ? (
          <NavLink key={tab.label} to={tab.to} className="tab">
            {tab.label}
          </NavLink>
        ) : (
          <span key={tab.label} className="tab tab-disabled" aria-disabled="true">
            {tab.label} <span className="tag">Soon</span>
          </span>
        ),
      )}
    </nav>
  )
}
