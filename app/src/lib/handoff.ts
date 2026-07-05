// Revezamento: preâmbulo pra CONTINUAR a conversa em OUTRO agent (limite/erro
// do atual). Determinístico de propósito (sem IA resumindo no meio): achata o
// transcript com corte TAIL-BIASED, o fim da conversa é o que importa; o estado
// dos arquivos o novo agent herda do disco (mesmo cwd/worktree).

import type { ChatItem } from "@/store/chat"

/** Orçamento do preâmbulo (~9k tokens), folga pro pedido pendente + resposta. */
const BUDGET_CHARS = 36_000

export function buildHandoff(items: ChatItem[]): string {
  const turns: string[] = []
  for (const it of items) {
    if (it.kind === "user") turns.push(`Usuário: ${it.text}`)
    else if (it.kind === "text") turns.push(`Assistente: ${it.text}`)
  }
  // corte tail-biased: acumula do FIM até estourar o orçamento.
  const kept: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    used += turns[i].length + 2
    if (used > BUDGET_CHARS && kept.length > 0) {
      kept.unshift("[… trocas anteriores omitidas …]")
      break
    }
    kept.unshift(turns[i])
  }
  return [
    "Você está CONTINUANDO uma conversa que começou com outro agent de código NESTE MESMO diretório.",
    "Os arquivos no disco já refletem o trabalho feito até aqui; não refaça o que já existe.",
    "",
    "Contexto da conversa até aqui:",
    "",
    kept.join("\n\n"),
  ].join("\n")
}
