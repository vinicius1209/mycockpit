import {
  useCallback,
  useEffect,
  useRef,
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
  RefreshCw,
  Sprout,
  X,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { confirm } from "@/lib/confirm"
import { useActiveProject, useApp } from "@/store/app"
import { runAgent } from "@/lib/agent"
import { buildDoctrineBlock, readDoctrine } from "@/lib/doctrine"
import { reduceItems, useChat, type ChatItem } from "@/store/chat"
import { Markdown } from "@/components/common/Markdown"
import { readTextFile } from "@/lib/sources"
import { fmtCost } from "@/lib/format"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { insertStageRun, listStageRuns, type StageRunRow } from "@/lib/db"
// Adoção do plano: todo gesto humano DAQUI marca o plano como "seu" no app, e
// só então os gates dele contam como pendência no sino/painel (antes disso são
// achado de disco). A marca é do app; o .claude/plans nunca é escrito por isso.
import { adoptPlan } from "@/lib/inbox"
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
  effectiveStage,
  stageLabel,
  stageIndex,
  gateText,
  gateCounts,
  type SddPlan,
  type SddTrack,
  type PrInfo,
  type SeedSummary,
} from "@/lib/sdd"
import { fmtDateTime, gateSummary, prLabel } from "@/components/sdd/sddFormat"
import { Pipeline } from "@/components/sdd/StagePipeline"
import { cn } from "@/lib/utils"

/** Marca a adoção do plano (ADR-032) e AVISA quando não conseguiu gravar: sem
 *  isso o gesto do humano some em silêncio e o plano cai, errado, em
 *  "Encontrados no projeto". Vale pros gestos que não deixam outro rastro
 *  (criar, aprovar PRD, marcar/sincronizar etapa); etapa DIRIGIDA não precisa,
 *  a linha em stage_runs já prova a adoção sozinha. */
async function adoptOrWarn(
  projectId: string,
  slug: string,
  titulo = "Não consegui marcar a adoção do plano",
): Promise<void> {
  if (await adoptPlan(projectId, slug)) return
  toast.warning(titulo, {
    description:
      "Ele fica em 'Encontrados no projeto' no Painel; use 'Adotar' por lá.",
  })
}

/** Modo SDD: o DETALHE de uma feature, em largura total. A lista de features
 *  vive na SIDEBAR (F2, docs/product-evolution.md — uma lista só por objeto):
 *  seleção via useApp.sddFocusSlug (fonte única) e criação via o contador
 *  useApp.sddCreateRequested. */
export function SddView() {
  const project = useActiveProject()
  const [plans, setPlans] = useState<SddPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState<boolean | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<SeedSummary | null>(null)
  // v2.4, nova feature, bifurcada: descrição → Explorar (discovery/Linear) OU
  // Criar plano e dirigir (Stage 0 determinístico no cockpit + gate no /prd).
  const [newFeatOpen, setNewFeatOpen] = useState(false)
  const [featDesc, setFeatDesc] = useState("")
  // trilha da feature nova: full (PRD+SPEC formais) por default; quick pula pro código.
  const [featTrack, setFeatTrack] = useState<SddTrack>("full")

  // Seleção = fonte ÚNICA: sddFocusSlug (sidebar e inbox setam via setSddFocus).
  const focusSlug = useApp((s) => s.sddFocusSlug)

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
        // Auto-seleção: NADA focado → primeiro plano (a sidebar acompanha, é o
        // mesmo estado). Slug focado que não existe fica como está — o render
        // cai no estado vazio, sem roubar um foco setado por outra intenção.
        const app = useApp.getState()
        if (!app.sddFocusSlug && real[0]) app.setSddFocus(real[0].slug)
        setLoading(false)
      },
    )
  }, [project?.path])

  // Criação pedida de fora (sidebar): o contador MUDOU → abre o dialog.
  // Pula o valor inicial (não abre ao montar/trocar de view).
  const createRequested = useApp((s) => s.sddCreateRequested)
  const createSeen = useRef(createRequested)
  useEffect(() => {
    if (createRequested === createSeen.current) return
    createSeen.current = createRequested
    setNewFeatOpen(true)
  }, [createRequested])

  // refresh silencioso do manifest (após rodar uma etapa), mantém a seleção.
  const reload = useCallback(() => {
    if (!project) return
    void loadSddPlans(project.path).then((ps) => {
      setPlans(ps.filter((p) => p.hasManifest))
      useApp.getState().bumpSddData() // sidebar recarrega a lista dela
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const track = featTrack
    setNewFeatOpen(false)
    setFeatDesc("")
    setFeatTrack("full")
    try {
      const slug = await createPlan(project.path, desc, track)
      // nasceu AQUI: já entra adotado (os gates dele contam desde o primeiro dia).
      // Se a marca não gravar (banco travado), o plano existe no disco mas cai
      // em "Encontrados no projeto" no Painel: diz isso em vez de deixar o
      // usuário achar que o app perdeu a procedência do que ele acabou de criar.
      await adoptOrWarn(project.id, slug, "Plano criado, mas não consegui marcar a adoção")
      const ps = (await loadSddPlans(project.path)).filter((p) => p.hasManifest)
      setPlans(ps)
      useApp.getState().setSddFocus(slug)
      useApp.getState().bumpSddData() // a feature nova aparece na sidebar
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

  // dialog de descrição (montado em qualquer estado: detalhe/vazio).
  const featUI = (
    <NewFeatureDialog
      open={newFeatOpen}
      onOpenChange={setNewFeatOpen}
      value={featDesc}
      onChange={setFeatDesc}
      track={featTrack}
      onTrack={setFeatTrack}
      onExplore={() => void exploreDiscovery()}
      onCreate={() => void createAndDrive()}
    />
  )

  // seleção derivada, sem estado local: o slug focado que existir nos planos.
  const plan = focusSlug ? plans.find((p) => p.slug === focusSlug) : undefined

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
          icon={<Loader2 className="size-7 animate-spin text-muted-foreground" />}
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
            <NewFeatureButton onClick={() => setNewFeatOpen(true)} />
          </CenteredEmpty>
          {featUI}
        </>
      )
    }
    // não-seedado → oferece instalar (v2.0).
    if (ready === false) {
      return (
        <CenteredEmpty
          icon={<Sprout className="size-8 text-muted-foreground/60" />}
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
          icon={<FileText className="size-8 text-muted-foreground/50" />}
          title="Nenhuma feature SDD ainda"
          desc={
            <>
              O fluxo está instalado. Descreva uma feature e o pipeline (PRD → SPEC →
              implementação → testes → review → PR) roda com gates.
            </>
          }
        >
          <NewFeatureButton onClick={() => setNewFeatOpen(true)} />
        </CenteredEmpty>
        {featUI}
      </>
    )
  }

  // Detalhe em LARGURA TOTAL — a lista mora na sidebar. Sem seleção válida
  // (nada focado sem planos? impossível aqui; slug morto/limpo) → estado vazio
  // com saída: criar uma feature nova.
  return (
    <div className="h-full overflow-y-auto bg-background">
      {plan ? (
        <PlanDetail plan={plan} onReload={reload} />
      ) : (
        <CenteredEmpty
          icon={<FileText className="size-8 text-muted-foreground/50" />}
          title="Selecione uma feature na barra lateral"
          desc="As features SDD deste projeto agora vivem na sidebar. Escolha uma pra ver o pipeline, os gates e a entrega, ou comece uma nova."
        >
          <NewFeatureButton
            onClick={() => useApp.getState().requestSddCreate()}
          />
        </CenteredEmpty>
      )}
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
      <p className="text-[14px] text-foreground/80">{title}</p>
      {desc && <p className="mt-1 max-w-md text-[13px] leading-relaxed">{desc}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

/** Botão "Nova feature" (pílula brass, usado nos estados vazios). */
function NewFeatureButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-brass/40 bg-brass/10 px-4 py-2 text-[13px] text-brass transition-colors hover:bg-brass/20"
    >
      <Plus className="size-4" /> Nova feature
    </button>
  )
}

/** Dialog da feature nova, bifurcado: a MESMA descrição alimenta os dois caminhos,
 *  Explorar (discovery é conversa → Linear) ou Criar plano e dirigir (Stage 0 + gate).
 *  Aberto localmente (estados vazios) ou de fora, via o contador sddCreateRequested. */
function NewFeatureDialog({
  open,
  onOpenChange,
  value,
  onChange,
  track,
  onTrack,
  onExplore,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (v: string) => void
  track: SddTrack
  onTrack: (t: SddTrack) => void
  onExplore: () => void
  onCreate: () => void
}) {
  const empty = !value.trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 rounded-xl bg-card p-5 shadow-[var(--shadow-pop)] sm:max-w-[560px]">
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-[14px] leading-normal font-medium text-foreground">
            <Sprout className="size-4 text-brass" /> Nova feature SDD
          </DialogTitle>
          <DialogDescription className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
            Descreva a ideia, vaga ou já clara. Os dois caminhos partem do mesmo
            texto.
          </DialogDescription>
        </DialogHeader>
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

        {/* trilha do plano (vale pro "Criar plano"): proporcional ao tamanho da mudança */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="mr-0.5 text-muted-foreground">Trilha:</span>
          <button
            onClick={() => onTrack("full")}
            title="Pipeline inteiro: PRD e SPEC formais antes do código"
            className={cn(
              "rounded-full border px-2.5 py-0.5 transition-colors",
              track === "full" ? SELECTED_FILL : UNSELECTED,
            )}
          >
            Completa · PRD + SPEC
          </button>
          <button
            onClick={() => onTrack("quick")}
            title="Sem PRD/SPEC formais: Descoberta → Implementação → Testes → Review → PR"
            className={cn(
              "rounded-full border px-2.5 py-0.5 transition-colors",
              track === "quick" ? SELECTED_FILL : UNSELECTED,
            )}
          >
            Rápida · direto pra implementação
          </button>
        </div>

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
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
          >
            Cancelar
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {desc}
        </p>
      </div>
      {action}
    </div>
  )
}

function PlanDetail({ plan, onReload }: { plan: SddPlan; onReload: () => void }) {
  const project = useActiveProject()
  const [pr, setPr] = useState<PrInfo | null>(null)
  const [run, setRun] = useState<StageRun | null>(null)
  const [doc, setDoc] = useState<DocView | null>(null)
  // custo por entrega: as etapas dirigidas desta feature (breakdown no Entrega).
  const [stageRuns, setStageRuns] = useState<StageRunRow[]>([])
  useEffect(() => {
    setStageRuns([])
    if (project) void listStageRuns(project.id, plan.slug).then(setStageRuns)
  }, [plan.slug, project?.id])
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
  // STAGE EFETIVO (evidência fs+git do backend + estado real do PR); o declarado
  // no manifest pode estar atrás da realidade → a UI segue a realidade.
  const effective = effectiveStage(plan, pr)
  const drift = stageIndex(effective) > stageIndex(plan.stage)
  const step = nextStep(plan, effective)
  const [syncing, setSyncing] = useState(false)

  // "Sincronizar etapa": grava o stage EFETIVO no manifest (o cache declarado
  // para de mentir) e recarrega os planos.
  async function syncStage() {
    if (!project) return
    setSyncing(true)
    try {
      await setPlanStage(project.path, plan.slug, effective)
      await adoptOrWarn(project.id, plan.slug)
      onReload()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao sincronizar a etapa")
    } finally {
      setSyncing(false)
    }
  }

  // Escape MANUAL (docs/sdd-evolution.md): quando a evidência NÃO consegue provar
  // (ex.: trabalho feito numa branch diferente da declarada no manifest, mergeado
  // sem PR vinculado), o humano marca a etapa clicando no trilho. Confirma antes;
  // monotônico (set_plan_stage só avança).
  async function markStage(stage: string) {
    if (!project) return
    const ok = await confirm({
      title: `Marcar "${stageLabel(stage)}" como etapa atual?`,
      description:
        "Use quando o trabalho foi feito fora do fluxo e a evidência não alcança " +
        "(ex.: branch diferente da declarada). As etapas anteriores contam como feitas.",
      confirmLabel: "Marcar etapa",
    })
    if (!ok) return
    try {
      await setPlanStage(project.path, plan.slug, stage)
      await adoptOrWarn(project.id, plan.slug)
      onReload()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao marcar a etapa")
    }
  }

  // v2.1, dirige a próxima etapa via o AgentRunner (claude -p "/{skill} {slug}").
  // v2.4, no sucesso, o cockpit AFIRMA o stage no manifest (determinístico).
  async function runStage() {
    if (!step || step.blockedBy || !project) return
    const ok = await runSkillInto(
      setRun,
      project.id,
      project.path,
      project.permissionMode ?? "padrao",
      step.skill,
      step.prompt,
      plan.slug,
    )
    if (ok) {
      // dirigiu uma etapa daqui: o plano passa a ser SEU no app (conta na fila).
      // Sem aviso se a marca não gravar: a linha em stage_runs desta etapa já
      // adota o plano sozinha (ADR-032), alarmar aqui seria falso positivo.
      await adoptPlan(project.id, plan.slug)
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
      approve: approved
        ? undefined
        : async () => {
            await approvePrd(project.path, plan.slug)
            // aprovou PELO APP: se ainda restar gate nesse plano, ele passa a
            // contar como pendência de verdade (não mais "achado no disco").
            await adoptOrWarn(project.id, plan.slug)
          },
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
    // largura total da view (a lista saiu): generosa e centrada — o pipeline
    // e a matriz de cenários respiram em vez de espremer.
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-8 py-6">
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

      <Pipeline plan={plan} pr={pr} onMarkStage={(s) => void markStage(s)} />

      {step?.blockedBy === "prd" ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span>PRD aguardando sua aprovação:</span>
          <button
            onClick={reviewPrd}
            className="flex items-center gap-1.5 rounded-full border border-brass/40 bg-brass/10 px-3 py-1 text-brass transition-colors hover:bg-brass/20"
          >
            <FileText className="size-3.5" /> Revisar PRD
          </button>
        </div>
      ) : (
        (step || drift) && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            {step && (
              <>
                <span>Próxima etapa:</span>
                <button
                  onClick={() => void runStage()}
                  disabled={!!run?.running}
                  className="flex items-center gap-1.5 rounded-full border border-brass/40 bg-brass/10 px-3 py-1 text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
                >
                  <Play className="size-3.5" /> Rodar /{step.skill}
                </button>
              </>
            )}
            {drift && (
              <button
                onClick={() => void syncStage()}
                disabled={syncing}
                title={`Grava "${stageLabel(effective)}" no manifest (hoje declara "${stageLabel(plan.stage)}")`}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-foreground/80 transition-colors hover:bg-accent disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Sincronizar etapa
              </button>
            )}
          </div>
        )
      )}

      <ContractSection plan={plan} />

      {/* gates tri-state, dinâmico */}
      <Section title="Gates de verificação">
        <Gates verification={plan.verification} />
      </Section>

      {/* artefatos + links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Artefatos">
          <div className="flex flex-col gap-2 text-[13px]">
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
          <div className="flex flex-col gap-2 text-[13px]">
            {plan.links.pr_url ? (
              <button
                onClick={() => void openUrl(plan.links.pr_url!)}
                title={`Abrir no GitHub · ${plan.links.pr_url}`}
                className={cn(
                  "flex w-fit items-center gap-1.5 transition-colors hover:underline",
                  // Cores do GitHub por TOKEN (--git-merged/--git-open), com
                  // par claro/escuro: o #3fb950 nativo é ilegível sobre fundo
                  // claro. Domínio git é a exceção declarada do STYLEGUIDE §2.
                  prState === "MERGED"
                    ? "text-git-merged hover:text-git-merged/80"
                    : prState === "CLOSED"
                      ? "text-st-error hover:text-st-error/80"
                      : "text-git-open hover:text-git-open/80",
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
            <CostBlock
              merged={plan.stage === "done" || !!mergedAt}
              runs={stageRuns}
            />
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
            if (project) void listStageRuns(project.id, plan.slug).then(setStageRuns)
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
  projectId: string,
  projectPath: string,
  permission: string,
  skill: string,
  prompt: string,
  slug: string,
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
  // DOUTRINA do projeto: a etapa do SDD é uma sessão fresca que ESCREVE spec e
  // código no repo. Roda em claude-code, que leria um CLAUDE.md — mas o
  // projeto pode não ter um, e as regras do MyCockpit moram na doutrina.
  const doctrine = buildDoctrineBlock((await readDoctrine(projectPath)).content)
  try {
    await runAgent(
      runId,
      `sdd:${slug}`,
      "claude-code",
      null,
      null,
      doctrine ? `${doctrine}\n\n${prompt}` : prompt,
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
  } catch (e) {
    // O comentário antigo dizia "erro já chega como card de Error no stream" —
    // e isso é FALSO para falha de SPAWN: se o runAgent rejeita antes de abrir o
    // stream (CLI ausente, cwd inválido), nenhum evento chega e o overlay
    // simplesmente para, sem dizer nada. Injeta o erro no fio, que é o que
    // store/fusion.ts e lib/mission.ts já fazem na mesma classe de chamada.
    const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
    console.error("[sdd] etapa dirigida falhou antes do stream", e)
    cur = {
      ...cur,
      items: [...cur.items, { kind: "error", id: crypto.randomUUID(), message: msg }],
    }
    setRun((prev) => (prev ? cur : prev))
    toast.error("A etapa não iniciou.", { description: msg })
  }
  cur = { ...cur, running: false }
  setRun((prev) => (prev ? cur : prev))
  // Custo por ENTREGA: persiste a etapa dirigida (falha também conta como run;
  // sem isso o custo do run morria junto com o overlay).
  const result = [...cur.items]
    .reverse()
    .find((it): it is Extract<ChatItem, { kind: "result" }> => it.kind === "result")
  void insertStageRun({
    projectId,
    slug,
    skill,
    agent: "claude-code",
    model: result?.model ?? cur.model,
    ok: result?.ok === true,
    costUsd: result?.costUsd ?? null,
    costSource: result?.costSource ?? null,
    durationMs: cur.startedAt != null ? Date.now() - cur.startedAt : null,
  })
  // ok = chegou um result bem-sucedido (não bumpa o stage num run que falhou).
  return result?.ok === true
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
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
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
          <FileText className="size-4 text-muted-foreground" />
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
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <Check className="mt-0.5 size-3.5 shrink-0 text-st-success" />
              <span className="text-foreground/80">{e}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted-foreground">
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
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-secondary/30 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/75">
              {plan.logTail}
            </pre>
          )}
        </div>
      )}
    </Section>
  )
}

/** Custo por ENTREGA: soma das etapas dirigidas PELO COCKPIT (runs feitos no
 *  terminal por fora não contam; o rótulo é honesto sobre isso). */
function CostBlock({ merged, runs }: { merged: boolean; runs: StageRunRow[] }) {
  const total = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  if (total < 0.0005) return null
  const estimated = runs.some(
    (r) => r.costUsd != null && r.costSource !== "reported",
  )
  const bySkill = new Map<string, number>()
  for (const r of runs) {
    bySkill.set(r.skill, (bySkill.get(r.skill) ?? 0) + (r.costUsd ?? 0))
  }
  const breakdown = [...bySkill.entries()]
    .filter(([, v]) => v > 0.0005)
    .map(([k, v]) => `/${k} ${v.toFixed(2)}`)
    .join(" · ")
  return (
    <div className="flex flex-col gap-0.5 pt-0.5">
      <span className="text-muted-foreground">
        {merged ? "Entregue por " : "Custo até aqui: "}
        <span className="font-mono tabular-nums text-foreground/80">
          {fmtCost(total, estimated ? "estimated" : "reported")}
        </span>{" "}
        em {runs.length} {runs.length === 1 ? "etapa dirigida" : "etapas dirigidas"}
      </span>
      {breakdown && (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
          {breakdown}
        </span>
      )}
    </div>
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

/** Sinais que puxaram o stage efetivo à frente do declarado (tooltip do badge). */
/** Contrato da SPEC (#7): resumo + matriz colapsável + superfícies + âncoras. */
function ContractSection({ plan }: { plan: SddPlan }) {
  const [expanded, setExpanded] = useState(false)
  const nScen = plan.scenarioMatrix.length
  const nSurf = plan.navSurfaces.length
  // âncora sem NENHUM campo preenchido renderizava <li> vazio (título órfão no
  // painel). Filtra e conta só as renderizáveis — a contagem fica honesta.
  const anchors = plan.consistencyAnchors.filter(
    (a) => a.category || a.canon_file || a.reference_doc,
  )
  const nAnchor = anchors.length
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
            {anchors.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                {a.category && <span className="text-foreground/85">{a.category}</span>}
                {(a.canon_file || a.reference_doc) && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {a.canon_file || a.reference_doc}
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
      <p className="text-[13px] text-muted-foreground">
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
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
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
      <table className="w-full text-left text-[13px]">
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
    return <p className="text-[13px] text-muted-foreground">Sem gates registrados.</p>
  }
  const pass = keys.filter((k) => verification[k] === true)
  const fail = keys.filter((k) => verification[k] === false)
  const notRun = keys.filter((k) => verification[k] === null)
  // planos antigos têm tudo null → 1 linha em vez de um muro de chips cinza.
  if (pass.length === 0 && fail.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
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
