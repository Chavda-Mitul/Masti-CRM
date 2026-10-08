import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastInput, type ToastTone } from '../lib/toast'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

const SHOW_MS = 7000

/** Holds the toasts shown by useToast(). Mounted once, in main.tsx. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const show = useCallback(
    ({ message, tone = 'info' }: ToastInput) => {
      const id = nextId.current++
      setToasts((all) => [...all, { id, message, tone }])
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        dismiss(id)
      }, SHOW_MS)
      timers.current.add(timer)
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            <button className="btn-link" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
