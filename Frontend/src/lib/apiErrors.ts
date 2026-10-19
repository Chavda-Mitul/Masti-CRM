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

/** One thing to check before saving (Backend/src/lib/warnings.ts). */
export interface SaveWarning {
  code: string
  message: string
}

/** 409 WARNING: usually a mistake but can be right; saving again with confirmWarnings: true goes ahead (useWarningGuard). */
export function isSaveWarning(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && errorCode(error) === 'WARNING'
}

/** What a 409 WARNING asks staff to check, or null for any other error. */
export function readSaveWarnings(error: unknown): SaveWarning[] | null {
  if (!isSaveWarning(error)) return null
  const warnings = errorBody(error)?.details?.warnings
  return Array.isArray(warnings) ? (warnings as SaveWarning[]) : null
}

/** The message to show in a form, or null when the error is handled elsewhere (duplicate or warning modal, stale toast). */
export function errorText(error: unknown): string | null {
  if (!error || isDuplicateWarning(error) || isSaveWarning(error) || isStale(error)) return null
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}

/** A screen without form fields: the first per-field message of a 400 (issues), else the answer's own message. */
export function issueText(error: unknown): string | null {
  const issues = errorBody(error)?.issues
  const first = issues && Object.values(issues).find((messages) => messages && messages.length > 0)?.[0]
  return first ?? errorText(error)
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
