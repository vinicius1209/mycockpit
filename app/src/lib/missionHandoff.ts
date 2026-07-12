// BLACKBOARD tipado do Mission (docs/mission-mode.md §5, correção de rumo do
// handoff). Cada fase escreve um JSON em `.mission/<i>-<persona>.json` no
// worktree com a INTENÇÃO/decisões/pendências — NÃO o código (os arquivos já
// estão no cwd; o próximo agente lê o disco). O app lê esses JSONs entre fases
// e injeta no prompt seguinte. Se um agente não emitir o JSON, o store cai no
// fallback do transcript (buildHandoff). Princípio confirmado pela pesquisa de
// campo (Anthropic research-system, Claude Code sub-agents, Factory) e pela
// skill `handoff` do Matt Pocock: "referencie por path, não duplique diffs".

import { invoke } from "@tauri-apps/api/core"
import type { GitDiff } from "@/lib/git"
import type { MissionPersona } from "@/lib/missionTypes"

export const MISSION_DIR = ".mission"

/** Diretório do worktree onde o agente escreve o handoff da fase. */
export function handoffFileName(phaseIdx: number, persona: MissionPersona): string {
  return `${MISSION_DIR}/${phaseIdx}-${persona}.json`
}

/** Uma decisão da fase (o "porquê" que o diff nunca carrega). */
export interface HandoffDecision {
  choice: string
  rejected?: string
  reason?: string
}

/** Documento de handoff tipado que uma fase deixa para a próxima. */
export interface HandoffDoc {
  intent: string
  decisions: HandoffDecision[]
  files_touched: string[]
  open_questions: string[]
  for_next_agent: string
}

const MAX_LIST = 5
const MAX_FILES = 40
const MAX_STR = 2_000

function str(v: unknown, max = MAX_STR): string {
  if (typeof v !== "string") return ""
  return v.length > max ? v.slice(0, max) + "…" : v
}

/** Parse TOLERANTE do JSON escrito pelo agente: aceita cercas ```json e prosa
 *  em volta (extrai do primeiro `{` ao último `}`). Valida forma e aplica caps
 *  (anti-blackboard-infinito). Devolve null se não for objeto aproveitável. */
export function parseHandoff(raw: string): HandoffDoc | null {
  if (!raw || !raw.trim()) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    const a = raw.indexOf("{")
    const b = raw.lastIndexOf("}")
    if (a < 0 || b <= a) return null
    try {
      obj = JSON.parse(raw.slice(a, b + 1))
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>

  const decisions: HandoffDecision[] = Array.isArray(o.decisions)
    ? o.decisions
        .slice(0, MAX_LIST)
        .map((d) => {
          const dd = (d ?? {}) as Record<string, unknown>
          return {
            choice: str(dd.choice, 400),
            rejected: dd.rejected ? str(dd.rejected, 400) : undefined,
            reason: dd.reason ? str(dd.reason, 400) : undefined,
          }
        })
        .filter((d) => d.choice)
    : []

  const files_touched: string[] = Array.isArray(o.files_touched)
    ? o.files_touched
        .filter((x): x is string => typeof x === "string")
        .slice(0, MAX_FILES)
        .map((x) => str(x, 300))
    : []

  const open_questions: string[] = Array.isArray(o.open_questions)
    ? o.open_questions
        .filter((x): x is string => typeof x === "string")
        .slice(0, MAX_LIST)
        .map((x) => str(x, 500))
    : []

  const doc: HandoffDoc = {
    intent: str(o.intent),
    decisions,
    files_touched,
    open_questions,
    for_next_agent: str(o.for_next_agent),
  }

  // precisa carregar ALGUM sinal útil, senão é lixo → cai no fallback.
  if (!doc.intent && !doc.for_next_agent && decisions.length === 0) return null
  return doc
}

/** Lê o handoff de uma fase do worktree (escopado à raiz). null em qualquer
 *  falha (arquivo ausente/ inválido) → o chamador usa o fallback. */
export async function readHandoff(
  cwd: string,
  relPath: string,
): Promise<HandoffDoc | null> {
  try {
    const raw = await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${relPath}`,
    })
    return parseHandoff(raw)
  } catch {
    return null
  }
}

/** Uma fase anterior + seu doc, para renderizar no prompt seguinte. */
export interface PriorHandoff {
  label: string
  persona: MissionPersona
  doc: HandoffDoc
}

/** Achata os handoffs anteriores num bloco markdown compacto para o prompt. */
export function formatPriorHandoffs(priors: PriorHandoff[]): string {
  return priors
    .map((p) => {
      const lines: string[] = [`### ${p.label} (${p.persona})`]
      if (p.doc.intent) lines.push(`Intenção: ${p.doc.intent}`)
      if (p.doc.decisions.length) {
        lines.push("Decisões:")
        for (const d of p.doc.decisions) {
          const tail = [
            d.rejected ? `descartou: ${d.rejected}` : "",
            d.reason ? `porque: ${d.reason}` : "",
          ]
            .filter(Boolean)
            .join(" — ")
          lines.push(`- ${d.choice}${tail ? ` (${tail})` : ""}`)
        }
      }
      if (p.doc.files_touched.length) {
        lines.push(`Arquivos: ${p.doc.files_touched.join(", ")}`)
      }
      if (p.doc.open_questions.length) {
        lines.push("Pendências/riscos:")
        for (const q of p.doc.open_questions) lines.push(`- ${q}`)
      }
      if (p.doc.for_next_agent) lines.push(`Para você: ${p.doc.for_next_agent}`)
      return lines.join("\n")
    })
    .join("\n\n")
}

/** Lista LEVE dos arquivos mudados (referência, não o patch): o agente lê o
 *  código no próprio cwd. É o "lightweight reference" da pesquisa. */
export function changedFilesRef(diff: GitDiff): string {
  if (!diff.isRepo) return "(fora de um repositório git)"
  if (diff.files.length === 0) return "(nenhuma mudança na working tree ainda)"
  const shown = diff.files.slice(0, MAX_FILES)
  const rows = shown.map(
    (f) => `- ${f.status} ${f.path} (+${f.additions} -${f.deletions})`,
  )
  if (diff.files.length > shown.length) {
    rows.push(`- … +${diff.files.length - shown.length} arquivo(s)`)
  }
  return rows.join("\n")
}

/** Instrução (anexada ao prompt) que manda o agente escrever seu handoff JSON.
 *  É o único canal de contexto para a próxima fase. */
export function handoffInstruction(relPath: string): string {
  return [
    "## Handoff obrigatório (para o próximo agente da missão)",
    `Ao terminar, escreva um arquivo JSON em \`${relPath}\` (crie a pasta ` +
      `\`${MISSION_DIR}/\` se preciso) com EXATAMENTE estes campos:`,
    "```json",
    "{",
    '  "intent": "1-2 frases: o que você fez e POR QUÊ (a intenção, não o código)",',
    '  "decisions": [{"choice":"o que decidiu","rejected":"alternativa descartada","reason":"por quê"}],',
    '  "files_touched": ["caminho/do/arquivo"],',
    '  "open_questions": ["riscos/dúvidas que o próximo agente deve saber"],',
    '  "for_next_agent": "instrução direta para a próxima fase"',
    "}",
    "```",
    "Regras: NÃO cole diffs nem código no JSON — referencie arquivos por " +
      "caminho (eles já estão no worktree). Redija segredos (chaves, senhas). " +
      "Máx 5 itens em decisions/open_questions. Este arquivo é o ÚNICO canal " +
      "de contexto para a próxima fase — capriche na intenção e nas pendências.",
  ].join("\n")
}
