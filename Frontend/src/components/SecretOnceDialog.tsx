import { useState, type ReactNode } from 'react'

/**
 * Shows a secret (a temporary password, an API key) that the server returns only once. It isn't stored anywhere:
 * it lives in the caller's state until "Done". Clicking outside doesn't close it, so it can't be lost by accident.
 */
export function SecretOnceDialog({
  title,
  children,
  secret,
  onClose,
}: {
  title: string
  /** What to do with it; say it's shown only once. */
  children: ReactNode
  secret: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(secret).then(() => setCopied(true))
  }
  // Long secrets (API keys) get a smaller font and wrap, short ones (passwords) stay big.
  const long = secret.length > 24
  return (
    <div className="overlay overlay-center">
      <div className={long ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true">
        <h2 className="h2">{title}</h2>
        <div style={{ margin: 0 }}>{children}</div>
        <div className={`secret mono${long ? ' secret-long' : ''}`}>{secret}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
