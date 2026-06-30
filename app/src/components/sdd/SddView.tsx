import { Fragment, useEffect, useState } from "react"
import {
  Check,
  ChevronDown,
  FileText,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Loader2,
  Minus,
  Search,
  X,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { useActiveProject } from "@/store/app"
import {
  loadSddPlans,
  loadPrInfo,
  stageLabel,
  stageIndex,
  gateText,
  gateCounts,
  SDD_STAGES,
  type SddPlan,
  type PrInfo,
} from "@/lib/sdd"
import { cn } from "@/lib/utils"

const FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "andamento", label: "Em andamento" },
  { id: "concluidas", label: "Concluídas" },
  { id: "compr", label: "Com PR" },
  { id: "comfalha", label: "Com falha" },
] as const
type FilterId = (typeof FILTERS)[number]["id"]

function matchesFilter(p: SddPlan, filter: FilterId, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q && !p.title.toLowerCase().includes(q) && !p.slug.includes(q)) return false
  switch (filter) {
    case "andamento":
      return p.stage !== "done"
    case "concluidas":
      return p.stage === "done"
    case "compr":
      return !!p.links.pr_url
    case "comfalha":
      return gateCounts(p.verification).fail > 0
    default:
      return true
  }
}

/** "5 gates passaram · 1 falhou · 2 não rodados" (omite zeros). */
function gateSummary(gc: { pass: number; fail: number; notRun: number }): string {
  const parts: string[] = []
  if (gc.pass)
    parts.push(`${gc.pass} ${gc.pass === 1 ? "gate passou" : "gates passaram"}`)
  if (gc.fail) parts.push(`${gc.fail} ${gc.fail === 1 ? "falhou" : "falharam"}`)
  if (gc.notRun)
    parts.push(`${gc.notRun} não ${gc.notRun === 1 ? "rodado" : "rodados"}`)
  return parts.join(" · ")
}

/** "PR #476" a partir da URL do GitHub (…/pull/476); fallback "Pull request". */
function prLabel(url: string): string {
  const m = url.match(/\/pull\/(\d+)/)
  return m ? `PR #${m[1]}` : "Pull request"
}

/** ISO → "dd/mm/aaaa hh:mm" (local). Fallback p/ só a data, se inválido. */
function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    })
  } catch {
    return iso.slice(0, 10)
  }
}

/** Modo SDD — v1: dashboard WATCHER read-only sobre `.claude/plans/`. Mostra o
 *  estado dos planos (pipeline + contrato + gates) sem dirigir nada ainda. */
export function SddView() {
  const project = useActiveProject()
  const [plans, setPlans] = useState<SddPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterId>("todas")

  useEffect(() => {
    if (!project) {
      setPlans([])
      setLoading(false)
      return
    }
    setLoading(true)
    void loadSddPlans(project.path).then((ps) => {
      const real = ps.filter((p) => p.hasManifest)
      setPlans(real)
      setSelected((s) => (s && real.some((p) => p.slug === s) ? s : (real[0]?.slug ?? null)))
      setLoading(false)
    })
  }, [project?.path])

  const plan = plans.find((p) => p.slug === selected)
  const filtered = plans.filter((p) => matchesFilter(p, filter, query))

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }
  if (plans.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <FileText className="mb-3 size-8 text-brass/50" />
        <p className="text-[15px] text-foreground/80">Nenhuma feature SDD aqui</p>
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed">
          O modo SDD lê os planos de <code className="text-foreground/70">.claude/plans/</code>.
          Planeje, implemente e valide uma feature via PRD → SPEC → implementação →
          testes → review → PR, com gates de verificação.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <div className="shrink-0 border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar feature…"
              className="w-full rounded-md border bg-secondary/30 py-1.5 pr-2 pl-7 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-brass/40"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10.5px] transition-colors",
                  filter === f.id
                    ? "border-brass/50 bg-brass/10 text-brass"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0 px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
          {filtered.length} de {plans.length}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.map((p) => (
            <PlanRow
              key={p.slug}
              plan={p}
              active={p.slug === selected}
              onSelect={() => setSelected(p.slug)}
            />
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {plan && <PlanDetail plan={plan} />}
      </div>
    </div>
  )
}

function PlanRow({
  plan,
  active,
  onSelect,
}: {
  plan: SddPlan
  active: boolean
  onSelect: () => void
}) {
  const done = plan.stage === "done"
  const failed = gateCounts(plan.verification).fail > 0
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col items-start gap-1 rounded-md px-2.5 py-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/55",
      )}
    >
      <span className="w-full truncate text-[12.5px] font-medium text-foreground">
        {plan.title}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "rounded border px-1 py-px text-[9px] tracking-wide uppercase",
            done
              ? "border-st-success/40 text-st-success"
              : "border-brass/40 text-brass",
          )}
        >
          {stageLabel(plan.stage)}
        </span>
        {failed && (
          <span
            className="size-1.5 rounded-full bg-st-error"
            title="gates falhando"
          />
        )}
        {plan.links.pr_url && (
          <GitPullRequest className="size-3 text-muted-foreground/40" />
        )}
      </span>
    </button>
  )
}

function PlanDetail({ plan }: { plan: SddPlan }) {
  const project = useActiveProject()
  const [pr, setPr] = useState<PrInfo | null>(null)
  // enriquece o PR (gh → git → manifest) ao trocar de plano. Lazy: 1 chamada/seleção.
  useEffect(() => {
    setPr(null)
    const sha =
      typeof plan.links.merge_commit === "string" ? plan.links.merge_commit : null
    if (project && plan.links.pr_url) {
      void loadPrInfo(project.path, plan.links.pr_url, sha).then(setPr)
    }
  }, [plan.slug, project?.path])

  const prState =
    pr?.state ?? (plan.stage === "done" || plan.mergedAt ? "MERGED" : "OPEN")
  const mergedAt = pr?.mergedAt ?? plan.mergedAt
  const gc = gateCounts(plan.verification)
  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-5 px-7 py-6">
      {/* header */}
      <div>
        <h1 className="text-[20px] font-medium tracking-[-0.01em] text-foreground">
          {plan.title}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {plan.branch && <span>{plan.branch}</span>}
          {plan.sponsor && <span>· {plan.sponsor}</span>}
          {plan.stageRaw && plan.stageRaw !== plan.stage && (
            <span className="text-muted-foreground/60">· stage cru: {plan.stageRaw}</span>
          )}
        </div>
        {/* resumo (#2): status · PR · gates — at-a-glance, fallback honesto */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span
            className={cn(
              "font-medium",
              plan.stage === "done" ? "text-st-success" : "text-brass",
            )}
          >
            {stageLabel(plan.stage)}
          </span>
          <span className="text-muted-foreground/40">·</span>
          {plan.links.pr_url ? (
            <span className="text-muted-foreground">
              {prLabel(plan.links.pr_url)}
              {prState === "MERGED"
                ? " mergeada"
                : prState === "CLOSED"
                  ? " fechada"
                  : " aberta"}
            </span>
          ) : (
            <span className="text-muted-foreground/60">Sem PR vinculado</span>
          )}
          {(gc.pass > 0 || gc.fail > 0) && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground">{gateSummary(gc)}</span>
            </>
          )}
        </div>
      </div>

      <Pipeline plan={plan} />

      <ContractSection plan={plan} />

      {/* gates tri-state — dinâmico */}
      <Section title="Gates de verificação">
        <Gates verification={plan.verification} />
      </Section>

      {/* artefatos + links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Artefatos">
          <div className="flex flex-col gap-2 text-[12.5px]">
            {plan.artifacts.prd && (
              <Artifact
                label={plan.artifacts.prd.path}
                note={plan.artifacts.prd.approved ? "aprovado" : "não aprovado"}
                ok={plan.artifacts.prd.approved}
              />
            )}
            {plan.artifacts.spec && <Artifact label={plan.artifacts.spec.path} />}
            <p className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {plan.artifacts.sourceFiles.length} arquivos ·{" "}
              {plan.artifacts.migrations.length} migrações ·{" "}
              {plan.artifacts.tests.length} testes
            </p>
          </div>
        </Section>

        <Section title="Entrega">
          <div className="flex flex-col gap-2 text-[12.5px]">
            {plan.links.pr_url ? (
              <button
                onClick={() => void openUrl(plan.links.pr_url!)}
                title={`Abrir no GitHub · ${plan.links.pr_url}`}
                className={cn(
                  "flex w-fit items-center gap-1.5 transition-colors hover:underline",
                  // cores do GitHub: mergeada=roxo, fechada=vermelho, aberta=verde
                  prState === "MERGED"
                    ? "text-[#a371f7] hover:text-[#b892ff]"
                    : prState === "CLOSED"
                      ? "text-st-error hover:text-st-error/80"
                      : "text-[#3fb950] hover:text-[#56d364]",
                )}
              >
                {prState === "MERGED" ? (
                  <GitMerge className="size-3.5" />
                ) : prState === "CLOSED" ? (
                  <GitPullRequestClosed className="size-3.5" />
                ) : (
                  <GitPullRequest className="size-3.5" />
                )}
                {prLabel(plan.links.pr_url)}
              </button>
            ) : (
              <span className="text-muted-foreground">Sem PR ainda</span>
            )}
            {mergedAt && (
              <span className="text-muted-foreground">
                Mergeado em {fmtDateTime(mergedAt)}
                {pr?.mergedBy ? ` por ${pr.mergedBy}` : ""}
              </span>
            )}
            {plan.createdAt && (
              <span className="text-muted-foreground">
                Criado em {fmtDateTime(plan.createdAt)}
              </span>
            )}
          </div>
        </Section>
      </div>

      {(plan.logEvents.length > 0 || plan.logTail) && <ActivitySection plan={plan} />}
    </div>
  )
}

/** Atividade (#10): timeline dos passos `[x]` + LOG cru colapsável. */
function ActivitySection({ plan }: { plan: SddPlan }) {
  const [showRaw, setShowRaw] = useState(false)
  return (
    <Section title="Atividade">
      {plan.logEvents.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {plan.logEvents.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px]">
              <Check className="mt-0.5 size-3.5 shrink-0 text-st-success" />
              <span className="text-foreground/80">{e}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          Sem etapas registradas no LOG.
        </p>
      )}
      {plan.logTail && (
        <div className="mt-3">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-brass hover:underline"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", showRaw && "rotate-180")}
            />
            {showRaw ? "Ocultar trecho do LOG" : "Ver trecho do LOG"}
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-secondary/30 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/75">
              {plan.logTail}
            </pre>
          )}
        </div>
      )}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Pipeline({ plan }: { plan: SddPlan }) {
  const cur = stageIndex(plan.stage)
  const completed = new Set(plan.stagesCompleted)
  const allDone = plan.stage === "done"
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      {/* trilho: pontos espalhados pela largura (conectores flex) — sem scroll */}
      <div className="flex items-start">
        {SDD_STAGES.map((s, i) => {
          const isCurrent = s === plan.stage
          const isDone =
            allDone || completed.has(s) || (cur >= 0 && i < cur && s !== "done")
          return (
            <Fragment key={s}>
              {i > 0 && (
                <div
                  className={cn(
                    "mt-[5px] h-px flex-1",
                    isDone || isCurrent ? "bg-brass/40" : "bg-border",
                  )}
                />
              )}
              <div className="group relative flex shrink-0 flex-col items-center gap-2">
                <span
                  className={cn(
                    "size-2.5 rounded-full transition-colors",
                    isCurrent
                      ? "bg-brass ring-[3px] ring-brass/20"
                      : isDone
                        ? "bg-st-success"
                        : "bg-muted-foreground/25",
                  )}
                />
                <span
                  className={cn(
                    "text-[10.5px] whitespace-nowrap",
                    isCurrent
                      ? "font-medium text-brass"
                      : isDone
                        ? "text-foreground/65"
                        : "text-muted-foreground/45",
                  )}
                >
                  {stageLabel(s)}
                </span>
                <StagePopover stage={s} plan={plan} />
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/** Resumo de um estágio (hover na pipeline) — só dado do manifest, sem dirigir. */
function stageSummary(stage: string, plan: SddPlan): string[] {
  const a = plan.artifacts
  switch (stage) {
    case "discovery":
      return ["Refinamento do escopo"]
    case "prd":
      return a.prd
        ? [`${a.prd.path} · ${a.prd.approved ? "aprovado" : "não aprovado"}`]
        : ["—"]
    case "spec":
      return [
        a.spec?.path ?? "SPEC.md",
        `${plan.scenarioMatrix.length} cenários · ${plan.navSurfaces.length} superfícies`,
      ]
    case "implementation":
      return [`${a.sourceFiles.length} arquivos · ${a.migrations.length} migrações`]
    case "test":
      return [`${a.tests.length} testes`]
    case "review": {
      const c = gateCounts(plan.verification)
      return [gateSummary(c) || "sem gates registrados"]
    }
    case "pr":
      return [
        plan.links.pr_url ? prLabel(plan.links.pr_url) : "sem PR",
        plan.mergedAt ? `mergeado ${fmtDateTime(plan.mergedAt)}` : "",
      ].filter(Boolean)
    case "done":
      return [plan.mergedAt ? `concluído ${fmtDateTime(plan.mergedAt)}` : "concluído"]
    default:
      return []
  }
}

function StagePopover({ stage, plan }: { stage: string; plan: SddPlan }) {
  const lines = stageSummary(stage, plan)
  if (lines.length === 0) return null
  return (
    <div className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg border bg-popover p-2.5 text-left opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover:visible group-hover:opacity-100">
      <p className="mb-0.5 text-[11px] font-medium text-foreground">
        {stageLabel(stage)}
      </p>
      {lines.map((l, i) => (
        <p key={i} className="text-[11.5px] leading-relaxed text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  )
}

/** Contrato da SPEC (#7): resumo + matriz colapsável + superfícies + âncoras. */
function ContractSection({ plan }: { plan: SddPlan }) {
  const [expanded, setExpanded] = useState(false)
  const nScen = plan.scenarioMatrix.length
  const nSurf = plan.navSurfaces.length
  const nAnchor = plan.consistencyAnchors.length
  const PREVIEW = 5
  return (
    <Section title="Contrato da SPEC">
      <p className="-mt-1 mb-3 text-[12px] tabular-nums text-muted-foreground">
        {nScen} cenários · {nSurf} superfícies · {nAnchor} âncoras
      </p>

      {nScen > 0 && (
        <div className="mb-4">
          <SubLabel>Matriz de cenários</SubLabel>
          <ScenarioMatrix
            rows={plan.scenarioMatrix}
            max={expanded ? undefined : PREVIEW}
          />
          {nScen > PREVIEW && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 flex items-center gap-1 text-[12px] text-brass hover:underline"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "Recolher" : `Ver todos os ${nScen} cenários`}
            </button>
          )}
        </div>
      )}

      {nSurf > 0 && (
        <div className="mb-4">
          <SubLabel>Superfícies afetadas</SubLabel>
          <div className="flex flex-wrap gap-1.5">
            {plan.navSurfaces.map((s, i) => (
              <span
                key={i}
                className="rounded-md border bg-secondary/40 px-2 py-0.5 text-[12px] text-foreground/80"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {nAnchor > 0 && (
        <div>
          <SubLabel>Âncoras de consistência</SubLabel>
          <ul className="flex flex-col gap-1 text-[12px]">
            {plan.consistencyAnchors.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                {a.category && <span className="text-foreground/85">{a.category}</span>}
                {a.canon_file && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {a.canon_file}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  )
}

function ScenarioMatrix({
  rows,
  max,
}: {
  rows: SddPlan["scenarioMatrix"]
  max?: number
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Sem matriz de cenários (o SPEC deveria ter ≥3).
      </p>
    )
  }
  const shown = max != null ? rows.slice(0, max) : rows
  // Forma 1 (comum): descrições freeform (string[]) → lista numerada.
  if (rows.some((r) => r.text)) {
    return (
      <ol className="flex flex-col gap-1.5">
        {shown.map((r, i) =>
          r.text ? (
            <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed">
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground/45">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-foreground/80">{r.text}</span>
            </li>
          ) : null,
        )}
      </ol>
    )
  }
  // Forma 2 (canônica): {persona, input, ui, backend} → tabela 4 colunas.
  if (rows.some((r) => r.input || r.ui || r.backend)) {
    return (
      <MatrixTable
        cols={["Persona", "Input / Estado", "UI esperada", "Backend"]}
        rows={shown.map((r) => [r.persona, r.input, r.ui, r.backend])}
      />
    )
  }
  // Forma 3: {persona, summary} → 2 colunas.
  return (
    <MatrixTable
      cols={["Persona", "Cenário"]}
      rows={shown.map((r) => [r.persona, r.summary])}
    />
  )
}

function MatrixTable({
  cols,
  rows,
}: {
  cols: string[]
  rows: (string | null)[][]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b bg-secondary/30 text-[11px] tracking-wide text-muted-foreground uppercase">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b align-top last:border-0">
              {cells.map((v, j) => (
                <Cell key={j} v={v} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ v }: { v: string | null }) {
  // célula vazia = ambiguidade não resolvida (filosofia do usuário) → marca em âmbar
  return (
    <td className="px-3 py-2 text-foreground/80">
      {v ? v : <span className="text-st-warning/80">— vazio</span>}
    </td>
  )
}

function Gates({ verification }: { verification: Record<string, boolean | null> }) {
  const keys = Object.keys(verification)
  if (keys.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">Sem gates registrados.</p>
  }
  const pass = keys.filter((k) => verification[k] === true)
  const fail = keys.filter((k) => verification[k] === false)
  const notRun = keys.filter((k) => verification[k] === null)
  // planos antigos têm tudo null → 1 linha em vez de um muro de chips cinza.
  if (pass.length === 0 && fail.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Verificação não registrada neste plano ({notRun.length} gates).
      </p>
    )
  }
  const ordered = [...fail, ...pass, ...notRun] // falha primeiro, não-rodado por último
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        {gateSummary({
          pass: pass.length,
          fail: fail.length,
          notRun: notRun.length,
        })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((k) => {
          const v = verification[k]
          return (
            <span
              key={k}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
                v === true
                  ? "border-st-success/40 text-st-success"
                  : v === false
                    ? "border-st-error/50 bg-st-error/5 text-st-error"
                    : "border-border/60 text-muted-foreground/50",
              )}
            >
              {v === true ? (
                <Check className="size-3" />
              ) : v === false ? (
                <X className="size-3" />
              ) : (
                <Minus className="size-3" />
              )}
              {gateText(k, v)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Artifact({ label, note, ok }: { label: string; note?: string; ok?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono text-foreground/80">{label}</span>
      {note && (
        <span className={cn("text-[11px]", ok ? "text-st-success" : "text-muted-foreground")}>
          · {note}
        </span>
      )}
    </li>
  )
}
