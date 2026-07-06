import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import { RichSelect } from "@/components/ui/RichSelect"
import { Button } from "@/components/ui/button"
import { ContextRing } from "@/components/chat/ContextRing"
import { MicButton } from "@/components/chat/MicButton"
import { useApp } from "@/store/app"
import { DESTINATIONS, agentModels, agentEfforts } from "@/lib/agents"
import type { SlashCommand } from "@/lib/sources"
import type { AtItem } from "@/hooks/useAtMentions"
import type { Attachment } from "@/lib/attachments"
import type { Destination, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

const CHIPS = [
  { label: "Explicar o projeto", prompt: "Explique a arquitetura deste projeto em alto nível." },
  { label: "Rodar os testes", prompt: "Rode a suíte de testes e me mostre o resultado." },
  { label: "Criar uma branch", prompt: "Crie uma branch nova a partir da main para esta tarefa." },
]

/** Popover do "/", comandos/skills do projeto (e globais). */
export function SlashPopover({
  project,
  matches,
  idx,
  setIdx,
  onPick,
}: {
  project: Project | null
  matches: SlashCommand[]
  idx: number
  setIdx: (i: number) => void
  onPick: (name: string) => void
}) {
  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-pop)]">
      <div className="border-b px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        Comandos{project ? ` · ${project.name}` : ""}
      </div>
      <div className="max-h-64 overflow-auto p-1">
        {matches.map((c, i) => (
          <button
            key={`${c.kind}:${c.name}`}
            onMouseEnter={() => setIdx(i)}
            onClick={() => onPick(c.name)}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-1.5 text-left",
              i === idx ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="font-mono text-[13px] text-foreground">
                /{c.name}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {c.origin === "global" && (
                  <span className="text-[8.5px] tracking-wide text-muted-foreground/55 uppercase">
                    global
                  </span>
                )}
                <span className="rounded border px-1 py-px text-[8.5px] tracking-wide text-muted-foreground uppercase">
                  {c.kind === "skill" ? "skill" : "cmd"}
                </span>
              </span>
            </span>
            {c.description && (
              <span className="line-clamp-1 text-[11.5px] text-muted-foreground">
                {c.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Popover do "@", arquivos + agents do projeto (mid-text). */
export function AtPopover({
  project,
  items,
  idx,
  setIdx,
  onPick,
}: {
  project: Project | null
  items: AtItem[]
  idx: number
  setIdx: (i: number) => void
  onPick: (value: string) => void
}) {
  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-pop)]">
      <div className="border-b px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        Referências{project ? ` · ${project.name}` : ""}
      </div>
      <div className="max-h-64 overflow-auto p-1">
        {items.map((m, i) => (
          <button
            key={`${m.kind}:${m.value}`}
            onMouseEnter={() => setIdx(i)}
            onClick={() => onPick(m.value)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left",
              i === idx ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="truncate font-mono text-[12.5px] text-foreground">
              @{m.value}
            </span>
            <span className="shrink-0 rounded border px-1 py-px text-[8.5px] tracking-wide text-muted-foreground uppercase">
              {m.kind}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Faixa de chips dos anexos pendentes (acima do textarea). */
export function AttachmentChips({
  attachments,
  caps,
  destLabel,
  onRemove,
}: {
  attachments: Attachment[]
  caps: { image: boolean; pdf: boolean }
  destLabel: string
  onRemove: (path: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {attachments.map((a) => {
        const ok =
          a.kind === "image"
            ? caps.image
            : a.kind === "pdf"
              ? caps.pdf
              : false
        const Icon = a.kind === "pdf" ? FileText : ImageIcon
        return (
          <span
            key={a.path}
            title={ok ? a.name : `${a.name} não é suportado por ${destLabel}`}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]",
              ok
                ? "bg-secondary/50 text-foreground/80"
                : "border-st-error/50 bg-st-error/10 text-st-error",
            )}
          >
            <Icon className="size-3 shrink-0" />
            <span className="max-w-[140px] truncate">{a.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(a.path)
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remover anexo"
            >
              <X className="size-3" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

/** Seleção de agent (dot + nome + badge + descrição). ÚNICO, o composer do Linear e
 *  a liga do Fusion reusam. Segue o padrão rico (RichSelect) dos demais selects. */
export function AgentSelect({
  value,
  onValueChange,
  disabled,
  options = DESTINATIONS,
  title,
}: {
  value: string
  onValueChange: (v: string) => void
  disabled?: boolean
  options?: Destination[]
  title?: string
}) {
  // agents com limite atingido (cross-conversa): o seletor avisa antes de tentar.
  const limited = useApp((s) => s.limitedAgents)
  return (
    <RichSelect
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      title={title}
      dot
      aria-label="Agent"
      triggerClassName="h-8 gap-2 pr-2 pl-2.5 text-[13px] text-foreground data-[size=default]:h-8"
      options={options.map((d) => {
        const isLimited = d.id in limited
        const hint = limited[d.id]
        return {
          value: d.id,
          label: d.label,
          description: isLimited
            ? hint
              ? `limite atingido, volta ${hint}`
              : "limite de uso atingido"
            : d.description,
          badge: isLimited ? "limitado" : d.hint,
          disabled: !d.available,
        }
      })}
    />
  )
}

/** Controles do footer: destino + modelo + effort + Disputar/anexar/enviar. */
export function ComposerControls({
  effectiveDest,
  locked,
  onDestChange,
  effectiveModel,
  onModelChange,
  effectiveEffort,
  onEffortChange,
  onFusion,
  fusionDisabled,
  fusionTitle,
  onAttach,
  running,
  onStop,
  onSubmit,
  canSend,
}: {
  effectiveDest: string
  locked: boolean
  onDestChange: (v: string) => void
  effectiveModel: string
  onModelChange: (v: string) => void
  effectiveEffort: string
  onEffortChange: (v: string) => void
  onFusion: () => void
  fusionDisabled?: boolean
  fusionTitle?: string
  onAttach: () => void
  running?: boolean
  onStop?: () => void
  onSubmit: () => void
  canSend: boolean
}) {
  const lockTitle = locked
    ? "Agent e modelo ficam fixos a partir do 1º envio desta conversa"
    : undefined
  return (
    <>
      <AgentSelect
        value={effectiveDest}
        onValueChange={onDestChange}
        disabled={locked}
        title={lockTitle}
      />

      <RichSelect
        value={effectiveModel}
        onValueChange={onModelChange}
        disabled={locked}
        title={lockTitle}
        options={agentModels(effectiveDest)}
        triggerClassName="h-8 gap-1 px-2.5 text-muted-foreground data-[size=default]:h-8"
        aria-label="Modelo"
      />

      <RichSelect
        value={effectiveEffort}
        onValueChange={onEffortChange}
        disabled={locked}
        title={lockTitle}
        options={agentEfforts(effectiveDest)}
        triggerClassName="h-8 gap-1 px-2.5 text-muted-foreground data-[size=default]:h-8"
        aria-label="Esforço de raciocínio"
      />

      <div className="ml-auto flex items-center gap-1.5">
        <ContextRing />
        <MicButton />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onFusion}
          disabled={fusionDisabled}
          title={fusionTitle ?? "Disputar entre agents (Fusion)"}
          aria-label="Disputar entre agents"
          className="rounded-full text-muted-foreground hover:text-brass"
        >
          <Sparkles className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onAttach}
          className="rounded-full text-muted-foreground hover:text-foreground"
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="size-4" />
        </Button>
        {running ? (
          <Button
            size="icon-sm"
            onClick={onStop}
            className="rounded-full"
            aria-label="Parar"
            title="Parar"
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            onClick={onSubmit}
            disabled={!canSend}
            className="rounded-full"
            aria-label="Enviar"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </>
  )
}

/** Linha de sugestões (chips) abaixo do composer: spinner → sugestões → CHIPS. */
export function SuggestionChips({
  suggesting,
  suggestions,
  onPick,
}: {
  suggesting: boolean
  suggestions: string[]
  onPick: (text: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggesting && suggestions.length === 0 ? (
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-[13px] text-muted-foreground">
          <Sparkles className="size-3.5 animate-pulse text-brass" />
          buscando sugestões…
        </span>
      ) : suggestions.length > 0 ? (
        suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(s)}
            className="flex items-center gap-1.5 rounded-full border border-brass/30 bg-brass/5 px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:border-brass/60 hover:bg-brass/10 hover:text-foreground"
          >
            <Sparkles className="size-3 text-brass" />
            {s}
          </button>
        ))
      ) : (
        CHIPS.map((c) => (
          <button
            key={c.label}
            onClick={() => onPick(c.prompt)}
            className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
          >
            {c.label}
          </button>
        ))
      )}
    </div>
  )
}
