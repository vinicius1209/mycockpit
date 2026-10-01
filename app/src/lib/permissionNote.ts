import type { PermissionMode } from "@/lib/types"

/** O que o modo de permissão REALMENTE faz no agent que roda a conversa.
 *
 *  Existe porque o seletor é do PROJETO e prometia um contrato uniforme que as
 *  CLIs não cumprem — só o Claude tem canal de aprovação em todos os modos, e o
 *  Antigravity não tem nenhum. Ver docs/agent-runner.md §7.
 *
 *  `tone`: "info" = comportamento esperado; "warn" = o modo NÃO vale como você
 *  espera nesse agent (a UI destaca). null = nada a dizer (contrato cumprido). */
export interface PermissionNote {
  text: string
  tone: "info" | "warn"
}

export function permissionNote(
  agent: string,
  mode: PermissionMode,
): PermissionNote | null {
  if (agent === "codex") {
    if (mode === "padrao") {
      return {
        text: "Codex pede aprovação de comandos por aqui (transporte app-server).",
        tone: "info",
      }
    }
    if (mode === "leitura") {
      return {
        text: "Codex confina em sandbox de SO (read-only): não pergunta, bloqueia.",
        tone: "info",
      }
    }
    return null
  }
  if (agent === "agy") {
    if (mode === "padrao") {
      return {
        text: "Antigravity IGNORA este modo: a CLI só roda com permissões liberadas (print mode não tem canal de aprovação). Use “Planejar primeiro” para revisar antes de executar.",
        tone: "warn",
      }
    }
    // "Só lê" no agy é garantido pelo confinamento no sandbox do sistema
    // (docs/sandbox-plan.md). O selo do ModeSelect reporta a disponibilidade local.
    return null
  }
  return null
}
