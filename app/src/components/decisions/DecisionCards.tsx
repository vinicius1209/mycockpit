// Os cards da fila "Precisam de você". Vieram do Painel (MissionControl) sem
// mudança de comportamento: o Painel virou retrospectiva e a fila mudou de
// casa pro chrome (ADR-040), então quem desenha a decisão passou a morar aqui.
//
// Duas correções de cor entraram junto (auditoria dos mocks, STYLEGUIDE §2):
//  - o ícone de PR saudável era `st-success`; verde é marco, nunca estado
//    ambiente que fica na tela. Virou cinza (só a FALHA continua vermelha).
//  - card `blocked` era `st-error`; vermelho é falha consumada. Bloqueado é
//    alguém esperando decisão, ou seja âmbar. Quem separa "bloqueado" de "em
//    revisão" é o texto do badge, não a tinta.

import { useState } from "react"
import { FileText, GitPullRequest, Lightbulb, SquareKanban, Swords } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { openCardConversation } from "@/store/cards"
import type { Decision } from "@/lib/inbox"
import { mergeEligible, prHealth, type PrEnrichment } from "@/lib/panel"
import { fmtAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Navega pra ONDE a decisão mora (mesmo destino do InboxBell.goTo): a conversa
 *  (disputa), o card do board (E1) ou o plano (SDD). A proposta do lead mora na
 *  PRÓPRIA fila (expande inline), então não navega pra lugar nenhum. */
export async function goToDecision(d: Decision) {
  const app = useApp.getState()
  if (d.kind === "proposal") return
  app.setActiveProject(d.projectId)
  if (d.kind === "fusion") {
    await useChat.getState().openProject(d.projectId)
    await useChat.getState().switchConversation(d.convId)
    app.setViewMode("linear")
  } else if (d.kind === "card") {
    // Sem conversa ligada não existe destino: o card JÁ está na sua frente, na
    // fila. Explicar é honesto; trocar de tela pra nada não é.
    if (!(await openCardConversation(d.cardId))) {
      toast(`"${d.title}" não tem conversa ligada`, {
        description:
          "Não há pra onde abrir. Ele fica na fila até mudar de estado.",
      })
    }
  } else {
    app.setSddFocus(d.slug)
    app.setViewMode("sdd")
  }
}

/** Idade a partir de um ISO (manifest do SDD). null/inválido = sem idade. */
function fmtRelativeIso(iso: string | null): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? fmtAgo(Date.now() - ts) : null
}

/** A ação principal de um card. Brass SÓ no primeiro item da fila (o mais
 *  pronto, pelo `orderQueue`): uma primária brass por superfície (§8) — três
 *  brass empilhados anulam a hierarquia que a fila acabou de criar. Os outros
 *  usam o botão neutro, com o mesmo rótulo e a mesma ação. */
function PrimaryButton({
  children,
  disabled,
  primary,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  primary?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-40",
        primary
          ? "bg-brass text-background transition-opacity hover:opacity-90"
          : "border border-border text-foreground hover:bg-accent/60",
      )}
    >
      {children}
    </button>
  )
}

/** Ação secundária discreta dos cards. */
function GhostAction({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      {children}
    </button>
  )
}

/** Moldura comum dos cards da fila. */
function QueueCard({
  onClick,
  children,
  className,
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick()
      }}
      className={cn(
        "cursor-pointer rounded-lg border border-border/70 bg-card/40 px-4 py-3 transition-colors hover:border-border hover:bg-accent/40",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Card de PR: corpo e primária abrem a PR no browser; Merge (brass) só com
 *  tudo verde; "Ver no SDD" é a navegação antiga, agora secundária. */
function PrCard({
  d,
  enrich,
  merging,
  primary,
  onMerge,
}: {
  d: Extract<Decision, { kind: "pr" }>
  enrich: PrEnrichment | null
  merging: boolean
  primary: boolean
  onMerge: () => void
}) {
  const health = prHealth(enrich)
  const failing = health === "failing"
  const canMerge = mergeEligible(enrich)
  const open = () => void openUrl(d.prUrl).catch(() => {})
  return (
    <QueueCard onClick={open}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <GitPullRequest
              className={cn(
                "size-4 shrink-0",
                failing ? "text-st-error" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {d.planTitle}
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {d.projectName}
            </span>
            {enrich?.updatedAt != null && (
              <span className="shrink-0 text-[11px] text-muted-foreground/60">
                {fmtAgo(Date.now() - enrich.updatedAt)}
              </span>
            )}
          </div>
          {enrich && (
            <p
              className={cn(
                "mt-1 pl-[26px] text-[12px] tabular-nums",
                failing ? "text-st-error" : "text-muted-foreground",
              )}
            >
              {enrich.checksTotal > 0 && (
                <>
                  {failing ? "✗" : health === "green" ? "✓" : ""}{" "}
                  {enrich.checksPassed}/{enrich.checksTotal} checks ·{" "}
                </>
              )}
              +{enrich.additions} −{enrich.deletions}
              {enrich.mergeable === "MERGEABLE"
                ? " · mergeable"
                : enrich.mergeable === "CONFLICTING"
                  ? " · conflito"
                  : ""}
              {enrich.isDraft ? " · draft" : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-px">
          <button
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
            className={cn(
              "shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors",
              failing
                ? "border-st-error/50 text-st-error hover:bg-st-error/10"
                : "border-border text-foreground hover:bg-accent/60",
            )}
          >
            {failing ? "Ver falha ↗" : "Abrir PR ↗"}
          </button>
          {canMerge && (
            <PrimaryButton
              primary={primary}
              disabled={merging}
              onClick={(e) => {
                e.stopPropagation()
                onMerge()
              }}
            >
              {merging ? "Mergeando…" : "Merge"}
            </PrimaryButton>
          )}
          <GhostAction
            onClick={(e) => {
              e.stopPropagation()
              void goToDecision(d)
            }}
          >
            Ver no SDD
          </GhostAction>
        </div>
      </div>
    </QueueCard>
  )
}

/** Card de disputa: julgar é a única ação — corpo e primária navegam. */
function FusionCard({
  d,
  primary,
}: {
  d: Extract<Decision, { kind: "fusion" }>
  primary: boolean
}) {
  const go = () => void goToDecision(d)
  return (
    <QueueCard onClick={go}>
      <div className="flex items-center gap-2.5">
        <Swords className="size-4 shrink-0 text-brass" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {d.title}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {d.projectName}
        </span>
        <PrimaryButton
          primary={primary}
          onClick={(e) => {
            e.stopPropagation()
            go()
          }}
        >
          Julgar
        </PrimaryButton>
      </div>
    </QueueCard>
  )
}

/** Card do board esperando você (E1: review/blocked): abrir leva à conversa
 *  ligada, ou seleciona o card no board quando não há conversa. Quando o vigia
 *  marcou o card como estagnado (S2.3), o destaque "parado há X min" entra
 *  aqui mesmo, sem layout novo. */
function BoardQueueCard({
  d,
  primary,
}: {
  d: Extract<Decision, { kind: "card" }>
  primary: boolean
}) {
  const go = () => void goToDecision(d)
  // minutos calculados no render: a fila re-escaneia periodicamente, o valor
  // acompanha; precisão de relógio vivo não vale um timer por card.
  const stalledMin =
    d.stalledSince != null
      ? Math.max(1, Math.round((Date.now() - d.stalledSince) / 60_000))
      : null
  return (
    <QueueCard onClick={go}>
      <div className="flex items-center gap-2.5">
        <SquareKanban className="size-4 shrink-0 text-st-warning" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {d.title}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {d.projectName}
        </span>
        {stalledMin != null && (
          <span className="shrink-0 rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[11px] tracking-wide text-st-warning">
            parado há {stalledMin} min
          </span>
        )}
        <span className="shrink-0 rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[11px] tracking-wide text-st-warning uppercase">
          {d.state === "blocked" ? "bloqueado" : "em revisão"}
        </span>
        <PrimaryButton
          primary={primary}
          onClick={(e) => {
            e.stopPropagation()
            go()
          }}
        >
          Abrir
        </PrimaryButton>
      </div>
    </QueueCard>
  )
}

/** Card de proposta do lead (S4.2): "Ver proposta" expande o texto INLINE no
 *  próprio card (sem modal novo); "Dispensar" marca dismissed e some da fila.
 *  O lead NUNCA despacha: não existe botão de dispatch aqui. */
function ProposalCard({
  d,
  primary,
  onDismiss,
}: {
  d: Extract<Decision, { kind: "proposal" }>
  primary: boolean
  onDismiss: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <QueueCard onClick={() => setOpen((o) => !o)}>
      <div className="flex items-center gap-2.5">
        <Lightbulb className="size-4 shrink-0 text-brass" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          Proposta do lead: {d.excerpt}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {d.projectName ?? "board inteiro"}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground/60">
          {fmtAgo(Date.now() - d.createdAt)}
        </span>
        <GhostAction
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          Dispensar
        </GhostAction>
        <PrimaryButton
          primary={primary}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          {open ? "Fechar" : "Ver proposta"}
        </PrimaryButton>
      </div>
      {open && (
        <p className="mt-2 pl-[26px] text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">
          {d.body}
        </p>
      )}
    </QueueCard>
  )
}

/** Card de PRD: revisar no SDD (aqui o SDD É o destino certo). */
function PrdCard({
  d,
  primary,
}: {
  d: Extract<Decision, { kind: "prd" }>
  primary: boolean
}) {
  const go = () => void goToDecision(d)
  const age = fmtRelativeIso(d.createdAt)
  return (
    <QueueCard onClick={go}>
      <div className="flex items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-brass" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {d.planTitle}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {d.projectName}
        </span>
        {age && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60">
            {age}
          </span>
        )}
        <PrimaryButton
          primary={primary}
          onClick={(e) => {
            e.stopPropagation()
            go()
          }}
        >
          Revisar PRD
        </PrimaryButton>
      </div>
    </QueueCard>
  )
}

/** A fila inteira, na ordem que o `orderQueue` decidiu. */
export function DecisionList({
  pending,
  prData,
  mergingUrl,
  onMerge,
  onDismissProposal,
}: {
  pending: Decision[]
  prData: Record<string, PrEnrichment | null>
  mergingUrl: string | null
  onMerge: (d: Extract<Decision, { kind: "pr" }>) => void
  onDismissProposal: (d: Extract<Decision, { kind: "proposal" }>) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {pending.map((d, i) =>
        d.kind === "pr" ? (
          <PrCard
            key={`pr:${d.prUrl}`}
            d={d}
            enrich={prData[d.prUrl] ?? null}
            merging={mergingUrl === d.prUrl}
            primary={i === 0}
            onMerge={() => onMerge(d)}
          />
        ) : d.kind === "fusion" ? (
          <FusionCard key={`fusion:${d.convId}`} d={d} primary={i === 0} />
        ) : d.kind === "card" ? (
          <BoardQueueCard key={`card:${d.cardId}`} d={d} primary={i === 0} />
        ) : d.kind === "proposal" ? (
          <ProposalCard
            key={`proposal:${d.proposalId}`}
            d={d}
            primary={i === 0}
            onDismiss={() => onDismissProposal(d)}
          />
        ) : (
          <PrdCard key={`prd:${d.projectId}:${d.slug}`} d={d} primary={i === 0} />
        ),
      )}
    </div>
  )
}
