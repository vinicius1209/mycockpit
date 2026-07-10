import { create } from "zustand"

export interface ConfirmReq {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** true = ação destrutiva (botão vermelho). */
  danger?: boolean
}

interface ConfirmState {
  req: ConfirmReq | null
  resolve: ((v: boolean) => void) | null
  open: (req: ConfirmReq) => Promise<boolean>
  close: (v: boolean) => void
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  req: null,
  resolve: null,
  open: (req) =>
    new Promise<boolean>((resolve) => {
      // se já havia um aberto, resolve o anterior como cancelado.
      get().resolve?.(false)
      set({ req, resolve })
    }),
  close: (v) => {
    get().resolve?.(v)
    set({ req: null, resolve: null })
  },
}))

/** Pede confirmação e resolve true/false. `await confirm({ title, danger })`. */
export function confirm(req: ConfirmReq): Promise<boolean> {
  return useConfirm.getState().open(req)
}
