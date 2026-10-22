import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../../lib/api'
import { errorText } from '../../../lib/apiErrors'
import { findHelper, helperLogIn } from '../../../lib/portalHelper'
import { NO_HELPER, pressResult, type PressResult } from './labels'
import { portalKeys } from './queries'

/** The one-time ticket a press gets from the CRM. */
export interface OpenedPress {
  useId: string
  ticket: string
}

/**
 * Log in for me (docs/decisions/0024-portal-logins.md): a one-time ticket from the CRM, handed to the helper, which opens
 * the portal and types the login there. The ID and password never come to this page. One plain async function, so
 * nothing of a press is kept in a query cache. On a visa case, `open` asks for the case's ticket instead (component 3)
 * and `caseNo` goes into the words. `disabled`: the portal is locked (component 2).
 */
export function LogInForMeButton({
  portal,
  helperIds,
  onResult,
  open,
  caseNo,
  className = 'btn btn-primary portal-go',
  disabled = false,
}: {
  portal: { id: string; name: string }
  helperIds: string[]
  onResult: (result: PressResult) => void
  open?: () => Promise<OpenedPress>
  caseNo?: string
  className?: string
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function press() {
    setBusy(true)
    try {
      const helperId = await findHelper(helperIds)
      if (!helperId) return onResult({ tone: 'bad', message: NO_HELPER, keep: true })

      let opened: OpenedPress
      try {
        opened = open ? await open() : await api<OpenedPress>(`/portal-logins/${portal.id}/open`, { method: 'POST', body: {} })
      } catch (error) {
        return onResult({ tone: 'bad', message: errorText(error) ?? "Log in for me didn't work. Try again.", keep: true })
      }

      const answer = await helperLogIn(helperId, opened.ticket)
      // The server marked a refusal itself.
      if (answer.outcome !== 'REFUSED') {
        await api(`/portal-logins/uses/${opened.useId}/outcome`, { method: 'POST', body: { outcome: answer.outcome } }).catch(() => undefined)
      }
      onResult(pressResult(answer, portal.name, caseNo))
      void queryClient.invalidateQueries({ queryKey: portalKeys.all })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={className} onClick={() => void press()} disabled={busy || disabled}>
      {busy ? 'Opening the portal…' : 'Log in for me'}
    </button>
  )
}
