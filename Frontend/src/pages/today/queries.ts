import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { TodaySummary } from './types'

export const todayKeys = {
  summary: ['today', 'summary'] as const,
}

/** One person's day. Rechecked every minute, so a case that falls due turns late without a reload. */
export function useToday() {
  return useQuery({
    queryKey: todayKeys.summary,
    queryFn: () => api<TodaySummary>('/today'),
    refetchInterval: 60_000,
  })
}
