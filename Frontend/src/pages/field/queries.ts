import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Place } from '../../lib/place'
import type { FailReason, MyRun, MyStop } from './types'

// Server state for the field staff's phone screens (TanStack Query).

export const fieldKeys = {
  runs: ['field', 'run'] as const,
  run: (day: string | null) => ['field', 'run', day ?? 'today'] as const,
  stop: (jobId: string) => ['field', 'stop', jobId] as const,
  failReasons: ['field', 'fail-reasons'] as const,
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

/** One of his stops, kept fresh like the run: the office may change it or call it off while he's on the way. */
export function useStop(jobId: string) {
  return useQuery({
    queryKey: fieldKeys.stop(jobId),
    queryFn: () => api<MyStop>(`/field/jobs/${encodeURIComponent(jobId)}`),
    refetchInterval: 60_000,
  })
}

/** The reasons for "Couldn't complete", switched on, loaded when he opens it. */
export function useFailReasons(enabled: boolean) {
  return useQuery({
    queryKey: fieldKeys.failReasons,
    queryFn: async () => (await api<{ reasons: FailReason[] }>('/field/fail-reasons')).reasons,
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** "Couldn't complete": the reason and the place. The stop comes back; every run refetches. */
export function useMarkFailed(jobId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { reasonId: number; place: Place }) =>
      api<MyStop>(`/field/jobs/${encodeURIComponent(jobId)}/failed`, { method: 'POST', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(fieldKeys.stop(jobId), data)
      void queryClient.invalidateQueries({ queryKey: fieldKeys.runs })
    },
    // Called off or moved meanwhile: show the stop as it is now.
    onError: () => void queryClient.invalidateQueries({ queryKey: fieldKeys.stop(jobId) }),
  })
}
