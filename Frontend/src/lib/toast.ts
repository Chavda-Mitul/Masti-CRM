import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'ok' | 'warn' | 'bad'

export interface ToastInput {
  message: string
  tone?: ToastTone
}

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null)

/** Shows a short message in the corner of the screen. Needs <ToastProvider> above (main.tsx). */
export function useToast() {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast must be used inside <ToastProvider>')
  return show
}
