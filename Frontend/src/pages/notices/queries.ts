import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { isStale } from '../../lib/apiErrors'
import { useToast } from '../../lib/toast'
import { todayKeys } from '../today/queries'
import type { Notice, NoticeBody, NoticeFilters, NoticePage } from './types'

export const noticeKeys = {
  all: ['notices'] as const,
  list: (filters: NoticeFilters) => ['notices', 'list', filters] as const,
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
