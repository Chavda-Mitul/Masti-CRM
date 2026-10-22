import type { HelperAnswer, Outcome } from '../../../lib/portalHelper'
import { dayMonth } from '../../enquiries/case/labels'
import { postedWhen } from '../../notices/labels'

// Settings → Portal logins' wording (docs/decisions/0024-portal-logins.md), in plain words for staff.

/** Shown when this browser has no CRM helper. */
export const NO_HELPER = 'Log in for me works only on the office computers.'

/** "Who used what": what happened after the press. */
const OUTCOME_WORDS: Record<Outcome, string> = {
  SUBMITTED: 'logged in',
  WAITING_FOR_STAFF: 'letters to type',
  NO_LOGIN_BOXES: "didn't log in by itself",
  ADDRESS_CHANGED: 'portal has moved',
  DIDNT_OPEN: "page didn't open",
  REFUSED: 'refused',
  FAILED: 'went wrong',
}

export const outcomeWords = (outcome: Outcome | null) => (outcome ? OUTCOME_WORDS[outcome] : 'no answer from the helper')

/** Outcomes the HOD should look at. */
export const needsLooking = (outcome: Outcome | null) => outcome !== 'SUBMITTED' && outcome !== 'WAITING_FOR_STAFF'

/** When: "today, 12:04 pm", "yesterday", "Sat", then "28 Sep". */
export const usedWhen = postedWhen

/** The card's line about the password ("Password saved 21 Oct"). Scheduled changes come in a later part. */
export const passwordLine = (passwordChangedAt: string) => `Password saved ${dayMonth(passwordChangedAt)}`

/** What a press tells the person: a toast, and the same words kept on the card when something needs doing. */
export interface PressResult {
  tone: 'ok' | 'warn' | 'bad'
  message: string
  keep: boolean
}

/** caseNo: pressed on a visa case (component 3), as the demo says "for case V-2041". */
export function pressResult(answer: HelperAnswer, portalName: string, caseNo?: string): PressResult {
  switch (answer.outcome) {
    case 'SUBMITTED':
      return {
        tone: 'ok',
        message: `Opened ${portalName} ${caseNo ? `for case ${caseNo}` : 'for you'}. The ID and password were never shown.`,
        keep: false,
      }
    case 'WAITING_FOR_STAFF':
      return { tone: 'ok', message: `${portalName} is open. Type the letters you see there, then press Login.`, keep: false }
    case 'NO_LOGIN_BOXES':
      return { tone: 'warn', message: "This portal didn't log in by itself. Your HOD can see this on Portal logins.", keep: true }
    case 'ADDRESS_CHANGED':
      return { tone: 'warn', message: 'This portal now opens at a different address. Ask your HOD to check it.', keep: true }
    case 'DIDNT_OPEN':
      return { tone: 'warn', message: "The portal didn't open. Check the internet and try again.", keep: true }
    case 'REFUSED':
      return { tone: 'bad', message: answer.message ?? 'Log in for me was refused. Ask your HOD.', keep: true }
    default:
      return { tone: 'bad', message: "Log in for me didn't work. Try again, and tell your HOD if it keeps happening.", keep: true }
  }
}
