import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadFile } from '../../lib/api'
import { useOpenSignedLink } from '../../lib/signedLinks'
import { useToast } from '../../lib/toast'
import { isStale } from './apiErrors'
import type { ScanType } from './scanFiles'
import type {
  ClientDocuments,
  ClientListFilters,
  ClientListPage,
  ClientMember,
  ClientNote,
  ClientOptions,
  ClientPhone,
  ClientProfile,
  CreateClientBody,
  MemberBody,
  UpdateClientBody,
} from './types'

// Server state for the client screens (TanStack Query). Mutations keep the cache in step:
// they write the returned profile into the detail query, or invalidate what they changed.

const PAGE_SIZE = 25
/** How many notes the profile carries (PROFILE_NOTES in Backend clients.service.ts). */
export const PROFILE_NOTES = 20

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => ['clients', 'list'] as const,
  list: (filters: ClientListFilters) => ['clients', 'list', filters] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
  notes: (id: string) => ['clients', 'notes', id] as const,
  documents: (id: string) => ['clients', 'documents', id] as const,
  options: ['clients', 'options'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The directory: search + filters, paged with the API's cursor ("Show more"). */
export function useClientList(filters: ClientListFilters) {
  return useInfiniteQuery({
    queryKey: clientKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (filters.q) params.set('q', filters.q)
      if (filters.kind) params.set('kind', filters.kind)
      if (filters.incomplete) params.set('incomplete', filters.incomplete)
      if (pageParam) params.set('cursor', pageParam)
      return api<ClientListPage>(`/clients?${params.toString()}`)
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Keep showing the old rows while a new search loads, instead of flashing "Loading…".
    placeholderData: keepPreviousData,
  })
}

export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: async () => (await api<{ client: ClientProfile }>(`/clients/${id}`)).client,
  })
}

/** The full notes log (the profile only carries the latest 20). Loaded only when `enabled`. */
export function useClientNotes(id: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: clientKeys.notes(id),
    queryFn: async () => (await api<{ notes: ClientNote[] }>(`/clients/${id}/notes`)).notes,
  })
}

/** Dropdown values. They change rarely (System Masters), so they're kept for half an hour. */
export function useClientOptions() {
  return useQuery({
    queryKey: clientKeys.options,
    queryFn: () => api<ClientOptions>('/clients/options'),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// Optimistic locking
// ---------------------------------------------------------------------------

/**
 * On 409 STALE (someone else saved after this screen loaded the record): reload the client and say so.
 * The form that failed closes; the user makes their change again on the fresh data.
 */
function useStaleRecovery(clientId: string | undefined, what: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return (error: unknown) => {
    if (!isStale(error) || !clientId) return
    void queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) })
    toast({
      tone: 'warn',
      message: `Someone else changed this ${what} while you were editing. The latest version is now loaded. Please make your change again.`,
    })
  }
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export function useCreateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateClientBody) => (await api<{ client: ClientProfile }>('/clients', { method: 'POST', body })).client,
    onSuccess: (client) => {
      queryClient.setQueryData(clientKeys.detail(client.id), client)
      void queryClient.invalidateQueries({ queryKey: clientKeys.lists() })
    },
  })
}

export function useUpdateClient(id: string) {
  const queryClient = useQueryClient()
  const onStale = useStaleRecovery(id, 'client')
  return useMutation({
    mutationFn: async (body: UpdateClientBody) =>
      (await api<{ client: ClientProfile }>(`/clients/${id}`, { method: 'PATCH', body })).client,
    onSuccess: (client) => {
      queryClient.setQueryData(clientKeys.detail(id), client)
      void queryClient.invalidateQueries({ queryKey: clientKeys.lists() })
    },
    onError: onStale,
  })
}

/** Makes another number the main one (lookup and WhatsApp). */
export function useChangeMainNumber(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { mobile: string; keepOldAsSecondary: boolean; confirmDuplicates?: boolean }) =>
      (await api<{ client: ClientProfile }>(`/clients/${id}/mobile`, { method: 'PUT', body })).client,
    onSuccess: (client) => {
      queryClient.setQueryData(clientKeys.detail(id), client)
      void queryClient.invalidateQueries({ queryKey: clientKeys.lists() })
    },
  })
}

function useInvalidateClient(id: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) })
    void queryClient.invalidateQueries({ queryKey: clientKeys.lists() })
    // The vault shows each person's name and whether they were taken off the list.
    void queryClient.invalidateQueries({ queryKey: clientKeys.documents(id) })
  }
}

export function useAddPhone(clientId: string) {
  const invalidate = useInvalidateClient(clientId)
  return useMutation({
    mutationFn: async (body: { mobile: string; label: string | null; confirmDuplicates?: boolean }) =>
      (await api<{ phone: ClientPhone }>(`/clients/${clientId}/phones`, { method: 'POST', body })).phone,
    onSuccess: invalidate,
  })
}

export function useRemovePhone(clientId: string) {
  const invalidate = useInvalidateClient(clientId)
  return useMutation({
    mutationFn: (phoneId: string) => api<void>(`/clients/${clientId}/phones/${phoneId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

// ---------------------------------------------------------------------------
// Family members
// ---------------------------------------------------------------------------

/** Adds a member (no memberId) or updates one (memberId, with body.updatedAt). */
export function useSaveMember(clientId: string) {
  const invalidate = useInvalidateClient(clientId)
  const onStale = useStaleRecovery(clientId, 'person')
  return useMutation({
    mutationFn: async ({ memberId, body }: { memberId?: string; body: MemberBody }) => {
      const path = memberId ? `/clients/${clientId}/members/${memberId}` : `/clients/${clientId}/members`
      return (await api<{ member: ClientMember }>(path, { method: memberId ? 'PATCH' : 'POST', body })).member
    },
    onSuccess: invalidate,
    onError: onStale,
  })
}

export function useArchiveMember(clientId: string) {
  const invalidate = useInvalidateClient(clientId)
  return useMutation({
    mutationFn: async (memberId: string) =>
      (await api<{ member: ClientMember }>(`/clients/${clientId}/members/${memberId}/archive`, { method: 'POST' })).member,
    onSuccess: invalidate,
  })
}

/** A consent signed on paper before the CRM, marked on file with the year (the Head or the Visa HOD; 0022 part 3). */
export function useMarkPaperConsent(clientId: string) {
  const invalidate = useInvalidateClient(clientId)
  return useMutation({
    mutationFn: async ({ memberId, year }: { memberId: string; year: number }) =>
      (await api<{ member: ClientMember }>(`/clients/${clientId}/members/${memberId}/paper-consent`, { method: 'POST', body: { year } })).member,
    onSuccess: invalidate,
  })
}

/** Takes a mistaken paper mark off: the person can then be sent the "I agree" link. */
export function useRemovePaperConsent(clientId: string) {
  const invalidate = useInvalidateClient(clientId)
  return useMutation({
    mutationFn: async (memberId: string) =>
      (await api<{ member: ClientMember }>(`/clients/${clientId}/members/${memberId}/paper-consent`, { method: 'DELETE' })).member,
    onSuccess: invalidate,
  })
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function useAddNote(clientId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { body: string }) =>
      (await api<{ note: ClientNote }>(`/clients/${clientId}/notes`, { method: 'POST', body })).note,
    onSuccess: (note) => {
      queryClient.setQueryData<ClientProfile>(clientKeys.detail(clientId), (client) =>
        client ? { ...client, notes: [note, ...client.notes].slice(0, PROFILE_NOTES) } : client,
      )
      queryClient.setQueryData<ClientNote[]>(clientKeys.notes(clientId), (notes) => (notes ? [note, ...notes] : notes))
    },
  })
}

// ---------------------------------------------------------------------------
// The document vault (docs/decisions/0016-client-documents.md): HODs and the Head only
// ---------------------------------------------------------------------------

/** The client's scans, grouped by person. Loaded only when `enabled` (the server refuses anyone else). */
export function useClientDocuments(clientId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: clientKeys.documents(clientId),
    queryFn: () => api<ClientDocuments>(`/clients/${clientId}/documents`),
  })
}

/** Saves a scan: the file is the body; which paper and whose go in the query (no member: the client's own paper). */
export function useAddClientDocument(clientId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, memberId, file, type }: { documentId: number; memberId: string | null; file: File; type: ScanType }) => {
      const params = new URLSearchParams({ documentId: String(documentId) })
      if (memberId) params.set('memberId', memberId)
      return uploadFile<ClientDocuments>(`/clients/${clientId}/documents?${params.toString()}`, file, type)
    },
    onSuccess: (documents) => queryClient.setQueryData(clientKeys.documents(clientId), documents),
  })
}

/** Opens one scan in a new tab, through a link that works for a few minutes. Every opening is recorded. */
export function useOpenClientDocument(clientId: string) {
  const open = useOpenSignedLink()
  return (scanId: string) => open(`/clients/${clientId}/documents/${scanId}/link`)
}
