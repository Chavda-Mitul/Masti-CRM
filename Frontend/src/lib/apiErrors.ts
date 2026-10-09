import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api'

// Reading the API's error responses. ApiError.details is the whole response body:
// { message, details?: { code, … }, issues?: { field: [messages] } } (Backend/src/middleware/error.ts).

export interface ErrorBody {
  message?: string
  details?: { code?: string } & Record<string, unknown>
  issues?: Record<string, string[] | undefined>
}

export function errorBody(error: unknown): ErrorBody | null {
  return error instanceof ApiError && error.details && typeof error.details === 'object' ? (error.details as ErrorBody) : null
}

/** The machine-readable code of a 4xx answer, e.g. "STALE", "DUPLICATE", "IN_USE". */
export function errorCode(error: unknown): string | undefined {
  return errorBody(error)?.details?.code
}

/** 409 STALE: someone else saved this record after it was loaded. */
export function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && errorCode(error) === 'STALE'
}

/** 409 DUPLICATE: a warning; saving again with confirmDuplicates: true goes ahead (useRetryGuard). */
export function isDuplicateWarning(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && errorCode(error) === 'DUPLICATE'
}

/** The message to show in a form, or null when the error is handled elsewhere (duplicate modal, stale toast). */
export function errorText(error: unknown): string | null {
  if (!error || isDuplicateWarning(error) || isStale(error)) return null
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}

/** Puts the backend's per-field validation messages (400 issues) next to the matching inputs. */
export function applyServerIssues<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly string[]) {
  const issues = errorBody(error)?.issues
  if (!issues) return
  for (const [field, messages] of Object.entries(issues)) {
    const message = messages?.[0]
    if (message && fields.includes(field)) setError(field as Path<T>, { type: 'server', message })
  }
}
