/**
 * Núcleo PURO do agrupamento da gaveta (Frente N, stories N2 e N3).
 *
 * Duas perguntas, e as duas são de dado, não de pixel:
 *
 *   · **quando a lista existe?** Com duas notas a coluna da esquerda é moldura
 *     vazia; o desenho degrada pra folha solta (variante B do mock). O limiar é
 *     constante nomeada e testada, nunca número solto no JSX.
 *   · **em que seção cada nota cai?** ESCOPO por fora ("Desta conversa" /
 *     "Deste projeto" / "De todos os projetos") e TEMPO por dentro (Hoje / Anteriores).
 *
 * O escopo vem por fora porque é a mesma regra que Configurações já aplica:
 * escopo explícito, nunca herdado em silêncio. Uma nota global e uma nota da
 * conversa lado a lado sem rótulo é a UI escondendo onde a coisa mora.
 *
 * INVARIANTE que o teste guarda: a soma das notas dos grupos é EXATAMENTE a
 * lista que entrou, sem perder nem duplicar. Agrupamento que come nota é a pior
 * classe de bug de lista, porque não dá erro: a nota só some.
 */

import type { StickyNote } from "@/components/notes/types"

/**
 * A partir de quantas notas a COLUNA da lista aparece.
 *
 * Abaixo disso a gaveta é só a folha, com navegação `‹ 1/2 ›` — é o desenho B
 * do mock, e é honesto: painel de 1 nota tem tamanho de 1 nota. O limiar conta
 * as notas visíveis do ESCOPO (conversa + projeto), sem o filtro por agent: o
 * filtro mora DENTRO da lista, e deixar ele decidir se a lista existe faria a
 * caixa de busca sumir junto com o resultado dela.
 */
export const LIMIAR_DA_LISTA = 3

/** @param total notas visíveis no escopo, antes de busca e de filtro. */
export function mostraLista(total: number): boolean {
  return total >= LIMIAR_DA_LISTA
}

export type EscopoDeNota = "conversa" | "projeto" | "todos"
export type FaixaDeTempo = "hoje" | "anteriores"

export const ROTULO_DE_ESCOPO: Record<EscopoDeNota, string> = {
  conversa: "Desta conversa",
  projeto: "Deste projeto",
  // O terceiro escopo não é enfeite: é o que as notas gravadas antes do
  // `projectId` SÃO. Elas apareciam em todo projeto sob o rótulo "Do projeto",
  // que era falso em todos menos um. Agora se chamam pelo que são.
  todos: "De todos os projetos",
}

export const ROTULO_DE_FAIXA: Record<FaixaDeTempo, string> = {
  hoje: "Hoje",
  anteriores: "Anteriores",
}

/**
 * Onde a nota MORA.
 *
 * `selectNotesFor` já garantiu que nota com `convId` nesta lista é desta
 * conversa (ele filtra por "global do projeto OU desta conversa"). A comparação
 * com `convId` aqui é cinto de segurança pro rótulo nunca mentir se a lista
 * chegar por outro caminho.
 */
export function escopoDaNota(
  nota: Pick<StickyNote, "convId" | "projectId">,
  convId?: string,
): EscopoDeNota {
  if (nota.convId != null && nota.convId === convId) return "conversa"
  return nota.projectId != null ? "projeto" : "todos"
}

/** Mesmo dia do calendário LOCAL (não "menos de 24h": nota de ontem às 23h não
 *  é "hoje" às 8h da manhã, por mais que caibam 9 horas entre as duas). */
export function mesmoDia(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** Só tempo. O pin saiu (ADR-117) e com ele a faixa que existia só pra ele. */
export function faixaDaNota(
  nota: Pick<StickyNote, "updatedAt">,
  agora: number,
): FaixaDeTempo {
  return mesmoDia(nota.updatedAt, agora) ? "hoje" : "anteriores"
}

export interface GrupoDeNotas {
  /** Chave estável de render (`conversa:hoje`). */
  id: string
  escopo: EscopoDeNota
  faixa: FaixaDeTempo
  rotuloEscopo: string
  rotuloFaixa: string
  /** `true` no PRIMEIRO grupo de cada escopo: é ele que escreve o cabeçalho de
   *  escopo, e os irmãos abaixo só escrevem a faixa de tempo. */
  abreEscopo: boolean
  notas: StickyNote[]
}

// Do mais estreito ao mais largo: a nota daqui vem antes da que vale em todo
// lugar.
const ORDEM_ESCOPO: EscopoDeNota[] = ["conversa", "projeto", "todos"]
const ORDEM_FAIXA: FaixaDeTempo[] = ["hoje", "anteriores"]

/**
 * Agrupa a lista já filtrada e já ordenada por `selectNotesFor`.
 *
 * A ordem DENTRO de cada grupo é a que entrou (fixadas primeiro, depois
 * `updatedAt` desc) — este núcleo não reordena nada, só reparte. Grupo vazio
 * não é devolvido: cabeçalho de seção sem nada embaixo é ruído.
 *
 * @param agora relógio injetável (o corte "Hoje" é função do relógio, e teste
 *              que depende de `Date.now()` real vira flake na virada do dia).
 */
export function agruparNotas(
  notas: readonly StickyNote[],
  { agora, convId }: { agora: number; convId?: string },
): GrupoDeNotas[] {
  const baldes = new Map<string, StickyNote[]>()
  for (const nota of notas) {
    const chave = `${escopoDaNota(nota, convId)}:${faixaDaNota(nota, agora)}`
    const balde = baldes.get(chave)
    if (balde) balde.push(nota)
    else baldes.set(chave, [nota])
  }

  const grupos: GrupoDeNotas[] = []
  for (const escopo of ORDEM_ESCOPO) {
    let primeiroDoEscopo = true
    for (const faixa of ORDEM_FAIXA) {
      const notasDoGrupo = baldes.get(`${escopo}:${faixa}`)
      if (!notasDoGrupo) continue
      grupos.push({
        id: `${escopo}:${faixa}`,
        escopo,
        faixa,
        rotuloEscopo: ROTULO_DE_ESCOPO[escopo],
        rotuloFaixa: ROTULO_DE_FAIXA[faixa],
        abreEscopo: primeiroDoEscopo,
        notas: notasDoGrupo,
      })
      primeiroDoEscopo = false
    }
  }
  return grupos
}

/**
 * Carimbo curto da linha da lista: "agora", "12min", "8h", "ontem", "26/08".
 *
 * Não é o `fmtAgo` compartilhado de propósito, e a razão é a largura: a coluna
 * tem 214px e divide a segunda linha com o preview. "há 8 h" gasta o dobro de
 * "8h" pra dizer o mesmo, e acima de um dia o que interessa não é a idade e sim
 * a DATA ("ontem", "26/08") — que o `fmtAgo` não sabe dizer.
 */
export function carimboCurto(ts: number, agora: number): string {
  const ms = agora - ts
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "agora"
  if (min < 60) return `${min}min`
  if (mesmoDia(ts, agora)) return `${Math.floor(min / 60)}h`
  if (mesmoDia(ts, agora - 86_400_000)) return "ontem"
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
}
