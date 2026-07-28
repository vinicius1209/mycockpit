// DOUTRINA DO PROJETO — `.mycockpit/instructions.md`, o arquivo de instrução do
// PRÓPRIO app. Existe porque instrução era a única camada do contexto que não
// era agnóstica: `CLAUDE.md` só o Claude Code lê, `AGENTS.md` só o Codex, o agy
// não lê nenhum dos dois, e o app NUNCA injetou nenhum deles — só os inventaria
// no painel. Resultado real medido neste repo: 0 de 2 arquivos presentes, com
// 4 das 5 entregas feitas pelo codex, que lê exatamente o AGENTS.md ausente.
//
// A doutrina vale nos três porque quem injeta é o app, pelo mesmo cano da
// persona (presets.ts) e das lições (learning.ts): um BLOCO prependido ao
// prompt. Nada de bolha visível no fio.
//
// Isso revisa o ADR-002 ("reexplicar contexto não é a dor — CLAUDE.md/AGENTS.md
// já cobrem"), que era verdade quando o app era só Claude Code (ADR-005).

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

/** Caminho relativo, usado na cópia da UI e no rótulo do bloco. */
export const DOCTRINE_PATH = ".mycockpit/instructions.md"

export interface Doctrine {
  exists: boolean
  content: string
  bytes: number
}

const VAZIA: Doctrine = { exists: false, content: "", bytes: 0 }

/** Lê a doutrina do projeto. Fora do Tauri (ou em falha) devolve "não existe" —
 *  doutrina é contexto opcional, nunca motivo pra travar um envio. */
export async function readDoctrine(projectPath: string): Promise<Doctrine> {
  if (!isTauri()) return VAZIA
  try {
    return await invoke<Doctrine>("read_project_doctrine", { path: projectPath })
  } catch {
    return VAZIA
  }
}

/** Grava a doutrina. AQUI o erro sobe: salvar é ação explícita do usuário e
 *  falhar em silêncio faria ele achar que escreveu regra que não existe. */
export async function writeDoctrine(
  projectPath: string,
  content: string,
): Promise<void> {
  await invoke("write_project_doctrine", { path: projectPath, content })
}

/** Lê INTEGRALMENTE um arquivo de instrução de CLI (CLAUDE.md/AGENTS.md) pra
 *  semear a 1ª doutrina. Não usa o conteúdo do inventário do painel de
 *  propósito: aquele vem truncado em 8k pra preview, e semear regra cortada
 *  perderia texto em silêncio. Erro sobe — semear é ação explícita. */
export async function readDoctrineSeed(
  projectPath: string,
  name: string,
): Promise<string> {
  return invoke<string>("read_doctrine_seed", { path: projectPath, name })
}

/** Teto do bloco no prompt. Doutrina é contexto de TODO turno inicial — texto
 *  longo demais roubaria janela do trabalho. Acima disso o bloco corta e APONTA
 *  o arquivo: o agent tem acesso ao disco e puxa o resto se precisar. */
export const DOCTRINE_MAX_CHARS = 12000

/** Monta o bloco de doutrina prependido ao prompt. null = nada a injetar
 *  (arquivo ausente ou em branco) — puro e testável. */
export function buildDoctrineBlock(content: string): string | null {
  const texto = content.trim()
  if (!texto) return null
  const cortou = texto.length > DOCTRINE_MAX_CHARS
  const corpo = cortou ? texto.slice(0, DOCTRINE_MAX_CHARS) : texto
  const lines = [
    `<doutrina fonte="${DOCTRINE_PATH}">`,
    "Estas são as regras deste projeto, definidas pelo humano no MyCockpit. Valem do primeiro ao último turno e têm precedência sobre hábitos gerais seus.",
    "",
    corpo,
  ]
  if (cortou) {
    lines.push(
      "",
      `[cortado em ${DOCTRINE_MAX_CHARS} caracteres — leia ${DOCTRINE_PATH} se precisar do texto completo]`,
    )
  }
  lines.push("</doutrina>")
  return lines.join("\n")
}

/** Agents que NÃO têm resume nativo: cada turno é sessão nova, então a doutrina
 *  precisa voltar toda vez. O prefixo do prompt não é guardado nos itens da
 *  conversa, logo o recap que o app monta pro agy não a carrega de volta. */
const SEM_RESUME = new Set(["agy"])

/** A doutrina entra neste envio?
 *  - `locked` = a conversa já tem itens (mesmo sinal do shouldInjectPersona);
 *  - `hasReply` = já houve resposta de assistant, ou seja o 1º prompt CHEGOU.
 *
 *  Em claude/codex vai só no 1º turno — o resume nativo carrega dali em diante,
 *  e repetir a cada turno seria pagar a mesma janela várias vezes. A exceção do
 *  `!hasReply` é a mesma da persona: 1º run que morreu antes de qualquer
 *  resposta (binário ausente) não pode deixar a doutrina perdida pra sempre. */
export function shouldInjectDoctrine(
  agent: string,
  locked: boolean,
  hasReply: boolean,
): boolean {
  if (SEM_RESUME.has(agent)) return true
  return !locked || !hasReply
}
