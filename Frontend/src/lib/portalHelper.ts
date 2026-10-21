// The CRM helper: a Chrome extension (Helper/) that types a portal's saved login when someone presses Log in for me
// (docs/decisions/0024-portal-logins.md). A page talks to it with chrome.runtime.sendMessage, which Chrome offers only on
// the pages the helper lists. Used by Settings → Portal logins, and later by the visa case's portal card.

/**
 * Every outcome a press can end in: a copy of Helper/src/protocol.ts's OUTCOMES and the Prisma enum PortalLoginOutcome
 * (Backend/tests/frontendRules.test.ts checks they agree).
 */
export const OUTCOMES = ['SUBMITTED', 'WAITING_FOR_STAFF', 'NO_LOGIN_BOXES', 'ADDRESS_CHANGED', 'DIDNT_OPEN', 'REFUSED', 'FAILED'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** What the helper answered; message is the server's own words when it refused. */
export interface HelperAnswer {
  outcome: Outcome
  message?: string
}

/** Only the bit of Chrome's API a page gets (no @types/chrome here). */
interface ChromeRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void
  lastError?: { message?: string }
}

function chromeRuntime(): ChromeRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime
}

/** One message to the helper; undefined when it isn't there, or doesn't answer in time. */
function send(helperId: string, message: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const runtime = chromeRuntime()
    if (!runtime?.sendMessage) return resolve(undefined)
    const timer = setTimeout(() => resolve(undefined), timeoutMs)
    try {
      runtime.sendMessage(helperId, message, (response) => {
        clearTimeout(timer)
        // Reading lastError tells Chrome it was handled: "not installed" lands here.
        resolve(runtime.lastError ? undefined : response)
      })
    } catch {
      clearTimeout(timer)
      resolve(undefined)
    }
  })
}

/** Which of these helper IDs is installed in this browser, or null. */
export async function findHelper(helperIds: string[]): Promise<string | null> {
  for (const id of helperIds) {
    const answer = (await send(id, { type: 'ping' }, 1500)) as { ok?: unknown } | undefined
    if (answer?.ok === true) return id
  }
  return null
}

/** Hands the helper a press's ticket and waits for what happened (a slow portal can take most of a minute). */
export async function helperLogIn(helperId: string, ticket: string): Promise<HelperAnswer> {
  const answer = (await send(helperId, { type: 'login', ticket }, 60_000)) as Partial<HelperAnswer> | undefined
  if (answer && typeof answer.outcome === 'string' && (OUTCOMES as readonly string[]).includes(answer.outcome)) {
    return { outcome: answer.outcome, ...(typeof answer.message === 'string' ? { message: answer.message } : {}) }
  }
  return { outcome: 'FAILED' }
}
