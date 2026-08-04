// Lightbox ÚNICO do fio (browser-plan B1 + anexos do usuário): overlay que
// abre uma imagem em tamanho real, com navegação ←/→ quando o gesto trouxe
// várias (as capturas de UMA tool, os anexos de UMA mensagem). Store zustand
// pra não threadar callback por ToolLine/ToolGroup/MessageItem inteiros; o
// overlay monta UMA vez no App. Helpers PUROS (open/step) testáveis sem DOM.

import { create } from "zustand"

export interface LightboxImage {
  /** Path RELATIVO ao app_data_dir ("evidence/…" ou "attachments/…") — vem
   *  SEMPRE do item do fio (backend/anexo original), nunca de texto do modelo. */
  path: string
  /** Nome p/ alt/título e para o rodapé do overlay. */
  name: string
  /** Origem: define o loader (read_evidence × read_attachment) e o texto do
   *  placeholder quando o arquivo saiu do disco. */
  source: "evidencia" | "anexo"
  /** MIME do anexo original (evidência deriva da extensão). */
  mime?: string
}

export interface LightboxState {
  images: LightboxImage[]
  index: number
}

/** Abre o lightbox numa galeria. Galeria vazia → null (nada a mostrar);
 *  índice fora do intervalo é CLAMPADO (nunca abre em imagem inexistente). */
export function openLightbox(
  images: LightboxImage[],
  index: number,
): LightboxState | null {
  if (images.length === 0) return null
  return { images, index: Math.min(Math.max(index, 0), images.length - 1) }
}

/** Passo ←/→ com CLAMP nas bordas (sem wrap: chegar no fim e apertar → não
 *  teleporta pro começo, previsível como visualizador de imagem nativo). */
export function stepLightbox(
  state: LightboxState,
  delta: number,
): LightboxState {
  const index = Math.min(
    Math.max(state.index + delta, 0),
    state.images.length - 1,
  )
  return index === state.index ? state : { ...state, index }
}

/** Placeholder honesto por origem quando o arquivo não está mais no disco
 *  (mesma copy do chip de anexo expirado; evidência tem a sua). */
export function missingLabel(source: LightboxImage["source"]): string {
  return source === "anexo" ? "anexo expirado" : "evidência removida"
}

interface LightboxStore {
  current: LightboxState | null
  open: (images: LightboxImage[], index: number) => void
  step: (delta: number) => void
  close: () => void
}

export const useLightbox = create<LightboxStore>((set, get) => ({
  current: null,
  open: (images, index) => set({ current: openLightbox(images, index) }),
  step: (delta) => {
    const cur = get().current
    if (cur) set({ current: stepLightbox(cur, delta) })
  },
  close: () => set({ current: null }),
}))
