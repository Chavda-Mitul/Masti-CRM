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

/**
 * The server couldn't be reached: no answer at all (status 0: offline, or the server is down), or the proxy in front
 * of it answered 502, 503 or 504 instead (the server is restarting or being updated). Pages that were loading try
 * again by themselves (retryWhileUnreachable); saves don't, so nothing is saved twice.
 */
export class ServerUnreachableError extends ApiError {
  constructor(status = 0) {
    super(status, "Can't reach the server. Wait a few seconds and try again.")
    this.name = 'ServerUnreachableError'
  }
}

/** A query's `retry`: while the server can't be reached, 3 more tries (after 1, 2 and 4 seconds); otherwise none. */
export function retryWhileUnreachable(failureCount: number, error: unknown): boolean {
  return error instanceof ServerUnreachableError && failureCount < 3
}

/** What a proxy (Vite in development, the web server when live) answers when the server behind it doesn't. */
const PROXY_STATUSES = new Set([502, 503, 504])

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** fetch with the session cookie. No answer at all (offline, or the server is down) becomes ServerUnreachableError. */
async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, credentials: 'include' })
  } catch (err) {
    // fetch rejects with a TypeError when the network fails.
    if (err instanceof TypeError) throw new ServerUnreachableError()
    throw err
  }
}

/** The body as JSON, or an ApiError carrying the server's message. */
async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : null
    // A proxy's own answer carries none of the API's JSON message.
    if (message === null && PROXY_STATUSES.has(res.status)) throw new ServerUnreachableError(res.status)
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`, data)
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
  const res = await request(path, {
    method: options.method ?? 'GET',
    headers: { ...options.headers, 'Content-Type': 'application/json' },
    body: options.body === undefined ? null : JSON.stringify(options.body),
  })
  return parseResponse<T>(res)
}

/**
 * Uploads a file as the request body itself (not a form). The backend accepts a PDF, a PNG or a JPEG this way, like
 * JSON, for state-changing calls: no other site's form can send those types (CSRF protection).
 */
export async function uploadFile<T>(path: string, file: Blob, contentType: string, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const res = await request(path, { method, headers: { 'Content-Type': contentType }, body: file })
  return parseResponse<T>(res)
}

/** A PDF as the request body (the visa case's saved file). */
export async function uploadPdf<T>(path: string, file: Blob): Promise<T> {
  return uploadFile<T>(path, file, 'application/pdf')
}
