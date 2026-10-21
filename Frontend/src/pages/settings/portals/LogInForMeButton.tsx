import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../../lib/api'
import { errorText } from '../../../lib/apiErrors'
import { findHelper, helperLogIn } from '../../../lib/portalHelper'
import { NO_HELPER, pressResult, type PressResult } from './labels'
import { portalKeys } from './queries'

/**
 * Log in for me (docs/decisions/0024-portal-logins.md): a one-time ticket from the CRM, handed to the helper, which opens
 * the portal and types the login there. The ID and password never come to this page. One plain async function, so
 * nothing of a press is kept in a query cache.
 */
export function LogInForMeButton({
  portal,
  helperIds,
  onResult,
}: {
  portal: { id: string; name: string }
  helperIds: string[]
  onResult: (result: PressResult) => void
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function press() {
    setBusy(true)
    try {
      const helperId = await findHelper(helperIds)
      if (!helperId) return onResult({ tone: 'bad', message: NO_HELPER, keep: true })

      let opened: { useId: string; ticket: string }
      try {
        opened = await api<{ useId: string; ticket: string }>(`/portal-logins/${portal.id}/open`, { method: 'POST', body: {} })
      } catch (error) {
        return onResult({ tone: 'bad', message: errorText(error) ?? "Log in for me didn't work. Try again.", keep: true })
      }

      const answer = await helperLogIn(helperId, opened.ticket)
      // The server marked a refusal itself.
      if (answer.outcome !== 'REFUSED') {
        await api(`/portal-logins/uses/${opened.useId}/outcome`, { method: 'POST', body: { outcome: answer.outcome } }).catch(() => undefined)
      }
      onResult(pressResult(answer, portal.name))
      void queryClient.invalidateQueries({ queryKey: portalKeys.all })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="btn btn-primary portal-go" onClick={() => void press()} disabled={busy}>
      {busy ? 'Opening the portal…' : 'Log in for me'}
    </button>
  )
}
