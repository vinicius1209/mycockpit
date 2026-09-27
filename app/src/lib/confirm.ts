import { create } from "zustand"

export interface ConfirmReq {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** true = ação destrutiva (botão vermelho). */
  danger?: boolean
  /** Terceira saída, à esquerda do rodapé e longe do Enter ("Não salvar").
   *  Só quem chama `perguntar` a usa; o `confirm` continua booleano. */
  alternativa?: string
}

/** As três respostas. Esc e o X do diálogo são "cancelar". */
export type RespostaDoConfirm = "confirmar" | "alternativa" | "cancelar"

interface ConfirmState {
  req: ConfirmReq | null
  resolve: ((v: RespostaDoConfirm) => void) | null
  open: (req: ConfirmReq) => Promise<RespostaDoConfirm>
  close: (v: boolean | RespostaDoConfirm) => void
}

const resposta = (v: boolean | RespostaDoConfirm): RespostaDoConfirm =>
  v === true ? "confirmar" : v === false ? "cancelar" : v

export const useConfirm = create<ConfirmState>((set, get) => ({
  req: null,
  resolve: null,
  open: (req) =>
    new Promise<RespostaDoConfirm>((resolve) => {
      // se já havia um aberto, resolve o anterior como cancelado.
      get().resolve?.("cancelar")
      set({ req, resolve })
    }),
  close: (v) => {
    get().resolve?.(resposta(v))
    set({ req: null, resolve: null })
  },
}))

/** Pede confirmação e resolve true/false. `await confirm({ title, danger })`. */
export async function confirm(req: ConfirmReq): Promise<boolean> {
  const { alternativa: _, ...semAlternativa } = req
  return (await useConfirm.getState().open(semAlternativa)) === "confirmar"
}

/** Pergunta com três saídas: confirmar, a alternativa, ou cancelar. */
export function perguntar(req: ConfirmReq & { alternativa: string }): Promise<RespostaDoConfirm> {
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
