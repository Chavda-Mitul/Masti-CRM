import { addDays, istToday } from '../../../lib/format'
import type { HelperAnswer, Outcome } from '../../../lib/portalHelper'
import { dayMonth } from '../../enquiries/case/labels'
import { postedWhen } from '../../notices/labels'
import type { PasswordSchedule } from './schemas'
import type { Portal } from './types'

// Settings → Portal logins' wording (docs/decisions/0024-portal-logins.md), in plain words for staff.

/** Shown when this browser has no CRM helper. */
export const NO_HELPER = 'Log in for me works only on the office computers.'

/** "Who used what": what happened after the press. */
const OUTCOME_WORDS: Record<Outcome, string> = {
  SUBMITTED: 'logged in',
  WAITING_FOR_STAFF: 'letters or a code to type',
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

/** The drawer's "Password changes" choices (component 2). */
export const SCHEDULE_CHOICES: { value: PasswordSchedule; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'NONE', label: 'No schedule' },
]

const SCHEDULE_WORD: Record<Exclude<PasswordSchedule, 'NONE'>, string> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' })
const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** When the next change is due, as the demo says it: "tomorrow", a weekday within the week ("Thu"), then "22 Nov". */
function dueWhen(dueOn: string, today: string): string {
  if (dueOn === addDays(today, 1)) return 'tomorrow'
  const day = new Date(`${dueOn}T00:00:00Z`)
  return dueOn <= addDays(today, 6) ? WEEKDAY.format(day) : DAY_MONTH.format(day)
}

/**
 * The card's line about the password (demo screen 28): "Changed monthly · next 12 Oct", "Weekly change overdue — HOD to
 * reset" once it's locked, or "No scheduled change · password saved 21 Oct".
 */
export function passwordLine(portal: Pick<Portal, 'passwordSchedule' | 'passwordDueOn' | 'passwordChangedAt' | 'locked'>): string {
  if (portal.passwordSchedule === 'NONE' || !portal.passwordDueOn) {
    return `No scheduled change · password saved ${dayMonth(portal.passwordChangedAt)}`
  }
  const word = SCHEDULE_WORD[portal.passwordSchedule]
  if (portal.locked) return `${word.charAt(0).toUpperCase()}${word.slice(1)} change overdue — HOD to reset`
  return `Changed ${word} · next ${dueWhen(portal.passwordDueOn, istToday())}`
}

/** On a locked portal's drawer: since when, and what to do. */
export const lockedNote = (dueOn: string) =>
  `Locked since ${DAY_MONTH.format(new Date(`${dueOn}T00:00:00Z`))}. Change the password on the portal itself, then type the new one here.`

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
      return { tone: 'ok', message: `${portalName} is open. Type the letters or code it asks for, then press Login.`, keep: false }
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
