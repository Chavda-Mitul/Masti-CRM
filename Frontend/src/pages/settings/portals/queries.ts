import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { isStale } from '../../../lib/apiErrors'
import { useToast } from '../../../lib/toast'
import type { Person, Portal, PortalBody, PortalLoginsData } from './types'

export const portalKeys = {
  all: ['portal-logins'] as const,
  people: (departmentCode: string) => ['portal-logins', 'people', departmentCode] as const,
}

/** The page: the portals this person may see, who used what, and what the page needs to know. */
export function usePortalLogins() {
  return useQuery({ queryKey: portalKeys.all, queryFn: () => api<PortalLoginsData>('/portal-logins') })
}

/** The department's office staff, for a portal's list. */
export function usePortalPeople(departmentCode: string) {
  return useQuery({
    queryKey: portalKeys.people(departmentCode),
    queryFn: async () => (await api<{ people: Person[] }>(`/portal-logins/people?department=${encodeURIComponent(departmentCode)}`)).people,
    enabled: departmentCode !== '',
  })
}

/** On 409 STALE (someone saved after the form opened): reload and say so; the form closes, as the notices' does. */
function useStalePortal() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return (error: unknown) => {
    if (!isStale(error)) return
    void queryClient.invalidateQueries({ queryKey: portalKeys.all })
    toast({
      tone: 'warn',
      message: 'Someone else changed this portal while you were editing. The latest version is now loaded. Please make your change again.',
    })
  }
}

/** Adds a portal (no id) or changes one (id, with body.updatedAt). */
export function useSavePortal() {
  const queryClient = useQueryClient()
  const onStale = useStalePortal()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: PortalBody }) =>
      (await api<{ portal: Portal }>(id ? `/portal-logins/${id}` : '/portal-logins', { method: id ? 'PATCH' : 'POST', body })).portal,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portalKeys.all }),
    onError: onStale,
  })
}

/** Off the list for everyone; its ID and password are wiped. */
export function useRemovePortal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api<{ portal: Portal }>(`/portal-logins/${id}/remove`, { method: 'POST', body: {} })).portal,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portalKeys.all }),
  })
}
