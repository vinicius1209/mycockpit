import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import {
  Check,
  ChevronDown,
  FileText,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Loader2,
  MessageCircle,
  Minus,
  Play,
  Plus,
  Search,
  Sprout,
  X,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { useActiveProject, useApp } from "@/store/app"
import { runAgent } from "@/lib/agent"
import { reduceItems, useChat, type ChatItem } from "@/store/chat"
import { Markdown } from "@/components/common/Markdown"
import { readTextFile } from "@/lib/sources"
import {
  loadSddPlans,
  loadPrInfo,
  sddReady,
  seedSdd,
  approvePrd,
  createPlan,
  setPlanStage,
  producedStage,
  nextStep,
  stageLabel,
  stageIndex,
  gateText,
  gateCounts,
  SDD_STAGES,
  type SddPlan,
  type PrInfo,
  type SeedSummary,
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

/** Modo SDD, v1: dashboard WATCHER read-only sobre `.claude/plans/`. Mostra o
 *  estado dos planos (pipeline + contrato + gates) sem dirigir nada ainda. */
export function SddView() {
  const project = useActiveProject()
  const [plans, setPlans] = useState<SddPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterId>("todas")
  const [ready, setReady] = useState<boolean | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<SeedSummary | null>(null)
  // v2.4, nova feature, bifurcada: descrição → Explorar (discovery/Linear) OU
  // Criar plano e dirigir (Stage 0 determinístico no cockpit + gate no /prd).
  const [newFeatOpen, setNewFeatOpen] = useState(false)
  const [featDesc, setFeatDesc] = useState("")

  useEffect(() => {
    if (!project) {
      setPlans([])
      setReady(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setSeedResult(null)
    void Promise.all([loadSddPlans(project.path), sddReady(project.path)]).then(
      ([ps, rdy]) => {
        const real = ps.filter((p) => p.hasManifest)
        setPlans(real)
        setReady(rdy)
        setSelected((s) =>
          s && real.some((p) => p.slug === s) ? s : (real[0]?.slug ?? null),
        )
        setLoading(false)
      },
    )
  }, [project?.path])

  // Navegação do inbox: foco pedido de fora → seleciona o plano e consome.
  const focusSlug = useApp((s) => s.sddFocusSlug)
  useEffect(() => {
    if (!focusSlug) return
    if (plans.some((p) => p.slug === focusSlug)) {
      setSelected(focusSlug)
      useApp.getState().setSddFocus(null)
    }
  }, [focusSlug, plans])

  // refresh silencioso do manifest (após rodar uma etapa), mantém a seleção.
  const reload = useCallback(() => {
    if (!project) return
    void loadSddPlans(project.path).then((ps) =>
      setPlans(ps.filter((p) => p.hasManifest)),
    )
  }, [project?.path])

  // v2.0, instala o fluxo SDD num projeto que ainda não tem (scaffold do seed).
  async function initSdd() {
    if (!project) return
    setSeeding(true)
    try {
      const sum = await seedSdd(project.path)
      setSeedResult(sum)
      setReady(true)
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao inicializar SDD")
    } finally {
      setSeeding(false)
    }
  }

  // "Criar plano e dirigir": Stage 0 DETERMINÍSTICO (cockpit cria o manifest do
  // template) + seleciona o plano. Sem rodar agent, o /prd vem depois, no detalhe,
  // com o gate. Espelha o Stage 0 do /feature, sem o autopilot.
  async function createAndDrive() {
    if (!project) return
    const desc = featDesc.trim()
    if (!desc) return
    setNewFeatOpen(false)
    setFeatDesc("")
    try {
      const slug = await createPlan(project.path, desc)
      const ps = (await loadSddPlans(project.path)).filter((p) => p.hasManifest)
      setPlans(ps)
      setSelected(slug)
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao criar o plano")
    }
  }

  // "Explorar (discovery)": discovery é CONVERSA → abre no Linear com o composer
  // pré-preenchido (/discovery <semente>). Você revisa e envia, sem gasto surpresa.
  async function exploreDiscovery() {
    if (!project) return
    const desc = featDesc.trim()
    if (!desc) return
    setNewFeatOpen(false)
    setFeatDesc("")
    await useChat.getState().newConversation(project.id)
    const convId = useChat.getState().activeId
    if (convId) useChat.getState().setDraft(convId, `/discovery ${desc}`)
    useApp.getState().setViewMode("linear")
  }

  // modal de descrição (montado em qualquer estado: lista/vazio).
  const featUI = newFeatOpen ? (
    <NewFeatureModal
      value={featDesc}
      onChange={setFeatDesc}
      onCancel={() => setNewFeatOpen(false)}
      onExplore={() => void exploreDiscovery()}
      onCreate={() => void createAndDrive()}
    />
  ) : null

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
    // instalando, loading CENTRALIZADO (não um texto no botão).
    if (seeding) {
      return (
        <CenteredEmpty
          icon={<Loader2 className="size-7 animate-spin text-brass" />}
          title="Instalando o fluxo SDD…"
          desc="Clonando o seed e copiando o scaffold pro .claude/. Leva uns segundos."
        />
      )
    }
    // acabou de instalar, confirmação CENTRALIZADA com o que foi feito.
    if (seedResult) {
      return (
        <>
          <CenteredEmpty
            icon={<Check className="size-8 text-st-success" />}
            title="Fluxo SDD instalado"
            desc={
              <>
                <span className="text-foreground/70">
                  {seedResult.copied.length} arquivos
                </span>{" "}
                copiados pro <code className="text-foreground/70">.claude/</code>
                {seedResult.skipped.length > 0
                  ? ` · ${seedResult.skipped.length} já existiam (preservados)`
                  : ""}
                . Descreva a primeira feature pra começar.
              </>
            }
          >
            <NewFeatureButton variant="solid" onClick={() => setNewFeatOpen(true)} />
          </CenteredEmpty>
          {featUI}
        </>
      )
    }
    // não-seedado → oferece instalar (v2.0).
    if (ready === false) {
      return (
        <CenteredEmpty
          icon={<Sprout className="size-8 text-brass/60" />}
          title="Este projeto ainda não tem o fluxo SDD"
          desc={
            <>
              Instalo o scaffold (skills do pipeline, agents, hooks, schema) no{" "}
              <code className="text-foreground/70">.claude/</code> a partir do seu
              seed. Não sobrescreve nada que já existe.
            </>
          }
        >
          <button
            onClick={() => void initSdd()}
            className="flex items-center gap-2 rounded-full border border-brass/40 bg-brass/10 px-4 py-2 text-[13px] text-brass transition-colors hover:bg-brass/20"
          >
            <Sprout className="size-4" /> Inicializar SDD
          </button>
        </CenteredEmpty>
      )
    }
    // seedado, mas sem planos ainda.
    return (
      <>
        <CenteredEmpty
          icon={<FileText className="size-8 text-brass/50" />}
          title="Nenhuma feature SDD ainda"
          desc={
            <>
              O fluxo está instalado. Descreva uma feature e o pipeline (PRD → SPEC →
              implementação → testes → review → PR) roda com gates.
            </>
          }
        >
          <NewFeatureButton variant="solid" onClick={() => setNewFeatOpen(true)} />
        </CenteredEmpty>
        {featUI}
      </>
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
          <div className="mt-2">
            <NewFeatureButton onClick={() => setNewFeatOpen(true)} />
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
        {plan && <PlanDetail plan={plan} onReload={reload} />}
      </div>
      {featUI}
    </div>
  )
}

function CenteredEmpty({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode
  title: string
  desc?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
      <div className="mb-3">{icon}</div>
      <p className="text-[15px] text-foreground/80">{title}</p>
      {desc && <p className="mt-1 max-w-md text-[13px] leading-relaxed">{desc}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

/** Botão "Nova feature", `solid` (pílula, nos estados vazios) ou ghost (na lista). */
function NewFeatureButton({
  onClick,
  variant = "ghost",
}: {
  onClick: () => void
  variant?: "ghost" | "solid"
}) {
  if (variant === "solid") {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-2 rounded-full border border-brass/40 bg-brass/10 px-4 py-2 text-[13px] text-brass transition-colors hover:bg-brass/20"
      >
        <Plus className="size-4" /> Nova feature
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-brass/40 hover:text-brass"
    >
      <Plus className="size-3.5" /> Nova feature
    </button>
  )
}

/** Modal da feature nova, bifurcado: a MESMA descrição alimenta os dois caminhos,
 *  Explorar (discovery é conversa → Linear) ou Criar plano e dirigir (Stage 0 + gate). */
function NewFeatureModal({
  value,
  onChange,
  onCancel,
  onExplore,
  onCreate,
}: {
  value: string
  onChange: (v: string) => void
  onCancel: () => void
  onExplore: () => void
  onCreate: () => void
}) {
  const empty = !value.trim()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[560px] rounded-xl border bg-card p-5 shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Sprout className="size-4 text-brass" />
          <h2 className="text-[15px] font-medium text-foreground">Nova feature SDD</h2>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
          Descreva a ideia, vaga ou já clara. Os dois caminhos partem do mesmo texto.
        </p>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !empty) onCreate()
          }}
          rows={3}
          placeholder="Ex.: lembrete de jejum X horas antes do treino, configurável por usuário…"
          className="w-full resize-none rounded-lg border bg-secondary/30 p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-brass/40"
        />

        {/* os dois caminhos (sua escolha): explorar (conversa) vs criar + dirigir */}
        <div className="mt-4 flex flex-col gap-2.5">
          <PathRow
            badge="Ainda é vago"
            desc="Conversa com o discovery no Linear. Ele pergunta (persona, flag, retroatividade…) e fecha o escopo com você."
            action={
              <button
                onClick={onExplore}
                disabled={empty}
                className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                <MessageCircle className="size-3.5" /> Explorar
              </button>
            }
          />
          <PathRow
            badge="Já está claro"
            desc="Cria o plano agora (PRD → SPEC → … com gates). Você roda o /prd no detalhe e aprova antes do SPEC."
            action={
              <button
                onClick={onCreate}
                disabled={empty}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-3 py-1.5 text-[12px] text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
              >
                <Play className="size-3.5" /> Criar plano
              </button>
            }
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">⌘↵ cria o plano</span>
          <button
            onClick={onCancel}
            className="rounded-md border px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function PathRow({
  badge,
  desc,
  action,
}: {
  badge: string
  desc: string
  action: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-secondary/20 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">{badge}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {desc}
        </p>
      </div>
      {action}
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

function PlanDetail({ plan, onReload }: { plan: SddPlan; onReload: () => void }) {
  const project = useActiveProject()
  const [pr, setPr] = useState<PrInfo | null>(null)
  const [run, setRun] = useState<StageRun | null>(null)
  const [doc, setDoc] = useState<DocView | null>(null)
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
  const step = nextStep(plan)

  // v2.1, dirige a próxima etapa via o AgentRunner (claude -p "/{skill} {slug}").
  // v2.4, no sucesso, o cockpit AFIRMA o stage no manifest (determinístico).
  async function runStage() {
    if (!step || step.blockedBy || !project) return
    const ok = await runSkillInto(
      setRun,
      project.path,
      project.permissionMode ?? "padrao",
      step.skill,
      step.prompt,
      `sdd:${plan.slug}`,
    )
    if (ok) {
      const produced = producedStage(step.skill)
      if (produced) {
        try {
          await setPlanStage(project.path, plan.slug, produced)
        } catch {
          /* best-effort, o reload mostra o que o agent já gravou */
        }
      }
    }
  }

  // Caminho de um artefato do plano no disco (.claude/plans/{slug}/{rel}).
  function planFile(rel: string): string {
    return `${project?.path ?? ""}/.claude/plans/${plan.slug}/${rel}`
  }
  // v2.2, gate do PRD: revisar o PRD (read + render); no gate, leva o aprovar junto.
  function reviewPrd() {
    if (!project) return
    const approved = plan.artifacts.prd?.approved
    setDoc({
      title: `PRD · ${plan.slug}`,
      path: planFile(plan.artifacts.prd?.path ?? "PRD.md"),
      root: project.path,
      status: approved ? "aprovado" : "não aprovado",
      approve: approved ? undefined : () => approvePrd(project.path, plan.slug),
    })
  }
  // Ver a SPEC (read-only).
  function viewSpec() {
    if (!project || !plan.artifacts.spec) return
    setDoc({
      title: `SPEC · ${plan.slug}`,
      path: planFile(plan.artifacts.spec.path),
      root: project.path,
    })
  }

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
        {/* resumo (#2): status · PR · gates, at-a-glance, fallback honesto */}
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

      {step &&
        (step.blockedBy === "prd" ? (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span>PRD aguardando sua aprovação:</span>
            <button
              onClick={reviewPrd}
              className="flex items-center gap-1.5 rounded-full border border-brass/40 bg-brass/10 px-3 py-1 text-brass transition-colors hover:bg-brass/20"
            >
              <FileText className="size-3.5" /> Revisar PRD
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span>Próxima etapa:</span>
            <button
              onClick={() => void runStage()}
              disabled={!!run?.running}
              className="flex items-center gap-1.5 rounded-full border border-brass/40 bg-brass/10 px-3 py-1 text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
            >
              <Play className="size-3.5" /> Rodar /{step.skill}
            </button>
          </div>
        ))}

      <ContractSection plan={plan} />

      {/* gates tri-state, dinâmico */}
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
                onClick={reviewPrd}
              />
            )}
            {plan.artifacts.spec && (
              <Artifact label={plan.artifacts.spec.path} onClick={viewSpec} />
            )}
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

      {run && (
        <StageRunOverlay
          run={run}
          onClose={() => {
            setRun(null)
            onReload()
          }}
        />
      )}

      {doc && (
        <DocViewer
          doc={doc}
          onClose={() => setDoc(null)}
          onApproved={() => {
            setDoc(null)
            onReload()
          }}
        />
      )}
    </div>
  )
}

interface StageRun {
  skill: string
  items: ChatItem[]
  streamingTextId: string | null
  model: string | null
  sessionId: string | null
  startedAt: number | null
  running: boolean
}

/** Roda uma skill via o AgentRunner, acumulando o stream num estado de StageRun.
 *  Reusado pelo run de etapa (PlanDetail) e pela criação de feature nova (/prd). */
async function runSkillInto(
  setRun: Dispatch<SetStateAction<StageRun | null>>,
  projectPath: string,
  permission: string,
  skill: string,
  prompt: string,
  convKey: string,
): Promise<boolean> {
  const runId = crypto.randomUUID()
  let cur: StageRun = {
    skill,
    items: [],
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: Date.now(),
    running: true,
  }
  setRun(cur)
  try {
    await runAgent(
      runId,
      convKey,
      "claude-code",
      null,
      null,
      prompt,
      projectPath,
      null,
      permission,
      [],
      (e) => {
        cur = { ...cur, ...reduceItems(cur, e) }
        // update FUNCIONAL: overlay fechado (null) fica fechado; o setter direto
        // ressuscitava o modal a cada evento do stream (achado do aval).
        setRun((prev) => (prev ? cur : prev))
      },
    )
  } catch {
    // erro já chega como card de Error no stream
  }
  cur = { ...cur, running: false }
  setRun((prev) => (prev ? cur : prev))
  // ok = chegou um result bem-sucedido (não bumpa o stage num run que falhou).
  return cur.items.some((it) => it.kind === "result" && it.ok === true)
}

function runText(items: ChatItem[]): string {
  const texts = items.filter(
    (it): it is Extract<ChatItem, { kind: "text" }> => it.kind === "text",
  )
  if (texts.length) return texts.map((t) => t.text).join("\n\n")
  const result = items.find(
    (it): it is Extract<ChatItem, { kind: "result" }> => it.kind === "result",
  )
  return result?.text ?? ""
}

/** Overlay do run de uma etapa (streaming ao vivo), fechar re-lê o manifest. */
function StageRunOverlay({ run, onClose }: { run: StageRun; onClose: () => void }) {
  const text = runText(run.items)
  const result = run.items.find(
    (it): it is Extract<ChatItem, { kind: "result" }> => it.kind === "result",
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8">
      <div className="flex max-h-[80vh] w-full max-w-[760px] flex-col rounded-xl border bg-card shadow-[var(--shadow-pop)]">
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
          {run.running ? (
            <Loader2 className="size-4 animate-spin text-brass" />
          ) : (
            <Check className="size-4 text-st-success" />
          )}
          <span className="font-mono text-[13px] text-foreground">/{run.skill}</span>
          <span className="text-[12px] text-muted-foreground">
            {run.running ? "rodando…" : "concluído"}
          </span>
          {result?.costUsd != null && (
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              ~US${result.costUsd.toFixed(3)}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[13px]">
          {text ? (
            <Markdown text={text} />
          ) : (
            <span className="text-muted-foreground">iniciando…</span>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
          >
            {run.running ? "Fechar (continua em background)" : "Fechar e atualizar"}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Atividade (#10): timeline dos passos `[x]` + LOG cru colapsável. */
interface DocView {
  title: string
  path: string
  /** Raiz permitida da leitura (a pasta do projeto). */
  root: string
  status?: string
  /** Presente = mostra "Aprovar PRD" no rodapé (contexto do gate). */
  approve?: () => Promise<void>
}

/** Visor de um artefato (.md) do plano: lê do disco + render Markdown. No gate do
 *  PRD carrega o aprovar junto (revisar e aprovar no mesmo lugar); na seção
 *  Artefatos abre read-only. Sobrevive a restart (lê o disco, não o stream). */
function DocViewer({
  doc,
  onClose,
  onApproved,
}: {
  doc: DocView
  onClose: () => void
  onApproved: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)

  useEffect(() => {
    setLoading(true)
    setText(null)
    void readTextFile(doc.root, doc.path)
      .then(setText)
      .catch(() => setText(null))
      .finally(() => setLoading(false))
  }, [doc.path])

  async function approve() {
    if (!doc.approve) return
    setApproving(true)
    try {
      await doc.approve()
      onApproved()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao aprovar o PRD")
      setApproving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-[820px] flex-col rounded-xl border bg-card shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
          <FileText className="size-4 text-brass" />
          <span className="text-[13px] font-medium text-foreground">{doc.title}</span>
          {doc.status && (
            <span
              className={cn(
                "text-[11px]",
                doc.status === "aprovado"
                  ? "text-st-success"
                  : "text-muted-foreground",
              )}
            >
              · {doc.status}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[13px]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : text ? (
            <Markdown text={text} />
          ) : (
            <p className="text-muted-foreground">
              Não consegui ler o arquivo. Talvez ainda não tenha sido gerado.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
          >
            Fechar
          </button>
          {doc.approve && (
            <button
              onClick={() => void approve()}
              disabled={approving}
              className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-3 py-1.5 text-[12px] text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
            >
              {approving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Aprovar PRD
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

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
      {/* trilho: pontos espalhados pela largura (conectores flex), sem scroll */}
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

/** Resumo de um estágio (hover na pipeline), só dado do manifest, sem dirigir. */
function stageSummary(stage: string, plan: SddPlan): string[] {
  const a = plan.artifacts
  switch (stage) {
    case "discovery":
      return ["Refinamento do escopo"]
    case "prd":
      return a.prd
        ? [`${a.prd.path} · ${a.prd.approved ? "aprovado" : "não aprovado"}`]
        : ["sem PRD"]
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
      {v ? v : <span className="text-st-warning/80">vazio</span>}
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

function Artifact({
  label,
  note,
  ok,
  onClick,
}: {
  label: string
  note?: string
  ok?: boolean
  onClick?: () => void
}) {
  const inner = (
    <>
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono text-foreground/80">{label}</span>
      {note && (
        <span className={cn("text-[11px]", ok ? "text-st-success" : "text-muted-foreground")}>
          · {note}
        </span>
      )}
    </>
  )
  if (onClick) {
    return (
      <button
        onClick={onClick}
        title="Abrir no cockpit"
        className="flex w-fit items-center gap-2 rounded text-left transition-colors hover:underline"
      >
        {inner}
      </button>
    )
  }
  return <div className="flex items-center gap-2">{inner}</div>
}
