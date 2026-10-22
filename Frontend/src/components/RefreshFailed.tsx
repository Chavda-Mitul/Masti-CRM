import { lostAccess } from '../lib/apiErrors'

/**
 * On a screen whose refresh failed after it had loaded (its tab came back into view, or a save asked for fresh data):
 * the screen stays as it was, unsaved work and all, and this line says it may be out of date. It goes once a refresh
 * works. When lostAccess (lib/apiErrors.ts) puts the error in the screen's place instead, this says nothing.
 */
export function RefreshFailed({
  query,
  what,
}: {
  query: { isRefetchError: boolean; isFetching: boolean; error: unknown; refetch: () => Promise<unknown> }
  /** "this case" */
  what: string
}) {
  if (!query.isRefetchError || lostAccess(query)) return null
  return (
    <div className="alert alert-warn" role="status">
      Couldn’t refresh {what} just now, so it may be out of date.{' '}
      <button type="button" className="btn-link" disabled={query.isFetching} onClick={() => void query.refetch()}>
        Try again
      </button>
    </div>
  )
}
