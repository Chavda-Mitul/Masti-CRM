const BASE_URL: string = import.meta.env.VITE_API_URL || '/api'

/** An error response from the API, with its HTTP status and the server's message. */
export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** The body as JSON, or an ApiError carrying the server's message. */
async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Request failed (${res.status})`
    throw new ApiError(res.status, message, data)
  }
  return data as T
}

/**
 * Calls the backend. Sends cookies (the session) and JSON. Every request declares JSON,
 * which the backend requires for state-changing calls (CSRF protection).
 */
export async function api<T>(
  path: string,
  options: { method?: Method; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: { ...options.headers, 'Content-Type': 'application/json' },
    body: options.body === undefined ? null : JSON.stringify(options.body),
  })
  return parseResponse<T>(res)
}

/**
 * Uploads a PDF as the request body itself (not a form). The backend accepts application/pdf, like JSON, for
 * state-changing calls: no other site's form can send it (CSRF protection).
 */
export async function uploadPdf<T>(path: string, file: Blob): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })
  return parseResponse<T>(res)
}
