import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  Bot,
  Check,
  ChevronRight,
  CornerDownRight,
  FileDiff,
  FilePen,
  FileText,
  Gauge,
  Globe,
  Globe2,
  GraduationCap,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  RotateCcw,
  Search,
  Square,
  Terminal,
  User,
  Wrench,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { DESTINATIONS } from "@/lib/agents"
import type { AgentDef } from "@/lib/agentDefs"
import { fmtCost, fmtDuration, fmtTime, fmtTokens } from "@/lib/format"
import type { Attachment } from "@/lib/attachments"
import { attachmentUrl } from "@/lib/attachments"
import { attachmentRead, attachmentReadLabel } from "@/lib/attachmentRead"
import type { SaveLessonOutcome } from "@/lib/learning"
import {
  cleanResultText,
  describeToolGroup,
  evidenceMeta,
  presentTool,
  resultMeta,
  summarizeToolGroup,
  type ToolKind,
} from "@/lib/toolview"
import {
  bornOpen,
  settledOkStubLabel,
  shouldAutoCollapseOnSettle,
} from "@/components/chat/toolGroupDisclosure"
import { EVIDENCE_MISSING, evidenceName, evidenceUrl } from "@/lib/evidence"
import { useLightbox, type LightboxImage } from "@/store/lightbox"
import { lineDiff, trimOuterContext, type DiffRow } from "@/lib/linediff"
import { deriveTaskPlans, type AgentPlan } from "@/lib/tasks"
import { openDeliveryDiff } from "@/lib/deliveryDiff"
import { Markdown } from "@/components/common/Markdown"
import { AgentLogo, agentLogoLabel } from "@/components/common/AgentLogo"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import {
  buildNodes,
  type IncidentNode,
  type Node,
  type ToolItem,
} from "@/components/chat/messageNodes"
import { groupByAuthor, groupTs, type MessageGroup } from "@/components/chat/messageGroups"
import { buildAdviceHandoffBlock } from "@/lib/advisor"
import { shortDigest } from "@/lib/presets"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { splitMentions } from "@/components/chat/mentions"
import { usePresets } from "@/store/presets"
import {
  deferredLiveLine,
  pendingDeferred,
  useChat,
  type ChatItem,
} from "@/store/chat"
import type { DeferredWork } from "@/lib/work"
import { agentLabel } from "@/lib/agent"

/** Máx. de linhas mostradas num bloco de diff (Edit/Write) antes de "… +N linhas". */
const DIFF_MAX_LINES = 80
/** Máx. de nós renderizados numa conversa longa (o resto atrás do botão). */
const CHAT_WINDOW = 150

const KIND_ICON: Record<ToolKind, LucideIcon> = {
  bash: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  generic: Wrench,
}

export interface ToolTreeNode {
  item: ToolItem
  children: ToolTreeNode[]
}

/** Reconstrói a topologia reportada pelo provider. Pai ausente/desconhecido
 * vira raiz (fail-open para históricos e adapters sem hierarquia). */
export function buildToolForest(tools: ToolItem[]): ToolTreeNode[] {
  const byToolId = new Map(
    tools.filter((t) => t.toolId).map((t) => [t.toolId!, t] as const),
  )
  const children = new Map<string, ToolItem[]>()
  const roots: ToolItem[] = []
  for (const tool of tools) {
    if (tool.parentToolId && byToolId.has(tool.parentToolId)) {
      const list = children.get(tool.parentToolId) ?? []
      list.push(tool)
      children.set(tool.parentToolId, list)
    } else {
      roots.push(tool)
    }
  }
  const building = new Set<string>()
  const node = (item: ToolItem): ToolTreeNode => {
    const key = item.toolId ?? item.id
    if (building.has(key)) return { item, children: [] }
    building.add(key)
    const out = {
      item,
      children: (item.toolId ? children.get(item.toolId) : undefined)?.map(node) ?? [],
    }
    building.delete(key)
    return out
  }
  return roots.map(node)
}

function branchContains(node: ToolTreeNode, itemId: string | null | undefined): boolean {
  if (!itemId) return false
  return (
    node.item.id === itemId ||
    node.children.some((child) => branchContains(child, itemId))
  )
}

/** O ramo carrega trabalho diferido do provider ainda VIVO (D1.2)? Mantém o nó
 *  do Workflow exposto (fora do histórico recolhido) enquanto o background
 *  task roda de verdade dentro do CLI. */
function branchHasLiveDeferred(node: ToolTreeNode): boolean {
  return (
    node.item.deferred?.status === "running" ||
    node.children.some(branchHasLiveDeferred)
  )
}

/** O ramo carrega alguma FALHA? Ramo falhado nunca entra no stub de concluídas
 *  (a falha não se esconde — despoluição do fio, mock B ③). */
function branchHasFailure(node: ToolTreeNode): boolean {
  return (
    node.item.result?.ok === false || node.children.some(branchHasFailure)
  )
}

/** Ações no ramo (plano, inclui descendentes) — alimenta a contagem honesta do
 *  stub "N concluídas · mostrar". */
function branchSize(node: ToolTreeNode): number {
  return 1 + node.children.reduce((acc, child) => acc + branchSize(child), 0)
}

/** Ancestral rolável do fio (o ChatPanel usa um div overflow-y-auto). null em
 *  testes/SSR: sem scroll não há leitor pra perder o tapete, o recolhimento
 *  segue o default. */
function scrollContainerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1) {
      const overflowY = getComputedStyle(p).overflowY
      if (overflowY === "auto" || overflowY === "scroll") return p
    }
  }
  return null
}

/** Cronômetro ao vivo enquanto o run pensa (atualiza a cada 1s). */
function Elapsed({ since, className }: { since: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className={cn("tabular-nums", className)}>{fmtDuration(now - since)}</span>
  )
}

/** Reúne os hunks de um tool de edição + contagem. Edit → 1 hunk; MultiEdit →
 *  1 por edição; Write → tudo adição. null = não é tool de edição. */
function editHunks(
  name: string,
  input: Record<string, unknown>,
): { hunks: DiffRow[][]; added: number; removed: number } | null {
  const acc = { hunks: [] as DiffRow[][], added: 0, removed: 0 }
  const push = (o: string, nw: string) => {
    const d = lineDiff(o, nw)
    acc.hunks.push(d.rows)
    acc.added += d.added
    acc.removed += d.removed
  }
  if (
    name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    push(input.old_string, input.new_string)
    return acc
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits as Record<string, unknown>[]) {
      if (e && typeof e.old_string === "string") {
        push(e.old_string, typeof e.new_string === "string" ? e.new_string : "")
      }
    }
    return acc.hunks.length ? acc : null
  }
  if (name === "Write" && typeof input.content === "string") {
    push("", input.content)
    return acc
  }
  return null
}

/** Diff unificado (interleaved), estilo Warp: contexto cinza + add/del
 *  coloridos, contexto externo aparado, cap de linhas. */
function UnifiedDiff({ rows }: { rows: DiffRow[] }) {
  const trimmed = trimOuterContext(rows)
  const shown = trimmed.slice(0, DIFF_MAX_LINES)
  const hidden = trimmed.length - shown.length
  return (
    <div className="overflow-x-auto py-1 font-mono text-[11.5px] leading-relaxed">
      {shown.map((r, idx) => (
        <div
          key={idx}
          className={cn(
            "flex gap-2 px-2",
            r.type === "add" && "bg-st-success/10",
            r.type === "del" && "bg-st-error/10",
          )}
        >
          <span
            className={cn(
              "w-3 shrink-0 select-none text-center",
              r.type === "add"
                ? "text-st-success"
                : r.type === "del"
                  ? "text-st-error"
                  : "text-transparent",
            )}
          >
            {r.type === "add" ? "+" : r.type === "del" ? "−" : " "}
          </span>
          <span
            data-selectable
            className={cn(
              "break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
              r.type === "ctx" ? "text-muted-foreground/70" : "text-foreground/85",
            )}
          >
            {r.text || " "}
          </span>
        </div>
      ))}
      {hidden > 0 && (
        <div className="px-2 pl-7 text-muted-foreground">… +{hidden} linhas</div>
      )}
    </div>
  )
}

/** Status de uma ação técnica. `recorded` é histórico antigo/adapter sem
 * resultado: neutro, nunca finge que ainda está pendente. */
type StepStatus = "ok" | "error" | "running" | "recorded"

function StepDot({ status }: { status: StepStatus }) {
  // Sucesso é o caso comum: ponto NEUTRO (paleta A da despoluição — a tinta
  // sobra pra falha e pro que gira). Um tom acima do `recorded` pra distinguir
  // "concluiu bem" de "sem resultado registrado".
  if (status === "ok")
    return <span className="size-[7px] shrink-0 rounded-full bg-muted-foreground/45" />
  if (status === "error")
    return <span className="size-[7px] shrink-0 rounded-full bg-st-error" />
  // Passo em execução GIRA (mesmo vocabulário do ToolGroupStatus): "girando =
  // este passo executando". O dot pulsante fica reservado ao rodapé
  // "trabalhando" (batimento do turno + cronômetro) — os dois sinais deixam de
  // ser dois pontos azuis idênticos.
  if (status === "running")
    return <Loader2 className="size-3 shrink-0 animate-spin text-st-running" />
  return <span className="size-[7px] shrink-0 rounded-full bg-muted-foreground/25" />
}

/** Tool call como LINHA (círculo de status + ícone + rótulo + meta), colapsável.
 *  A prosa do agent é o conteúdo; a ferramenta é rodapé, não caixa. `active` =
 *  o turno está rodando E este é o passo corrente (sem result ainda). */
const ToolLine = memo(function ToolLine({
  node,
  activeToolId,
  agent,
  depth = 1,
  deferredPending = false,
  headerLabel,
  onStop,
  onRetry,
}: {
  node: ToolTreeNode
  activeToolId?: string | null
  agent: string
  depth?: number
  /** Há trabalho em background do provider vivo neste fio (D1.4): o botão de
   *  interromper avisa que ele morre junto com o turno. */
  deferredPending?: boolean
  /** Rótulo que o CABEÇALHO do grupo já mostra (despoluição, paleta A ①): se
   *  esta linha repetiria a mesma string, ela mostra só o delta (estado). Só
   *  vem preenchido no nível 1; falha nunca dedupa (a linha é a evidência). */
  headerLabel?: string
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
}) {
  const { item, children } = node
  const active =
    branchContains(node, activeToolId) ||
    item.managedProcess?.status === "running" ||
    item.managedProcess?.status === "stopping" ||
    item.deferred?.status === "running"
  const p = presentTool(item.name, item.input)
  const Icon = KIND_ICON[p.kind]
  const i = (item.input ?? {}) as Record<string, unknown>
  const diff = editHunks(item.name, i)
  // Nível 2 do disclosure: primeiro se abre o grupo semântico; só um gesto
  // explícito revela comando/input/output/diff desta ação.
  const [open, setOpen] = useState(active && children.length > 0)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const failed = item.result?.ok === false
  const status: StepStatus = item.result
    ? item.result.ok
      ? "ok"
      : "error"
    : active
      ? "running"
      : "recorded"
  const res = resultMeta(item.name, item.result)
  const processMeta = item.managedProcess
    ? `PID ${item.managedProcess.pid} · ${item.managedProcess.status}`
    : null
  // Estado do trabalho diferido no PRÓPRIO rótulo da linha (D1.2). Rodando, o
  // nó é MARCO ("iniciado", onde o trabalho nasceu): quem narra o agora é a
  // linha viva do rodapé, e dois painéis vivos competindo foi a confusão dos
  // builds 181/182 (background-status B2.2).
  const deferredMeta = item.deferred
    ? item.deferred.status === "running"
      ? "iniciado"
      : item.deferred.status === "completed"
        ? "concluiu"
        : "interrompido"
    : null
  // Rótulo UMA vez (despoluição, paleta A ①): quando o cabeçalho do grupo já é
  // o dono desta MESMA string, o filho mostra só o delta dele — o estado (que
  // no diferido já é a meta "iniciado/concluiu/interrompido"). Falha não
  // dedupa: a linha falhada é a evidência e mantém o nome.
  const echoesHeader =
    headerLabel != null && status !== "error" && p.label === headerLabel
  const stateWord =
    status === "running"
      ? "em execução"
      : status === "ok"
        ? "concluído"
        : "registrado"
  const label = echoesHeader ? (deferredMeta ?? stateWord) : p.label
  const meta = [
    p.meta,
    processMeta,
    echoesHeader ? null : deferredMeta,
    res,
    evidenceMeta(item.images),
  ]
    .filter(Boolean)
    .join(" · ")
  // Suprime o boilerplate de sucesso do write/edit ("File created…") — vira ""
  // e o bloco de result nem aparece (o cartão já mostra arquivo + diff).
  const resultText = cleanResultText(item.name, item.result)
  const expandable = Boolean(
    p.detail ||
      diff ||
      resultText ||
      item.agentSummary ||
      item.deferred?.outputFile ||
      children.length,
  )
  // Ação no dono certo (background-status B2.4): no cartão de UM trabalho só
  // cabe ação DAQUELE trabalho. "Interromper turno" mata o turno inteiro, então
  // mora na superfície do turno (o Parar do composer, com a copy do D1.4). No
  // nó de trabalho diferido ele ainda era pior: depois do `result` o runId já é
  // null (chat.ts:1050) e o clique não parava nada — botão de teatro.
  const stopInHeader =
    active &&
    onStop &&
    item.deferred == null &&
    (p.kind === "agent" || item.managedProcess != null)
  const briefingLines = p.detail ? Math.max(1, p.detail.split("\n").length) : 0

  useEffect(() => {
    if (active && children.length) setOpen(true)
  }, [active, children.length])

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center">
        <button
          onClick={() => expandable && setOpen((o) => !o)}
          data-work-node
          data-node-id={item.toolId ?? item.id}
          data-parent-id={item.parentToolId}
          role="treeitem"
          aria-level={depth}
          aria-expanded={expandable ? open : undefined}
          tabIndex={-1}
          className={cn(
            "group/step flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-[12.5px] transition-colors",
            expandable && "hover:bg-accent/40",
            p.emphasis === "warning" && status !== "error" && "text-brass",
            // passo em execução PULA da sequência: leve tinta st-running.
            status === "running" && "bg-st-running/[0.06]",
          )}
        >
        <span
          className="grid size-3.5 shrink-0 place-items-center"
          title={status === "recorded" ? "sem resultado registrado" : undefined}
        >
          <StepDot status={status} />
        </span>
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            failed
              ? "text-st-error"
              : p.emphasis === "warning" || p.kind === "edit" || p.kind === "write"
                ? "text-brass"
                : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "truncate",
            // estado no PRÓPRIO rótulo (não só no ponto): concluído assenta,
            // em execução fica pleno → a sequência ganha ritmo de progresso.
            failed
              ? "text-st-error"
              : status === "ok"
                ? "text-foreground/55"
                : status === "running"
                  ? "text-foreground"
                  : p.emphasis === "warning"
                    ? "text-brass"
                    : "text-foreground/75",
          )}
        >
          {label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {diff ? (
            // contagem de diff em SUSSURRO (paleta A: metadado, não semáforo);
            // as cores continuam dentro do diff aberto, onde são evidência.
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
              {diff.added > 0 && `+${diff.added}`}
              {diff.added > 0 && diff.removed > 0 && " "}
              {diff.removed > 0 && `−${diff.removed}`}
            </span>
          ) : (
            meta && (
              <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                {meta}
              </span>
            )
          )}
          {/* Selo do motor saiu do nó (background-status B2.3): ele mora no
              cabeçalho do agente (work-hierarchy) — repetido em cada linha
              virava ruído ao lado do rótulo de transporte. */}
          {expandable && (
            // seta de expandir no FIM (longe do ícone `>_` → sem duplicação).
            <ChevronRight
              className={cn(
                "size-3 text-muted-foreground/45 transition-transform group-hover/step:text-muted-foreground/70",
                open && "rotate-90",
              )}
            />
          )}
        </span>
        </button>
        {stopInHeader && (
          <button
            type="button"
            onClick={() => onStop(item)}
            title={
              item.managedProcess
                ? "Para este processo e os filhos dele"
                : deferredPending
                  ? "O provider não expõe cancelamento individual deste subagente; interrompe o turno completo e o trabalho em background morre junto"
                  : "O provider não expõe cancelamento individual deste subagente; interrompe o turno completo"
            }
            className="mr-1 inline-flex shrink-0 items-center gap-1 rounded border border-st-error/30 px-1.5 py-0.5 text-[10px] text-st-error transition-colors hover:bg-st-error/10"
          >
            <Square className="size-2.5" />
            <span className="hidden lg:inline">
              {item.managedProcess ? "Parar" : "Interromper turno"}
            </span>
          </button>
        )}
      </div>
      {/* Evidência VISUAL do resultado (B1): sempre à mostra (o valor é VER o
          que o agent viu), thumbnail modesto — detalhe é no lightbox. Tool sem
          imagem não rende nada aqui (fail-open). */}
      {item.images && item.images.length > 0 && (
        <div className="mt-1 mb-1 ml-7 flex flex-wrap gap-1.5">
          {item.images.map((path, i) => (
            <EvidenceThumb
              key={path}
              path={path}
              onOpen={() =>
                useLightbox.getState().open(evidenceGallery(item.images!), i)
              }
            />
          ))}
        </div>
      )}
      {open && (
        <div className="ml-[7px] border-l border-border/45 pl-2.5">
          {p.kind === "agent" && p.detail && (
            <div className="mt-1 mb-1.5 overflow-hidden rounded-md border border-border/55 bg-secondary/10">
              <button
                type="button"
                onClick={() => setBriefingOpen((value) => !value)}
                aria-expanded={briefingOpen}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground"
              >
                <MessageSquareQuote className="size-3.5 shrink-0" />
                <span>Briefing do agente</span>
                <span className="font-mono text-[10.5px] text-muted-foreground/70">
                  · {briefingLines} linha{briefingLines === 1 ? "" : "s"}
                </span>
                <ChevronRight
                  className={cn(
                    "ml-auto size-3 text-muted-foreground/45 transition-transform",
                    briefingOpen && "rotate-90",
                  )}
                />
              </button>
              {briefingOpen && (
                <div
                  data-selectable
                  className="max-h-52 overflow-y-auto border-t border-border/45 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/70"
                >
                  {p.detail}
                </div>
              )}
            </div>
          )}
          {((p.kind !== "agent" && p.detail) ||
            diff ||
            resultText ||
            item.agentSummary ||
            (item.result && onRetry)) && (
            <div className="mt-1 mb-1.5 overflow-hidden rounded-md border border-border/60 bg-secondary/20">
              {p.kind !== "agent" && p.detail && (
                <div className="p-2">
                  <p className="mb-1 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                    {p.kind === "bash" ? "Comando" : "Entrada"}
                  </p>
                  <div
                    data-selectable
                    className="font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/70"
                  >
                    {p.detail}
                  </div>
                </div>
              )}
              {diff && (
                <div
                  className={cn(
                    p.kind !== "agent" &&
                      p.detail &&
                      "border-t border-border/50",
                  )}
                >
                  <p className="px-2 pt-2 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                    Alterações
                  </p>
                  {diff.hunks.map((rows, idx) => (
                    <div
                      key={idx}
                      className={cn(idx > 0 && "border-t border-border/40")}
                    >
                      <UnifiedDiff rows={rows} />
                    </div>
                  ))}
                </div>
              )}
              {resultText && (
                <div className="border-t border-border/50 p-2">
                  <p className="mb-1 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                    {failed ? "Erro" : "Saída"}
                  </p>
                  <div
                    data-selectable
                    className={cn(
                      "font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
                      failed ? "text-st-error" : "text-muted-foreground",
                    )}
                  >
                    {resultText}
                  </div>
                </div>
              )}
              {item.agentSummary && (
                <div className="border-t border-border/50 p-2">
                  <p className="mb-1 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                    Retorno do agente
                  </p>
                  <div
                    data-selectable
                    className="text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/75"
                  >
                    {item.agentSummary}
                  </div>
                </div>
              )}
              {item.deferred?.outputFile && item.deferred.status !== "running" && (
                <div className="border-t border-border/50 p-2">
                  <p className="mb-1 text-[9.5px] tracking-wide text-muted-foreground/70 uppercase">
                    Resultado em disco
                  </p>
                  <div
                    data-selectable
                    className="font-mono text-[11px] leading-relaxed break-words [overflow-wrap:anywhere] text-muted-foreground"
                  >
                    {item.deferred.outputFile}
                  </div>
                </div>
              )}
              {/* Retomar ≠ repetir (decisão 3 do deferred-work-plan): num nó de
                  trabalho diferido, "Repetir etapa" relançaria o workflow do
                  zero pagando tudo de novo — só o INTERROMPIDO ganha ação, e
                  ela é Retomar (reaproveita o cache via resumeFromRunId). */}
              {item.result &&
                onRetry &&
                (!item.deferred || item.deferred.status === "interrupted") && (
                  <div className="flex items-center justify-end gap-1.5 border-t border-border/50 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRetry(item)
                      }}
                      title={
                        item.deferred
                          ? "Retoma o trabalho em background de onde parou, reaproveitando o cache do workflow (não relança do zero)"
                          : undefined
                      }
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <RotateCcw className="size-3" />{" "}
                      {item.deferred ? "Retomar" : "Repetir etapa"}
                    </button>
                  </div>
                )}
            </div>
          )}
          {children.length > 0 && (
            <ToolNodeList
              nodes={children}
              activeToolId={activeToolId}
              agent={agent}
              depth={depth + 1}
              parentId={item.toolId ?? item.id}
              live={active}
              deferredPending={deferredPending}
              onStop={onStop}
              onRetry={onRetry}
            />
          )}
        </div>
      )}
    </div>
  )
})

/** Durante o voo, ações já resolvidas viram um único registro recolhido e só o
 * ramo ativo permanece exposto. Num grupo ASSENTADO com falha, a linha falhada
 * fica exposta (a falha não se esconde) e as concluídas viram o stub
 * "N concluídas · mostrar" (mock B ③/④). Aberto, cada shell/arquivo volta a
 * ser navegável individualmente pelas setas. */
function ToolNodeList({
  nodes,
  activeToolId,
  agent,
  depth,
  parentId,
  live,
  deferredPending,
  headerLabel,
  onStop,
  onRetry,
}: {
  nodes: ToolTreeNode[]
  activeToolId?: string | null
  agent: string
  depth: number
  parentId?: string
  live: boolean
  deferredPending?: boolean
  /** Rótulo do cabeçalho do grupo (só no nível 1) — vai pro dedup da ToolLine. */
  headerLabel?: string
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const activeNodes = live
    ? nodes.filter(
        (node) =>
          branchContains(node, activeToolId) ||
          node.item.managedProcess?.status === "running" ||
          node.item.managedProcess?.status === "stopping" ||
          branchHasLiveDeferred(node),
      )
    : []
  const settledNodes = nodes.filter((node) => !activeNodes.includes(node))
  // Ramo com falha fica EXPOSTO; só as concluídas se recolhem atrás do stub.
  const failedNodes = settledNodes.filter(branchHasFailure)
  const okNodes = settledNodes.filter((node) => !failedNodes.includes(node))
  // Em voo, o histórico ok recolhe a partir de 2 (comportamento existente);
  // assentado com falha, TODA concluída vira stub — quem expandiu quer a culpada.
  const foldOk = live
    ? okNodes.length >= 2
    : failedNodes.length > 0 && okNodes.length >= 1
  const summary = summarizeToolGroup(
    okNodes.map((node) => node.item),
    false,
  )
  const okCount = okNodes.reduce((acc, node) => acc + branchSize(node), 0)
  const historyId = `history:${parentId ?? "root"}:${depth}`

  const renderNode = (node: ToolTreeNode) => (
    <ToolLine
      key={node.item.id}
      node={node}
      activeToolId={activeToolId}
      agent={agent}
      depth={depth}
      deferredPending={deferredPending}
      headerLabel={headerLabel}
      onStop={onStop}
      onRetry={onRetry}
    />
  )

  if (!foldOk) {
    return (
      <div role="group" className="flex flex-col gap-px">
        {nodes.map(renderNode)}
      </div>
    )
  }

  return (
    <div role="group" className="flex flex-col gap-px">
      {failedNodes.map(renderNode)}
      <button
        type="button"
        onClick={() => setHistoryOpen((value) => !value)}
        data-work-node
        data-node-id={historyId}
        data-parent-id={parentId}
        role="treeitem"
        aria-level={depth}
        aria-expanded={historyOpen}
        tabIndex={-1}
        className="group/history flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-[12px] text-muted-foreground/75 transition-colors hover:bg-accent/35 hover:text-foreground"
      >
        {live ? (
          <>
            <span className="grid size-3.5 shrink-0 place-items-center">
              <ToolGroupStatus state={summary.state} />
            </span>
            <span className="truncate">{summary.label}</span>
            <ChevronRight
              className={cn(
                "ml-auto size-3 text-muted-foreground/40 transition-transform group-hover/history:text-muted-foreground/70",
                historyOpen && "rotate-90",
              )}
            />
          </>
        ) : (
          // stub quieto do grupo falhado: as ok existiram, mas não pagam o
          // pato — visíveis só a pedido (o verbo é o affordance, sem chevron).
          <span className="truncate underline-offset-4 group-hover/history:underline">
            {settledOkStubLabel(okCount, historyOpen)}
          </span>
        )}
      </button>
      {historyOpen && (
        <div className="ml-[7px] border-l border-border/40 pl-2">
          {okNodes.map(renderNode)}
        </div>
      )}
      {activeNodes.map(renderNode)}
    </div>
  )
}

function ToolGroupStatus({
  state,
}: {
  state: ReturnType<typeof summarizeToolGroup>["state"]
}) {
  if (state === "running")
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-st-running" />
  if (state === "error")
    return <X className="size-3.5 shrink-0 text-st-error" aria-hidden="true" />
  // Check CINZA (paleta A): a forma segue dizendo "concluiu", sem competir com
  // a falha (vermelha) e com o vivo (st-running) pela atenção.
  if (state === "ok")
    return (
      <Check
        className="size-3.5 shrink-0 text-muted-foreground/60"
        aria-hidden="true"
      />
    )
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
}

function ActivityAge({ at, stalled }: { at?: number; stalled?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!at) return null
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  const label =
    seconds < 5
      ? "agora"
      : seconds < 60
        ? `há ${seconds}s`
        : `há ${Math.floor(seconds / 60)}min`
  return (
    <span className={cn("font-mono text-[10px]", stalled && "text-st-warning")}>
      {stalled ? "sem eventos " : "atividade "}
      {label}
    </span>
  )
}

/** Registro de voo: UMA caption por burst — e, assentado, UMA linha por grupo
 * (despoluição do fio, direção B): o resumo é a informação (contagem, duração
 * congelada, culpada nomeada na falha); o detalhe fica a um clique. */
function ToolGroup({
  tools,
  active = false,
  agent,
  stalledSince,
  onStop,
  onRetry,
}: {
  tools: ToolItem[]
  /** turno rodando E este é o grupo corrente → o passo sem result "roda". */
  active?: boolean
  agent: string
  stalledSince?: number
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const manuallyToggled = useRef(false)
  const processLive = tools.some(
    (tool) =>
      tool.managedProcess?.status === "running" ||
      tool.managedProcess?.status === "stopping",
  )
  // Trabalho diferido VIVO mantém o grupo aceso (D1.2): ele roda dentro do CLI
  // mesmo com o texto do turno já parado.
  const deferredLive = tools.some(
    (tool) => tool.deferred?.status === "running",
  )
  const live = active || processLive || deferredLive
  const wasActive = useRef(live)
  const forest = useMemo(() => buildToolForest(tools), [tools])
  const activeToolId = live
    ? [...tools]
        .reverse()
        .find(
          (tool) =>
            !tool.result ||
            tool.managedProcess?.status === "running" ||
            tool.managedProcess?.status === "stopping" ||
            tool.deferred?.status === "running",
        )?.id ?? null
    : null
  // Digest do cabeçalho numa passada só, memoizado por grupo: este é o
  // componente mais quente do app — nada de varredura extra por render.
  const digest = useMemo(
    () => describeToolGroup(tools, live && activeToolId != null),
    [tools, live, activeToolId],
  )
  const failedInGroup = digest.failed > 0
  // Concluído NASCE recolhido; só o vivo nasce aberto; falha nasce aberta
  // mostrando a culpada (regra em toolGroupDisclosure.ts).
  const [open, setOpen] = useState(() =>
    bornOpen({ live, failed: failedInGroup }),
  )
  const lastActivity = tools.reduce(
    (latest, tool) =>
      Math.max(
        latest,
        tool.managedProcess?.updatedAt ?? tool.activityAt ?? tool.ts ?? 0,
      ),
    0,
  )
  const diffTotal = useMemo(
    () =>
      tools.reduce(
        (acc, t) => {
          const d = editHunks(t.name, (t.input ?? {}) as Record<string, unknown>)
          if (d) {
            acc.added += d.added
            acc.removed += d.removed
          }
          return acc
        },
        { added: 0, removed: 0 },
      ),
    [tools],
  )

  // A atividade corrente abre pra dar feedback ao vivo. Quando termina,
  // recolhe sozinha SÓ quando não puxa o tapete de ninguém: nunca sobre toggle
  // manual, nunca sobre falha, e nunca se o leitor desancorou do fundo com o
  // grupo visível (regra exata documentada em toolGroupDisclosure.ts).
  useEffect(() => {
    if (live && !manuallyToggled.current) setOpen(true)
    if (wasActive.current && !live) {
      const el = rootRef.current
      const container = el ? scrollContainerOf(el) : null
      const rect = el?.getBoundingClientRect()
      const crect = container?.getBoundingClientRect()
      const groupInViewport =
        rect != null &&
        crect != null &&
        rect.bottom > crect.top &&
        rect.top < crect.bottom
      const followingBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight <
          80
        : true
      if (
        shouldAutoCollapseOnSettle({
          manuallyToggled: manuallyToggled.current,
          failed: failedInGroup,
          groupInViewport,
          followingBottom,
        })
      )
        setOpen(false)
    }
    wasActive.current = live
  }, [live, failedInGroup])

  function onTreeKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-work-root], [data-work-node]",
    )
    if (!target) return
    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        "[data-work-root], [data-work-node]",
      ),
    ).filter((el) => el.offsetParent !== null)
    const index = focusables.indexOf(target)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const delta = e.key === "ArrowDown" ? 1 : -1
      focusables[Math.max(0, Math.min(focusables.length - 1, index + delta))]?.focus()
      return
    }
    if (e.key === "ArrowRight") {
      e.preventDefault()
      if (target.getAttribute("aria-expanded") === "false") target.click()
      else focusables[index + 1]?.focus()
      return
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      if (target.getAttribute("aria-expanded") === "true") {
        target.click()
        return
      }
      const parentId = target.dataset.parentId
      const parent = focusables.find((el) => el.dataset.nodeId === parentId)
      ;(parent ?? focusables[0])?.focus()
    }
  }

  return (
    <div ref={rootRef} className="min-w-0" onKeyDown={onTreeKeyDown}>
      <button
        onClick={() => {
          manuallyToggled.current = true
          setOpen((o) => !o)
        }}
        data-work-root
        aria-expanded={open}
        className={cn(
          "group/activity flex w-full items-center gap-2 rounded-md border-l-2 border-l-transparent px-1.5 py-1.5 text-left text-[12px] transition-colors hover:bg-accent/35 focus-visible:border-l-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          live && "border-l-st-running bg-st-running/[0.045]",
          digest.state === "error"
            ? "text-st-error"
            : digest.state === "running"
              ? "text-foreground"
              : digest.emphasis === "warning"
                ? "text-brass"
                : digest.emphasis === "quiet"
                  ? "text-muted-foreground/75"
                  : "text-muted-foreground",
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
          <ToolGroupStatus state={digest.state} />
        </span>
        <span className="min-w-0 flex-1 truncate">{digest.label}</span>
        <span className="hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
          {digest.agents > 0 && (
            <span>
              {digest.agents} agente{digest.agents === 1 ? "" : "s"}
            </span>
          )}
          {digest.agents > 0 && digest.shells > 0 && (
            <span aria-hidden="true">·</span>
          )}
          {digest.shells > 0 && (
            <span>
              {digest.shells} shell{digest.shells === 1 ? "" : "s"}
            </span>
          )}
          {live && (
            <>
              {(digest.agents > 0 || digest.shells > 0) && (
                <span aria-hidden="true">·</span>
              )}
              <ActivityAge
                at={stalledSince ?? lastActivity}
                stalled={stalledSince != null}
              />
            </>
          )}
        </span>
        {(diffTotal.added > 0 || diffTotal.removed > 0) && (
          // sussurro (paleta A): o total de diff informa sem virar semáforo.
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
            {diffTotal.added > 0 && `+${diffTotal.added}`}
            {diffTotal.added > 0 && diffTotal.removed > 0 && " "}
            {diffTotal.removed > 0 && `−${diffTotal.removed}`}
          </span>
        )}
        {/* Duração TOTAL congelada do grupo assentado (pretérito, regra do
            Warp: tabular, coluna fixa à direita, quem trunca é o nome). O vivo
            não ganha relógio aqui — o "agora" é da linha viva do rodapé. */}
        {!live && digest.durationMs != null && (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
            {fmtDuration(digest.durationMs)}
          </span>
        )}
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/35 transition-transform group-hover/activity:text-muted-foreground/70",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          role="tree"
          aria-label="Fio Vivo da execução"
          className="mt-0.5 ml-[7px] flex flex-col gap-px border-l border-border/40 pl-2.5"
        >
          <ToolNodeList
            nodes={forest}
            activeToolId={activeToolId}
            agent={agent}
            depth={1}
            live={live}
            deferredPending={deferredLive}
            headerLabel={digest.label}
            onStop={onStop}
            onRetry={onRetry}
          />
        </div>
      )}
    </div>
  )
}

/** Galeria de lightbox a partir dos paths de evidência de UMA tool. */
function evidenceGallery(paths: string[]): LightboxImage[] {
  return paths.map((path) => ({
    path,
    name: evidenceName(path),
    source: "evidencia" as const,
  }))
}

/** Thumbnail de evidência visual de tool_result (B1). Arquivo sumido do disco
 *  → chip honesto ("evidência removida"), nunca <img> quebrada. */
function EvidenceThumb({ path, onOpen }: { path: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    evidenceUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [path])
  if (failed) {
    return (
      <span className="rounded-md border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
        {EVIDENCE_MISSING}
      </span>
    )
  }
  if (!url) {
    return <span className="h-20 w-28 animate-pulse rounded-lg border bg-secondary/40" />
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${evidenceName(path)} (clique para ampliar)`}
      className="overflow-hidden rounded-lg border transition-colors hover:border-brass/60"
    >
      <img
        src={url}
        alt={evidenceName(path)}
        className="max-h-32 max-w-[220px] object-contain"
      />
    </button>
  )
}

/** Thumbnail de um anexo no histórico (bytes → object URL cacheado). */
function AttachmentThumb({
  att,
  read,
  onOpen,
}: {
  att: Attachment
  /** Selo de leitura: null = nada a afirmar (inlinado / sem telemetria). */
  read: { text: string; warn: boolean } | null
  /** Abre o anexo no lightbox (só imagens; PDF segue chip). */
  onOpen?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    attachmentUrl(att)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.path])
  if (att.kind === "pdf") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span className="max-w-[160px] truncate">{att.name}</span>
        <ReadBadge read={read} />
      </span>
    )
  }
  if (failed) {
    return (
      <span className="rounded-md border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
        anexo expirado
      </span>
    )
  }
  if (!url) {
    return <span className="size-20 animate-pulse rounded-lg border bg-secondary/40" />
  }
  // Parte 2 do B1: o anexo enviado volta a ser ABRÍVEL (feedback real:
  // "depois de enviada eu não consigo abrir e ver detalhes") — clique abre o
  // mesmo lightbox da evidência de tool.
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        title={onOpen ? `${att.name} (clique para ampliar)` : att.name}
        className={cn(
          "overflow-hidden rounded-lg border",
          onOpen && "transition-colors hover:border-brass/60",
        )}
      >
        <img
          src={url}
          alt={att.name}
          className="max-h-44 max-w-[220px] object-contain"
        />
      </button>
      {read && (
        <span className="absolute right-1 bottom-1">
          <ReadBadge read={read} />
        </span>
      )}
    </span>
  )
}

/** Selo do anexo: prova (ou falta dela) de que o agent ABRIU o arquivo.
 *  No Claude e no agy o anexo é um ponteiro — o modelo decide abrir —, então
 *  "respondeu" nunca significou "olhou". O rastro já existia no fio (a chamada
 *  da ferramenta de leitura); isto só o mostra. */
function ReadBadge({ read }: { read: { text: string; warn: boolean } | null }) {
  if (!read) return null
  return (
    <span
      title={
        read.warn
          ? "O agent respondeu sem abrir este anexo — a resposta pode não considerá-lo."
          : "O agent abriu este anexo durante o turno."
      }
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm",
        read.warn
          ? "bg-st-warning/20 text-st-warning ring-1 ring-st-warning/40"
          : "bg-card/85 text-muted-foreground ring-1 ring-border",
      )}
    >
      {read.text}
    </span>
  )
}

/** Contrato de feedback do Linear (M2), threadado do ChatPanel. `null` fora do
 *  Linear (Fusion/Mission não têm este loop). O gate humano vive no card:
 *  distill PROPÕE, o clique GRAVA. */
export interface FeedbackApi {
  /** Persiste a reação no RESULTADO terminal. Retorna true quando adicionou
   *  (false = removeu), para o reforço só contar sinais positivos novos. */
  onReact: (resultId: string, reaction: string) => Promise<boolean>
  /** Destila um candidato de regra + o veredito de learnability (Haiku julga se
   *  há algo durável). learnable:false → a UI avisa mas deixa salvar (gate humano). */
  distill: (
    agentTurn: string,
    userNote: string,
  ) => Promise<{ rule: string; learnable: boolean | null }>

  /** Grava a regra após o gate humano (dedup interno). O desfecho distingue
   *  duplicata de FALHA — antes os dois viravam `false` e a UI dizia "duplicata"
   *  quando o banco tinha caído. */
  save: (
    rule: string,
    scope: "global" | "project",
    reaction?: string | null,
  ) => Promise<SaveLessonOutcome>
}

const TURN_REACTIONS = [
  { emoji: "👍", label: "Gostei" },
  { emoji: "🎯", label: "Preciso" },
  { emoji: "🧠", label: "Boa análise" },
  { emoji: "🧪", label: "Bem testado" },
  { emoji: "⚡", label: "Eficiente" },
  { emoji: "👎", label: "Precisa melhorar" },
] as const
const MORE_REACTIONS = ["🚀", "✨", "🔥", "💡", "🧹", "🐢", "⚠️", "❤️"] as const

/** UMA superfície de feedback por resultado de turno. Emoji é sinal leve;
 *  memória permanente exige nota → proposta editável → confirmação humana. */
function TurnFeedback({
  resultId,
  agentTurn,
  reactions,
  api,
}: {
  resultId: string
  agentTurn: string
  reactions: string[]
  api: FeedbackApi
}) {
  // "idle" | "ask" (input inline) | "card" (propor regra) | "done"
  const [mode, setMode] = useState<"idle" | "ask" | "card" | "done">("idle")
  const [selectedReaction, setSelectedReaction] = useState<string | null>(
    reactions.at(-1) ?? null,
  )
  const [note, setNote] = useState("")
  const [rule, setRule] = useState("")
  // veredito do juiz de learnability: false = pouco generalizável (avisa, não bloqueia).
  const [learnable, setLearnable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  async function react(reaction: string) {
    const added = await api.onReact(resultId, reaction)
    setSelectedReaction(added ? reaction : null)
  }

  function openAsk() {
    const negative = selectedReaction === "👎"
    setNote(
      negative
        ? ""
        : selectedReaction
          ? `O que funcionou com ${selectedReaction} e deve se repetir: `
          : "",
    )
    setMode("ask")
  }

  // input enviado → destila (Haiku ou cru) e mostra o card editável (gate humano).
  async function propose() {
    const n = note.trim()
    if (!n) return
    setBusy(true)
    try {
      const candidate = await api.distill(agentTurn, n)
      setRule(candidate.rule)
      setLearnable(candidate.learnable)
      setMode("card")
    } finally {
      setBusy(false)
    }
  }

  async function commit(scope: "global" | "project") {
    const r = rule.trim()
    if (!r) return
    setBusy(true)
    try {
      const r2 = await api.save(r, scope, selectedReaction)
      setMode(r2 === "salva" ? "done" : "idle")
      if (r2 === "duplicata") toastDuplicate()
      if (r2 === "erro") {
        toast.error("Não consegui salvar a regra.", {
          description: "O detalhe está no console. Sua regra NÃO foi gravada.",
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border-t border-border/45 pt-2">
      <div className="flex flex-wrap items-center gap-1">
        {TURN_REACTIONS.map(({ emoji, label }) => {
          const active = reactions.includes(emoji)
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => void react(emoji)}
              aria-pressed={active}
              title={label}
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[13px] leading-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active
                  ? "border-brass/45 bg-brass/10"
                  : "border-transparent bg-secondary/50",
              )}
            >
              <span aria-hidden>{emoji}</span>
              <span className="sr-only">{label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-label="Mais reações"
          className="rounded-full border border-transparent bg-secondary/50 px-1.5 py-0.5 text-[13px] leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          ＋
        </button>
        {(moreOpen ||
          reactions.some((reaction) =>
            (MORE_REACTIONS as readonly string[]).includes(reaction),
          )) && (
          <span className="flex items-center gap-0.5 rounded-full border bg-card p-0.5 shadow-sm">
            {MORE_REACTIONS.filter(
              (emoji) => moreOpen || reactions.includes(emoji),
            ).map((emoji) => {
              const active = reactions.includes(emoji)
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => void react(emoji)}
                  aria-pressed={active}
                  aria-label={`Reagir com ${emoji}`}
                  className={cn(
                    "rounded-full px-1 py-0.5 text-[13px] leading-none hover:bg-accent",
                    active && "bg-brass/10",
                  )}
                >
                  {emoji}
                </button>
              )
            })}
          </span>
        )}
        <button
          type="button"
          onClick={openAsk}
          className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-brass"
        >
          <GraduationCap className="size-3.5" /> Transformar em aprendizado
        </button>
        {mode === "done" && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-st-success">
            <Check className="size-3" /> Regra salva
          </span>
        )}
      </div>

      {mode === "ask" && (
        <div className="mt-2 flex items-center gap-1.5">
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void propose()
            if (e.key === "Escape") setMode("idle")
          }}
          placeholder={
            selectedReaction === "👎"
              ? "O que faltou ou deveria mudar?"
              : "O que funcionou e deve se repetir?"
          }
          className="min-w-0 flex-1 rounded-md border bg-background/60 px-2 py-1 text-[12px] outline-none focus:border-brass/60"
        />
        <button
          onClick={() => void propose()}
          disabled={busy || !note.trim()}
          className="shrink-0 rounded-md bg-brass px-2 py-1 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            "Propor aprendizado"
          )}
        </button>
        <button
          onClick={() => setMode("idle")}
          aria-label="Cancelar"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      )}

      {mode === "card" && (
      <div
        className={cn(
          "mt-1.5 flex flex-col gap-2 rounded-lg border p-2.5",
          learnable === false
            ? "border-st-warning/40 bg-st-warning/5"
            : "border-brass/40 bg-brass/5",
        )}
      >
        {learnable === false ? (
          <div className="flex items-start gap-1.5 text-[11px] text-st-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" /> Isso parece
            pouco generalizável — nada óbvio pra virar regra. Salve só se for
            mesmo uma preferência durável.
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <GraduationCap className="size-3.5 text-brass" /> Aprendizado
            proposto — confirme antes de tornar permanente
          </div>
        )}
        <textarea
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border bg-background/60 px-2 py-1.5 text-[12.5px] leading-snug outline-none focus:border-brass/60"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => void commit("project")}
            disabled={busy || !rule.trim()}
            className="rounded-md bg-brass px-2.5 py-1 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Salvar regra
          </button>
          <button
            onClick={() => void commit("global")}
            disabled={busy || !rule.trim()}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Globe2 className="size-3.5" /> Salvar como global
          </button>
          <button
            onClick={() => setMode("idle")}
            className="rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Descartar
          </button>
          {busy && <Loader2 className="size-3.5 animate-spin text-brass" />}
        </div>
      </div>
      )}
    </div>
  )
}

/** Aviso leve de duplicata: dedup preferível a ruído (nunca grava 2 regras iguais). */
function toastDuplicate() {
  toast("Já existe uma regra parecida — não salvei de novo.")
}

/** Telemetria de fim de turno como INSTRUMENTO (não linha cinza corrida): o dado
 *  mais denso do app — tempo, tokens por direção, cache, custo — em células
 *  rotuladas, com o custo promovido a brass. */
function TurnTelemetry({
  it,
  incidentTone,
}: {
  it: Extract<ChatItem, { kind: "result" }>
  incidentTone?: "limit"
}) {
  const hasUsage = it.usage && (it.usage.input > 0 || it.usage.output > 0)
  // Caption de fim de turno: linha DISCRETA, alinhada ao conteúdo da mensagem
  // (sem sangrar pro gutter, sem cartão). O dado continua todo lá — só que como
  // legenda: custo em brass, "concluído" verde. flex-wrap + min-w-0 = sem scroll.
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground/80">
      <span
        className={cn(
          "flex items-center gap-1 font-medium",
          it.ok
            ? "text-st-success"
            : incidentTone === "limit"
              ? "text-st-warning"
              : "text-st-error",
        )}
      >
        {it.ok ? (
          <Check className="size-3" />
        ) : incidentTone === "limit" ? (
          <Gauge className="size-3" />
        ) : (
          <AlertCircle className="size-3" />
        )}
        {it.ok ? "concluído" : incidentTone === "limit" ? "turno encerrado" : "erro"}
      </span>
      {it.durationMs != null && (
        <>
          <Sep />
          <span className="tabular-nums">{fmtDuration(it.durationMs)}</span>
        </>
      )}
      {hasUsage && (
        <>
          <Sep />
          <span className="tabular-nums">
            {fmtTokens(it.usage!.input)} ↓ · {fmtTokens(it.usage!.output)} ↑
          </span>
        </>
      )}
      {it.usage && it.usage.cacheRead > 0 && (
        <>
          <Sep />
          <span className="tabular-nums">cache {fmtTokens(it.usage.cacheRead)}</span>
        </>
      )}
      {it.model && (
        <>
          <Sep />
          <span className="truncate">{it.model}</span>
        </>
      )}
      {it.costUsd != null && (
        <>
          <Sep />
          <span
            className="font-medium tabular-nums text-brass"
            title={
              it.costSource === "estimated"
                ? "estimado: tokens × tabela de preço"
                : undefined
            }
          >
            {fmtCost(it.costUsd, it.costSource)}
          </span>
        </>
      )}
      {/* Entrega→diff em 1 clique: abre o diff do worktree no painel de Alterações. */}
      {it.ok && (
        <button
          type="button"
          onClick={() => {
            const convId = useChat.getState().activeId
            if (!convId) return
            void openDeliveryDiff({ convId, text: it.text ?? "" })
          }}
          title="Ver o diff desta entrega"
          aria-label="Ver o diff desta entrega"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <Sep />
          <FileDiff className="size-3" /> Diff
        </button>
      )}
    </div>
  )
}

/** Separador "·" da caption de telemetria. */
function Sep() {
  return <span className="text-muted-foreground/30">·</span>
}

/** Texto de bolha com CHIP de menção (Especialistas): `@nome` que casa com uma
 *  persona conhecida vira um destaque brass; o resto fica texto puro. Só a
 *  mensagem RENDERIZADA (não o composer ao vivo). Aditivo — não passa pelo
 *  Markdown/messageNodes, então a costura da prosa do agente segue intocada. */
function MentionText({ text }: { text: string }) {
  const list = usePresets((s) => s.list)
  const segs = useMemo(
    () => splitMentions(text, list.map((p) => p.name)),
    [text, list],
  )
  if (segs.length === 1 && segs[0].type === "text") return <>{text}</>
  return (
    <>
      {segs.map((seg, i) =>
        seg.type === "mention" ? (
          <span
            key={i}
            className="rounded bg-brass/[0.12] px-1 font-medium text-brass"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}

/** Reset vem em formatos de vários CLIs. A UI só humaniza os casos inequívocos
 * e mantém o texto original nos demais (sem inventar um relógio). */
function formatIncidentReset(hint: string): string {
  let formatted = hint
    .trim()
    .replace(/^reset(?:s|ting)?\s+(?:at\s+)?/i, "")
  const time = formatted.match(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/i)
  if (time) {
    let hour = Number(time[1]) % 12
    if (time[3].toLowerCase() === "p") hour += 12
    formatted = formatted.replace(time[0], `${String(hour).padStart(2, "0")}:${time[2]}`)
  }
  return formatted
    .replace(/\s*\(America\/Sao_Paulo\)/i, " · horário de São Paulo")
    .replace(/America\/Sao_Paulo/i, "horário de São Paulo")
}

/** Linha de CHEGADA do conselheiro (Especialistas E1): enquanto o parecer não
 *  resolve (`conv.advising` setado), a persona "entra no fio" no lugar onde o
 *  parecer vai cair, estilo Slack — avatar + nome + "está lendo o contexto…"
 *  com dots pulsando. Some quando o item `advice` chega. Resolve o AgentDef pelo
 *  id do advising (fallback: nome) na lista de presets; fail-soft: sem persona,
 *  avatar genérico com seed no id/nome, não quebra. */
function AdviceArrivalRow({
  advising,
}: {
  advising: { id: string; name: string }
}) {
  const persona = usePresets((s) =>
    s.list.find((p) => p.id === advising.id || p.name === advising.name),
  )
  return (
    <div className="flex gap-3 animate-cockpit-rise">
      <div className="w-7 shrink-0 pt-0.5">
        <AgentAvatar
          def={persona}
          seed={persona ? undefined : advising.id || advising.name}
          size={28}
          rounded
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-brass">
            {persona?.name ?? advising.name}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>está lendo o contexto</span>
          <span className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="animate-cockpit-pulse size-1.5 rounded-full bg-brass/70"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Parecer de um CONSELHEIRO (Especialistas E1): item atribuído à persona,
 *  visualmente distinto de uma ação do executor (borda brass, cabeçalho com o
 *  nome + selo "parecer · só leitura"). Carimba persona@version + digest curto
 *  (auditoria/drift). Ações: "Trazer pro Executor" (injeta o parecer no próximo
 *  turno) e "Dispensar" (remove o item). Sem volante/piloto (isso é Sprint 3). */
function AdviceCard({ item }: { item: Extract<ChatItem, { kind: "advice" }> }) {
  // Avatar com a identidade REAL da persona (estilo/seed do arquivo) quando ela
  // ainda existe na lista; senão, a seed cai no id/nome carimbados no parecer
  // (a persona pode ter sido apagada — o parecer histórico não perde a cara).
  const persona = usePresets((s) =>
    s.list.find((p) => p.id === item.personaId),
  )
  // S3.2 — "passar o volante": só oferecido quando a persona ainda existe, NÃO
  // é já quem pilota (um piloto por vez) e não há turno em voo (senão passWheel
  // no-opa e o gesto ficaria sem efeito). Gesto humano e explícito.
  const isPilot = useChat((s) =>
    s.activeId ? s.byId[s.activeId]?.presetId === item.personaId : false,
  )
  const turnBusy = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : undefined
    return !!c?.running || !!c?.finalizing
  })
  const canPassWheel = !!persona && !isPilot && !turnBusy
  return (
    <div className="group/msg rounded-lg border border-brass/40 bg-brass/[0.05] px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* avatar + nome da persona vivem no cabeçalho do grupo (gutter Slack);
            aqui fica só a natureza do bloco (selo) + o carimbo de versão. */}
        <MessageSquareQuote className="size-4 shrink-0 text-brass" />
        <span className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[10.5px] font-medium text-brass">
          parecer · só leitura
        </span>
        <span
          className="ml-auto font-mono text-[10.5px] text-muted-foreground/70"
          title="Persona e versão que opinaram (carimbo de auditoria/drift)"
        >
          v{item.personaVersion} · {shortDigest(item.digest)}
        </span>
      </div>
      <div data-selectable className="text-[14px]">
        <Markdown text={item.text} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {canPassWheel && (
          <button
            onClick={() => {
              const convId = useChat.getState().activeId
              if (!convId) return
              // só anuncia quando a troca efetivou (passWheel no-opa em turno em
              // voo / já piloto) — sem gesto sem efeito passando por concluído.
              void useChat
                .getState()
                .passWheel(convId, item.personaId, persona!.name)
                .then((ok) => {
                  if (ok)
                    toast(
                      `${item.personaName} vai pilotar o próximo turno (a doutrina viaja no envio).`,
                    )
                })
            }}
            title="Trocar o piloto: a próxima ação da conversa passa a ser desta persona"
            className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-brass/40 px-2.5 py-1 text-[12px] text-brass transition-colors hover:bg-brass/10"
          >
            <CornerDownRight className="size-3.5" /> Passar o volante
          </button>
        )}
        <button
          onClick={() => {
            const convId = useChat.getState().activeId
            if (!convId) return
            useChat.getState().dismissAdvice(convId, item.id)
          }}
          className="rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
        >
          Dispensar
        </button>
        <button
          onClick={() => {
            const convId = useChat.getState().activeId
            if (!convId) return
            useChat
              .getState()
              .bringAdviceToExecutor(convId, buildAdviceHandoffBlock(item))
            toast(
              `Parecer de ${item.personaName} vai como contexto no próximo turno.`,
            )
          }}
          className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Trazer pro Executor
        </button>
      </div>
    </div>
  )
}

/** Um término vira UM instrumento acionável. Limite é estado operacional
 * esperado (âmbar); vermelho fica reservado para falha real. O texto cru do
 * provider existe para diagnóstico, mas não domina o fio. */
function IncidentCard({
  incident,
  currentAgent,
  onContinueWith,
  feedback,
  feedbackText,
}: {
  incident: IncidentNode
  currentAgent: string
  onContinueWith?: (agent: string) => void
  feedback?: FeedbackApi | null
  feedbackText?: string
}) {
  const limited = incident.severity === "limit"
  const Icon = limited ? Gauge : AlertCircle
  const title = limited
    ? "Limite desta sessão atingido"
    : "Não foi possível concluir esta execução"
  const description = limited
    ? "O agente precisa de uma pausa. O MyCockpit preservou seu histórico, contexto e arquivos."
    : "O MyCockpit preservou a conversa e os arquivos para você tentar novamente ou continuar com outro agente."

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border",
        limited
          ? "border-st-warning/45 bg-st-warning/[0.07]"
          : "border-st-error/40 bg-st-error/[0.07]",
      )}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border",
              limited
                ? "border-st-warning/35 bg-st-warning/10 text-st-warning"
                : "border-st-error/30 bg-st-error/10 text-st-error",
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[13px] font-medium",
                limited ? "text-st-warning" : "text-st-error",
              )}
            >
              {title}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground/75">
              {description}
            </p>
          </div>
        </div>

        {limited && incident.resetHint && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-st-warning/30 bg-st-warning/[0.08] px-2.5 py-2 text-[12px] text-foreground/80">
            <RotateCcw className="size-3.5 shrink-0 text-st-warning" />
            <span>Disponível novamente</span>
            <strong className="font-mono font-medium text-st-warning">
              {formatIncidentReset(incident.resetHint)}
            </strong>
          </div>
        )}

        {incident.result && (
          <div className="mt-2.5 border-t border-border/45 pt-2">
            <TurnTelemetry
              it={incident.result}
              incidentTone={limited ? "limit" : undefined}
            />
          </div>
        )}

        {onContinueWith && (
          <div className="mt-2.5 border-t border-border/45 pt-2.5">
            <ContinueRow
              current={currentAgent}
              onPick={onContinueWith}
              subtle={!limited}
            />
          </div>
        )}

        {incident.details.length > 0 && (
          <details className="group/details mt-2.5 border-t border-border/40 pt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3 transition-transform group-open/details:rotate-90" />
              Detalhes técnicos
            </summary>
            <div
              data-selectable
              className="mt-2 max-h-40 overflow-y-auto rounded-md bg-background/45 px-2.5 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
            >
              {incident.details.join("\n")}
            </div>
          </details>
        )}
      </div>

      {incident.result && feedback && (
        <div className="border-t border-border/45 px-3.5 py-2">
          <TurnFeedback
            resultId={incident.result.id}
            agentTurn={feedbackText ?? incident.result.text ?? ""}
            reactions={incident.result.reactions ?? []}
            api={feedback}
          />
        </div>
      )}
    </div>
  )
}

/** Um item NÃO-tool da conversa. `memo`: só re-renderiza quando a REFERÊNCIA do
 *  item muda (itens não-streaming têm ref estável), não re-pinta a cada delta (F12). */
const MessageItem = memo(function MessageItem({
  item: it,
  feedback,
  feedbackText,
  reads,
}: {
  item: ChatItem
  feedback?: FeedbackApi | null
  feedbackText?: string
  /** Selo de leitura por PATH de anexo (só itens do usuário usam). Vem pronto
   *  do MessageList: calcular aqui exigiria o fio inteiro dentro de um `memo`
   *  por item, o que mataria a memoização a cada delta do streaming. */
  reads?: Record<string, { text: string; warn: boolean } | null>
}) {
  if (it.kind === "user") {
    // Slack-style: alinhado à esquerda sob o gutter "Você" (o autor está no
    // cabeçalho do grupo), não mais bolha à direita.
    // Galeria do lightbox = só as IMAGENS desta mensagem (PDF segue chip).
    const gallery: LightboxImage[] = (it.attachments ?? [])
      .filter((a) => a.kind === "image")
      .map((a) => ({
        path: a.path,
        name: a.name,
        source: "anexo" as const,
        mime: a.mime,
      }))
    return (
      <div className="flex flex-col items-start gap-1.5">
        {it.attachments && it.attachments.length > 0 && (
          <div className="flex max-w-full flex-wrap gap-1.5">
            {it.attachments.map((a) => (
              <AttachmentThumb
                key={a.path}
                att={a}
                read={reads?.[a.path] ?? null}
                onOpen={
                  a.kind === "image"
                    ? () =>
                        useLightbox
                          .getState()
                          .open(
                            gallery,
                            gallery.findIndex((g) => g.path === a.path),
                          )
                    : undefined
                }
              />
            ))}
          </div>
        )}
        {it.text && (
          <div
            data-selectable
            className="max-w-full rounded-2xl rounded-tl-md bg-secondary px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground"
          >
            <MentionText text={it.text} />
          </div>
        )}
      </div>
    )
  }

  if (it.kind === "text") {
    return <Markdown text={it.text} />
  }

  // Tools são agrupadas por buildNodes/ToolGroup. Este guard só torna a união
  // exaustiva caso um item cru chegue aqui por histórico legado.
  if (it.kind === "tool") return null

  if (it.kind === "error") {
    return (
      <IncidentCard
        incident={{
          type: "incident",
          key: it.id,
          severity: "error",
          message: it.message,
          details: [it.message],
        }}
        currentAgent=""
      />
    )
  }

  if (it.kind === "limit") {
    return (
      <IncidentCard
        incident={{
          type: "incident",
          key: it.id,
          severity: "limit",
          message: it.message,
          resetHint: it.resetHint,
          details: [it.message],
        }}
        currentAgent=""
      />
    )
  }

  if (it.kind === "cancelled") {
    return (
      <div className="flex items-center gap-2 pt-1 text-[12px] text-muted-foreground">
        <Ban className="size-3.5" />
        <span>interrompido</span>
      </div>
    )
  }

  if (it.kind === "notice") {
    return (
      <div className="flex items-center gap-2 px-1 text-[11.5px] text-muted-foreground/80">
        <AlertCircle className="size-3 shrink-0" />
        <span>{it.message}</span>
      </div>
    )
  }

  if (it.kind === "advice") {
    return <AdviceCard item={it} />
  }

  return (
    <div className="rounded-lg border border-border/55 bg-card/35 px-3 py-2.5">
      {!it.ok && it.text && (
        <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2">
          <div
            data-selectable
            className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
          >
            {it.text}
          </div>
        </div>
      )}
      <TurnTelemetry it={it} />
      {feedback && (
        <TurnFeedback
          resultId={it.id}
          agentTurn={feedbackText ?? it.text ?? ""}
          reactions={it.reactions ?? []}
          api={feedback}
        />
      )}
    </div>
  )
})

/** Revezamento: continuar a conversa em OUTRO agent (após limite ou erro).
 *  `subtle` = versão discreta pro cartão de erro comum. */
function ContinueRow({
  current,
  onPick,
  subtle,
}: {
  current: string
  onPick: (agent: string) => void
  subtle?: boolean
}) {
  const targets = DESTINATIONS.filter(
    (d) => d.available && d.kind === "agent" && d.id !== current,
  )
  if (targets.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!subtle && (
        <span className="text-[12px] text-muted-foreground">Revezamento:</span>
      )}
      {targets.map((d) => (
        <button
          key={d.id}
          onClick={() => onPick(d.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors",
            subtle
              ? "text-muted-foreground hover:bg-accent hover:text-foreground"
              : "border-brass/40 bg-brass/10 text-brass hover:bg-brass/20",
          )}
        >
          <ArrowRightLeft className="size-3.5" /> Continuar no {d.label}
        </button>
      ))}
    </div>
  )
}

// Modelo de nós (buildNodes/continuesProse) mora em ./messageNodes — puro e
// testável, sem estragar o fast-refresh deste arquivo de componentes.

interface NodeCtx {
  isLast: boolean
  running: boolean
  taskPlans: AgentPlan[]
  activePlanAnchor: string | null
  feedback?: FeedbackApi | null
  attReads: Record<string, { text: string; warn: boolean } | null>
  agent: string
  stalledSince?: number
  feedbackByResult: Map<string, string>
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
  onContinueWith?: (agent: string) => void
}

/** O transcript registra que o plano nasceu e como terminou; a checklist viva
 * mora exclusivamente junto ao composer. Assim o plano não disputa atenção
 * consigo mesmo em dois pontos da tela. */
function PlanMilestone({
  plan,
  live,
}: {
  plan: AgentPlan
  live: boolean
}) {
  const [open, setOpen] = useState(false)
  const done = plan.tasks.filter((task) => task.status === "completed").length
  const complete = plan.tasks.length > 0 && done === plan.tasks.length
  const expandable = !live && plan.tasks.length > 0
  const label = live
    ? "Plano publicado"
    : complete
      ? "Plano concluído"
      : plan.terminal
        ? "Plano encerrado"
        : "Plano registrado"
  const meta = live
    ? `${plan.tasks.length} etapa${plan.tasks.length === 1 ? "" : "s"}`
    : `${done}/${plan.tasks.length}`

  return (
    <div className="animate-cockpit-rise">
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-muted-foreground transition-colors",
          expandable && "hover:bg-accent/35 hover:text-foreground",
        )}
      >
        {complete ? (
          <Check className="size-3.5 shrink-0 text-st-success" />
        ) : (
          <ListChecks
            className={cn(
              "size-3.5 shrink-0",
              live ? "text-brass" : "text-muted-foreground/65",
            )}
          />
        )}
        <span>{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/75">
          · {meta}
        </span>
        {expandable && (
          <ChevronRight
            className={cn(
              "ml-auto size-3.5 text-muted-foreground/45 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && (
        <div className="mt-1 ml-[7px] border-l border-border/45 py-1 pl-3">
          <TaskChecklist tasks={plan.tasks} dense />
        </div>
      )}
    </div>
  )
}

/** Corpo de UM nó de render (sem gutter/cabeçalho — isso é do grupo). Mantém
 *  intactos os caminhos existentes: prose costurada + ToolGroup, burst de tools,
 *  checklist e os cartões de item (user/result/erro/limite/advice…). */
function renderNode(n: Node, ctx: NodeCtx): React.ReactNode {
  if (n.type === "incident") {
    const continuable = ctx.onContinueWith && !ctx.running && ctx.isLast
    const resultId = n.result?.id
    return (
      <IncidentCard
        incident={n}
        currentAgent={ctx.agent}
        onContinueWith={continuable ? ctx.onContinueWith : undefined}
        feedback={
          resultId && ctx.feedbackByResult.has(resultId) ? ctx.feedback : null
        }
        feedbackText={resultId ? ctx.feedbackByResult.get(resultId) : undefined}
      />
    )
  }
  if (n.type === "plan") {
    const plan = ctx.taskPlans.find((candidate) => candidate.anchorId === n.anchorId)
    if (!plan) return null
    return (
      <PlanMilestone
        plan={plan}
        live={ctx.running && ctx.activePlanAnchor === n.anchorId}
      />
    )
  }
  if (n.type === "prose") {
    // narração do turno (costurada) + as tools que ela disparou, juntas e
    // apertadas (gap-1.5). O grupo só "roda" quando é o último nó do run.
    const active = ctx.running && ctx.isLast
    const hasText = n.text.trim().length > 0
    return (
      <div className="group/msg flex flex-col gap-1.5">
        {hasText && <Markdown text={n.text} />}
        {n.tools.length > 0 && (
          <ToolGroup
            tools={n.tools}
            active={active}
            agent={ctx.agent}
            stalledSince={ctx.stalledSince}
            onStop={ctx.onStop}
            onRetry={ctx.onRetry}
          />
        )}
      </div>
    )
  }
  if (n.type === "tools") {
    const active = ctx.running && ctx.isLast
    return (
      <ToolGroup
        tools={n.tools}
        active={active}
        agent={ctx.agent}
        stalledSince={ctx.stalledSince}
        onStop={ctx.onStop}
        onRetry={ctx.onRetry}
      />
    )
  }
  // cartão de limite/erro ganha a fileira de revezamento (só fora do run; durante
  // o run o Stop é o caminho).
  const continuable =
    ctx.onContinueWith &&
    !ctx.running &&
    (n.item.kind === "limit" || n.item.kind === "error") &&
    ctx.isLast
  if (continuable) {
    return (
      <div className="flex flex-col gap-2">
        <MessageItem
          item={n.item}
          feedback={
            ctx.feedbackByResult.has(n.item.id) ? ctx.feedback : null
          }
          feedbackText={ctx.feedbackByResult.get(n.item.id)}
          reads={ctx.attReads}
        />
        <ContinueRow
          current={ctx.agent}
          onPick={ctx.onContinueWith!}
          subtle={n.item.kind === "error"}
        />
      </div>
    )
  }
  return (
    <MessageItem
      item={n.item}
      feedback={ctx.feedbackByResult.has(n.item.id) ? ctx.feedback : null}
      feedbackText={ctx.feedbackByResult.get(n.item.id)}
      reads={ctx.attReads}
    />
  )
}

/** Identidade do EXECUTOR pro gutter (compartilhada entre o cabeçalho do grupo
 *  e o indicador de "trabalhando…", pra não duplicar a resolução): a
 *  persona-piloto quando a conversa tem preset resolvido na lista; senão o logo
 *  do code agent num círculo + o rótulo do produto. Puro dada a lista de presets.
 *
 *  `engine` é o selo do motor pro CABEÇALHO (work-hierarchy: "o provider mora no
 *  cabeçalho do agente"; background-status B2.3 tirou o selo repetido de cada
 *  nó). Só vem preenchido quando o nome exibido NÃO é o do motor — com persona
 *  pilotando, o motor ficaria invisível; sem persona, o nome já É o motor e
 *  repetir seria ruído. */
export function resolveExecutorIdentity(
  presets: AgentDef[],
  agent: string,
  presetId: string | null,
): { gutter: React.ReactNode; name: string; engine: string | null } {
  const pilot = presetId ? presets.find((p) => p.id === presetId) : undefined
  if (pilot) {
    return {
      gutter: <AgentAvatar def={pilot} size={28} rounded />,
      name: pilot.name,
      engine: agentLabel(agent),
    }
  }
  return {
    gutter: (
      <span className="grid size-7 place-items-center rounded-full border bg-card">
        <AgentLogo agent={agent} className="size-4 text-muted-foreground" />
      </span>
    ),
    name: agentLogoLabel(agent),
    engine: null,
  }
}

/** Indicador "trabalhando…" estilo Slack/typing: o avatar do executor no mesmo
 *  gutter das mensagens + "está trabalhando…" com dots escalonados + cronômetro.
 *  `finalizando…` mantém o formato (só troca o verbo). Com trabalho DIFERIDO
 *  vivo (deferred-work-plan D1.3), o rótulo fica honesto: o CLI segura o turno
 *  aberto enquanto o background task roda — o spinner mudo virava mentira.
 *
 *  É a ÚNICA superfície do "agora" (background-status B2.2): o nó no fio é
 *  marco/resultado, não um segundo painel vivo. Regras do layout, do estudo do
 *  Warp (B1'): o cronômetro é irmão do que anima (nunca dentro), tem largura
 *  reservada + `tabular-nums` + `shrink-0`, e quem trunca é o NOME (B2.1). */
function WorkingIndicator({
  agent,
  presetId,
  finalizing,
  running,
  startedAt,
  deferred = [],
}: {
  agent: string
  presetId: string | null
  finalizing: boolean
  running: boolean
  startedAt: number | null
  /** Trabalhos em background vivos (derivado de items, replay-safe). */
  deferred?: DeferredWork[]
}) {
  const presets = usePresets((s) => s.list)
  const { gutter, name, engine } = resolveExecutorIdentity(presets, agent, presetId)
  const live = deferredLiveLine(deferred)
  const label = live
    ? live.text
    : finalizing
      ? "finalizando…"
      : "está trabalhando…"
  // O relógio pertence ao que está ESCRITO na linha: com background vivo é o
  // trabalho nomeado (o turno zera o startedAt no `result`, e era justo aí que
  // o cronômetro sumia); sem background, é o turno.
  const since = live ? live.since : running ? startedAt : null
  return (
    <div className="flex gap-3">
      <div className="w-7 shrink-0 pt-0.5">{gutter}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-foreground">{name}</span>
          {engine && (
            <span className="rounded border px-1 py-px text-[10px] text-muted-foreground">
              {engine}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="min-w-0 truncate" title={live ? live.detail : undefined}>
            {label}
          </span>
          <span className="flex shrink-0 items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="animate-cockpit-pulse size-1.5 rounded-full bg-st-running/70"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </span>
          {since != null && (
            <Elapsed
              since={since}
              className="ml-1 min-w-[4.5rem] shrink-0 font-mono text-foreground/70"
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Uma linha de grupo estilo Slack: avatar no gutter + cabeçalho (nome) UMA vez,
 *  e os corpos dos nós contíguos daquele autor indentados sob o mesmo gutter
 *  (largura fixa 28px, o fio fica coeso pra todos os tipos). O autor sistema
 *  (interrupção/aviso) é voz sem dono: sem gutter nem cabeçalho. */
function GroupRow({
  group,
  agent,
  presetId,
  ts,
  lastKey,
  ctxBase,
}: {
  group: MessageGroup
  agent: string
  presetId: string | null
  /** Hora (epoch ms) do 1º item do grupo — vira "HH:MM" ao lado do nome, estilo
   *  Slack. undefined (itens antigos sem carimbo) omite a hora. */
  ts?: number
  lastKey: string | null
  ctxBase: Omit<NodeCtx, "isLast">
}) {
  const presets = usePresets((s) => s.list)
  const author = group.author
  const time = fmtTime(ts)

  const bodies = group.nodes.map((n) => (
    <div key={n.key} className="min-w-0">
      {renderNode(n, { ...ctxBase, isLast: n.key === lastKey })}
    </div>
  ))

  if (author.kind === "system") {
    return <div className="flex flex-col gap-1.5">{bodies}</div>
  }

  let gutter: React.ReactNode
  let name: string
  let nameClass = "text-foreground"
  // Selo do motor no CABEÇALHO (B2.3): só no grupo do executor, e só quando o
  // nome exibido é de uma persona (senão o nome já é o motor).
  let engine: string | null = null
  if (author.kind === "you") {
    gutter = (
      <span className="grid size-7 place-items-center rounded-full bg-secondary text-muted-foreground">
        <User className="size-4" />
      </span>
    )
    name = "Você"
  } else if (author.kind === "especialista") {
    const persona = presets.find((p) => p.id === author.personaId)
    gutter = (
      <AgentAvatar
        def={persona}
        seed={persona ? undefined : author.personaId || author.personaName}
        size={28}
        rounded
      />
    )
    name = author.personaName
    nameClass = "text-brass"
  } else {
    // executor: identidade compartilhada com o indicador de "trabalhando…".
    const id = resolveExecutorIdentity(presets, agent, presetId)
    gutter = id.gutter
    name = id.name
    engine = id.engine
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 shrink-0 pt-0.5">{gutter}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className={cn("text-[13px] font-medium", nameClass)}>{name}</span>
          {engine && (
            <span className="rounded border px-1 py-px text-[10px] text-muted-foreground">
              {engine}
            </span>
          )}
          {time && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60">
              {time}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">{bodies}</div>
      </div>
    </div>
  )
}

/** Contexto consolidado do executor para o feedback do resultado. Recomeça em
 * cada item do usuário; tools/subagentes não vazam como se fossem a resposta
 * principal. */
export function feedbackTextByResult(items: ChatItem[]): Map<string, string> {
  const out = new Map<string, string>()
  let parts: string[] = []
  let previousResult: string | null = null
  for (const item of items) {
    if (item.kind === "user") {
      parts = []
      previousResult = null
      continue
    }
    if (item.kind === "text" && item.text.trim()) {
      parts.push(item.text)
      continue
    }
    if (item.kind === "result") {
      // Alguns providers publicam envelopes parciais. Dentro do mesmo pedido,
      // só o resultado mais recente é um alvo de feedback.
      if (previousResult) out.delete(previousResult)
      const joined = parts.join("\n\n").trim()
      out.set(item.id, joined || item.text?.trim() || "")
      previousResult = item.id
    }
  }
  return out
}

export function MessageList({
  items,
  running,
  finalizing,
  startedAt,
  agent,
  presetId,
  advising,
  stalledSince,
  unseenDividerId,
  onStop,
  onRetry,
  onContinueWith,
  feedback,
}: {
  items: ChatItem[]
  running: boolean
  finalizing: boolean
  startedAt: number | null
  agent: string
  /** Preset (persona-piloto) carimbado na conversa — resolve o avatar/nome do
   *  autor "executor" no gutter. null/undefined = sem piloto (usa o logo do agent). */
  presetId?: string | null
  /** Especialistas E1: conselheiro em consulta (id+nome) — enquanto setado, a
   *  linha de chegada aparece no fim do fio; some quando o item `advice` cai. */
  advising?: { id: string; name: string } | null
  /** Watchdog do turno: presente quando o provider está vivo, mas sem eventos
   *  observáveis desde este instante. */
  stalledSince?: number
  /** S1.1 — id do primeiro item NÃO-VISTO (capturado ao abrir uma conversa com
   *  finishedUnseen): o divisor "novas mensagens" entra antes do grupo que
   *  começa nele. undefined = sem divisor nesta visita. */
  unseenDividerId?: string
  /** Controle capability-aware: hoje interrompe o run principal; processos
   *  gerenciados podem especializar este callback depois. */
  onStop?: (tool: ToolItem) => void
  /** Repetição explícita vira um novo turno, nunca reexecuta efeito escondido. */
  onRetry?: (tool: ToolItem) => void
  /** Revezamento: continuar a conversa em outro agent (limite/erro). */
  onContinueWith?: (agent: string) => void
  /** Loop de feedback do Linear (M2). null/undefined fora do Linear. */
  feedback?: FeedbackApi | null
}) {
  const nodes = useMemo(() => buildNodes(items), [items])
  const taskPlans = useMemo(() => deriveTaskPlans(items), [items])
  const latestUserId = items.findLast((item) => item.kind === "user")?.id
  const latestPlan = taskPlans.at(-1)
  const activePlanAnchor =
    running &&
    latestPlan &&
    latestPlan.turnId === latestUserId &&
    latestPlan.terminal == null
      ? latestPlan.anchorId
      : null
  const feedbackByResult = useMemo(() => feedbackTextByResult(items), [items])
  // Trabalho diferido VIVO (D1.3): alimenta a LINHA VIVA, dona única do "agora"
  // (background-status B2.2). Derivado de items — replay-safe, sem estado
  // paralelo: no restore o diferido vira interrompido e a linha some sozinha.
  const liveDeferred = useMemo(() => pendingDeferred(items), [items])
  // Selo "lido / não foi aberto" por anexo. Calculado UMA vez aqui (varre o fio)
  // e entregue pronto ao MessageItem: fazer dentro do item quebraria o memo dele
  // a cada delta do streaming. Só muda quando items/running mudam.
  const attReads = useMemo(() => {
    const out: Record<string, { text: string; warn: boolean } | null> = {}
    items.forEach((it, i) => {
      if (it.kind !== "user" || !it.attachments?.length) return
      for (const a of it.attachments) {
        out[a.path] = attachmentReadLabel(
          attachmentRead(items, i, a, agent, running),
        )
      }
    })
    return out
  }, [items, agent, running])

  // Janela de renderização: conversa longa (já vimos 665KB de items) renderizava
  // TUDO — com diffs abertos por padrão o DOM explodia. Mostra os últimos
  // CHAT_WINDOW nós (agrupamento preservado) + botão pra revelar o histórico.
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = showAll ? 0 : Math.max(0, nodes.length - CHAT_WINDOW)
  const visible = hiddenCount > 0 ? nodes.slice(hiddenCount) : nodes

  // Agrupamento estilo Slack: nós contíguos do mesmo autor viram um grupo
  // (avatar/cabeçalho uma vez). `lastKey` mantém o "último nó do run roda" —
  // agora comparado por key, não por índice, porque o nó vive dentro do grupo.
  const groups = groupByAuthor(visible)
  const lastKey = visible.length ? visible[visible.length - 1].key : null
  // id → ts do item (o cabeçalho do grupo lê o ts do 1º item via a key do 1º nó,
  // que buildNodes deriva do id desse item). Itens antigos sem `ts` → undefined,
  // e o grupo omite a hora. Recalcula só quando o fio muda.
  const tsById = useMemo(
    () => new Map(items.map((it) => [it.id, it.ts] as const)),
    [items],
  )
  const ctxBase: Omit<NodeCtx, "isLast"> = {
    running,
    taskPlans,
    activePlanAnchor,
    feedback,
    attReads,
    agent,
    stalledSince,
    feedbackByResult,
    onStop,
    onRetry,
    onContinueWith,
  }
  return (
    <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-5 px-8 py-8">
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mx-auto rounded-full border bg-card/60 px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Mostrar {hiddenCount} itens anteriores
        </button>
      )}
      {groups.map((g) => (
        <Fragment key={g.key}>
          {/* S1.1 — divisor "novas mensagens" na fronteira do não-visto. A key
              do 1º nó de um grupo é o id do item que o abriu (buildNodes), e a
              fronteira vem logo após uma mensagem SUA — troca de autor abre
              grupo novo, então o divisor cai sempre ENTRE grupos. */}
          {unseenDividerId != null && g.nodes[0]?.key === unseenDividerId && (
            <div
              role="separator"
              aria-label="novas mensagens"
              className="flex items-center gap-3"
            >
              <span className="h-px flex-1 bg-st-warning/40" />
              <span className="text-[10.5px] font-medium tracking-wide text-st-warning/90 uppercase">
                novas mensagens
              </span>
              <span className="h-px flex-1 bg-st-warning/40" />
            </div>
          )}
          <GroupRow
            group={g}
            agent={agent}
            presetId={presetId ?? null}
            ts={groupTs(g, tsById)}
            lastKey={lastKey}
            ctxBase={ctxBase}
          />
        </Fragment>
      ))}

      {advising && <AdviceArrivalRow advising={advising} />}

      {(running || finalizing) && (
        <WorkingIndicator
          agent={agent}
          presetId={presetId ?? null}
          finalizing={finalizing}
          running={running}
          startedAt={startedAt}
          deferred={liveDeferred}
        />
      )}
    </div>
  )
}
