import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadPdf } from '../../lib/api'
import { isStale } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import type {
  ClientLookup,
  CreateVisaCaseBody,
  DocketKind,
  DocketStickerData,
  InvoiceCheck,
  SaveQuoteBody,
  DocumentArrival,
  DocumentCheck,
  DocumentStatus,
  EntryType,
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
  /** Under lists(), so maturing and reassigning (which refresh the lists) refresh the sidebar's count too. */
  toAssign: ['enquiries', 'list', 'to-assign'] as const,
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
  /** Every docket's label: a docket change on any case, or new company details, can change them. */
  stickers: ['enquiries', 'sticker'] as const,
  invoiceCheck: (caseNo: string) => ['enquiries', 'invoice-check', caseNo.toUpperCase()] as const,
  sticker: (caseNo: string) => ['enquiries', 'sticker', caseNo.toUpperCase()] as const,
}

/** One visa case: the case page (Step 2 onwards). */
export function useVisaCase(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.case(caseNo),
    queryFn: async () => (await api<{ case: VisaCase }>(`/visa/cases/${encodeURIComponent(caseNo)}`)).case,
  })
}

/** Cases that had several actions running at once: the last to finish reloads the case rather than trusting its answer. */
const overlapping = new Set<string>()

/**
 * A case action returns the whole case: it replaces the page's copy. The list (its stage), the follow-up desk (documents
 * pending) and the client's open cases may have changed with it. One that sends updatedAt ("Mark documents complete")
 * can meet a change by someone else (409 STALE): the case is reloaded, with a warning.
 */
function useCaseAction<Vars>(
  caseNo: string,
  request: (path: string, vars: Vars) => Promise<{ case: VisaCase }>,
  { otherCases = false }: { otherCases?: boolean } = {},
) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const base = `/visa/cases/${encodeURIComponent(caseNo)}`
  const mutationKey = ['case-action', caseNo.toUpperCase()]
  return useMutation({
    mutationKey,
    mutationFn: async (vars: Vars) => (await request(base, vars)).case,
    onSettled: (updated) => {
      // Ticking down a list sends several changes at once, and their answers can come back out of order: an older
      // answer must not overwrite a newer one. While others are still running an answer is held back, and the last one
      // to finish reloads the case instead.
      if (queryClient.isMutating({ mutationKey }) > 1) {
        overlapping.add(mutationKey[1]!)
        return
      }
      if (overlapping.delete(mutationKey[1]!)) void queryClient.invalidateQueries({ queryKey: enquiryKeys.case(caseNo) })
      else if (updated) queryClient.setQueryData(enquiryKeys.case(caseNo), updated)
    },
    onSuccess: () => {
      // A docket change shows on every case in that docket, not just this one, and on its label.
      if (otherCases) {
        void queryClient.invalidateQueries({ queryKey: enquiryKeys.cases, predicate: (q) => q.queryKey[2] !== caseNo.toUpperCase() })
        void queryClient.invalidateQueries({ queryKey: enquiryKeys.stickers })
      }
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.desks() })
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (error) => {
      if (!isStale(error)) return
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.case(caseNo) })
      toast({ tone: 'warn', message: 'Someone else changed this case after you opened it. The latest version is now loaded. Please try again.' })
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

/**
 * "Mark documents complete": the case moves to File preparation with no owner, for the HOD to pick a processor. A change
 * by someone else in between (409 STALE) reloads the case, with a warning.
 */
export function useMatureCase(caseNo: string) {
  return useCaseAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/mature`, { method: 'POST', body }))
}

/** Ticks one paper: Original/Xerox, Made, Not needed, or back to Pending. */
export function useUpdateCaseDocument(caseNo: string) {
  return useCaseAction<{ documentId: string; status: DocumentStatus; receivedAs?: ReceivedAs | null }>(
    caseNo,
    (base, { documentId, ...body }) => api(`${base}/documents/${documentId}`, { method: 'PATCH', body }),
  )
}

/**
 * The processor's check of one paper in Step 3: Checked, Needs replacing (with a reason from the list), or null for
 * "to check". Like ticks, it waits its turn on the case and doesn't make anyone's page stale.
 */
export function useCheckCaseDocument(caseNo: string) {
  return useCaseAction<{ documentId: string; check: DocumentCheck | null; reasonId?: number }>(caseNo, (base, { documentId, ...body }) =>
    api(`${base}/documents/${documentId}/check`, { method: 'PATCH', body }),
  )
}

/** Uploads the final file (one PDF). A newer upload becomes the current one; older ones are kept. */
export function useUploadFinalFile(caseNo: string) {
  return useCaseAction<{ file: File }>(caseNo, (base, { file }) => uploadPdf(`${base}/files/final`, file))
}

/**
 * Opens one of the case's files in a new tab, through a link that works for a few minutes. The tab is opened on the
 * click itself, so popup blockers allow it, and pointed at the file once the link arrives.
 */
export function useOpenCaseFile(caseNo: string) {
  const toast = useToast()
  return (fileId: string) => {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    api<{ url: string }>(`/visa/cases/${encodeURIComponent(caseNo)}/files/${fileId}/link`)
      .then(({ url }) => {
        if (tab) tab.location.href = url
        else window.location.href = url
      })
      .catch((err: unknown) => {
        tab?.close()
        toast({ tone: 'bad', message: err instanceof Error ? err.message : 'Couldn’t open the file. Please try again.' })
      })
  }
}

/** Names a traveller: links the client's family member. */
export function useLinkTraveller(caseNo: string) {
  return useCaseAction<{ travellerId: string; memberId: string }>(caseNo, (base, { travellerId, memberId }) =>
    api(`${base}/travellers/${travellerId}/member`, { method: 'PUT', body: { memberId } }),
  )
}

/** Trip details: only the fields that changed; null clears one. */
export function useUpdateTrip(caseNo: string) {
  return useCaseAction<{ departOn?: string | null; returnOn?: string | null; entryType?: EntryType | null; hotelStay?: string | null }>(
    caseNo,
    (base, body) => api(`${base}/trip`, { method: 'PATCH', body }),
  )
}

/** One traveller's acknowledgement number and appointment (a day and a time in India); null clears either. */
export function useUpdateApplication(caseNo: string) {
  return useCaseAction<{ travellerId: string; ackNo?: string | null; appointment?: { on: string; at: string } | null }>(
    caseNo,
    (base, { travellerId, ...body }) => api(`${base}/travellers/${travellerId}/application`, { method: 'PATCH', body }),
  )
}

/** "File ready — add to docket" (0007 Decision 9): 409 NOT_READY lists what Step 3 still lacks. */
export function useMarkFileReady(caseNo: string) {
  return useCaseAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/file-ready`, { method: 'POST', body }))
}

/** The case's vendor (0007 Decision 7), from the active vendors covering its country; null clears it. */
export function useSetVendor(caseNo: string) {
  return useCaseAction<{ vendorId: number | null }>(caseNo, (base, body) => api(`${base}/vendor`, { method: 'PUT', body }))
}

/** The quote (0009 Decision 2): saved whole. A save that missed someone else's (409 STALE) reloads the case. */
export function useSaveQuote(caseNo: string) {
  return useCaseAction<SaveQuoteBody>(caseNo, (base, body) => api(`${base}/quote`, { method: 'PUT', body }))
}

/** What stands in the way of raising the invoice, or what it will say (0009). Always fresh: it opens a dialog. */
export function useInvoiceCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.invoiceCheck(caseNo),
    queryFn: () => api<InvoiceCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/invoice/check`),
    staleTime: 0,
  })
}

/** Raises the locked tax invoice from the quote the dialog showed (0009). */
export function useRaiseInvoice(caseNo: string) {
  return useCaseAction<{ quoteUpdatedAt: string }>(caseNo, (base, body) => api(`${base}/invoice`, { method: 'POST', body }), {
    otherCases: true,
  })
}

/** The docket's parcel label (0008 Decision 5), once the case is in a docket. */
export function useDocketSticker(caseNo: string, enabled = true) {
  return useQuery({
    queryKey: enquiryKeys.sticker(caseNo),
    queryFn: async () => (await api<{ sticker: DocketStickerData }>(`/visa/cases/${encodeURIComponent(caseNo)}/sticker`)).sticker,
    enabled,
  })
}

/** "Add to docket" (0008 Decision 2): join the vendor's shared docket (GROUP) or start one of its own (OWN). */
export function useAddToDocket(caseNo: string) {
  return useCaseAction<{ mode: DocketKind; updatedAt: string }>(caseNo, (base, body) => api(`${base}/docket`, { method: 'POST', body }), {
    otherCases: true,
  })
}

/** "Take out of docket" (0008 Decision 10), while the docket is open. */
export function useTakeOutOfDocket(caseNo: string) {
  return useCaseAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/docket`, { method: 'DELETE', body }), { otherCases: true })
}

/** All enquiries (open, postponed or cancelled): late first, then by time due. Paged with the API's cursor ("Show more"). */
export function useEnquiryList(filters: EnquiryListFilters) {
  return useInfiniteQuery({
    queryKey: enquiryKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      // "To assign" is the open cases nobody owns yet.
      if (filters.status === 'TO_ASSIGN') params.set('unassigned', 'true')
      else if (filters.status !== 'OPEN') params.set('status', filters.status)
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

/** The sidebar's "To assign" count: open cases nobody owns yet, for an HOD or the Head. */
export function useToAssignCount(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: enquiryKeys.toAssign,
    queryFn: async () => (await api<{ count: number }>('/enquiries/to-assign')).count,
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
