import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { MyRun } from './types'

// Server state for the field staff's phone screen (TanStack Query).

export const fieldKeys = {
  run: (day: string | null) => ['field', 'run', day ?? 'today'] as const,
}

/**
 * His run for a day; null asks for today, so a phone left open overnight opens on the new day. Kept fresh every
 * minute while the screen is open (a stop the office books or calls off shows up), and whenever he comes back to it.
 */
export function useMyRun(day: string | null) {
  return useQuery({
    queryKey: fieldKeys.run(day),
    queryFn: () => api<MyRun>(day ? `/field/jobs?day=${day}` : '/field/jobs'),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
}
