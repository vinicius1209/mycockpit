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

/**
 * Enter no diálogo de confirmação deve confirmar?
 *
 * Puro porque a regra tem uma sutileza que só morde em uso real: quando o foco
 * já está num BOTÃO (chegou via Tab), quem responde ao Enter é o próprio botão.
 * Se o container também respondesse, Enter em cima de "Cancelar" confirmaria —
 * o pior desfecho possível num diálogo destrutivo. Por isso a regra exige que o
 * evento tenha nascido no PRÓPRIO container.
 *
 * Existe porque o `autoFocus` saiu do botão de confirmar (o anel âmbar parecia
 * seleção antes de qualquer gesto). Tirar o anel não era motivo pra tirar o
 * gesto: Enter fechava o diálogo desde sempre.
 */
export function enterConfirma(e: {
  key: string
  target: unknown
  currentTarget: unknown
}): boolean {
  return e.key === "Enter" && e.target === e.currentTarget
}
