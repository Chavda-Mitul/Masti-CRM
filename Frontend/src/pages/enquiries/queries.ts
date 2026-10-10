import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { isStale } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import type {
  ClientLookup,
  CreateVisaCaseBody,
  DocumentArrival,
  DocumentStatus,
  EnquiryListFilters,
  EnquiryListPage,
  EnquirySourceOption,
  FollowUpBadge,
  FollowUpBucket,
  FollowUpDesk,
  FollowUpScope,
  IntakeCountry,
  LogFollowUpBody,
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
  desks: () => ['enquiries', 'follow-ups'] as const,
  desk: (bucket: FollowUpBucket, scope: FollowUpScope) => ['enquiries', 'follow-ups', bucket, scope] as const,
  /** Under desks(), so every case action that refreshes the desk refreshes the badge too. */
  badge: ['enquiries', 'follow-ups', 'badge'] as const,
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
 * A case action returns the whole case: it replaces the page's copy. The list (its stage), the follow-up desk (documents
 * pending) and the client's open cases may have changed with it.
 */
function useCaseAction<Vars>(caseNo: string, request: (path: string, vars: Vars) => Promise<{ case: VisaCase }>) {
  const queryClient = useQueryClient()
  const base = `/visa/cases/${encodeURIComponent(caseNo)}`
  return useMutation({
    mutationFn: async (vars: Vars) => (await request(base, vars)).case,
    onSuccess: (updated) => {
      queryClient.setQueryData(enquiryKeys.case(caseNo), updated)
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.desks() })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

/** How the documents reach us, and booklets received. */
export function useUpdateVisaCase(caseNo: string) {
  return useCaseAction<{ arrival?: DocumentArrival | null; bookletsCurrent?: number | null; bookletsOld?: number | null }>(
    caseNo,
    (base, body) => api(base, { method: 'PATCH', body }),
  )
}

/**
 * Log call, postpone, cancel, resume, reassign: actions on the shared enquiry. They return only its new state, so the case is
 * reloaded. A change by someone else in between (409 STALE) reloads it too, with a warning.
 */
function useEnquiryAction<Vars>(caseNo: string, request: (base: string, vars: Vars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const base = `/enquiries/${encodeURIComponent(caseNo)}`
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: enquiryKeys.case(caseNo) })
    void queryClient.invalidateQueries({ queryKey: enquiryKeys.lists() })
    void queryClient.invalidateQueries({ queryKey: enquiryKeys.desks() })
    void queryClient.invalidateQueries({ queryKey: ['clients'] })
  }
  return useMutation({
    mutationFn: (vars: Vars) => request(base, vars),
    onSuccess: refresh,
    onError: (error) => {
      if (!isStale(error)) return
      refresh()
      toast({ tone: 'warn', message: 'Someone else changed this case after you opened it. The latest version is now loaded. Please try again.' })
    },
  })
}

/** "Log call": What happened → Next step → When. On a postponed case it also resumes it. */
export function useLogFollowUp(caseNo: string) {
  return useEnquiryAction<LogFollowUpBody>(caseNo, (base, body) => api(`${base}/follow-ups`, { method: 'POST', body }))
}

export function usePostponeCase(caseNo: string) {
  return useEnquiryAction<{ reasonId: number; resumeOn: string; updatedAt: string }>(caseNo, (base, body) =>
    api(`${base}/postpone`, { method: 'POST', body }),
  )
}

export function useCancelCase(caseNo: string) {
  return useEnquiryAction<{ reasonId: number; updatedAt: string }>(caseNo, (base, body) => api(`${base}/cancel`, { method: 'POST', body }))
}

export function useResumeCase(caseNo: string) {
  return useEnquiryAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/resume`, { method: 'POST', body }))
}

export function useReassignCase(caseNo: string) {
  return useEnquiryAction<{ ownerId: string; updatedAt: string }>(caseNo, (base, body) => api(`${base}/owner`, { method: 'PUT', body }))
}

/** Who the HOD or Head can give the case to. */
export function useAssignees(caseNo: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...enquiryKeys.case(caseNo), 'assignees'],
    queryFn: async () =>
      (await api<{ assignees: { id: string; name: string; isOwner: boolean }[] }>(`/enquiries/${encodeURIComponent(caseNo)}/assignees`))
        .assignees,
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

/** All enquiries (open, postponed or cancelled): late first, then by time due. Paged with the API's cursor ("Show more"). */
export function useEnquiryList(filters: EnquiryListFilters) {
  return useInfiniteQuery({
    queryKey: enquiryKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (filters.status !== 'OPEN') params.set('status', filters.status)
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

/** The follow-up desk: one tab's rows and the four counts. */
export function useFollowUpDesk(bucket: FollowUpBucket, scope: FollowUpScope) {
  return useQuery({
    queryKey: enquiryKeys.desk(bucket, scope),
    queryFn: () => api<FollowUpDesk>(`/enquiries/follow-ups?bucket=${bucket}&scope=${scope}`),
    placeholderData: keepPreviousData,
  })
}

/** Overdue follow-ups for the sidebar. Rechecked every minute, so a case that falls due shows up without a reload. */
export function useFollowUpBadge() {
  return useQuery({
    queryKey: enquiryKeys.badge,
    queryFn: () => api<FollowUpBadge>('/enquiries/follow-ups/badge'),
    refetchInterval: 60_000,
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
