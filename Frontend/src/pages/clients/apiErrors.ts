import { ApiError } from '../../lib/api'
import { errorBody, errorCode, isDuplicateWarning } from '../../lib/apiErrors'
import type { Duplicate } from './types'

// Client-specific readers of the API's error responses. The generic ones live in lib/apiErrors.ts.
export { applyServerIssues, errorText, isStale } from '../../lib/apiErrors'

/** 409 DUPLICATE: details already on file elsewhere. Saving again with confirmDuplicates: true goes ahead. */
export function readDuplicates(error: unknown): { message: string; duplicates: Duplicate[] } | null {
  if (!(error instanceof ApiError) || !isDuplicateWarning(error)) return null
  return { message: error.message, duplicates: (errorBody(error)?.details?.duplicates as Duplicate[] | undefined) ?? [] }
}

/** 409 CLIENT_EXISTS: the id of the client who already has this main number. */
export function existingClientId(error: unknown): string | null {
  return errorCode(error) === 'CLIENT_EXISTS' ? ((errorBody(error)?.details?.clientId as string | undefined) ?? null) : null
}
