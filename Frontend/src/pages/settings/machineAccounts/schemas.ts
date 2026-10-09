import { z } from 'zod'

// Form validation for machine accounts. Mirrors Backend/src/modules/apiClients/apiClients.schemas.ts so mistakes
// show up before saving. IP entries get a light check here; the backend's isIpOrCidr (node:net) is the real one.

export type ApiScope = 'HOLIDAYS_PUSH'

/** At most this many allowed addresses per account (the backend's limit). */
export const MAX_ALLOWED_IPS = 20

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const IPV6 = /^[0-9a-f:.]+$/i

/** "203.0.113.10", "203.0.113.0/24", "2001:db8::/32". */
function looksLikeIpOrCidr(entry: string): boolean {
  const [base = '', prefix, extra] = entry.split('/')
  if (extra !== undefined) return false
  const v6 = base.includes(':')
  if (v6 ? !IPV6.test(base) : !IPV4.test(base)) return false
  if (prefix === undefined) return true
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (v6 ? 128 : 32)
}

/** The textarea's entries: one per line (commas work too), blanks dropped. */
export function ipEntries(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export const apiClientFormSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name, e.g. Holiday bot.').max(80, 'Keep it under 80 characters.'),
  scopes: z.array(z.enum(['HOLIDAYS_PUSH'])).min(1, 'Pick at least one thing it can do.'),
  allowedIps: z.string().superRefine((text, ctx) => {
    const entries = ipEntries(text)
    if (entries.length > MAX_ALLOWED_IPS) {
      ctx.addIssue({ code: 'custom', message: `At most ${MAX_ALLOWED_IPS} addresses.` })
      return
    }
    const bad = entries.filter((e) => e.length > 50 || !looksLikeIpOrCidr(e))
    if (bad.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Not an IP address or range: ${bad.join(', ')}. Use e.g. 203.0.113.10 or 203.0.113.0/24.` })
    }
  }),
})

export type ApiClientFormValues = z.infer<typeof apiClientFormSchema>

export interface ApiClientBody {
  name?: string
  scopes?: ApiScope[]
  allowedIps?: string[]
}

/** Form values → request body. `include` picks the fields to send (all on create, the changed ones on edit). */
export function apiClientBody(values: ApiClientFormValues, include: (field: keyof ApiClientFormValues) => boolean): ApiClientBody {
  const body: ApiClientBody = {}
  if (include('name')) body.name = values.name.trim()
  if (include('scopes')) body.scopes = values.scopes
  if (include('allowedIps')) body.allowedIps = ipEntries(values.allowedIps)
  return body
}
