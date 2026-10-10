import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type {
  ClientLookup,
  CreateVisaCaseBody,
  DocumentStatus,
  EnquiryListFilters,
  EnquiryListPage,
  EnquirySourceOption,
  IntakeCountry,
  ReceivedAs,
  VisaCase,
} from './types'

// Server state for the enquiry screens (TanStack Query).

const PAGE_SIZE = 25
/** Dropdown data changes rarely; don't refetch it on every visit. */
const OPTIONS_STALE = 5 * 60_000

export const enquiryKeys = {
  all: ['enquiries'] as const,
  lists: () => ['enquiries', 'list'] as const,
  list: (filters: EnquiryListFilters) => ['enquiries', 'list', filters] as const,
  sources: ['enquiries', 'sources'] as const,
  visaOfferings: ['enquiries', 'visa-offerings'] as const,
  lookups: ['enquiries', 'client-lookup'] as const,
  lookup: (mobile: string) => ['enquiries', 'client-lookup', mobile] as const,
  cases: ['enquiries', 'case'] as const,
  case: (caseNo: string) => ['enquiries', 'case', caseNo.toUpperCase()] as const,
}

/** One visa case: the case page (Step 2 onwards). */
export function useVisaCase(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.case(caseNo),
    queryFn: async () => (await api<{ case: VisaCase }>(`/visa/cases/${encodeURIComponent(caseNo)}`)).case,
  })
}

/**
 * A case action returns the whole case: it replaces the page's copy. The list (its stage) and the client's open cases
 * may have changed with it.
 */
function useCaseAction<Vars>(caseNo: string, request: (path: string, vars: Vars) => Promise<{ case: VisaCase }>) {
  const queryClient = useQueryClient()
  const base = `/visa/cases/${encodeURIComponent(caseNo)}`
  return useMutation({
    mutationFn: async (vars: Vars) => (await request(base, vars)).case,
    onSuccess: (updated) => {
      queryClient.setQueryData(enquiryKeys.case(caseNo), updated)
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

/** "Start collecting documents": Enquiry → Documents. */
export function useStartDocuments(caseNo: string) {
  return useCaseAction<void>(caseNo, (base) => api(`${base}/start`, { method: 'POST' }))
}

/** Ticks one paper: Original/Xerox, Made, Not needed, or back to Pending. */
export function useUpdateCaseDocument(caseNo: string) {
  return useCaseAction<{ documentId: string; status: DocumentStatus; receivedAs?: ReceivedAs | null }>(
    caseNo,
    (base, { documentId, ...body }) => api(`${base}/documents/${documentId}`, { method: 'PATCH', body }),
  )
}

/** Names a traveller: links the client's family member. */
export function useLinkTraveller(caseNo: string) {
  return useCaseAction<{ travellerId: string; memberId: string }>(caseNo, (base, { travellerId, memberId }) =>
    api(`${base}/travellers/${travellerId}/member`, { method: 'PUT', body: { memberId } }),
  )
}

/** All enquiries: late first, then by time due. Paged with the API's cursor ("Show more"). */
export function useEnquiryList(filters: EnquiryListFilters) {
  return useInfiniteQuery({
    queryKey: enquiryKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (filters.department) params.set('department', filters.department)
      if (filters.mine) params.set('mine', 'true')
      if (filters.q) params.set('q', filters.q)
      if (pageParam) params.set('cursor', pageParam)
      return api<EnquiryListPage>(`/enquiries?${params.toString()}`)
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
}

/** "Came in through" chips. */
export function useEnquirySources() {
  return useQuery({
    queryKey: enquiryKeys.sources,
    queryFn: async () => (await api<{ sources: EnquirySourceOption[] }>('/enquiries/sources')).sources,
    staleTime: OPTIONS_STALE,
  })
}

/**
 * Countries with the visa types we process for them (only ones with a checklist).
 * Refetched each time the form opens: a visa the Visa HOD just switched off (maybe on another computer) must not be
 * offered. The cached list shows meanwhile, so the form doesn't wait.
 */
export function useVisaIntakeOfferings() {
  return useQuery({
    queryKey: enquiryKeys.visaOfferings,
    queryFn: async () => (await api<{ countries: IntakeCountry[] }>('/visa/offerings')).countries,
    staleTime: OPTIONS_STALE,
    refetchOnMount: 'always',
  })
}

/** "Existing client" and their open cases while typing the mobile. `mobile` is the normalised number, or null while it isn't one yet. */
export function useClientLookup(mobile: string | null) {
  return useQuery({
    enabled: mobile !== null,
    queryKey: enquiryKeys.lookup(mobile ?? ''),
    queryFn: () => api<ClientLookup>(`/clients/lookup?mobile=${encodeURIComponent(mobile ?? '')}`),
    staleTime: 30_000,
  })
}

/** "Save enquiry". The key makes a retried or double-clicked save return the same case. */
export function useCreateVisaCase(idempotencyKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateVisaCaseBody) =>
      api<{ case: VisaCase; clientCreated: boolean }>('/visa/cases', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.lookups })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    // E.g. "We don't process this country and visa type any more": show the current list.
    onError: () => void queryClient.invalidateQueries({ queryKey: enquiryKeys.visaOfferings }),
  })
}
