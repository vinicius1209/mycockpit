// Os cards da fila "Precisam de você". Vieram do Painel (MissionControl) sem
// mudança de comportamento: o Painel virou retrospectiva e a fila mudou de
// casa pro chrome (ADR-040), então quem desenha a decisão passou a morar aqui.
//
// Correção de cor que entrou junto (auditoria dos mocks, STYLEGUIDE §2): card
// `blocked` era `st-error`; vermelho é falha consumada. Bloqueado é alguém
// esperando decisão, ou seja âmbar. Quem separa "bloqueado" de "em revisão" é
// o texto do badge, não a tinta.
//
// Os cards de PR e PRD saíram com a aba Features (remocao-features-prd D1):
// eles só nasciam de manifest SDD.

import { useState } from "react"
import { Lightbulb, SquareKanban, Swords } from "lucide-react"
import { avisar } from "@/lib/avisos"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { openCardConversation } from "@/store/cards"
import type { Decision } from "@/lib/inbox"
import { fmtAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Navega pra ONDE a decisão mora (mesmo destino do InboxBell.goTo): a conversa
 *  (disputa) ou o card do board (E1). A proposta do lead mora na
 *  PRÓPRIA fila (expande inline), então não navega pra lugar nenhum. */
export async function goToDecision(d: Decision) {
  const app = useApp.getState()
  if (d.kind === "proposal") return
  app.setActiveProject(d.projectId)
  if (d.kind === "fusion") {
    await useChat.getState().openProject(d.projectId)
    await useChat.getState().switchConversation(d.convId)
    app.setViewMode("linear")
  } else {
    // Sem conversa ligada não existe destino: o card JÁ está na sua frente, na
    // fila. Explicar é honesto; trocar de tela pra nada não é.
    if (!(await openCardConversation(d.cardId))) {
      avisar.nota(`"${d.title}" não tem conversa ligada`, {
        detalhe:
          "Não há pra onde abrir. Ele fica na fila até mudar de estado.",
      })
    }
  }
}

/** A ação principal de um card. Brass SÓ no primeiro item da fila (o mais
 *  pronto, pelo `orderQueue`): uma primária brass por superfície (§8) — três
 *  brass empilhados anulam a hierarquia que a fila acabou de criar. Os outros
 *  usam o botão neutro, com o mesmo rótulo e a mesma ação. */
function PrimaryButton({
  children,
  primary,
  onClick,
}: {
  children: React.ReactNode
  primary?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
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

/** A fila inteira, na ordem que o `orderQueue` decidiu. */
export function DecisionList({
  pending,
  onDismissProposal,
}: {
  pending: Decision[]
  onDismissProposal: (d: Extract<Decision, { kind: "proposal" }>) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {pending.map((d, i) =>
        d.kind === "fusion" ? (
          <FusionCard key={`fusion:${d.convId}`} d={d} primary={i === 0} />
        ) : d.kind === "card" ? (
          <BoardQueueCard key={`card:${d.cardId}`} d={d} primary={i === 0} />
        ) : (
          <ProposalCard
            key={`proposal:${d.proposalId}`}
            d={d}
            primary={i === 0}
            onDismiss={() => onDismissProposal(d)}
          />
        ),
      )}
    </div>
  )
}
