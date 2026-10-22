import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadFile } from '../../lib/api'
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

/** The client's code is on its way: its WhatsApp not yet delivered or failed, and the code not confirmed or expired. */
function codeOnItsWay(data: MyStop | undefined) {
  const otp = data?.otp
  if (!otp || otp.confirmedAt || Date.parse(otp.expiresAt) <= Date.now()) return false
  return otp.message?.status === 'QUEUED' || otp.message?.status === 'SENT'
}

/**
 * One of his stops, kept fresh like the run: the office may change it or call it off while he's on the way. While the
 * client's code is on its way, every 5 seconds, so he sees it go, arrive, or fail (decided 22 Oct 2026).
 */
export function useStop(jobId: string) {
  return useQuery({
    queryKey: fieldKeys.stop(jobId),
    queryFn: () => api<MyStop>(`/field/jobs/${encodeURIComponent(jobId)}`),
    refetchInterval: (query) => (codeOnItsWay(query.state.data) ? 5_000 : 60_000),
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

/** A save on a stop: it comes back, every run refetches; refused, the stop is read again (moved or called off meanwhile). */
function useStopSave<V>(jobId: string, save: (vars: V) => Promise<MyStop>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: save,
    onSuccess: (data) => {
      queryClient.setQueryData(fieldKeys.stop(jobId), data)
      void queryClient.invalidateQueries({ queryKey: fieldKeys.runs })
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: fieldKeys.stop(jobId) }),
  })
}

const stopPath = (jobId: string, rest = '') => `/field/jobs/${encodeURIComponent(jobId)}${rest}`

/** "Couldn't complete": the reason and the place. */
export function useMarkFailed(jobId: string) {
  return useStopSave(jobId, (body: { reasonId: number; place: Place }) => api<MyStop>(stopPath(jobId, '/failed'), { method: 'POST', body }))
}

/** "Send the code" (0015 Decision 4, amended 22 Oct 2026): a new one-time code to the client's WhatsApp. */
export function useSendOtp(jobId: string) {
  return useStopSave<void>(jobId, () => api<MyStop>(stopPath(jobId, '/otp'), { method: 'POST' }))
}

/** "Check" the code the client reads out. */
export function useCheckOtp(jobId: string) {
  return useStopSave(jobId, (code: string) => api<MyStop>(stopPath(jobId, '/otp/check'), { method: 'POST', body: { code } }))
}

/** The photos taken at the door: his selfie, or (at a delivery) the person receiving. */
export type DoorPhoto = 'selfie' | 'receiver'

/** A photo at the door, saved as soon as he takes it: its case file. */
export function useUploadDoorPhoto(jobId: string, kind: DoorPhoto) {
  return useMutation({
    mutationFn: async (photo: Blob) => {
      const answer = await uploadFile<{ selfie?: SavedPhoto; photo?: SavedPhoto }>(
        stopPath(jobId, kind === 'selfie' ? '/selfie' : '/receiver-photo'),
        photo,
        photo.type || 'image/jpeg',
      )
      return (kind === 'selfie' ? answer.selfie : answer.photo)!
    },
  })
}

interface SavedPhoto {
  id: string
  fileName: string
}

/** "Picked up": the booklets he counted, his selfie and the place, once the client confirmed the code. */
export function useMarkDone(jobId: string) {
  return useStopSave(jobId, (body: { booklets: { current: number; old: number }; selfieId: string; place: Place }) =>
    api<MyStop>(stopPath(jobId, '/done'), { method: 'POST', body }),
  )
}

/** The handover at the door (phase 5): the booklets, who receives them, their photo, his selfie and the place. */
export function useHandOverAtDoor(jobId: string) {
  return useStopSave(
    jobId,
    (body: {
      booklets: { current: number; old: number }
      receiver: { travellerId: string } | { name: string }
      photoId: string
      selfieId: string
      place: Place
      confirmWarnings?: boolean
    }) => api<MyStop>(stopPath(jobId, '/handover'), { method: 'POST', body }),
  )
}
