import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches a crash while rendering, so one broken page doesn't blank the whole app.
 * Change `resetKey` (e.g. the path) to clear the error when the user moves on.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; resetKey?: string }> {
  state: { error: Error | null; resetKey?: string } = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; resetKey?: string }) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card pad" style={{ maxWidth: 480 }}>
        <h1 className="h2">Something went wrong on this page</h1>
        <p className="muted">Your saved work is safe. Reload the page, or go to another one from the menu.</p>
        <button className="btn btn-sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
