// E1 — Detalhe do card (feedback real de uso: "senti falta de um clique no
// card para ver mais detalhes ou acrescentar mais detalhes"). Dialog compacto
// no padrão shadcn do repo (SettingsDialog/FusionLauncher): título e body
// EDITÁVEIS com Salvar explícito (update do store, mesmo relógio banco+patch),
// meta read-only (projeto, estado, criado/atualizado, custo, assignee) e as
// MESMAS ações de estado do BoardLane no rodapé (cardActions — fonte única,
// nenhum caminho novo de estado).

import { useRef, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { openCardConversation, useCards, type CardRow } from "@/store/cards"
import { fmtCost } from "@/lib/format"
import {
  CardStateActions,
  CardStateBadge,
  tryAction,
} from "@/components/panel/cardActions"

/** Mesmo formato do InboxBell (duplicado local de propósito — padrão do
 *  MissionControl, sem tocar lá). */
function fmtRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "agora"
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="label-mono w-24 shrink-0 text-[9px]">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-foreground">
        {children}
      </span>
    </div>
  )
}

function DetailBody({
  card,
  projectName,
  archivedProject,
  cost,
  onClose,
}: {
  card: CardRow
  projectName: string
  archivedProject: boolean
  cost: { total: number; estimated: boolean } | null
  onClose: () => void
}) {
  // rascunho local do formulário: seed no mount (o key={card.id} do caller
  // garante remount ao trocar de card) — Salvar é o gesto que persiste.
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body ?? "")
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const stalledMin =
    card.stalledSince != null
      ? Math.max(1, Math.round((Date.now() - card.stalledSince) / 60_000))
      : null

  async function save() {
    if (saving) return
    if (!title.trim()) {
      toast.error("O card precisa de um título")
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    // o store valida de novo (título vazio lança) e carimba banco+patch com o
    // MESMO relógio — aqui só a coreografia do formulário.
    const ok = await tryAction(() =>
      useCards.getState().update(card.id, { title, body }),
    )
    setSaving(false)
    if (ok) onClose()
  }

  const dirty = title !== card.title || body !== (card.body ?? "")

  return (
    <DialogContent
      className="gap-0 rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)] sm:max-w-xl"
      // A11y do pedido: foco no TÍTULO ao abrir (não no botão de fechar).
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        titleRef.current?.focus()
      }}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Detalhe do card</DialogTitle>
        <DialogDescription>
          Edite o título e a descrição da intenção; as ações de estado ficam no
          rodapé.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 px-5 pt-5 pb-4">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Título do card"
          placeholder="Título do card"
          className="h-9 w-full rounded-md border border-border/70 bg-secondary/20 px-2.5 pr-8 text-[14px] font-medium text-foreground placeholder:text-muted-foreground/60 focus:border-brass/50 focus:outline-none"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Descrição do card"
          placeholder="Adicione contexto, critérios de aceite, links..."
          className="max-h-64 min-h-24 text-[13px] leading-relaxed"
        />

        {/* meta read-only — o card não mente: projeto arquivado e estagnação
            aparecem aqui com o mesmo vocabulário do board */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/30 px-3 py-2.5">
          <MetaRow label="Projeto">
            {archivedProject ? (
              <span className="text-muted-foreground">projeto arquivado</span>
            ) : (
              <span className="min-w-0 truncate">{projectName}</span>
            )}
          </MetaRow>
          <MetaRow label="Estado">
            <CardStateBadge state={card.state} />
            {stalledMin != null && (
              <span className="shrink-0 rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[10px] tracking-wide text-st-warning">
                parado há {stalledMin} min
              </span>
            )}
          </MetaRow>
          <MetaRow label="Criado">{fmtRelative(card.createdAt)}</MetaRow>
          <MetaRow label="Atualizado">{fmtRelative(card.updatedAt)}</MetaRow>
          {card.assigneeAgent && (
            <MetaRow label="Agent">{card.assigneeAgent}</MetaRow>
          )}
          {cost && cost.total > 0 && (
            <MetaRow label="Custo">
              <span
                className="font-mono tabular-nums"
                title="Custo de chat e disputas. Missão e SDD ficam fora no v1."
              >
                {cost.estimated ? "~" : ""}
                {fmtCost(cost.total)}
              </span>
            </MetaRow>
          )}
        </div>

        {card.conversationId && (
          <div>
            <Button
              size="sm"
              variant="outline"
              // F-E: conversa em projeto invisível é armadilha — não navega.
              disabled={archivedProject}
              onClick={() => {
                onClose()
                void openCardConversation(card.id)
              }}
            >
              Abrir conversa
            </Button>
          </div>
        )}
      </div>

      {/* rodapé: ações de estado (fonte única do board) + Salvar explícito */}
      <div className="flex items-center gap-1 border-t border-border/60 px-5 py-3">
        <CardStateActions card={card} archivedProject={archivedProject} />
        <Button
          size="sm"
          className="ml-auto"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </DialogContent>
  )
}

export function CardDetailDialog({
  cardId,
  onClose,
  projectNames,
  costs,
}: {
  /** id do card aberto no detalhe (null = fechado). */
  cardId: string | null
  onClose: () => void
  projectNames: Map<string, string>
  /** Mesmo mapa de custos que o BoardLane já mantém (por conv_id). */
  costs: Record<string, { total: number; estimated: boolean }>
}) {
  // assinatura viva do store: mover/fechar pelo rodapé re-renderiza o badge.
  const card = useCards((s) =>
    cardId ? s.all.find((c) => c.id === cardId) : undefined,
  )
  return (
    <Dialog open={card != null} onOpenChange={(o) => !o && onClose()}>
      {card && (
        <DetailBody
          key={card.id}
          card={card}
          projectName={projectNames.get(card.projectId) ?? "projeto"}
          archivedProject={!projectNames.has(card.projectId)}
          cost={
            card.conversationId ? (costs[card.conversationId] ?? null) : null
          }
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}
