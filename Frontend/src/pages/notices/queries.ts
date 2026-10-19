import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { isStale } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { todayKeys } from '../today/queries'
import type { LoginPopupItem, Notice, NoticeBody, NoticeFilters, NoticePage } from './types'

export const noticeKeys = {
  all: ['notices'] as const,
  list: (filters: NoticeFilters) => ['notices', 'list', filters] as const,
  /** Under all, so a notice picked or unpicked shows in (or leaves) the visa team's popup. */
  loginPopup: ['notices', 'login-popup'] as const,
}

/** The visa team's login popup (0017 Decision 12): what's new to this person since they last dismissed it. */
export function useLoginPopup(enabled: boolean) {
  return useQuery({
    queryKey: noticeKeys.loginPopup,
    queryFn: async () => (await api<{ items: LoginPopupItem[] }>('/notices/login-popup')).items,
    enabled,
  })
}

/** "Got it" or "All updates": these items are seen, up to the newest of them (so anything newer still shows). */
export function useDismissLoginPopup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: LoginPopupItem[]) =>
      api('/notices/login-popup/seen', {
        method: 'POST',
        body: {
          upTo: items.reduce((newest, i) => (i.at > newest ? i.at : newest), items[0]?.at ?? new Date().toISOString()),
          noticeIds: items.filter((i) => i.kind === 'NOTICE').map((i) => i.id),
          holidayIds: items.filter((i) => i.kind === 'HOLIDAY').map((i) => i.id),
        },
      }),
    onSuccess: () => queryClient.setQueryData(noticeKeys.loginPopup, []),
  })
}

/** The board, newest first, 30 at a time. */
export function useNotices(filters: NoticeFilters) {
  return useInfiniteQuery({
    queryKey: noticeKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (filters.department) params.set('department', filters.department)
      if (filters.category) params.set('category', filters.category)
      if (pageParam) params.set('cursor', pageParam)
      const query = params.toString()
      return api<NoticePage>(`/notices${query ? `?${query}` : ''}`)
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

/** A change shows on the board and on Today's notice card. */
function useNoticesChanged() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: noticeKeys.all })
    void queryClient.invalidateQueries({ queryKey: todayKeys.summary })
  }
}

/** On 409 STALE (someone saved after the form opened): reload and say so; the form closes, as the masters' do. */
function useStaleNotice() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return (error: unknown) => {
    if (!isStale(error)) return
    void queryClient.invalidateQueries({ queryKey: noticeKeys.all })
    toast({
      tone: 'warn',
      message: 'Someone else changed this notice while you were editing. The latest version is now loaded. Please make your change again.',
    })
  }
}

/** Posts a notice (no id) or edits one (id, with body.updatedAt). */
export function useSaveNotice() {
  const changed = useNoticesChanged()
  const onStale = useStaleNotice()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: NoticeBody }) =>
      (await api<{ notice: Notice }>(id ? `/notices/${id}` : '/notices', { method: id ? 'PATCH' : 'POST', body })).notice,
    onSuccess: changed,
    onError: onStale,
  })
}

/** Off the board for everyone, kept in the records. */
export function useRemoveNotice() {
  const changed = useNoticesChanged()
  return useMutation({
    mutationFn: async (id: string) => (await api<{ notice: Notice }>(`/notices/${id}/remove`, { method: 'POST', body: {} })).notice,
    onSuccess: changed,
  })
}
