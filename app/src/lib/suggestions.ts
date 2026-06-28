// Sprint 3 — motor PURO de sugestões dinâmicas (prompt + montagem de contexto +
// parsing). A orquestração (debounce + token de geração por convId) vive na
// store/chat; aqui ficam só funções sem efeito colateral.

import { extractJson } from "@/lib/format"
import type { ChatItem } from "@/store/chat"

// Janela de contexto enviada ao modelo de sugestões.
const CONTEXT_ITEMS = 6 // últimas N mensagens consideradas
const CHAR_CAP = 1200 // corte por mensagem de assistente
const TOTAL_CAP = 4000 // corte do contexto montado

/** Espera (ms) após o turno antes de gerar — debounce contra rajadas de prompts. */
export const SUGGEST_DEBOUNCE_MS = 700

export const SUGGEST_PROMPT = `Você sugere as PRÓXIMAS AÇÕES úteis para o usuário continuar este trabalho de desenvolvimento, com base na conversa abaixo.

Responda APENAS com um array JSON de até 3 strings curtas (máx 6 palavras cada), em pt-BR, acionáveis e específicas ao contexto. Nada além do JSON.
Exemplo: ["Rodar os testes do módulo","Fazer o commit pendente","Documentar a função nova"]`

export function buildContext(items: ChatItem[]): string {
  const lines: string[] = []
  for (const it of items.slice(-CONTEXT_ITEMS)) {
    if (it.kind === "user") lines.push(`Usuário: ${it.text}`)
    else if (it.kind === "text")
      lines.push(`Assistente: ${it.text.slice(0, CHAR_CAP)}`)
    else if (it.kind === "tool") lines.push(`(ferramenta: ${it.name})`)
  }
  return lines.join("\n").slice(-TOTAL_CAP)
}

export function parseSuggestions(raw: string): string[] {
  // resposta malformada / sem array → mantém os chips estáticos
  const arr = extractJson<unknown>(raw, "array")
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is string => typeof x === "string").slice(0, 3)
}
