import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { isStale } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import type {
  Checklist,
  ChecklistLineBody,
  Country,
  DocumentMaster,
  Embassy,
  Holiday,
  HolidayBody,
  HolidayFilter,
  HolidaySettings,
  HolidayTargetOptions,
  MasterResource,
  Offering,
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
}

export const masterKeys = {
  all: ['masters'] as const,
  list: (resource: MasterResource) => ['masters', resource] as const,
  offerings: ['masters', 'offerings'] as const,
  checklist: (offeringId: number) => ['masters', 'checklist', offeringId] as const,
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

const FILTER_QUERY: Record<HolidayFilter, string> = { upcoming: '', pending: '?status=PENDING', removed: '?status=REMOVED' }

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

export function useHolidaySettings() {
  return useQuery({
    queryKey: holidayKeys.settings,
    queryFn: async () => (await api<{ settings: HolidaySettings }>('/holidays/settings')).settings,
    staleTime: MASTER_STALE,
  })
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

/** Confirm (a bot entry starts blocking dates) or remove. */
export function useHolidayAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'confirm' | 'remove' }) =>
      (await api<{ holiday: Holiday }>(`/holidays/${id}/${action}`, { method: 'POST' })).holiday,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: holidayKeys.all }),
  })
}

// ---------------------------------------------------------------------------
// The four small lists
// ---------------------------------------------------------------------------

interface MasterRow {
  countries: Country
  'visa-types': VisaType
  embassies: Embassy
  documents: DocumentMaster
}

/** The JSON key each list and save comes back under. */
const LIST_KEY = { countries: 'countries', 'visa-types': 'visaTypes', embassies: 'embassies', documents: 'documents' } as const
const ITEM_KEY = { countries: 'country', 'visa-types': 'visaType', embassies: 'embassy', documents: 'document' } as const

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
      if (resource !== 'embassies') {
        void queryClient.invalidateQueries({ queryKey: masterKeys.offerings })
        void queryClient.invalidateQueries({ queryKey: ['masters', 'checklist'] })
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
    mutationFn: async ({ id, body }: { id?: number; body: { countryId: number; visaTypeId: number } | { isActive: boolean } }) =>
      (await api<{ offering: Offering }>(id ? `/masters/visa-offerings/${id}` : '/masters/visa-offerings', {
        method: id ? 'PATCH' : 'POST',
        body,
      })).offering,
    onSuccess: (offering) => {
      void queryClient.invalidateQueries({ queryKey: masterKeys.offerings })
      void queryClient.invalidateQueries({ queryKey: masterKeys.checklist(offering.id) })
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
    },
  })
}
