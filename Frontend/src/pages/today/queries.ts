import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { TodaySettings, TodaySummary } from './types'

export const todayKeys = {
  summary: ['today', 'summary'] as const,
  settings: ['today', 'settings'] as const,
}

/** One person's day. Rechecked every minute, so a case that falls due turns late without a reload. */
export function useToday() {
  return useQuery({
    queryKey: todayKeys.summary,
    queryFn: () => api<TodaySummary>('/today'),
    refetchInterval: 60_000,
  })
}

/** When New enquiries start counting. Every office user reads it; the Head changes it. */
export function useTodaySettings() {
  return useQuery({
    queryKey: todayKeys.settings,
    queryFn: async () => (await api<{ settings: TodaySettings }>('/today/settings')).settings,
  })
}

export function useUpdateTodaySettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Partial<TodaySettings>) =>
      (await api<{ settings: TodaySettings }>('/today/settings', { method: 'PUT', body })).settings,
    onSuccess: (settings) => {
      queryClient.setQueryData(todayKeys.settings, settings)
      // The New enquiries tile counts from the new time.
      void queryClient.invalidateQueries({ queryKey: todayKeys.summary })
    },
  })
}
