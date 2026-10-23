import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadFile, uploadPdf } from '../../lib/api'
import { isStale } from '../../lib/apiErrors'
import { useOpenSignedLink } from '../../lib/signedLinks'
import { useToast } from '../../lib/toast'
import type { ScanType } from '../clients/scanFiles'
import type {
  CaseMessage,
  ClientLookup,
  ConsentDetailsBody,
  ConsentForm,
  CoveringLetterPrint,
  CoveringLetterView,
  CreateVisaCaseBody,
  DocketKind,
  DocketStickerData,
  DispatchCheck,
  InvoiceCheck,
  CancelInvoiceCheck,
  RecallCheck,
  AdditionalInvoiceCheck,
  SendEvisaCheck,
  VisaOutcome,
  SubmitOnlineCheck,
  VendorReceivedCheck,
  InvoiceTaxType,
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
  FieldJob,
  FieldStaff,
  ReceivedAs,
  StickerCheck,
  VisaCase,
  WrittenLetter,
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
  /** Under lists() too: the sidebar's red dots, cases given to me that I haven't seen. */
  givenToMe: ['enquiries', 'list', 'given-to-me'] as const,
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
  /** Under case(), so reloading a case reloads its messages too. */
  caseMessages: (caseNo: string) => ['enquiries', 'case', caseNo.toUpperCase(), 'messages'] as const,
  /** Every docket's label: a docket change on any case, or new company details, can change them. */
  stickers: ['enquiries', 'sticker'] as const,
  invoiceCheck: (caseNo: string) => ['enquiries', 'invoice-check', caseNo.toUpperCase()] as const,
  cancelInvoiceCheck: (caseNo: string, invoiceNo?: string) => ['enquiries', 'cancel-invoice-check', caseNo.toUpperCase(), invoiceNo ?? 'main'] as const,
  recallCheck: (caseNo: string) => ['enquiries', 'recall-check', caseNo.toUpperCase()] as const,
  additionalInvoiceCheck: (caseNo: string) => ['enquiries', 'additional-invoice-check', caseNo.toUpperCase()] as const,
  dispatchCheck: (caseNo: string) => ['enquiries', 'dispatch-check', caseNo.toUpperCase()] as const,
  submitOnlineCheck: (caseNo: string) => ['enquiries', 'submit-online-check', caseNo.toUpperCase()] as const,
  sendEvisaCheck: (caseNo: string) => ['enquiries', 'send-evisa-check', caseNo.toUpperCase()] as const,
  vendorReceivedCheck: (caseNo: string) => ['enquiries', 'vendor-received-check', caseNo.toUpperCase()] as const,
  sticker: (caseNo: string) => ['enquiries', 'sticker', caseNo.toUpperCase()] as const,
  /** The covering letter's card, per letter shown; all of a case's under one key, so a case action refreshes them. */
  coveringLetters: (caseNo: string) => ['enquiries', 'covering-letter', caseNo.toUpperCase()] as const,
  coveringLetter: (caseNo: string, formatId: number | undefined) => ['enquiries', 'covering-letter', caseNo.toUpperCase(), formatId ?? 'default'] as const,
  /** Every case's print of its letter: a new letterhead space changes them all. */
  coveringLetterPrints: ['enquiries', 'covering-letter-print'] as const,
  coveringLetterPrint: (caseNo: string) => ['enquiries', 'covering-letter-print', caseNo.toUpperCase()] as const,
}

/** One visa case: the case page (Step 2 onwards). */
export function useVisaCase(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.case(caseNo),
    queryFn: async () => (await api<{ case: VisaCase }>(`/visa/cases/${encodeURIComponent(caseNo)}`)).case,
  })
}

/** How long a message still counts as on its way: queued, or sent but not yet delivered. */
const QUEUED_FOR_MS = 60 * 60_000
const SENT_FOR_MS = 15 * 60_000

function onItsWay(m: CaseMessage) {
  const since = (iso: string | null) => (iso ? Date.now() - Date.parse(iso) : Infinity)
  return (m.status === 'QUEUED' && since(m.createdAt) < QUEUED_FOR_MS) || (m.status === 'SENT' && since(m.sentAt) < SENT_FOR_MS)
}

/**
 * The case's "Sent to the client" card (0021). While a message is on its way it checks again every 10 seconds (only
 * while the page is in view), so Waiting turns into Sent and then Delivered by itself; then it stops.
 */
export function useCaseMessages(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.caseMessages(caseNo),
    queryFn: async () => (await api<{ messages: CaseMessage[] }>(`/visa/cases/${encodeURIComponent(caseNo)}/messages`)).messages,
    refetchInterval: (query) => (query.state.data?.some(onItsWay) ? 10_000 : false),
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
      // The covering letter's preview is filled in from the case (its trip details, its step).
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.coveringLetters(caseNo) })
      // A step may have queued a message to the client ("All documents received"): the card shows it at once.
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.caseMessages(caseNo) })
    },
    onError: (error) => {
      if (!isStale(error)) return
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.case(caseNo) })
      toast({ tone: 'warn', message: 'Someone else changed this case after you opened it. The latest version is now loaded. Please try again.' })
    },
  })
}

/** The Reminders card's On/Off (0006 amendment 19). */
export function useSetReminders(caseNo: string) {
  return useCaseAction<{ on: boolean }>(caseNo, (base, body) => api(`${base}/reminders`, { method: 'PUT', body }))
}

/** How urgent the case is, in the right rail (0003 amendment 1). */
export function useSetUrgency(caseNo: string) {
  return useCaseAction<{ urgencyId: number }>(caseNo, (base, body) => api(`${base}/urgency`, { method: 'PUT', body }))
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

/** A refused traveller's refusal letter (0012 Decision 4): any time once refused, whatever the case's status. */
export function useUploadRefusalLetter(caseNo: string) {
  return useCaseAction<{ travellerId: string; file: File }>(caseNo, (base, { travellerId, file }) =>
    uploadPdf(`${base}/travellers/${travellerId}/refusal-letter`, file),
  )
}

/** Uploads an approved traveller's e-visa (0025, one PDF). A newer upload becomes the current one and clears the check. */
export function useUploadEvisa(caseNo: string) {
  return useCaseAction<{ travellerId: string; file: File }>(caseNo, (base, { travellerId, file }) =>
    uploadPdf(`${base}/travellers/${travellerId}/evisa`, file),
  )
}

/** An e-visa checked against the passport (0025): Matches, Doesn't match, or null to undo. It names the PDF looked at. */
export function useSetEvisaCheck(caseNo: string) {
  return useCaseAction<{ travellerId: string; fileId: string; check: StickerCheck | null }>(caseNo, (base, { travellerId, ...body }) =>
    api(`${base}/travellers/${travellerId}/evisa-check`, { method: 'PUT', body }),
  )
}

/** Opens one of the case's files in a new tab, through a link that works for a few minutes. */
export function useOpenCaseFile(caseNo: string) {
  const open = useOpenSignedLink()
  return (fileId: string) => open(`/visa/cases/${encodeURIComponent(caseNo)}/files/${fileId}/link`)
}

/**
 * "Save scan" (0016 Decision 5): keeps one of a traveller's papers in the client's document vault. It doesn't tick the
 * paper. The case action refreshes the client's queries too, so the client's Documents card follows.
 */
export function useSaveCaseScan(caseNo: string) {
  return useCaseAction<{ documentId: string; file: File; type: ScanType }>(caseNo, (base, { documentId, file, type }) =>
    uploadFile(`${base}/documents/${documentId}/scan`, file, type),
  )
}

/** Opens a paper's copy in the client's vault: the one an On file paper came from, or else the current one. */
export function useOpenCaseScan(caseNo: string) {
  const open = useOpenSignedLink()
  return (documentId: string) => open(`/visa/cases/${encodeURIComponent(caseNo)}/documents/${documentId}/scan/link`)
}

/** Names a traveller: links the client's family member. */
export function useLinkTraveller(caseNo: string) {
  return useCaseAction<{ travellerId: string; memberId: string; confirmWarnings?: boolean }>(caseNo, (base, { travellerId, ...body }) =>
    api(`${base}/travellers/${travellerId}/member`, { method: 'PUT', body }),
  )
}

/**
 * The consent form for one named traveller: the fields in use, from the master in Settings, and the person's answers
 * (0022 amendment 1). Under case(), so reloading the case reloads it; not on window focus, so typing isn't disturbed.
 */
export function useConsentForm(caseNo: string, travellerId: string) {
  return useQuery({
    queryKey: [...enquiryKeys.case(caseNo), 'consent-form', travellerId],
    queryFn: async () =>
      (await api<{ form: ConsentForm }>(`/visa/cases/${encodeURIComponent(caseNo)}/travellers/${travellerId}/consent-details`)).form,
    refetchOnWindowFocus: false,
  })
}

/** The consent form's details for one named traveller (docs/decisions/0022-consent-form.md, part 1). */
export function useSaveConsentDetails(caseNo: string) {
  return useCaseAction<{ travellerId: string } & ConsentDetailsBody>(caseNo, (base, { travellerId, ...body }) =>
    api(`${base}/travellers/${travellerId}/consent-details`, { method: 'PUT', body }),
  )
}

/** "Send the link again" (0022 part 2): a new "I agree" link; the open one stops working. */
export function useSendConsentLink(caseNo: string) {
  return useCaseAction<{ travellerId: string }>(caseNo, (base, { travellerId }) =>
    api(`${base}/travellers/${travellerId}/consent-link`, { method: 'POST' }),
  )
}

/** Trip details: only the fields that changed; null clears one. */
export function useUpdateTrip(caseNo: string) {
  return useCaseAction<{
    departOn?: string | null
    returnOn?: string | null
    entryType?: EntryType | null
    hotelStay?: string | null
    confirmWarnings?: boolean
  }>(
    caseNo,
    (base, body) => api(`${base}/trip`, { method: 'PATCH', body }),
  )
}

/** One traveller's acknowledgement number and appointment (a day and a time in India); null clears either. */
export function useUpdateApplication(caseNo: string) {
  return useCaseAction<{ travellerId: string; ackNo?: string | null; appointment?: { on: string; at: string } | null; confirmWarnings?: boolean }>(
    caseNo,
    (base, { travellerId, ...body }) => api(`${base}/travellers/${travellerId}/application`, { method: 'PATCH', body }),
  )
}

/** "File ready — add to docket" (0007 Decision 9): 409 NOT_READY lists what Step 3 still lacks. */
export function useMarkFileReady(caseNo: string) {
  return useCaseAction<{ updatedAt: string; confirmWarnings?: boolean }>(caseNo, (base, body) => api(`${base}/file-ready`, { method: 'POST', body }))
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

/** Raises the locked tax invoice from what the dialog showed (0009): its quote, GST rate, tax type and total. */
export function useRaiseInvoice(caseNo: string) {
  type Shown = { quoteUpdatedAt: string; taxType: InvoiceTaxType; gstRatePercent: number; totalPaise: number }
  return useCaseAction<Shown>(caseNo, (base, body) => api(`${base}/invoice`, { method: 'POST', body }), {
    otherCases: true,
  })
}

/** What stands in the way of dispatching the docket, and when its cases come back due (0008). Fresh: it opens a dialog. */
export function useDispatchCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.dispatchCheck(caseNo),
    queryFn: () => api<DispatchCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/dispatch/check`),
    staleTime: 0,
  })
}

/** "Dispatch docket" (0008 Decision 9): every case in the docket moves on, so the other cases' pages refresh too. */
export function useDispatchDocket(caseNo: string) {
  return useCaseAction<{ courierId: number; awbNo: string | null; caseNos: string[] }>(
    caseNo,
    (base, body) => api(`${base}/dispatch`, { method: 'POST', body }),
    { otherCases: true },
  )
}

/** "Send again" (0008 Decision 8): the dispatched docket's email to the vendor, after a failed send. */
export function useResendDocketEmail(caseNo: string) {
  return useCaseAction<void>(caseNo, (base) => api(`${base}/dispatch/email`, { method: 'POST', body: {} }), { otherCases: true })
}

/** What blocks an e-visa's "Submitted online" (0008 Decision 11), and when it comes back due to check the portal. */
export function useSubmitOnlineCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.submitOnlineCheck(caseNo),
    queryFn: () => api<SubmitOnlineCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/submit-online/check`),
    staleTime: 0,
  })
}

/** "Submitted online" (0008 Decision 11): an e-visa moves to At vendor, with no docket. */
export function useSubmitOnline(caseNo: string) {
  return useCaseAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/submit-online`, { method: 'POST', body }))
}

/** What blocks "Send the e-visa" (0025, part 3), who gets which file, and whether the case closes or waits for the handover. */
export function useSendEvisaCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.sendEvisaCheck(caseNo),
    queryFn: () => api<SendEvisaCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/send-evisa/check`),
    staleTime: 0,
  })
}

/** "Send the e-visa" (0025, part 3): each approved traveller's e-visa goes to the client; the case closes, or waits for the handover. */
export function useSendEvisa(caseNo: string) {
  return useCaseAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/send-evisa`, { method: 'POST', body }))
}

/** When a file the vendor got comes back due, and why then (0011 Decision 2). */
export function useVendorReceivedCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.vendorReceivedCheck(caseNo),
    queryFn: () => api<VendorReceivedCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/vendor-received/check`),
    staleTime: 0,
  })
}

/** "Vendor got it, papers checked" (0011 Decision 2), for this file only. */
export function useVendorReceived(caseNo: string) {
  return useCaseAction<{ updatedAt: string }>(caseNo, (base, body) => api(`${base}/vendor-received`, { method: 'POST', body }))
}

/** "Submitted at the embassy" (0011 Decisions 3 and 4), or a change to it at Step 5. */
export function useSaveSubmission(caseNo: string) {
  return useCaseAction<{ vendorFileNo: string; embassyId: number; collectionOn: string; updatedAt: string; confirmWarnings?: boolean }>(
    caseNo,
    (base, body) => api(`${base}/submission`, { method: 'PUT', body }),
  )
}

/** "Record the decision" (0012 Decision 6): every traveller's outcome at once; the case moves to Decision. */
export function useRecordDecision(caseNo: string) {
  return useCaseAction<{
    outcomes: { travellerId: string; outcome: VisaOutcome; visaNo?: string; validFrom?: string; validTo?: string }[]
    updatedAt: string
    confirmWarnings?: boolean
  }>(caseNo, (base, body) => api(`${base}/decision`, { method: 'POST', body }))
}

/**
 * "Passports on the way back" (0013 Decision 3): the case moves to Passport back, in transit. 400 under `collectedOn` or
 * `expectedOn`.
 */
export function useSendPassportsBack(caseNo: string) {
  return useCaseAction<{ collectedOn: string; expectedOn: string; updatedAt: string }>(caseNo, (base, body) =>
    api(`${base}/passports-back`, { method: 'POST', body }),
  )
}

/**
 * "Mark received" (0013 Decision 5): the booklets counted and each approved traveller's sticker checked; whatever the
 * case's status. 400 under `booklets` or `stickers`.
 */
export function useReceivePassports(caseNo: string) {
  return useCaseAction<{
    booklets: { current: number; old: number }
    stickers: { travellerId: string; check: StickerCheck }[]
    updatedAt: string
  }>(caseNo, (base, body) => api(`${base}/passports-received`, { method: 'POST', body }))
}

/**
 * "Received the rest" of a short return (0013 Decision 5, amended 17 Oct 2026): the late booklets, each kind up to
 * what's missing; whatever the case's status. 400 under `booklets`.
 */
export function useReceiveRest(caseNo: string) {
  return useCaseAction<{ booklets: { current: number; old: number }; updatedAt: string }>(caseNo, (base, body) =>
    api(`${base}/passports-received/rest`, { method: 'POST', body }),
  )
}

/** "Clear the shortfall" (same amendment): why the missing passports won't come back, from the list. 400 under `reasonId`. */
export function useClearShortfall(caseNo: string) {
  return useCaseAction<{ reasonId: number; updatedAt: string }>(caseNo, (base, body) =>
    api(`${base}/passports-received/clear`, { method: 'POST', body }),
  )
}

/** Who can be sent (0015): the active field staff. */
export function useFieldStaff() {
  return useQuery({
    queryKey: ['field-staff'],
    queryFn: async () => (await api<{ staff: FieldStaff[] }>('/visa/field-staff')).staff,
    staleTime: 60_000,
  })
}

/** A field job's who, when and where (0015 Decisions 2 and 3). */
type FieldJobBody = { assigneeId: string; day: string; slotId: number; address: string; mapLink: string | null; updatedAt: string }

/**
 * "Book the collection boy" (0015 phase 1) or "Book the delivery boy" (phase 2). 409 when the client has no email
 * (CLIENT_EMAIL_MISSING) or one of the kind is booked.
 */
export function useBookFieldJob(caseNo: string) {
  return useCaseAction<FieldJobBody & { kind: FieldJob['kind'] }>(caseNo, (base, body) => api(`${base}/field-jobs`, { method: 'POST', body }))
}

/** "Change" a booked job (0015). */
export function useChangeFieldJob(caseNo: string) {
  return useCaseAction<FieldJobBody & { jobId: string }>(caseNo, (base, { jobId, ...body }) =>
    api(`${base}/field-jobs/${encodeURIComponent(jobId)}`, { method: 'PUT', body }),
  )
}

/** "Cancel" a booked job (0015). */
export function useCancelFieldJob(caseNo: string) {
  return useCaseAction<{ jobId: string; updatedAt: string }>(caseNo, (base, { jobId, ...body }) =>
    api(`${base}/field-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body }),
  )
}

/**
 * The photo of the person collecting the passports (0014 Decision 6), uploaded as soon as it's taken: the case doesn't
 * change until "Hand over" links it.
 */
export function useUploadHandoverPhoto(caseNo: string) {
  return useMutation({
    mutationFn: async (photo: Blob) =>
      (
        await uploadFile<{ photo: { id: string; fileName: string } }>(
          `/visa/cases/${encodeURIComponent(caseNo)}/handover/photo`,
          photo,
          photo.type || 'image/jpeg',
        )
      ).photo,
  })
}

/** "Hand over to the client" at the office (0014): the case is Delivered and closes. 400 under `booklets`, `receiver` or `photoId`. */
export function useHandOver(caseNo: string) {
  return useCaseAction<{
    mode: 'OFFICE'
    booklets: { current: number; old: number }
    receiver: { travellerId: string } | { name: string }
    photoId: string
    updatedAt: string
    confirmWarnings?: boolean
  }>(caseNo, (base, body) => api(`${base}/handover`, { method: 'POST', body }))
}

/** "Change" either day while the passports are on their way back (0013 component 2); the due time moves too. */
export function useChangePassportsBack(caseNo: string) {
  return useCaseAction<{ collectedOn: string; expectedOn: string; updatedAt: string }>(caseNo, (base, body) =>
    api(`${base}/passports-back`, { method: 'PUT', body }),
  )
}

/** "Change" one traveller's decision while the case is at Decision (0012 Decision 6). 400 under `decision`. */
export function useChangeDecision(caseNo: string) {
  return useCaseAction<{
    travellerId: string
    outcome: VisaOutcome
    visaNo?: string
    validFrom?: string
    validTo?: string
    stickerCheck?: StickerCheck
    updatedAt: string
    confirmWarnings?: boolean
  }>(
    caseNo,
    (base, { travellerId, ...body }) => api(`${base}/travellers/${travellerId}/decision`, { method: 'PUT', body }),
  )
}

/** What cancelling the case's invoice with a credit note gives back, and what blocks it (0011 Decision 5). */
export function useCancelInvoiceCheck(caseNo: string, invoiceNo?: string) {
  const which = invoiceNo ? `?invoiceNo=${encodeURIComponent(invoiceNo)}` : ''
  return useQuery({
    queryKey: enquiryKeys.cancelInvoiceCheck(caseNo, invoiceNo),
    queryFn: () => api<CancelInvoiceCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/invoice/cancel/check${which}`),
    staleTime: 0,
  })
}

/** "Cancel with a credit note" (0011 Decision 5): the docket table on the other cases loses this file's invoice too. */
export function useCancelInvoice(caseNo: string) {
  return useCaseAction<{ invoiceNo: string; totalPaise: number; reasonId: number }>(
    caseNo,
    (base, body) => api(`${base}/invoice/cancel`, { method: 'POST', body }),
    { otherCases: true },
  )
}

/** What taking the file back gives back, per traveller, and when it's due back (0011 Decision 6). */
export function useRecallCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.recallCheck(caseNo),
    queryFn: () => api<RecallCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/recall/check`),
    staleTime: 0,
  })
}

/** "Take the file back" (0011 Decision 6): `refunds` only for the HOD's "Change refund"; `invoiceNo` null when nothing goes back. */
export function useRecallFile(caseNo: string) {
  return useCaseAction<{ invoiceNo: string | null; reasonId: number; refunds?: { position: number; refundPaise: number }[]; updatedAt: string }>(
    caseNo,
    (base, body) => api(`${base}/recall`, { method: 'POST', body }),
  )
}

/** The file's one additional invoice: what it adds to, its number, and what blocks it (0011 Decision 7). */
export function useAdditionalInvoiceCheck(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.additionalInvoiceCheck(caseNo),
    queryFn: () => api<AdditionalInvoiceCheck>(`/visa/cases/${encodeURIComponent(caseNo)}/additional-invoice/check`),
    staleTime: 0,
  })
}

/** Raises the file's one additional invoice, "MVI…-A" (0011 Decision 7). */
export function useRaiseAdditionalInvoice(caseNo: string) {
  return useCaseAction<{ mainInvoiceNo: string; charges: { chargeId: number; amountPaise: number }[]; totalPaise: number }>(caseNo, (base, body) =>
    api(`${base}/additional-invoice`, { method: 'POST', body }),
  )
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

/** The sidebar's red dots: per department code, the cases the HOD or the Head gave me that I haven't seen (0006 amendment 22). */
export function useGivenToMe() {
  return useQuery({
    queryKey: enquiryKeys.givenToMe,
    queryFn: async () => (await api<{ departments: Record<string, number> }>('/enquiries/given-to-me')).departments,
    refetchInterval: 60_000,
  })
}

/** Clicking a department in the sidebar: its dot goes at once. */
export function useSeeGivenToMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (department: string) => api<void>('/enquiries/given-to-me/seen', { method: 'POST', body: { department } }),
    onMutate: (department) =>
      queryClient.setQueryData<Record<string, number>>(enquiryKeys.givenToMe, (old) => {
        if (!old) return old
        const { [department]: _cleared, ...rest } = old
        return rest
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: enquiryKeys.givenToMe }),
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

/**
 * The covering letter's card (docs/decisions/0019-covering-letters.md): the letters that fit the case, one filled in
 * (formatId, else the one made, else the first) and the one made. Always fetched fresh: the case or the client's family
 * list may have changed since.
 */
export function useCoveringLetter(caseNo: string, formatId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: enquiryKeys.coveringLetter(caseNo, formatId),
    queryFn: async () =>
      (await api<{ letter: CoveringLetterView }>(`/visa/cases/${encodeURIComponent(caseNo)}/covering-letter${formatId ? `?formatId=${formatId}` : ''}`))
        .letter,
    enabled,
    staleTime: 0,
    // Picking another letter keeps the card's preview until the new one arrives.
    placeholderData: keepPreviousData,
    // Coming back to the tab mustn't redraw the letter under someone typing in it (0019 amendment 1). Saving the case
    // still refreshes it.
    refetchOnWindowFocus: false,
  })
}

/**
 * "Make the letter" with its text as staff left it, and the wording that text started from (0019 amendment 1): answers
 * with the card's view. The other letters' views and the print show the letter made.
 */
export function useMakeCoveringLetter(caseNo: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { formatId: number; versionId: number; letter: string }) =>
      (
        await api<{ letter: CoveringLetterView }>(`/visa/cases/${encodeURIComponent(caseNo)}/covering-letter`, {
          method: 'POST',
          body: input,
        })
      ).letter,
    onSuccess: (letter, { formatId }) => {
      const shown = enquiryKeys.coveringLetter(caseNo, formatId)
      queryClient.setQueryData(shown, letter)
      void queryClient.invalidateQueries({
        queryKey: enquiryKeys.coveringLetters(caseNo),
        predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(shown),
      })
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.coveringLetterPrint(caseNo) })
    },
  })
}

/**
 * "Write the whole letter with AI" (0019 amendments 4 and 5): the letter as it stands on the card, rewritten for the
 * trip and its notes to the AI, with the personal details the AI dropped and what it did with each note. Nothing is
 * saved: the card shows the letter. A failure is a 503 whose message says why (AI_FAILED).
 */
export function useWriteLetter(caseNo: string) {
  return useMutation({
    mutationFn: async (letter: string) =>
      api<WrittenLetter>(`/visa/cases/${encodeURIComponent(caseNo)}/covering-letter/write`, {
        method: 'POST',
        body: { letter },
      }),
  })
}

/** The letter made, to print: the same letter every time (0019 Decision 10). */
export function useCoveringLetterPrint(caseNo: string) {
  return useQuery({
    queryKey: enquiryKeys.coveringLetterPrint(caseNo),
    queryFn: async () => (await api<{ print: CoveringLetterPrint }>(`/visa/cases/${encodeURIComponent(caseNo)}/covering-letter/print`)).print,
  })
}
