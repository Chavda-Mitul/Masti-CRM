import { useQuery } from '@tanstack/react-query'
import type { Department } from '../auth/types'
import { api } from './api'

/** The active departments, in menu order (GET /api/departments). They rarely change. */
export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api<{ departments: Department[] }>('/departments')).departments,
    staleTime: 5 * 60_000,
  })
}
