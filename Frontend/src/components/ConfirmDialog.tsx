/** "Are you sure?" for actions that change records. */
export function ConfirmDialog(props: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay overlay-center" onClick={props.onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2">{props.title}</h2>
        <p style={{ margin: 0 }}>{props.body}</p>
        {props.error && <div className="alert alert-bad">{props.error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={props.danger ? 'btn btn-dark' : 'btn btn-primary'}
            onClick={props.onConfirm}
            disabled={props.pending}
          >
            {props.pending ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
