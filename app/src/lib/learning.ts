// AUTO-APRENDIZADO — orquestração do M1 (recall) e M2 (lessons) sobre o SQLite
// (lib/db) e a lógica pura (lib/recall). NÃO toca em Rust: as tabelas nascem do
// frontend (db.ts, CREATE IF NOT EXISTS). Este módulo:
//  - monta os BLOCOS de prompt injetados no planner/executor (recall + lições);
//  - destila UMA regra acionável da correção do reviewer via o helper Haiku
//    (suggest), com dedup simples anti-inchaço.
// Princípio do doc: só grava de eventos de ALTO SINAL, artefatos pequenos,
// cap + dedup p/ não inchar, nada destrutivo automático.

import { suggest } from "@/lib/agent"
import {
  bumpLessonUses,
  insertLesson,
  listDeliveries,
  listLessons,
  type LessonRecord,
} from "@/lib/db"
import { recallMatches, strongMatches, tokenize } from "@/lib/recall"
import { fmtCost } from "@/lib/format"

/** Teto de lições injetadas por prompt (cap anti-inchaço do doc). */
export const MAX_LESSONS_INJECTED = 8

/** Bloco de prompt (markdown) + os ids das lições usadas (p/ bumpar `uses`). */
export interface LearningBlocks {
  recall: string | null
  lessons: string | null
  lessonIds: string[]
}

/** Monta os blocos de contexto aprendido para injetar num prompt de fase.
 *  `withRecall` só faz sentido no planner (o doc: recall alimenta o planner);
 *  as lições vão em planner E executor. Tolerante a falha: qualquer erro de DB
 *  degrada para "sem bloco" (nunca quebra a missão). */
export async function buildLearningBlocks(
  projectId: string,
  task: string,
  withRecall: boolean,
): Promise<LearningBlocks> {
  let recall: string | null = null
  let lessons: string | null = null
  let lessonIds: string[] = []

  try {
    if (withRecall) {
      const deliveries = await listDeliveries(projectId)
      const matches = strongMatches(recallMatches(task, deliveries))
      if (matches.length > 0) recall = renderRecall(matches)
    }
  } catch {
    recall = null
  }

  try {
    const all = await listLessons(projectId)
    const top = all.slice(0, MAX_LESSONS_INJECTED)
    if (top.length > 0) {
      lessons = renderLessons(top)
      lessonIds = top.map((l) => l.id)
    }
  } catch {
    lessons = null
    lessonIds = []
  }

  return { recall, lessons, lessonIds }
}

/** Marca as lições injetadas como usadas (o ranking sobe as recorrentes). */
export async function markLessonsUsed(ids: string[]): Promise<void> {
  try {
    await bumpLessonUses(ids)
  } catch {
    // best-effort: contador é sinal secundário, não vale quebrar por ele.
  }
}

function renderRecall(
  matches: ReturnType<typeof recallMatches>,
): string {
  const lines = ["## Entregas similares já feitas (recall)"]
  lines.push(
    "Estas features JÁ passaram nos gates deste projeto. Reuse o plano/arquivos " +
      "quando fizer sentido — não reinvente o que já funcionou:",
  )
  for (const m of matches) {
    const d = m.delivery
    lines.push("")
    lines.push(`### ${d.task} (confiança ${m.confidence})`)
    if (d.planSummary.trim()) lines.push(`Plano: ${truncate(d.planSummary, 600)}`)
    if (d.filesTouched.length) {
      lines.push(`Arquivos: ${d.filesTouched.slice(0, 12).join(", ")}`)
    }
    if (d.costUsd != null) lines.push(`Custo da entrega: ${fmtCost(d.costUsd)}`)
  }
  return lines.join("\n")
}

function renderLessons(lessons: LessonRecord[]): string {
  const lines = ["## Lições deste projeto"]
  lines.push("Regras aprendidas de entregas e correções passadas. Siga-as:")
  for (const l of lessons) lines.push(`- ${l.rule}`)
  return lines.join("\n")
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s
}

// ── M2: destilação de lição da correção do reviewer ──

const DISTILL_PROMPT = [
  "Você destila LIÇÕES REUSÁVEIS de correções de código. Recebe o feedback de",
  "um reviewer que reprovou uma entrega (e pendências em aberto). Extraia UMA",
  "única regra curta, acionável e GENÉRICA (aplicável a futuras tarefas do",
  "projeto, não específica desta), em português, no imperativo.",
  "Responda APENAS com a regra numa linha (sem aspas, sem numeração, sem prosa).",
  "Se não houver lição generalizável, responda exatamente: NENHUMA.",
].join(" ")

/** Similaridade simples entre duas regras: overlap de tokens (mesmo motor do
 *  recall). ≥ este limiar = duplicata → não grava de novo (dedup do doc). */
const DEDUP_THRESHOLD = 0.6

function ruleSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size)
}

/** É uma regra nova (não duplica nenhuma lição existente)? Puro/testável. */
export function isNovelRule(rule: string, existing: string[]): boolean {
  const r = rule.trim()
  if (!r) return false
  return !existing.some((e) => ruleSimilarity(r, e) >= DEDUP_THRESHOLD)
}

/** Normaliza a saída do Haiku numa regra limpa (ou null se NENHUMA/vazio). */
export function parseDistilledRule(raw: string): string | null {
  const first = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first) return null
  const cleaned = first.replace(/^[-*\d.)\s]+/, "").replace(/^["']|["']$/g, "").trim()
  if (!cleaned || /^nenhuma$/i.test(cleaned)) return null
  return truncate(cleaned, 300)
}

export interface DistillArgs {
  projectId: string
  /** cwd p/ o helper (pasta do projeto/worktree). */
  cwd: string
  /** Modelo helper (Haiku) resolvido pelo chamador; null = destilação desligada. */
  helperModel: string | null
  /** Feedback do reviewer que provocou a correção. */
  reviewerFeedback: string
  /** Pendências/riscos do handoff (open_questions), opcional. */
  openQuestions?: string[]
  /** Injetável nos testes; default = suggest real. */
  run?: typeof suggest
}

/** Destila e GRAVA uma lição da correção do reviewer (evento de alto sinal:
 *  reprovado→corrigido→aprovado). Dedup contra as lições existentes. Best-effort:
 *  qualquer falha vira no-op (nunca quebra a missão). Retorna a regra gravada,
 *  ou null se destilação desligada / sem lição / duplicata. */
export async function distillLesson(args: DistillArgs): Promise<string | null> {
  if (!args.helperModel) return null
  const feedback = args.reviewerFeedback.trim()
  if (!feedback) return null

  try {
    const q =
      args.openQuestions && args.openQuestions.length
        ? `\n\nPendências em aberto:\n${args.openQuestions.map((x) => `- ${x}`).join("\n")}`
        : ""
    const run = args.run ?? suggest
    const raw = await run(
      args.helperModel,
      args.cwd,
      `${DISTILL_PROMPT}\n\nFeedback do reviewer:\n${truncate(feedback, 2000)}${q}`,
    )
    const rule = parseDistilledRule(raw)
    if (!rule) return null

    const existing = (await listLessons(args.projectId)).map((l) => l.rule)
    if (!isNovelRule(rule, existing)) return null

    await insertLesson({ projectId: args.projectId, rule, source: "reviewer" })
    return rule
  } catch {
    return null
  }
}
