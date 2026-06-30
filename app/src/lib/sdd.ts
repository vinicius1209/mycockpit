// Watcher do SDD (frontend): carrega + NORMALIZA os manifests do disco. O dado real
// diverge do schema (developer/test-suite/code-review nas stages, lint_passing +
// merge_commit + merged_at extras, pastas sem manifest) → parse tolerante aqui.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export const SDD_STAGES = [
  "discovery",
  "prd",
  "spec",
  "implementation",
  "test",
  "review",
  "pr",
  "done",
] as const
export type SddStage = (typeof SDD_STAGES)[number]

const STAGE_LABEL: Record<string, string> = {
  discovery: "Descoberta",
  prd: "PRD",
  spec: "SPEC",
  implementation: "Implementação",
  test: "Testes",
  review: "Review",
  pr: "PR",
  done: "Concluído",
}
export function stageLabel(s: string): string {
  return STAGE_LABEL[s] ?? s
}

// Normaliza o drift: developer→implementation, test-suite→test, code-review→review,
// release→pr (virtual pós-pr). Tolerante a stages desconhecidas (devolve como veio).
const STAGE_ALIAS: Record<string, SddStage> = {
  developer: "implementation",
  implementation: "implementation",
  "test-suite": "test",
  test: "test",
  "code-review": "review",
  review: "review",
  release: "pr",
}
function normStage(s: string | undefined | null): string {
  if (!s) return ""
  return STAGE_ALIAS[s] ?? s
}

// O dado real é heterogêneo: a linha da matriz pode ser uma STRING (descrição),
// um dict {persona,input,ui,backend} (ui às vezes string, às vezes array), ou um
// dict {persona,summary}. (E há manifest com scenario_matrix = int!) Normaliza tudo.
export interface ScenarioRow {
  /** Linha freeform (string), alguns planos descrevem cenários como texto. */
  text: string | null
  persona: string | null
  input: string | null
  ui: string | null
  backend: string | null
  /** Forma alternativa {persona, summary}. */
  summary: string | null
}

function uiToStr(v: unknown): string {
  if (typeof v === "string") return v
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" · ")
  return ""
}

const EMPTY_ROW: ScenarioRow = {
  text: null,
  persona: null,
  input: null,
  ui: null,
  backend: null,
  summary: null,
}

function normScenarioRow(r: unknown): ScenarioRow {
  if (typeof r === "string") return { ...EMPTY_ROW, text: r }
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>
    return {
      text: null,
      persona: typeof o.persona === "string" ? o.persona : null,
      input: typeof o.input === "string" ? o.input : null,
      ui: uiToStr(o.ui) || null,
      backend: typeof o.backend === "string" ? o.backend : null,
      summary: typeof o.summary === "string" ? o.summary : null,
    }
  }
  return EMPTY_ROW
}
export interface ConsistencyAnchor {
  category: string
  canon_file: string
  reference_doc: string
}
export interface SddPlan {
  slug: string
  title: string
  sponsor: string | null
  branch: string | null
  createdAt: string | null
  stage: string // normalizado
  stageRaw: string
  stagesCompleted: string[] // normalizado
  artifacts: {
    prd: { path: string; approved: boolean; approvedAt: string | null } | null
    spec: { path: string; approvedAt: string | null } | null
    migrations: string[]
    sourceFiles: string[]
    tests: string[]
  }
  scenarioMatrix: ScenarioRow[]
  navSurfaces: string[]
  consistencyAnchors: ConsistencyAnchor[]
  /** Todos os gates presentes no manifest (dinâmico, o real tem 7, não 6). */
  verification: Record<string, boolean | null>
  links: Record<string, string | null>
  mergedAt: string | null
  hasManifest: boolean
  logTail: string | null
  /** Títulos dos passos `[x]` do LOG, timeline de atividade. */
  logEvents: string[]
}

interface SddPlanRaw {
  slug: string
  manifest: string | null
  log_tail: string | null
  log_events: string[]
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : []
}

function normalize(raw: SddPlanRaw): SddPlan {
  let m: Record<string, any> = {}
  let hasManifest = false
  if (raw.manifest) {
    try {
      m = JSON.parse(raw.manifest)
      hasManifest = true
    } catch {
      hasManifest = false
    }
  }
  const a = (m.artifacts ?? {}) as Record<string, any>
  const p = (m.promised_in_spec ?? {}) as Record<string, any>
  const v = (m.verification ?? {}) as Record<string, unknown>
  const verification: Record<string, boolean | null> = {}
  for (const [k, val] of Object.entries(v)) {
    verification[k] = val === true ? true : val === false ? false : null
  }
  return {
    slug: raw.slug,
    title: typeof m.title === "string" ? m.title : raw.slug,
    sponsor: typeof m.sponsor === "string" ? m.sponsor : null,
    branch: typeof m.branch === "string" ? m.branch : null,
    createdAt: typeof m.created_at === "string" ? m.created_at : null,
    stage: normStage(m.stage),
    stageRaw: typeof m.stage === "string" ? m.stage : "",
    stagesCompleted: asStrArray(m.stages_completed).map(normStage),
    artifacts: {
      prd: a.prd
        ? {
            path: a.prd.path ?? "PRD.md",
            approved: !!a.prd.approved,
            approvedAt: a.prd.approved_at ?? null,
          }
        : null,
      spec: a.spec
        ? { path: a.spec.path ?? "SPEC.md", approvedAt: a.spec.approved_at ?? null }
        : null,
      migrations: asStrArray(a.migrations),
      sourceFiles: asStrArray(a.source_files),
      tests: asStrArray(a.tests),
    },
    scenarioMatrix: Array.isArray(p.scenario_matrix)
      ? p.scenario_matrix.map(normScenarioRow)
      : [],
    navSurfaces: asStrArray(p.navigation_surfaces),
    consistencyAnchors: Array.isArray(p.consistency_anchors)
      ? p.consistency_anchors.map((c: any) => ({
          category: c?.category ?? "",
          canon_file: c?.canon_file ?? "",
          reference_doc: c?.reference_doc ?? "",
        }))
      : [],
    verification,
    links: (m.links ?? {}) as Record<string, string | null>,
    mergedAt: typeof m.merged_at === "string" ? m.merged_at : null,
    hasManifest,
    logTail: raw.log_tail,
    logEvents: raw.log_events ?? [],
  }
}

export async function loadSddPlans(projectPath: string): Promise<SddPlan[]> {
  if (!isTauri()) return []
  try {
    const raw = await invoke<SddPlanRaw[]>("read_sdd_plans", { projectPath })
    return raw.map(normalize)
  } catch {
    return []
  }
}

export interface PrInfo {
  state: string | null // OPEN | MERGED | CLOSED
  mergedBy: string | null
  mergedAt: string | null
  createdAt: string | null
  source: string // "gh" | "git" | "none", proveniência honesta
}

/** Enriquece a info do PR de forma graciosa (gh → git → nada). null se não-Tauri. */
export async function loadPrInfo(
  projectPath: string,
  prUrl: string,
  mergeCommit: string | null,
): Promise<PrInfo | null> {
  if (!isTauri()) return null
  try {
    return await invoke<PrInfo>("pr_info", { projectPath, prUrl, mergeCommit })
  } catch {
    return null
  }
}

/** O projeto tem o fluxo SDD instalado (architect stages presentes)? */
export async function sddReady(projectPath: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await invoke<boolean>("sdd_ready", { projectPath })
  } catch {
    return false
  }
}

export interface SeedSummary {
  copied: string[]
  skipped: string[]
}

/** Instala o scaffold SDD (clona o seed + copia non-destructive pro .claude/). */
export async function seedSdd(projectPath: string): Promise<SeedSummary> {
  return invoke<SeedSummary>("seed_sdd", { projectPath })
}

/** Gate do PRD (v2.2): o cockpit escreve a aprovação no manifest (approved=true). */
export async function approvePrd(projectPath: string, slug: string): Promise<void> {
  return invoke("approve_prd", {
    projectPath,
    slug,
    approvedAt: new Date().toISOString(),
  })
}

/** Stage 0 determinístico (v2.4): o cockpit cria o plano (manifest do template).
 *  Devolve o slug derivado da descrição. Espelha o Stage 0 do `/feature`. */
export async function createPlan(
  projectPath: string,
  description: string,
): Promise<string> {
  const r = await invoke<{ slug: string }>("create_plan", {
    projectPath,
    description,
    createdAt: new Date().toISOString(),
  })
  return r.slug
}

/** O cockpit AFIRMA o stage do manifest após dirigir uma etapa (só avança). */
export async function setPlanStage(
  projectPath: string,
  slug: string,
  stage: string,
): Promise<void> {
  return invoke("set_plan_stage", { projectPath, slug, stage })
}

// skill dirigida → stage (normalizado) que ela produz. O cockpit afirma esse stage
// no manifest após o run, fechando o loop de forma determinística.
const SKILL_PRODUCES: Record<string, string> = {
  prd: "prd",
  spec: "spec",
  developer: "implementation",
  "test-suite": "test",
  "code-review": "review",
  pr: "pr",
}
export function producedStage(skill: string): string | null {
  return SKILL_PRODUCES[skill] ?? null
}

/** Índice do stage no pipeline (deriva done/current/pending). -1 se desconhecido. */
export function stageIndex(s: string): number {
  return (SDD_STAGES as readonly string[]).indexOf(s)
}

// stage normalizado → a SKILL que avança pro próximo (nome real da skill no projeto).
const NEXT_SKILL: Record<string, string> = {
  "": "discovery",
  discovery: "prd",
  prd: "spec",
  spec: "developer",
  implementation: "test-suite",
  test: "code-review",
  review: "pr",
}

/** Próxima etapa a rodar (skill + prompt). null se done OU travado num gate humano. */
export function nextStep(
  plan: SddPlan,
): { skill: string; prompt: string; blockedBy?: "prd" } | null {
  // Gate do PRD (v2.2): PRD existe e não aprovado → não dispara /spec; espera você.
  if (plan.stage === "prd" && plan.artifacts.prd && !plan.artifacts.prd.approved) {
    return { skill: "spec", prompt: "", blockedBy: "prd" }
  }
  const skill = NEXT_SKILL[plan.stage]
  if (!skill) return null
  return { skill, prompt: `/${skill} ${plan.slug}` }
}

// Rótulo ADAPTADO ao estado: o texto NUNCA diz "passando" quando cinza/falho.
const GATE: Record<string, { pass: string; fail: string; nrun: string }> = {
  scenarios_validated: {
    pass: "Cenários validados",
    fail: "Cenários reprovados",
    nrun: "Cenários não validados",
  },
  all_nav_surfaces_updated: {
    pass: "Superfícies atualizadas",
    fail: "Superfícies desatualizadas",
    nrun: "Superfícies não verificadas",
  },
  consistency_check_passed: {
    pass: "Consistência validada",
    fail: "Consistência reprovada",
    nrun: "Consistência não verificada",
  },
  tests_passing: {
    pass: "Testes passando",
    fail: "Testes falhando",
    nrun: "Testes não rodados",
  },
  build_passing: {
    pass: "Build passando",
    fail: "Build quebrado",
    nrun: "Build não rodado",
  },
  type_check_passing: {
    pass: "Typecheck passando",
    fail: "Typecheck falhou",
    nrun: "Typecheck não rodado",
  },
  lint_passing: { pass: "Lint passando", fail: "Lint falhou", nrun: "Lint não rodado" },
}

/** Rótulo do gate adaptado ao estado (true/false/null). */
export function gateText(k: string, v: boolean | null): string {
  const g = GATE[k]
  if (!g) return k
  return v === true ? g.pass : v === false ? g.fail : g.nrun
}

/** Contagem dos gates por estado, header, filtro da lista e resumo. */
export function gateCounts(v: Record<string, boolean | null>): {
  pass: number
  fail: number
  notRun: number
} {
  let pass = 0
  let fail = 0
  let notRun = 0
  for (const val of Object.values(v)) {
    if (val === true) pass++
    else if (val === false) fail++
    else notRun++
  }
  return { pass, fail, notRun }
}
