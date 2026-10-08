import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { isStale } from './apiErrors'
import type {
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

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => ['clients', 'list'] as const,
  list: (filters: ClientListFilters) => ['clients', 'list', filters] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
  notes: (id: string) => ['clients', 'notes', id] as const,
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

/** The full notes log (the profile only carries the latest 20). */
export function useClientNotes(id: string) {
  return useQuery({
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

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function useAddNote(clientId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { body: string }) =>
      (await api<{ note: ClientNote }>(`/clients/${clientId}/notes`, { method: 'POST', body })).note,
    onSuccess: (note) => {
      queryClient.setQueryData<ClientNote[]>(clientKeys.notes(clientId), (notes) => (notes ? [note, ...notes] : notes))
      void queryClient.invalidateQueries({ queryKey: clientKeys.notes(clientId) })
    },
  })
}
