import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'warning'
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (message, tone = 'info') => {
    const id = ++seq
    set({ toasts: [...get().toasts, { id, message, tone }] })
    window.setTimeout(() => get().dismiss(id), 4200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (message: string, tone?: Toast['tone']) => useToasts.getState().push(message, tone)
