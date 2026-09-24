// As abas de cada conversa (ADR-243, ADR-244). Guarda o conjunto; a vista (o
// que está na tela agora) continua sendo o `mainTab` de `store/app.ts`, e quem
// liga os dois à conversa ativa é `components/layout/abasNoPrincipal.ts`.
//
// Persiste de propósito, ao contrário do `mainTab`: o pedido foi "que fique
// aberto para eu voltar livremente entre um arquivo e outro", e o que se abre
// numa conversa é trabalho em andamento dela, não gesto da sessão.

import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  SEM_ABAS,
  abrirAba,
  fecharAbas,
  lembrarFechadas,
  moverAba,
  semNada,
  type AbasDaConversa,
} from "@/lib/abasDeArquivo"

/** Fração do cartão que o arquivo ao lado ocupa. */
export const LADO_MIN = 0.25
export const LADO_MAX = 0.7
/** Abaixo desta largura de cartão não há espaço honesto para dois. */
export const CARTAO_PARA_O_LADO = 900

interface AbasDeArquivoState {
  porConversa: Record<string, AbasDaConversa>
  /** Pilha do ⌘⇧T, por conversa. Não persiste: é memória da sessão. */
  fechadas: Record<string, string[]>
  /** Abas cujo arquivo não está mais no disco, `conversa\0caminho`. Quem
   *  descobre é o visualizador, ao ler; a tira só risca. */
  sumidos: Record<string, true>
  larguraDoLado: number
  /** O cartão tem largura para conversa e arquivo lado a lado? Quem mede é o
   *  host da conversa; abaixo do mínimo o arquivo ao lado vira aba comum. */
  ladoCabe: boolean
  /** Pedido para a árvore mostrar um arquivo ("Mostrar na árvore"). O selo
   *  deixa repetir o pedido para o mesmo caminho. */
  revelar: { caminho: string; selo: number } | null
  abrir: (convId: string, caminho: string) => void
  fechar: (convId: string, caminhos: readonly string[]) => void
  /** Tira da pilha a última fechada que ainda não voltou e a reabre. */
  reabrir: (convId: string) => string | null
  mover: (convId: string, de: number, para: number) => void
  porAoLado: (convId: string, caminho: string | null) => void
  /** Anota o que está à vista e a aba Navegador, para voltar a ela. */
  marcarVista: (convId: string, vista: Pick<AbasDaConversa, "vista" | "navegador">) => void
  marcarSumido: (convId: string, caminho: string, sumiu: boolean) => void
  setLarguraDoLado: (fracao: number) => void
  setLadoCabe: (cabe: boolean) => void
  pedirRevelar: (caminho: string) => void
  /** A conversa foi apagada: a tira, a pilha do ⌘⇧T e os riscados dela saem. */
  esquecer: (convId: string) => void
}

export const chaveDoSumido = (convId: string, caminho: string) => `${convId}\0${caminho}`

export function abasDo(s: Pick<AbasDeArquivoState, "porConversa">, convId: string | null): AbasDaConversa {
  return (convId && s.porConversa[convId]) || SEM_ABAS
}

export const useAbasDeArquivo = create<AbasDeArquivoState>()(
  persist(
    (set, get) => {
      // Nenhuma ação chama `set` sem mudança de fato: o `persist` grava no
      // disco a CADA `set`, mesmo o que devolve o estado igual, e o
      // `setLadoCabe` roda a cada evento de redimensionar.
      const trocar = (convId: string, f: (a: AbasDaConversa) => AbasDaConversa) => {
        const s = get()
        const antes = abasDo(s, convId)
        const depois = f(antes)
        if (depois === antes) return
        // Conversa sem nada além dela não ocupa lugar no disco.
        const { [convId]: _, ...resto } = s.porConversa
        set({ porConversa: semNada(depois) ? resto : { ...resto, [convId]: depois } })
      }
      return {
        porConversa: {},
        fechadas: {},
        sumidos: {},
        larguraDoLado: 0.45,
        ladoCabe: true,
        revelar: null,
        abrir: (convId, caminho) => trocar(convId, (a) => abrirAba(a, caminho)),
        fechar: (convId, caminhos) => {
          const abertos = caminhos.filter((c) => abasDo(get(), convId).abertas.includes(c))
          if (abertos.length === 0) return
          trocar(convId, (a) => fecharAbas(a, abertos))
          set((s) => ({
            fechadas: { ...s.fechadas, [convId]: lembrarFechadas(s.fechadas[convId] ?? [], abertos) },
          }))
        },
        reabrir: (convId) => {
          const pilha = [...(get().fechadas[convId] ?? [])]
          const abertas = abasDo(get(), convId).abertas
          let caminho: string | null = null
          while (caminho === null && pilha.length > 0) {
            const c = pilha.pop()!
            // a que já voltou por outro caminho (clique na árvore) é pulada
            if (!abertas.includes(c)) caminho = c
          }
          if (pilha.length !== (get().fechadas[convId]?.length ?? 0)) {
            set((s) => ({ fechadas: { ...s.fechadas, [convId]: pilha } }))
          }
          if (caminho === null) return null
          const reaberto = caminho
          trocar(convId, (a) => abrirAba(a, reaberto))
          return reaberto
        },
        mover: (convId, de, para) => trocar(convId, (a) => moverAba(a, de, para)),
        porAoLado: (convId, caminho) =>
          trocar(convId, (a) => {
            const comAba = caminho ? abrirAba(a, caminho) : a
            return comAba.aoLado === caminho ? comAba : { ...comAba, aoLado: caminho }
          }),
        marcarVista: (convId, { vista, navegador }) =>
          trocar(convId, (a) => (a.vista === vista && a.navegador === navegador ? a : { ...a, vista, navegador })),
        marcarSumido: (convId, caminho, sumiu) => {
          const k = chaveDoSumido(convId, caminho)
          if (Boolean(get().sumidos[k]) === sumiu) return
          const sumidos = { ...get().sumidos }
          if (sumiu) sumidos[k] = true
          else delete sumidos[k]
          set({ sumidos })
        },
        setLarguraDoLado: (fracao) => {
          const larguraDoLado = Math.min(LADO_MAX, Math.max(LADO_MIN, fracao))
          if (larguraDoLado !== get().larguraDoLado) set({ larguraDoLado })
        },
        pedirRevelar: (caminho) =>
          set((s) => ({ revelar: { caminho, selo: (s.revelar?.selo ?? 0) + 1 } })),
        esquecer: (convId) => {
          const s = get()
          const prefixo = `${convId}\0`
          const sumidos = Object.keys(s.sumidos).filter((k) => k.startsWith(prefixo))
          if (!(convId in s.porConversa) && !(convId in s.fechadas) && sumidos.length === 0) return
          const { [convId]: _a, ...porConversa } = s.porConversa
          const { [convId]: _f, ...fechadas } = s.fechadas
          const restantes = { ...s.sumidos }
          for (const k of sumidos) delete restantes[k]
          set({ porConversa, fechadas, sumidos: restantes })
        },
        setLadoCabe: (ladoCabe) => {
          if (ladoCabe !== get().ladoCabe) set({ ladoCabe })
        },
      }
    },
    {
      name: "frota.abasDaConversa",
      version: 1,
      partialize: (s) => ({ porConversa: s.porConversa, larguraDoLado: s.larguraDoLado }),
    },
  ),
)
