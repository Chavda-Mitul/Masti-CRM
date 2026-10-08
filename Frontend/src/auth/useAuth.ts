import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import type { User } from './types'

export const ME_KEY = ['me'] as const

/** The logged-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['login'],
    mutationFn: (input: { identifier: string; password: string }) =>
      api<{ user: User }>('/auth/login', { method: 'POST', body: input }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME_KEY, user),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(ME_KEY, null)
    },
  })
}

export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { currentPassword?: string; newPassword: string }) =>
      api<{ user: User }>('/auth/change-password', { method: 'POST', body: input }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME_KEY, user),
  })
}

/** Short description of what a user can access, e.g. "Head · all departments" or "HOD · Visa". */
export function roleSummary(user: User): string {
  if (user.type === 'HEAD') return 'Head · all departments'
  if (user.type === 'FIELD') return 'Field staff · collection & delivery'
  if (user.departments.length === 0) return 'No department'
  return user.departments.map((d) => `${d.role === 'HOD' ? 'HOD' : 'Staff'} · ${d.name}`).join(', ')
}
