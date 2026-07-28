// Memória PLENA da conversa, consultável por QUALQUER agent via arquivo (pull):
// renderTranscript gera o markdown completo (sem truncar) que o backend grava em
// .mycockpit/context/<convId>.md (export_conv_context, escrita atômica +
// gitignore). O preâmbulo/recap (push) segue vindo do serializeContext; aqui
// mora o transcript pleno + o ponteiro + a montagem do prompt pro agy (sem
// resume, todo turno é sessão fresca).

import { invoke } from "@tauri-apps/api/core"
import { agentDef } from "@/lib/agents"
import { serializeContext, toolDigest } from "@/lib/fusion"
import type { ChatItem } from "@/store/chat"

export interface TranscriptMeta {
  /** Agent da conversa (id do registry; vira o rótulo longo no cabeçalho). */
  agent?: string | null
  /** Data do export (injetável p/ teste determinístico). Default: agora. */
  date?: Date
}

/** Markdown completo e legível da conversa — a memória plena. PURO e SEM
 *  truncar os textos; tool calls entram em lista com input resumido (digest). */
export function renderTranscript(
  items: ChatItem[],
  meta: TranscriptMeta = {},
): string {
  const date = meta.date ?? new Date()
  const agent = meta.agent ? (agentDef(meta.agent)?.label ?? meta.agent) : null
  const lines: string[] = ["# Memória da conversa", ""]
  lines.push(`- Data: ${date.toISOString()}`)
  if (agent) lines.push(`- Agent: ${agent}`)
  for (const it of items) {
    switch (it.kind) {
      case "user":
        lines.push("", "## Usuário", "", it.text)
        break
      case "text":
        lines.push("", "## Assistente", "", it.text)
        break
      case "tool": {
        const digest = toolDigest(it.input)
        const fail = it.result && !it.result.ok ? " (falhou)" : ""
        lines.push(`- tool \`${it.name}\`${digest ? ` — ${digest}` : ""}${fail}`)
        break
      }
      case "error":
        lines.push("", `> Erro: ${it.message}`)
        break
      case "cancelled":
        lines.push("", "> Turno cancelado pelo usuário.")
        break
      case "notice":
        lines.push("", `> Nota: ${it.message}`)
        break
      case "limit":
        lines.push("", `> Limite de uso atingido: ${it.message}`)
        break
      case "advice":
        // Parecer de conselheiro (só leitura) — entra na memória como um bloco
        // atribuído à persona, não como turno do executor.
        lines.push(
          "",
          `## Parecer de ${it.personaName} (conselheiro, só leitura)`,
          "",
          it.text,
        )
        break
      // result: o texto final já veio no item "text"; não duplica.
      default:
        break
    }
  }
  return `${lines.join("\n")}\n`
}

/** Linha-ponteiro pro arquivo de memória (mesma frase no Fusion e no agy). */
export function memoryPointerLine(relPath: string): string {
  return `Memória completa desta conversa (leia se precisar de mais contexto): ${relPath}`
}

/** Orçamento do recap injetado no prompt do agy (menor que o do Fusion). */
export const AGY_RECAP_BUDGET = 4_000

/** Prompt de um turno do agy (sem resume): recap curto da conversa + ponteiro
 *  pro arquivo de memória plena (se exportou) + o pedido. Puro e testável. */
export function buildMemoryPrompt(
  items: ChatItem[],
  pointer: string | null,
  prompt: string,
): string {
  const parts = [serializeContext(items, AGY_RECAP_BUDGET)]
  if (pointer) parts.push(memoryPointerLine(pointer))
  return `${parts.join("\n\n")}\n\n---\n\n${prompt}`
}

/** Orçamento do recap do fallback de resume (claude/codex): curto — o motor
 *  SÓ prepende ao prompt se o resume nativo falhar no restart. */
export const RESUME_FALLBACK_BUDGET = 3_000

/** Frase de continuidade do fallback (fecha o bloco de memória). */
export const RESUME_FALLBACK_NOTE =
  "A sessão nativa desta conversa expirou; o contexto acima é a memória do Frota — continue a conversa normalmente."

/** Decide se o envio leva `memoryFallback` (MyCockpit resume): só quando o run
 *  VAI tentar resume nativo — conversa com histórico E sessionId. agy fica de
 *  fora (não tem resume; a memória dele já vai em TODO turno via
 *  buildMemoryPrompt). Conversa nova (sem itens ou sem sessão) não tem o que
 *  retomar. PURO e testável. */
export function shouldAttachResumeFallback(
  agent: string,
  items: ChatItem[],
  sessionId: string | null,
): boolean {
  return agent !== "agy" && items.length > 0 && sessionId != null
}

/** Texto do `memoryFallback` (claude/codex): recap curto (~3k) + ponteiro pro
 *  arquivo de memória plena (se exportou) + a linha de continuidade. O MOTOR
 *  só usa se o resume nativo falhar (prepende ao prompt no restart). PURO. */
export function buildResumeFallback(
  items: ChatItem[],
  pointer: string | null,
): string {
  const parts = [serializeContext(items, RESUME_FALLBACK_BUDGET)]
  if (pointer) parts.push(memoryPointerLine(pointer))
  parts.push(RESUME_FALLBACK_NOTE)
  return parts.join("\n\n")
}

/** Grava a memória plena em .mycockpit/context/<convId>.md (backend: escrita
 *  atômica + gitignore) e devolve o caminho RELATIVO a `projectPath`. Pode
 *  lançar (convId inválido, disco) — os callers tratam como best-effort. */
export async function exportConvContext(
  projectPath: string,
  convId: string,
  markdown: string,
): Promise<string> {
  return invoke<string>("export_conv_context", { projectPath, convId, markdown })
}
