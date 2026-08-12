// E1 — Detalhe do card. Redesenho no padrão blocks.so/dialogs: cabeçalho de
// VERDADE (eyebrow + ações + fechar num banco só — o X ganha "casa" e não cai
// mais sobre o campo de título), corpo editável (título+descrição), meta
// read-only e rodapé com as ações de estado (cardActions, fonte única) +
// Salvar. Arquivar (sai do board, recuperável) e Apagar (destrutivo, com
// confirmação no padrão dialog-03: ícone de alerta + Cancelar/Apagar) moram no
// canto do cabeçalho — nenhum caminho novo de estado, só lifecycle do card.

import { useRef, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Archive, Trash2, X } from "lucide-react"
import {
  Dialog,
  DialogClose,
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
      <span className="label-mono w-24 shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-foreground">
        {children}
      </span>
    </div>
  )
}

/** Botão de ícone do cabeçalho (arquivar/apagar/fechar) — mesma pegada do X do
 *  dialog base, com "casa" própria no banco do header. */
function HeaderIconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        "grid size-7 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 " +
        (danger ? "hover:bg-st-error/10 hover:text-st-error" : "")
      }
    >
      {children}
    </button>
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const isArchived = card.archivedAt != null
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

  async function archive() {
    const ok = await tryAction(() => useCards.getState().archive(card.id))
    if (ok) {
      toast("Card arquivado. Restaure em Arquivados, no board.")
      onClose()
    }
  }

  async function restore() {
    const ok = await tryAction(() => useCards.getState().restore(card.id))
    if (ok) {
      toast.success("Card restaurado ao board.")
      onClose()
    }
  }

  async function remove() {
    const ok = await tryAction(() => useCards.getState().remove(card.id))
    setConfirmDelete(false)
    if (ok) {
      toast("Card apagado.")
      onClose()
    }
  }

  const dirty = title !== card.title || body !== (card.body ?? "")

  return (
    <DialogContent
      showCloseButton={false}
      className="gap-0 rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)] sm:max-w-xl"
      // A11y do pedido: foco no TÍTULO ao abrir (não numa ação de canto).
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        titleRef.current?.focus()
      }}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Detalhe do card</DialogTitle>
        <DialogDescription>
          Edite o título e a descrição da intenção; as ações de estado ficam no
          rodapé e as de arquivar/apagar no cabeçalho.
        </DialogDescription>
      </DialogHeader>

      {/* cabeçalho: eyebrow (projeto · estado) + ações de canto num banco só */}
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 pt-0.5">
          <span className="min-w-0 truncate text-[12px] text-muted-foreground">
            {archivedProject ? "projeto arquivado" : projectName}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <CardStateBadge state={card.state} />
          {isArchived && (
            <span className="shrink-0 rounded border border-border px-1.5 py-px text-[11px] tracking-wide text-muted-foreground uppercase">
              arquivado
            </span>
          )}
          {stalledMin != null && (
            <span className="shrink-0 rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[11px] tracking-wide text-st-warning">
              parado há {stalledMin} min
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isArchived ? (
            <HeaderIconButton label="Restaurar ao board" onClick={() => void restore()}>
              <Archive />
            </HeaderIconButton>
          ) : (
            <HeaderIconButton label="Arquivar" onClick={() => void archive()}>
              <Archive />
            </HeaderIconButton>
          )}
          <HeaderIconButton label="Apagar de vez" danger onClick={() => setConfirmDelete(true)}>
            <Trash2 />
          </HeaderIconButton>
          <DialogClose asChild>
            <HeaderIconButton label="Fechar" onClick={onClose}>
              <X />
            </HeaderIconButton>
          </DialogClose>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 pt-4 pb-4">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Título do card"
          placeholder="Título do card"
          className="h-9 w-full rounded-md border border-border/70 bg-secondary/20 px-2.5 text-[14px] font-medium text-foreground placeholder:text-muted-foreground/60 focus:border-brass/50 focus:outline-none"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Descrição do card"
          placeholder="Adicione contexto, critérios de aceite, links..."
          className="max-h-64 min-h-24 text-[13px] leading-relaxed"
        />

        {/* meta read-only — criado/atualizado/agent/custo (projeto e estado já
            vivem no cabeçalho, sem repetir) */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/30 px-3 py-2.5">
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

      {/* rodapé: ações de estado (fonte única do board) + Salvar explícito.
          Arquivado é FORA do fluxo — não mostra Iniciar/Revisão/etc. (agir num
          arquivado gravava no banco e divergia do store): pra agir, restaure. */}
      <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3">
        {isArchived ? (
          <span className="text-[11px] text-muted-foreground">
            Arquivado — restaure para agir no fluxo.
          </span>
        ) : (
          <CardStateActions card={card} archivedProject={archivedProject} />
        )}
        <Button
          size="sm"
          className="ml-auto"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      {/* confirmação destrutiva — padrão blocks.so dialog-03 (ícone de alerta,
          Cancelar / Apagar). Dialog próprio empilhado sobre o detalhe. */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <div className="flex items-start gap-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-st-error/10">
              <AlertTriangle className="size-5 text-st-error" />
            </div>
            <DialogHeader className="space-y-1.5">
              <DialogTitle>Apagar este card?</DialogTitle>
              <DialogDescription>
                “{card.title}” será removido de vez do board. Esta ação não pode
                ser desfeita. A conversa ligada (se houver) não é apagada.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-st-error text-white hover:bg-st-error/90"
              onClick={() => void remove()}
            >
              Apagar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
  // assinatura viva do store: mover/arquivar/fechar re-renderiza. Procura nas
  // DUAS listas — o detalhe abre tanto de card do board quanto de arquivado.
  const card = useCards((s) =>
    cardId
      ? (s.all.find((c) => c.id === cardId) ??
        s.archived.find((c) => c.id === cardId))
      : undefined,
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
