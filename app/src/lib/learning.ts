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
  deleteLesson,
  insertLesson,
  listActiveLessons,
  listDeliveries,
  listLessons,
  mergeLessonUses,
  reinforceLessons as dbReinforceLessons,
  setLessonStatus,
  type LessonRecord,
  type LessonScope,
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
    // Estágio 1: só lições ATIVAS entram no prompt (candidate/archived não).
    const all = await listActiveLessons(projectId)
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

/** Marca as lições injetadas como usadas (o ranking sobe as recorrentes) e
 *  carimba `last_used_at`. */
export async function markLessonsUsed(ids: string[]): Promise<void> {
  try {
    await bumpLessonUses(ids)
  } catch {
    // best-effort: contador é sinal secundário, não vale quebrar por ele.
  }
}

/** Reforça as lições injetadas quando o 👍 valida o turno — sinal de utilidade
 *  REAL (o curador rebaixa as muito injetadas que NUNCA foram reforçadas).
 *  Best-effort. Deve ser chamado no hook do 👍 junto de markLessonsUsed. */
export async function reinforceLessons(ids: string[]): Promise<void> {
  if (!ids.length) return
  await dbReinforceLessons(ids)
}

// ── P6: feedback fora do ChatPanel (mesa do office + página do Companion) ──
// O ChatPanel guarda os ids injetados num ref LOCAL do componente
// (injectedLessonsRef) — a mesa e o celular não enxergam esse ref. Este
// registro por conversa dá o mesmo insumo pro MESMO caminho do 👍
// (reinforceLessons): sendFromDesk grava aqui a cada envio.

const injectedByConv = new Map<string, string[]>()

/** Registra as lições injetadas no ÚLTIMO envio da conversa (sobrescreve —
 *  o 👍 só reforça o turno corrente, nunca ids de turnos velhos). */
export function recordInjectedLessons(convId: string, ids: string[]): void {
  injectedByConv.set(convId, ids)
}

/** 👍/👎 num turno concluído da mesa/companion — o MESMO caminho do onThumbUp
 *  do ChatPanel: `up` reforça (reinforceLessons) as lições injetadas no último
 *  turno da conversa. `down` não escreve nada hoje — no ChatPanel o 👎 sozinho
 *  também não grava (abre o fluxo de propor regra, que exige nota + gate
 *  humano, ambos vivos só na UI). Best-effort: nunca lança.
 *  `run` é injetável nos testes (padrão do distillLesson). */
export async function feedbackLesson(
  convId: string,
  verdict: "up" | "down",
  run: typeof reinforceLessons = reinforceLessons,
): Promise<void> {
  if (verdict !== "up") return
  const ids = injectedByConv.get(convId) ?? []
  if (!ids.length) return
  try {
    await run(ids)
  } catch {
    // reforço é sinal secundário — não vale quebrar por ele.
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

    // Estágio 1: lição derivada do loop do Mission entra como CANDIDATE — não
    // injeta até o humano promover na auditoria (sinal mais fraco que o save
    // explícito do Linear, que grava active).
    await insertLesson({
      projectId: args.projectId,
      rule,
      source: "reviewer",
      status: "candidate",
    })
    return rule
  } catch {
    return null
  }
}

// ── M2 do Linear: feedback do usuário → PROPOR uma regra (gate humano) ──
// Diferença crucial pro fluxo do reviewer: aqui NÃO grava. Destila um CANDIDATO
// que a UI mostra num card editável; só o clique do usuário chama saveLesson.

const LINEAR_DISTILL_PROMPT = [
  "Você é um JUIZ DE LIÇÕES: decide se o feedback de um usuário sobre a resposta",
  "de um agente de código contém algo REUSÁVEL e DURÁVEL o suficiente pra virar",
  "uma regra permanente do projeto. Seja EXIGENTE. NÃO vira lição: mensagens de",
  "status, resultados pontuais deste momento, elogios/críticas vagos, ou coisas",
  "específicas só desta tarefa. VIRA lição: um padrão do código, uma convenção,",
  "uma preferência durável, um erro que deve ser evitado sempre.",
  "Se HOUVER lição: responda APENAS com UMA regra curta, acionável e genérica,",
  "em português, no imperativo (uma linha, sem aspas/numeração/prosa).",
  "Se NÃO houver: responda exatamente NENHUMA.",
].join(" ")

export interface DistillCandidateArgs {
  /** cwd p/ o helper (pasta do projeto/worktree). */
  cwd: string
  /** Modelo helper (Haiku) resolvido pelo chamador; null = destilação desligada. */
  helperModel: string | null
  /** Resposta do agente que o usuário avaliou (contexto do turno). */
  agentTurn: string
  /** O que o usuário apontou (👎 "o que faltou" / "o que funcionou"). */
  userNote: string
  /** Injetável nos testes; default = suggest real. */
  run?: typeof suggest
}

/** Resultado da destilação: a regra (editável) + se o juiz achou algo REALMENTE
 *  learnable. `learnable:false` → a UI avisa "isso parece pouco generalizável"
 *  mas AINDA deixa salvar (o humano tem a palavra final — caveat EMNLP: o filtro
 *  automático erra nos dois sentidos). `null` = não deu pra julgar (helper off). */
export interface DistillCandidate {
  rule: string
  learnable: boolean | null
}

/** Destila um CANDIDATO de regra do feedback do Linear via Haiku — NÃO grava.
 *  Estágio 0 do funil de learnability (docs/autonomy.md): o Haiku JULGA se há
 *  algo durável/genérico antes de propor. Sem helper OU falha → devolve o texto
 *  cru com learnable:null (não julga, não bloqueia). Nunca lança. */
export async function distillCandidate(
  args: DistillCandidateArgs,
): Promise<DistillCandidate> {
  const note = args.userNote.trim()
  // Sem helper → não dá pra julgar; devolve o texto cru (card editável).
  if (!args.helperModel) return { rule: note, learnable: null }
  try {
    const run = args.run ?? suggest
    const raw = await run(
      args.helperModel,
      args.cwd,
      `${LINEAR_DISTILL_PROMPT}\n\nResposta do agente:\n${truncate(
        args.agentTurn,
        2000,
      )}\n\nFeedback do usuário:\n${truncate(note, 1000)}`,
    )
    const rule = parseDistilledRule(raw)
    // regra → learnable; NENHUMA/vazio → não-learnable (mas devolve o cru p/ o
    // humano poder salvar mesmo assim, ciente de que é fraco).
    if (rule) return { rule, learnable: true }
    return { rule: note, learnable: false }
  } catch {
    return { rule: note, learnable: null }
  }
}

/** Grava uma lição vinda do Linear (após o gate humano do card). Dedup contra
 *  as lições que já valem no projeto (próprias + globais). Retorna false se
 *  vazia ou duplicata (a UI avisa "já existe algo parecido"). Best-effort. */
/** Desfecho de salvar uma lição. Era `boolean`, e isso confundia DUPLICATA com
 *  FALHA: o `catch { return false }` fazia um erro de banco chegar na UI como
 *  "já existe uma regra parecida" — o usuário achava que estava tudo bem e a
 *  regra dele simplesmente não existia. Três desfechos, três mensagens. */
export type SaveLessonOutcome = "salva" | "duplicata" | "erro"

export async function saveLesson(args: {
  projectId: string
  rule: string
  scope: LessonScope
  source?: string
}): Promise<SaveLessonOutcome> {
  const rule = args.rule.trim()
  if (!rule) return "erro"
  try {
    const existing = (await listLessons(args.projectId)).map((l) => l.rule)
    if (!isNovelRule(rule, existing)) return "duplicata"
    await insertLesson({
      projectId: args.projectId,
      rule,
      source: args.source ?? "linear",
      scope: args.scope,
    })
    return "salva"
  } catch (e) {
    console.warn("[lições] falha ao salvar", e)
    return "erro"
  }
}

// ── Estágio 3: CURADOR de memória (docs/autonomy.md) ──
// Higiene periódica das lições ATIVAS, disparada pelo botão "Revisar memória":
//  (a) DEDUP: pares quase-iguais → mantém a de maior uses, soma os usos da outra
//      na canônica e remove a duplicata.
//  (b) REBAIXA: ativa muito injetada (uses ≥ N) mas NUNCA reforçada (reinforced
//      = 0) provavelmente é ruído → vira candidate (reversível, não exclui).
// Best-effort: nunca lança. Token-similarity (isNovelRule) já basta no v1 — não
// gasta Haiku (o helperModel fica reservado p/ um dedup semântico futuro).

/** Uses mínimos p/ suspeitar de ruído no rebaixamento (injetada muito, nunca
 *  reforçada). */
export const CURATOR_DEMOTE_USES = 5

export interface CuratorSummary {
  /** Quantas duplicatas foram fundidas + removidas. */
  deduped: number
  /** Quantas ativas viraram candidate (ruído suspeito). */
  demoted: number
}

/** Roda o curador sobre as lições ATIVAS do projeto (próprias + globais).
 *  `helperModel` fica disponível p/ um dedup semântico opcional; no v1 usamos só
 *  a similaridade de token. Best-effort — qualquer falha degrada p/ no-op. */
export async function runCurator(
  projectId: string,
  _helperModel?: string | null,
): Promise<CuratorSummary> {
  const summary: CuratorSummary = { deduped: 0, demoted: 0 }
  try {
    const actives = await listActiveLessons(projectId)

    // (a) DEDUP: varre pares quase-iguais DO MESMO ESCOPO. Comparar escopos
    // diferentes deletava uma lição GLOBAL por causa de uma duplicata local do
    // projeto (hard-delete afetando TODOS os projetos) — achado da revisão.
    // Mesmo-escopo: global×global (dedup legítimo) e projeto×projeto (idem).
    const removed = new Set<string>()
    for (let i = 0; i < actives.length; i++) {
      const a = actives[i]
      if (removed.has(a.id)) continue
      for (let j = i + 1; j < actives.length; j++) {
        const b = actives[j]
        if (removed.has(b.id)) continue
        if (a.scope !== b.scope) continue // nunca funde escopos diferentes
        if (isNovelRule(a.rule, [b.rule])) continue // não são quase-iguais
        // duplicata: mantém a de MAIOR uses (empate → a `a`, já ordenada desc).
        const [keep, drop] = a.uses >= b.uses ? [a, b] : [b, a]
        await mergeLessonUses(keep.id, drop.uses)
        await deleteLesson(drop.id)
        removed.add(drop.id)
        keep.uses += drop.uses // reflete pro passo (b) na mesma passada
        summary.deduped++
      }
    }

    // (b) REBAIXA: sobreviventes muito injetadas e nunca reforçadas → candidate.
    // SÓ lições do PROJETO: um run de curadoria num projeto não rebaixa uma
    // GLOBAL (ela pode estar sendo útil em outros projetos) — achado da revisão.
    for (const l of actives) {
      if (removed.has(l.id)) continue
      if (l.scope === "global") continue
      if (l.uses >= CURATOR_DEMOTE_USES && l.reinforced === 0) {
        await setLessonStatus(l.id, "candidate")
        summary.demoted++
      }
    }
  } catch {
    // best-effort: nunca quebra a auditoria.
  }
  return summary
}
