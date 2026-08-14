// TRAVAMENTO MACRO que não é silêncio (R11 do docs/mocks/missao-README.md).
//
// O paliativo do motor calado (lib/missionQuiet) detecta QUIETUDE. Um agent
// rodando o mesmo teste oito vezes nunca fica quieto e mesmo assim não anda, e
// num plano de 12 fases com cinco dependentes o custo de descobrir tarde é de
// outra ordem. Era o argumento mais forte CONTRA a direção A, e é o buraco que
// este módulo fecha.
//
// A heurística, decidível, com DOIS fatores e nunca um só:
//
//   mesmo comando ≥ 4 vezes seguidas
//   E nenhum arquivo alterado no worktree desde a primeira delas
//
// O primeiro fator sozinho é ruidoso (teste que legitimamente re-roda vira
// alarme falso). O segundo é o dado que faltava, e agora existe: o comando Rust
// `git_worktree_pulse` devolve uma impressão digital barata da working tree, e
// quem chama só chama DEPOIS que o primeiro fator disparou — não há polling de
// fundo. SEM impressão digital (fora de repo, git ausente, leitura falhou) o
// aviso NÃO aparece: "não sei" nunca vira "não mudou".
//
// O texto relata o que se OBSERVOU, não o diagnóstico. Quem conclui "travou" é
// o humano; o app não aborta nada sozinho, e o gesto oferecido é o de sempre.
//
// Puro: `now` sempre injetado.

import { presentTool } from "@/lib/toolview"
import type { ChatItem } from "@/store/chat"

/** Repetições seguidas a partir das quais vale perguntar ao worktree. */
export const REPEAT_MIN = 4

/** Comando cru de uma ação, quando ela É um comando. null = não é. */
function commandOf(item: Extract<ChatItem, { kind: "tool" }>): string | null {
  const i =
    item.input && typeof item.input === "object"
      ? (item.input as Record<string, unknown>)
      : {}
  const cmd = i.command ?? i.cmd
  if (typeof cmd !== "string" || !cmd.trim()) return null
  return cmd.trim()
}

export interface RepeatCandidate {
  /** O comando repetido, cru (é ele que o humano precisa reconhecer). */
  command: string
  /** Quantas vezes SEGUIDAS, contando a corrente. */
  count: number
  /** Instante da PRIMEIRA das repetições (o marco contra o qual o worktree é
   *  comparado). null = os itens não têm carimbo, e aí não há janela a citar. */
  firstAt: number | null
  /** Instante da última. */
  lastAt: number | null
  /** Alguma das repetições falhou (a evidência mais forte). */
  anyFailed: boolean
}

/**
 * O primeiro fator: o mesmo comando, N vezes SEGUIDAS no fim da fase.
 *
 * "Seguidas" é literal: uma leitura no meio quebra a sequência. É o que separa
 * "está batendo a cabeça" de "roda o teste depois de cada edição".
 */
export function repeatCandidate(
  items: ChatItem[] | undefined,
  min: number = REPEAT_MIN,
): RepeatCandidate | null {
  const tools = (items ?? []).filter(
    (i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool",
  )
  if (tools.length < min) return null
  const ultimo = commandOf(tools[tools.length - 1])
  if (!ultimo) return null
  let count = 0
  let firstAt: number | null = null
  let lastAt: number | null = null
  let anyFailed = false
  for (let i = tools.length - 1; i >= 0; i--) {
    if (commandOf(tools[i]) !== ultimo) break
    count++
    const t = tools[i]
    if (t.result && !t.result.ok) anyFailed = true
    if (t.ts != null) firstAt = t.ts
    if (lastAt == null) lastAt = t.activityAt ?? t.ts ?? null
  }
  if (count < min) return null
  return { command: ultimo, count, firstAt, lastAt, anyFailed }
}

export interface RepeatWarning {
  /** Título curto do bloco. */
  headline: string
  /** O que se OBSERVOU, sem diagnóstico. */
  observed: string
  /** O comando, cru, pra render em mono. */
  command: string
  count: number
}

/** Duração humana curta ("6 min", "45s"). */
function janela(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s}s`
  return `${Math.round(s / 60)} min`
}

/**
 * Os DOIS fatores juntos. null sempre que faltar um deles, e faltar inclui
 * "não consegui olhar o worktree".
 *
 * @param worktreeChangedAt última vez que a impressão digital do worktree MUDOU
 *        (epoch ms). null = nunca foi amostrado, ou a amostra não veio: sem
 *        isso o aviso não aparece, porque um fator só é alarme falso.
 */
export function repeatWarning(
  candidate: RepeatCandidate | null,
  worktreeChangedAt: number | null,
  now: number,
): RepeatWarning | null {
  if (!candidate) return null
  if (worktreeChangedAt == null) return null
  if (candidate.firstAt == null) return null
  // escreveu DEPOIS da primeira repetição ⇒ está andando, não repetindo.
  if (worktreeChangedAt > candidate.firstAt) return null
  const dur = janela(Math.max(0, now - candidate.firstAt))
  return {
    headline: `o mesmo comando, ${candidate.count} vezes`,
    observed:
      `Rodou o mesmo comando ${candidate.count} vezes nos últimos ${dur}, ` +
      "e nenhum arquivo mudou no worktree desde a primeira.",
    command: candidate.command,
    count: candidate.count,
  }
}

/** Rótulo humano do comando repetido, pra quem quiser uma linha só (o mesmo
 *  vocabulário do fio; o comando cru continua visível ao lado). */
export function repeatCommandLabel(command: string): string {
  return presentTool("Bash", { command }).label
}
