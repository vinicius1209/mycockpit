// Estado do painel Bastidores (ADR-200): quais vistas estão abertas em cada
// conversa e a saída ao vivo que chega pelo stream do turno.
//
// A saída NÃO mora no `useChat`: ela chega linha a linha e re-renderizaria o
// fio inteiro, além de inchar o banco. Aqui ela tem teto (`LINHAS_MAX`), não
// persiste, e chega agrupada: vários deltas no mesmo intervalo viram um `set`.

import { create } from "zustand"
import { SAIDA_VAZIA, somarTexto, type SaidaViva } from "@/lib/bastidores"

/** Mosaico: uma vista, duas empilhadas, ou uma em cima e duas embaixo. */
export const VISTAS_MAX = 3
const INTERVALO_DE_ENTREGA_MS = 60

export interface VistaAberta {
  convId: string
  itemId: string
}

interface BastidoresStore {
  vistas: VistaAberta[]
  /** Índice (entre as vistas da conversa) que recebe o próximo "abrir". */
  foco: number
  saidas: Record<string, SaidaViva>
  /** Vistas lado a lado (empilhadas no painel) em vez de uma aba por vez. */
  dividido: boolean
  /** Com vistas abertas, a pessoa voltou para a lista sem fechar nenhuma. */
  indiceVisivel: boolean
  /** Abre na vista em foco (ou a primeira). Se já está aberta, só foca. */
  abrir: (convId: string, itemId: string) => void
  /** Soma uma vista ao mosaico; cheio, substitui a mais antiga fora de foco. */
  fixar: (convId: string, itemId: string) => void
  fechar: (convId: string, itemId: string) => void
  fecharTodas: (convId: string) => void
  focar: (indice: number) => void
  alternarDivisao: () => void
  verIndice: (visivel: boolean) => void
  anexarSaida: (convId: string, toolId: string, texto: string) => void
}

export const chaveDaSaida = (convId: string, toolId: string) => `${convId}\u0000${toolId}`

export function vistasDa(vistas: VistaAberta[], convId: string | null): VistaAberta[] {
  return convId ? vistas.filter((v) => v.convId === convId) : []
}

/** Regras puras do mosaico (testáveis sem store). */
export function abrirVista(vistas: VistaAberta[], foco: number, alvo: VistaAberta): { vistas: VistaAberta[]; foco: number } {
  const daConversa = vistasDa(vistas, alvo.convId)
  const ja = daConversa.findIndex((v) => v.itemId === alvo.itemId)
  if (ja >= 0) return { vistas, foco: ja }
  if (!daConversa.length) return { vistas: [...vistas, alvo], foco: 0 }
  const i = Math.min(Math.max(foco, 0), daConversa.length - 1)
  const substituida = daConversa[i]
  return { vistas: vistas.map((v) => (v === substituida ? alvo : v)), foco: i }
}

export function fixarVista(vistas: VistaAberta[], foco: number, alvo: VistaAberta): { vistas: VistaAberta[]; foco: number } {
  const daConversa = vistasDa(vistas, alvo.convId)
  const ja = daConversa.findIndex((v) => v.itemId === alvo.itemId)
  if (ja >= 0) return { vistas, foco: ja }
  if (daConversa.length < VISTAS_MAX) {
    return { vistas: [...vistas, alvo], foco: daConversa.length }
  }
  const emFoco = daConversa[Math.min(foco, daConversa.length - 1)]
  const sai = daConversa.find((v) => v !== emFoco) ?? daConversa[0]
  const restantes = vistas.filter((v) => v !== sai)
  return { vistas: [...restantes, alvo], foco: VISTAS_MAX - 1 }
}

const pendentes = new Map<string, string>()
let entrega: ReturnType<typeof setTimeout> | null = null

export const useBastidores = create<BastidoresStore>((set, get) => ({
  vistas: [],
  foco: 0,
  saidas: {},
  dividido: false,
  indiceVisivel: false,
  abrir: (convId, itemId) =>
    set((s) => ({ ...abrirVista(s.vistas, s.foco, { convId, itemId }), indiceVisivel: false })),
  fixar: (convId, itemId) =>
    set((s) => ({ ...fixarVista(s.vistas, s.foco, { convId, itemId }), indiceVisivel: false })),
  fechar: (convId, itemId) =>
    set((s) => {
      const vistas = s.vistas.filter((v) => !(v.convId === convId && v.itemId === itemId))
      return { vistas, foco: Math.max(0, Math.min(s.foco, vistasDa(vistas, convId).length - 1)) }
    }),
  fecharTodas: (convId) =>
    set((s) => ({ vistas: s.vistas.filter((v) => v.convId !== convId), foco: 0, indiceVisivel: false })),
  focar: (indice) => set({ foco: Math.max(0, indice) }),
  alternarDivisao: () => set((s) => ({ dividido: !s.dividido })),
  verIndice: (indiceVisivel) => set({ indiceVisivel }),
  anexarSaida: (convId, toolId, texto) => {
    const chave = chaveDaSaida(convId, toolId)
    pendentes.set(chave, (pendentes.get(chave) ?? "") + texto)
    if (entrega) return
    entrega = setTimeout(() => {
      entrega = null
      const lote = new Map(pendentes)
      pendentes.clear()
      const saidas = { ...get().saidas }
      for (const [k, t] of lote) saidas[k] = somarTexto(saidas[k] ?? SAIDA_VAZIA, t)
      set({ saidas })
    }, INTERVALO_DE_ENTREGA_MS)
  },
}))

// Loop visual em dev no browser (não entra no build), como o `__mcStores`.
if (import.meta.env.DEV && typeof window !== "undefined") {
  ;(window as unknown as Record<string, unknown>).__mcBastidores = useBastidores
}

