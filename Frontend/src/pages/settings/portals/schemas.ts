import { z } from 'zod'

// The portal form (Backend portalLogins.schemas.ts, the same limits and address rule; Backend/tests/frontendRules.test.ts
// checks they agree).

export const MAX_PORTAL_NAME = 80
export const MAX_PORTAL_URL = 500
export const MAX_ID_LABEL = 30
export const MAX_LOGIN_ID = 200
export const MAX_PORTAL_PASSWORD = 200
export const MAX_STEP = 120
export const MAX_STEPS = 20

/** The steps textarea, one per line, as the list the API wants. */
export function stepsFromText(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** How often a portal's password has to change (component 2); overdue, the portal locks. */
export const PASSWORD_SCHEDULES = ['DAILY', 'WEEKLY', 'MONTHLY', 'NONE'] as const
export type PasswordSchedule = (typeof PASSWORD_SCHEDULES)[number]

/**
 * Why a login page address can't be saved, or null if it can: https, or http (some suppliers' portals have no https),
 * and never an ID or password inside the address.
 */
export function loginUrlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return "Paste the portal's login page address, starting with https://"
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'The address must start with https:// or http://'
  if (url.username || url.password) return 'Take the ID and password out of the address: they go in their own boxes.'
  if (/\s/.test(url.href) || url.href.length > MAX_PORTAL_URL) return `Use an address of at most ${MAX_PORTAL_URL} characters.`
  return null
}

/** changeId / changePassword: when editing, the boxes open only on purpose (new portals always have them). */
export const portalFormSchema = z
  .object({
    departmentCode: z.string().min(1, 'Pick a department.'),
    name: z.string().trim().min(1, 'Give the portal a name.').max(MAX_PORTAL_NAME, `Keep the name to ${MAX_PORTAL_NAME} characters.`),
    loginUrl: z
      .string()
      .trim()
      .min(1, "Paste the portal's login page address.")
      .superRefine((value, ctx) => {
        const problem = loginUrlProblem(value)
        if (problem) ctx.addIssue({ code: 'custom', message: problem })
      }),
    idLabel: z.string().trim().min(1, 'Say what the portal calls the first box, e.g. ID.').max(MAX_ID_LABEL, `Keep it to ${MAX_ID_LABEL} characters.`),
    // A third login box before the ID and password (e.g. an agency code).
    hasExtra: z.boolean(),
    extraLabel: z.string().trim().max(MAX_ID_LABEL, `Keep it to ${MAX_ID_LABEL} characters.`),
    changeExtra: z.boolean(),
    extra: z.string().max(MAX_LOGIN_ID, `Keep it to ${MAX_LOGIN_ID} characters.`),
    stepsText: z.string(),
    changeId: z.boolean(),
    loginId: z.string().max(MAX_LOGIN_ID, `Keep the ID to ${MAX_LOGIN_ID} characters.`),
    changePassword: z.boolean(),
    password: z.string().max(MAX_PORTAL_PASSWORD, `Keep the password to ${MAX_PORTAL_PASSWORD} characters.`),
    passwordSchedule: z.enum(PASSWORD_SCHEDULES, 'Pick how often the password changes.'),
    userIds: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    if (values.changeId && !values.loginId.trim()) ctx.addIssue({ code: 'custom', path: ['loginId'], message: "Type the portal's ID." })
    if (values.changePassword && !values.password) ctx.addIssue({ code: 'custom', path: ['password'], message: "Type the portal's password." })
    if (values.hasExtra && !values.extraLabel.trim()) ctx.addIssue({ code: 'custom', path: ['extraLabel'], message: 'Say what the extra box is called.' })
    if (values.hasExtra && values.changeExtra && !values.extra.trim())
      ctx.addIssue({ code: 'custom', path: ['extra'], message: 'Type the value for the extra box.' })
    const steps = stepsFromText(values.stepsText)
    if (steps.length > MAX_STEPS) ctx.addIssue({ code: 'custom', path: ['stepsText'], message: `Up to ${MAX_STEPS} steps.` })
    if (steps.some((s) => s.length > MAX_STEP)) ctx.addIssue({ code: 'custom', path: ['stepsText'], message: `Keep each step to ${MAX_STEP} characters.` })
  })

export type PortalFormValues = z.infer<typeof portalFormSchema>
