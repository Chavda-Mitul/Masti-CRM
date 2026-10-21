import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { errorCode } from '../../lib/apiErrors'

// The client's consent page (docs/decisions/0022-consent-form.md, part 2; Backend src/modules/consent). No login: the
// token from the link is the key, sent in the body so it never sits in an address a server logs.

/** Masti's name, address and phones: nothing of its tax or bank details. */
export interface ConsentCompany {
  name: string
  address: string
  phone: string
  /** The 24/7 number. */
  phone2: string | null
}

/** The person as the form shows them, and as the consent keeps them once agreed. Dates are YYYY-MM-DD. */
export interface ConsentPerson {
  name: string
  relation: string
  passportNumber: string | null
  dateOfBirth: string | null
  spouseDateOfBirth: string | null
  anniversary: string | null
  motherDateOfBirth: string | null
  fatherDateOfBirth: string | null
  residentialAddress: string | null
  officeAddress: string | null
  /** A year, in whole rupees. */
  annualIncome: number | null
  profession: string | null
  education: string | null
}

interface Agreed {
  state: 'AGREED'
  name: string
  agreedAt: string
}

/** OPEN: the form to agree to; detailsHash is the details' fingerprint, sent back with "I agree". AGREED: said once already, so no details. */
export type ConsentView =
  | { state: 'OPEN'; person: ConsentPerson; detailsHash: string; wording: { id: number; body: string }; company: ConsentCompany }
  | (Agreed & { company: ConsentCompany })

/** What the page showed, so the client agrees only to what they read. */
interface Shown {
  wordingId: number
  detailsHash: string
}

const consentKey = (token: string) => ['consent', token] as const

export function useConsentView(token: string) {
  return useQuery({
    queryKey: consentKey(token),
    queryFn: async () => (await api<{ consent: ConsentView }>('/public/consent/view', { method: 'POST', body: { token } })).consent,
    enabled: token !== '',
    // Coming back to the tab mustn't reload the form under the reader.
    refetchOnWindowFocus: false,
  })
}

/** The form changed while the client read it (409): its wording, or their details. */
export const formChanged = (error: unknown) => ['WORDING_CHANGED', 'DETAILS_CHANGED'].includes(errorCode(error) ?? '')

/** "I agree", to the form as the page showed it. */
export function useAgreeConsent(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shown: Shown) =>
      (await api<{ consent: Agreed }>('/public/consent/agree', { method: 'POST', body: { token, ...shown } })).consent,
    onSuccess: (agreed) =>
      queryClient.setQueryData<ConsentView>(consentKey(token), (view) => view && { ...agreed, company: view.company }),
    onError: (error) => {
      // The form changed while they read it, or a newer link replaced this one: load it again.
      if (formChanged(error) || (error instanceof ApiError && error.status === 410)) {
        void queryClient.invalidateQueries({ queryKey: consentKey(token) })
      }
    },
  })
}
