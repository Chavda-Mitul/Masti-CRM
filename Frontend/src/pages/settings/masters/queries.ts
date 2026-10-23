import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { api, uploadFile } from '../../../lib/api'
import { isStale } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import { enquiryKeys } from '../../enquiries/queries'
import type {
  BlockedDay,
  BlockTarget,
  Checklist,
  ChecklistLineBody,
  ConsentWordingVersion,
  CoveringLetter,
  CoveringLetterBody,
  CoveringLetterSummary,
  Country,
  DocumentMaster,
  DocumentRemindersSetting,
  DocumentProblemReason,
  ProcessingSpeed,
  UrgencyLevel,
  Courier,
  CreditNoteReason,
  RecallReason,
  MissingPassportReason,
  ExtraCharge,
  FieldSlot,
  EnquiryReason,
  EnquirySource,
  FollowUpOption,
  TaggedOption,
  Embassy,
  Holiday,
  HolidayBody,
  HolidayFilter,
  HolidaySettings,
  CompanyDetails,
  CompanyImageKind,
  CompanyView,
  VisaSettings,
  InvoiceTerms,
  HolidayTargetOptions,
  MasterResource,
  Offering,
  Vendor,
  VisaType,
} from './types'

// Server state for the Settings → Masters screens (TanStack Query). Saves keep the cache in step by invalidating what
// they changed, including what shows a changed name elsewhere (an embassy or country renamed shows in holiday targets
// and checklist labels).

/** Masters change rarely; keep them for a while. */
const MASTER_STALE = 5 * 60_000

export const holidayKeys = {
  all: ['holidays'] as const,
  list: (filter: HolidayFilter) => ['holidays', 'list', filter] as const,
  targets: ['holidays', 'targets'] as const,
  settings: ['holidays', 'settings'] as const,
  /** Under all, so a holiday change greys out the right days on every open calendar. */
  blocked: (target: number | 'office', from: string, to: string) => ['holidays', 'blocked', target, from, to] as const,
}

export const masterKeys = {
  all: ['masters'] as const,
  list: (resource: MasterResource) => ['masters', resource] as const,
  offerings: ['masters', 'offerings'] as const,
  checklist: (offeringId: number) => ['masters', 'checklist', offeringId] as const,
  /** The list; one letter's key sits under it, so invalidating this refreshes both. */
  coveringLetters: ['masters', 'covering-letters'] as const,
  coveringLetter: (id: number) => ['masters', 'covering-letters', id] as const,
  consentWording: ['masters', 'consent-wording'] as const,
}

/**
 * On 409 STALE (someone else saved after this screen loaded the record): reload and say so.
 * The form that failed closes; the user makes their change again on the fresh data.
 */
function useStaleRecovery(queryKey: QueryKey, what: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return (error: unknown) => {
    if (!isStale(error)) return
    void queryClient.invalidateQueries({ queryKey })
    toast({
      tone: 'warn',
      message: `Someone else changed this ${what} while you were editing. The latest version is now loaded. Please make your change again.`,
    })
  }
}

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

const FILTER_QUERY: Record<HolidayFilter, string> = { upcoming: '', removed: '?status=REMOVED' }

export function useHolidays(filter: HolidayFilter) {
  return useQuery({
    queryKey: holidayKeys.list(filter),
    queryFn: async () => (await api<{ holidays: Holiday[] }>(`/holidays${FILTER_QUERY[filter]}`)).holidays,
  })
}

export function useHolidayTargets() {
  return useQuery({
    queryKey: holidayKeys.targets,
    queryFn: () => api<HolidayTargetOptions>('/holidays/targets'),
    staleTime: MASTER_STALE,
  })
}

/**
 * The days an embassy, or our office, is closed in from…to, with the holidays that close it (0005 §3): the date pickers
 * grey them out.
 */
export function useBlockedDays(target: BlockTarget | null, from: string, to: string) {
  const office = !!target && 'office' in target
  const embassyId = target && 'embassyId' in target ? target.embassyId : 0
  return useQuery({
    enabled: target !== null,
    queryKey: holidayKeys.blocked(office ? 'office' : embassyId, from, to),
    queryFn: async () =>
      (await api<{ days: BlockedDay[] }>(`/holidays/blocked?from=${from}&to=${to}&${office ? 'office=true' : `embassyId=${embassyId}`}`)).days,
  })
}

export function useHolidaySettings() {
  return useQuery({
    queryKey: holidayKeys.settings,
    queryFn: async () => (await api<{ settings: HolidaySettings }>('/holidays/settings')).settings,
    staleTime: MASTER_STALE,
  })
}

const companyKeys = {
  details: ['company', 'details'] as const,
  terms: ['company', 'invoice-terms'] as const,
  image: (kind: CompanyImageKind) => ['company', 'image', kind] as const,
}

/**
 * Masti's own details, the current logo and signature, and what the first invoice still needs (0008 Decision 5, 0009
 * Decision 8). Every office user reads them; the Head changes them.
 */
export function useCompanyDetails() {
  return useQuery({
    queryKey: companyKeys.details,
    queryFn: () => api<CompanyView>('/company/details'),
    staleTime: MASTER_STALE,
  })
}

export function useUpdateCompanyDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<CompanyDetails>) => api<CompanyView>('/company/details', { method: 'PUT', body }),
    onSuccess: (view) => {
      queryClient.setQueryData(companyKeys.details, view)
      // Every docket's sticker shows the name, address and phone.
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.stickers })
    },
  })
}

/** The invoice's terms (0009 Decision 8), one per line. */
export function useInvoiceTerms() {
  return useQuery({
    queryKey: companyKeys.terms,
    queryFn: async () => (await api<{ terms: InvoiceTerms }>('/company/invoice-terms')).terms,
    staleTime: MASTER_STALE,
  })
}

export function useSaveInvoiceTerms() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: InvoiceTerms) => (await api<{ terms: InvoiceTerms }>('/company/invoice-terms', { method: 'PUT', body })).terms,
    onSuccess: (terms) => queryClient.setQueryData(companyKeys.terms, terms),
  })
}

/** A new logo or signature (the Head only): the image itself is the body. */
export function useUploadCompanyImage(kind: CompanyImageKind) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadFile<CompanyView>(`/company/images/${kind}`, file, file.type, 'PUT'),
    onSuccess: (view) => {
      queryClient.setQueryData(companyKeys.details, view)
      void queryClient.invalidateQueries({ queryKey: companyKeys.image(kind) })
    },
  })
}

/** A short-lived link to the current logo or signature, for the preview. Refetched well before it expires. */
export function useCompanyImageLink(kind: CompanyImageKind, enabled: boolean) {
  return useQuery({
    queryKey: companyKeys.image(kind),
    queryFn: () => api<{ url: string; expiresAt: string }>(`/company/images/${kind}/link`),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

const visaSettingsKey = ['visa', 'settings'] as const

/** The visa settings, kept whole in the cache; each card picks its part with `select`. */
export function useVisaSettings<T = VisaSettings>(select?: (settings: VisaSettings) => T) {
  return useQuery({
    queryKey: visaSettingsKey,
    queryFn: async () => (await api<{ settings: VisaSettings }>('/visa/settings')).settings,
    staleTime: MASTER_STALE,
    select,
  })
}

const invoiceOf = (settings: VisaSettings) => settings.invoice

/** The invoice series and GST rate (0009 Decisions 3 and 4), on Company & invoice. */
export function useVisaInvoiceSetting() {
  return useVisaSettings(invoiceOf)
}

/** Saves some of the visa settings (the Visa HOD or the Head); the answer is all of them. */
function useSaveVisaSettingsWith(onSaved?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Partial<VisaSettings>) => (await api<{ settings: VisaSettings }>('/visa/settings', { method: 'PUT', body })).settings,
    onSuccess: (settings) => {
      queryClient.setQueryData(visaSettingsKey, settings)
      onSaved?.()
    },
  })
}

const documentRemindersKey = ['visa', 'settings', 'documentReminders'] as const

/** The pending-document reminders (0006 amendment 19), for Settings → Masters. */
export function useDocumentRemindersSetting(enabled = true) {
  return useQuery({
    queryKey: documentRemindersKey,
    queryFn: async () => (await api<{ settings: { documentReminders: DocumentRemindersSetting } }>('/visa/settings')).settings.documentReminders,
    staleTime: MASTER_STALE,
    enabled,
  })
}

/** The Visa HOD or the Head. Every open case's next reminder follows at once, so they reload. */
export function useSaveDocumentRemindersSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (documentReminders: DocumentRemindersSetting) =>
      (
        await api<{ settings: { documentReminders: DocumentRemindersSetting } }>('/visa/settings', {
          method: 'PUT',
          body: { documentReminders },
        })
      ).settings.documentReminders,
    onSuccess: (saved) => {
      queryClient.setQueryData(documentRemindersKey, saved)
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.cases })
    },
  })
}

/** The covering letter's print setting (0019 Decision 11), under its own key: the invoice card reads another part. */
const letterheadKey = ['visa', 'settings', 'covering-letter'] as const

type CoveringLetterSetting = { letterheadMm: number }

/** How much to leave blank at the top of a covering letter for the client's letterhead. */
export function useLetterheadSetting() {
  return useQuery({
    queryKey: letterheadKey,
    queryFn: async () => (await api<{ settings: { coveringLetter: CoveringLetterSetting } }>('/visa/settings')).settings.coveringLetter,
    staleTime: MASTER_STALE,
  })
}

/** The Visa HOD or the Head. The next print uses it. */
export function useSaveLetterheadSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (coveringLetter: CoveringLetterSetting) =>
      (await api<{ settings: { coveringLetter: CoveringLetterSetting } }>('/visa/settings', { method: 'PUT', body: { coveringLetter } })).settings
        .coveringLetter,
    onSuccess: (setting) => {
      queryClient.setQueryData(letterheadKey, setting)
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.coveringLetterPrints })
    },
  })
}

/** The invoice series and GST rate. The quotes' GST preview follows the rate, so open cases reload. */
export function useSaveVisaInvoiceSetting() {
  const queryClient = useQueryClient()
  return useSaveVisaSettingsWith(() => void queryClient.invalidateQueries({ queryKey: enquiryKeys.cases }))
}

/** The timings and the warnings' values (Settings → Visa). They apply to the next save that uses them. */
export function useSaveVisaSettings() {
  return useSaveVisaSettingsWith()
}

export function useUpdateHolidaySettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Partial<HolidaySettings>) =>
      (await api<{ settings: HolidaySettings }>('/holidays/settings', { method: 'PUT', body })).settings,
    onSuccess: (settings) => {
      queryClient.setQueryData(holidayKeys.settings, settings)
      // "new" chips depend on newForDays.
      void queryClient.invalidateQueries({ queryKey: holidayKeys.all })
    },
  })
}

/** Adds a holiday (no id) or edits one (id, with body.updatedAt). */
export function useSaveHoliday() {
  const queryClient = useQueryClient()
  const onStale = useStaleRecovery(holidayKeys.all, 'holiday')
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: HolidayBody & { updatedAt?: string } }) =>
      (await api<{ holiday: Holiday }>(id ? `/holidays/${id}` : '/holidays', { method: id ? 'PATCH' : 'POST', body })).holiday,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: holidayKeys.all }),
    onError: onStale,
  })
}

/** Takes a holiday off the calendar: its dates can be picked again. It stays under "Removed". */
export function useRemoveHoliday() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api<{ holiday: Holiday }>(`/holidays/${id}/remove`, { method: 'POST' })).holiday,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: holidayKeys.all }),
  })
}

// ---------------------------------------------------------------------------
// The small lists
// ---------------------------------------------------------------------------

interface MasterRow {
  countries: Country
  'visa-types': VisaType
  embassies: Embassy
  documents: DocumentMaster
  'enquiry-sources': EnquirySource
  'follow-up-outcomes': TaggedOption
  'follow-up-next-steps': TaggedOption
  'enquiry-reasons': EnquiryReason
  vendors: Vendor
  'document-problem-reasons': DocumentProblemReason
  'processing-speeds': ProcessingSpeed
  'urgency-levels': UrgencyLevel
  couriers: Courier
  'credit-note-reasons': CreditNoteReason
  'recall-reasons': RecallReason
  'missing-passport-reasons': MissingPassportReason
  'extra-charges': ExtraCharge
  'field-slots': FieldSlot
  'field-fail-reasons': FollowUpOption
}

/** The JSON key each list and save comes back under. */
const LIST_KEY = {
  countries: 'countries',
  'visa-types': 'visaTypes',
  embassies: 'embassies',
  documents: 'documents',
  'enquiry-sources': 'sources',
  'follow-up-outcomes': 'outcomes',
  'follow-up-next-steps': 'nextSteps',
  'enquiry-reasons': 'reasons',
  vendors: 'vendors',
  'document-problem-reasons': 'problemReasons',
  'processing-speeds': 'processingSpeeds',
  'urgency-levels': 'urgencyLevels',
  couriers: 'couriers',
  'credit-note-reasons': 'creditNoteReasons',
  'recall-reasons': 'recallReasons',
  'missing-passport-reasons': 'missingPassportReasons',
  'extra-charges': 'extraCharges',
  'field-slots': 'slots',
  'field-fail-reasons': 'reasons',
} as const
const ITEM_KEY = {
  countries: 'country',
  'visa-types': 'visaType',
  embassies: 'embassy',
  documents: 'document',
  'enquiry-sources': 'source',
  'follow-up-outcomes': 'outcome',
  'follow-up-next-steps': 'nextStep',
  'enquiry-reasons': 'reason',
  vendors: 'vendor',
  'document-problem-reasons': 'problemReason',
  'processing-speeds': 'processingSpeed',
  'urgency-levels': 'urgencyLevel',
  couriers: 'courier',
  'credit-note-reasons': 'creditNoteReason',
  'recall-reasons': 'recallReason',
  'missing-passport-reasons': 'missingPassportReason',
  'extra-charges': 'extraCharge',
  'field-slots': 'slot',
  'field-fail-reasons': 'reason',
} as const

/** Every row, switched-off ones too: the screens filter. */
export function useMasterList<R extends MasterResource>(resource: R, enabled = true) {
  return useQuery({
    enabled,
    queryKey: masterKeys.list(resource),
    queryFn: async () => (await api<Record<string, MasterRow[R][]>>(`/masters/${resource}`))[LIST_KEY[resource]] ?? [],
    staleTime: MASTER_STALE,
  })
}

/** Adds a row (no id) or changes one (id; only the fields sent). */
export function useSaveMaster<R extends MasterResource>(resource: R) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: Record<string, unknown> }) =>
      (await api<Record<string, MasterRow[R]>>(id ? `/masters/${resource}/${id}` : `/masters/${resource}`, {
        method: id ? 'PATCH' : 'POST',
        body,
      }))[ITEM_KEY[resource]] as MasterRow[R],
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: masterKeys.list(resource) })
      if (resource === 'countries' || resource === 'embassies') {
        void queryClient.invalidateQueries({ queryKey: holidayKeys.all })
        void queryClient.invalidateQueries({ queryKey: masterKeys.list('embassies') })
      }
      // A vendor lists its countries by name.
      if (resource === 'countries') void queryClient.invalidateQueries({ queryKey: masterKeys.list('vendors') })
      // So does a covering letter, with its visa type.
      if (resource === 'countries' || resource === 'visa-types') void queryClient.invalidateQueries({ queryKey: masterKeys.coveringLetters })
      // A case shows its vendor's name, city and contact, and whether it was switched off since; the case's picker
      // reads this same list.
      if (resource === 'vendors') {
        void queryClient.invalidateQueries({ queryKey: enquiryKeys.cases })
        return
      }
      // The document problems, couriers, urgency levels and the reasons lists change nothing else: the screens that
      // pick from them read these lists.
      if (['document-problem-reasons', 'couriers', 'urgency-levels', 'credit-note-reasons', 'recall-reasons', 'missing-passport-reasons', 'extra-charges', 'field-slots', 'field-fail-reasons'].includes(resource)) return
      // A case's quote shows its processing speed by name.
      if (resource === 'processing-speeds') {
        void queryClient.invalidateQueries({ queryKey: enquiryKeys.cases })
        return
      }
      if (resource === 'enquiry-sources') {
        // The New enquiry form's "Came in through" chips.
        void queryClient.invalidateQueries({ queryKey: enquiryKeys.sources })
        return
      }
      if (resource !== 'embassies') {
        void queryClient.invalidateQueries({ queryKey: masterKeys.offerings })
        void queryClient.invalidateQueries({ queryKey: ['masters', 'checklist'] })
        // The New enquiry form's Country and Visa type lists.
        void queryClient.invalidateQueries({ queryKey: enquiryKeys.visaOfferings })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Offerings (country × visa type) and checklists
// ---------------------------------------------------------------------------

export function useOfferings(enabled = true) {
  return useQuery({
    enabled,
    queryKey: masterKeys.offerings,
    queryFn: async () => (await api<{ offerings: Offering[] }>('/masters/visa-offerings')).offerings,
    staleTime: MASTER_STALE,
  })
}

export function useSaveOffering() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id?: number
      body:
        | { countryId: number; visaTypeId: number }
        | { isActive?: boolean; appointmentNeeded?: boolean; vendorNeeded?: boolean; portalLoginId?: string | null }
    }) =>
      (await api<{ offering: Offering }>(id ? `/masters/visa-offerings/${id}` : '/masters/visa-offerings', {
        method: id ? 'PATCH' : 'POST',
        body,
      })).offering,
    onSuccess: (offering) => {
      void queryClient.invalidateQueries({ queryKey: masterKeys.offerings })
      void queryClient.invalidateQueries({ queryKey: masterKeys.checklist(offering.id) })
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.visaOfferings })
      // Open cases read the visa's switches live.
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.cases })
    },
  })
}

export function useChecklist(offeringId: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: masterKeys.checklist(offeringId),
    queryFn: () => api<Checklist>(`/masters/visa-offerings/${offeringId}/checklist`),
    // The editor holds its own draft; a background refetch must not look like someone else's change.
    refetchOnWindowFocus: false,
  })
}

/** Replaces the whole checklist. A 409 STALE is left to the editor, which keeps the draft until the user reloads. */
export function useReplaceChecklist(offeringId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { updatedAt: string; items: ChecklistLineBody[] }) =>
      api<Checklist>(`/masters/visa-offerings/${offeringId}/checklist`, { method: 'PUT', body }),
    onSuccess: (checklist) => {
      queryClient.setQueryData(masterKeys.checklist(offeringId), checklist)
      void queryClient.invalidateQueries({ queryKey: masterKeys.offerings })
      // A visa is offered at intake only once it has a checklist.
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.visaOfferings })
    },
  })
}

// ---------------------------------------------------------------------------
// Covering letters (docs/decisions/0019-covering-letters.md)
// ---------------------------------------------------------------------------

export function useCoveringLetters(enabled = true) {
  return useQuery({
    enabled,
    queryKey: masterKeys.coveringLetters,
    queryFn: async () => (await api<{ formats: CoveringLetterSummary[] }>('/masters/covering-letters')).formats,
    staleTime: MASTER_STALE,
  })
}

export function useCoveringLetter(id: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: masterKeys.coveringLetter(id),
    queryFn: async () => (await api<{ format: CoveringLetter }>(`/masters/covering-letters/${id}`)).format,
    // A wording being written is its own draft; a background refetch must not look like someone else's change.
    refetchOnWindowFocus: false,
  })
}

/** Every save answers with the whole letter: it replaces the cached one, and the list catches up. */
function useLetterSaved() {
  const queryClient = useQueryClient()
  return (format: CoveringLetter) => {
    queryClient.setQueryData(masterKeys.coveringLetter(format.id), format)
    void queryClient.invalidateQueries({ queryKey: masterKeys.coveringLetters, exact: true })
  }
}

export function useCreateCoveringLetter() {
  const onSaved = useLetterSaved()
  return useMutation({
    mutationFn: async (body: CoveringLetterBody) =>
      (await api<{ format: CoveringLetter }>('/masters/covering-letters', { method: 'POST', body })).format,
    onSuccess: onSaved,
  })
}

/** The details, or switching it off or on. On 409 STALE the latest is loaded and the user is told. */
export function useUpdateCoveringLetter() {
  const onSaved = useLetterSaved()
  const onStale = useStaleRecovery(masterKeys.coveringLetters, 'covering letter')
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<Omit<CoveringLetterBody, 'body' | 'effectiveFrom'>> & { isActive?: boolean; updatedAt: string } }) =>
      (await api<{ format: CoveringLetter }>(`/masters/covering-letters/${id}`, { method: 'PATCH', body })).format,
    onSuccess: onSaved,
    onError: onStale,
  })
}

/** A new wording, or a change to one still to come (replacesId). A 409 STALE is left to the editor, which keeps the draft. */
export function useAddWording(id: number) {
  const onSaved = useLetterSaved()
  return useMutation({
    mutationFn: async (body: { body: string; effectiveFrom: string; replacesId?: number; updatedAt: string }) =>
      (await api<{ format: CoveringLetter }>(`/masters/covering-letters/${id}/versions`, { method: 'POST', body })).format,
    onSuccess: onSaved,
  })
}

/**
 * The consent form's wording, every version newest first (0022 part 2b). No refetch on focus: the editor's basedOnId
 * must stay the version it opened, so someone else's change shows as a 409 rather than a silent swap.
 */
export function useConsentWordings(enabled = true) {
  return useQuery({
    enabled,
    queryKey: masterKeys.consentWording,
    queryFn: async () => (await api<{ versions: ConsentWordingVersion[] }>('/masters/consent-wording')).versions,
    staleTime: MASTER_STALE,
    refetchOnWindowFocus: false,
  })
}

/** A new version of the consent wording, used from now on. A 409 STALE is left to the editor, which keeps the draft. */
export function useAddConsentWording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { body: string; basedOnId: number }) =>
      (await api<{ versions: ConsentWordingVersion[] }>('/masters/consent-wording', { method: 'POST', body })).versions,
    onSuccess: (versions) => queryClient.setQueryData(masterKeys.consentWording, versions),
  })
}

/** Removes a wording still to come. On 409 STALE the latest is loaded and the user is told. */
export function useRemoveWording(id: number) {
  const onSaved = useLetterSaved()
  const onStale = useStaleRecovery(masterKeys.coveringLetters, 'covering letter')
  return useMutation({
    mutationFn: async ({ versionId, updatedAt }: { versionId: number; updatedAt: string }) =>
      (await api<{ format: CoveringLetter }>(`/masters/covering-letters/${id}/versions/${versionId}`, { method: 'DELETE', body: { updatedAt } })).format,
    onSuccess: onSaved,
    onError: onStale,
  })
}
