// Quem está sujo, em conflito ou salvando (spec §7.3). O TEXTO não mora aqui
// (`lib/edicao/buffers.ts`); isto é só o que a tela precisa desenhar.
//
// Sem `persist`, de propósito: buffer não sobrevive a fechar o app, e a saída
// avisa antes (ADR-164). Começa vazio por definição, então não hidrata no boot.

import { create } from "zustand"

export type AvisoDoArquivo = "conflito" | "sumiu"
export type ModoDoMarkdown = "previa" | "editor"

interface EdicaoState {
  /** Caminho canônico → sujo. */
  sujos: Record<string, true>
  avisos: Record<string, AvisoDoArquivo>
  /** Markdown: o modo por caminho da aba (`root\0chave`), na memória da sessão. */
  modo: Record<string, ModoDoMarkdown>
  salvando: Record<string, true>
  marcarSujo: (caminho: string, sujo: boolean) => void
  marcarAviso: (caminho: string, aviso: AvisoDoArquivo | null) => void
  setModo: (aba: string, modo: ModoDoMarkdown) => void
  marcarSalvando: (caminho: string, v: boolean) => void
  esquecer: (caminho: string) => void
}

function comOuSem<T>(mapa: Record<string, T>, chave: string, valor: T | null): Record<string, T> {
  if (valor === null) {
    const { [chave]: _, ...resto } = mapa
    return resto
  }
  return { ...mapa, [chave]: valor }
}

export const useEdicao = create<EdicaoState>((set, get) => ({
  sujos: {},
  avisos: {},
  modo: {},
  salvando: {},
  // Nenhuma ação chama `set` sem mudança de fato: a tira e a bandeja assinam.
  marcarSujo: (caminho, sujo) => {
    if (Boolean(get().sujos[caminho]) === sujo) return
    set((s) => ({ sujos: comOuSem(s.sujos, caminho, sujo ? true : null) }))
  },
  marcarAviso: (caminho, aviso) => {
    if ((get().avisos[caminho] ?? null) === aviso) return
    set((s) => ({ avisos: comOuSem(s.avisos, caminho, aviso) }))
  },
  setModo: (aba, modo) => {
    if ((get().modo[aba] ?? "previa") === modo) return
    set((s) => ({ modo: { ...s.modo, [aba]: modo } }))
  },
  marcarSalvando: (caminho, v) => {
    if (Boolean(get().salvando[caminho]) === v) return
    set((s) => ({ salvando: comOuSem(s.salvando, caminho, v ? true : null) }))
  },
  esquecer: (caminho) => {
    const s = get()
    if (!s.sujos[caminho] && !s.avisos[caminho] && !s.salvando[caminho]) return
    set({
      sujos: comOuSem(s.sujos, caminho, null),
      avisos: comOuSem(s.avisos, caminho, null),
      salvando: comOuSem(s.salvando, caminho, null),
    })
  },
}))
