import {
  ArrowUp,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Rocket,
  Sparkles,
  Square,
  Swords,
  X,
  Zap,
} from "lucide-react"
import { RichSelect } from "@/components/ui/RichSelect"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IdentityPicker } from "@/components/chat/IdentityPicker"
import { MicButton } from "@/components/chat/MicButton"
import { useApp } from "@/store/app"
import { DESTINATIONS } from "@/lib/agents"
import type { SlashCommand } from "@/lib/sources"
import { commandBadges } from "@/lib/slashCommands"
import type { Attachment } from "@/lib/attachments"
import type { QueuedMsg } from "@/store/chat"
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
      <div className="border-b px-3 py-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
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
              {/* chips de origem HONESTOS (fonte · escopo · tipo): o usuário
                  vê de onde o comando vem e, portanto, quem o executa. */}
              <span className="flex shrink-0 items-center gap-1.5">
                {commandBadges(c).map((chip) => (
                  <span
                    key={chip}
                    className="rounded border px-1 py-px text-[11px] tracking-wide text-muted-foreground uppercase"
                  >
                    {chip}
                  </span>
                ))}
              </span>
            </span>
            {c.description && (
              <span className="line-clamp-1 text-[12px] text-muted-foreground">
                {c.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Faixa de chips dos anexos pendentes (acima do input). */
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
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]",
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

/** Fila de mensagens digitadas durante o turno (acima do textarea). Enviadas
 *  juntas, num único envio, quando o turno atual termina, com ações de envio
 *  forçado e edição. */
export function QueuedChips({
  queued,
  onRemove,
  onEdit,
  onForceSend,
}: {
  queued: QueuedMsg[]
  onRemove: (index: number) => void
  onEdit?: (index: number) => void
  onForceSend?: (index: number) => void
}) {
  if (queued.length === 0) return null
  return (
    <div className="mb-1 flex flex-col gap-1.5 rounded-xl border border-st-queued/40 bg-st-queued/10 p-2">
      <div className="flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-st-queued uppercase">
          <span className="rounded-full bg-st-queued/25 px-1.5 py-px font-mono text-[11px] font-bold text-st-queued">
            {queued.length}
          </span>
          Na fila · enviam juntas ao terminar
        </span>
      </div>
      {queued.map((msg, i) => (
        <span
          key={i}
          title={msg.text}
          className="flex items-center gap-2 rounded-md border border-st-queued/30 bg-card/85 px-2.5 py-1 text-[12px] text-foreground/90 shadow-xs"
        >
          <span className="font-mono text-[11px] font-medium text-st-queued/80">{i + 1}.</span>
          <span className="min-w-0 flex-1 truncate">{msg.text}</span>
          {/* anexos viajam com a mensagem enfileirada — mostra que foram junto */}
          {msg.attachments.map((a) => {
            const Icon = a.kind === "pdf" ? FileText : ImageIcon
            return (
              <span
                key={a.path}
                title={a.name}
                className="flex shrink-0 items-center gap-1 rounded border bg-secondary/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                <Icon className="size-2.5 shrink-0" />
                <span className="max-w-[90px] truncate">{a.name}</span>
              </span>
            )
          })}
          <span className="flex shrink-0 items-center gap-1">
            {onForceSend && (
              <Button
                variant="ghost"
                size="chip"
                onClick={() => onForceSend(i)}
                className="text-st-queued hover:bg-st-queued/20 hover:text-st-queued"
                title="Priorizar esta mensagem, interromper o turno e enviar a fila"
                aria-label="Priorizar e enviar a fila agora"
              >
                <Zap className="size-2.5 fill-current" />
                <span>Enviar agora</span>
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="icone-chip"
                onClick={() => onEdit(i)}
                className="text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="Devolver ao composer para editar"
                aria-label="Editar mensagem"
              >
                <Pencil className="size-2.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icone-chip"
              onClick={() => onRemove(i)}
              className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              title="Remover da fila"
              aria-label="Remover da fila"
            >
              <X className="size-3" />
            </Button>
          </span>
        </span>
      ))}
    </div>
  )
}

/** Seleção de agent (dot + nome + badge + descrição). ÚNICO, o composer do Linear e
 *  a liga da disputa (FusionLauncher) reusam. Segue o padrão rico (RichSelect)
 *  dos demais selects. */
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

// Sentinela do "Sem preset" no seletor de persona (S3.6) — nunca vira id real.
export const NO_PRESET = "__none__"

/** IDENTIDADE do turno: preset (persona) + agent + modelo + esforço. Os
 *  quatro TRAVAM no 1º envio da conversa — o `CommandConsole` monta isto e
 *  entrega pronto em `ComposerActions.identityControls` (ADR-051). Agent +
 *  modelo + esforço vivem no `IdentityPicker` (popover único, cmdk); o preset
 *  segue como `RichSelect` próprio, um nível acima da camada crua. */
export function IdentityControls({
  presetValue,
  presetOptions,
  onPresetChange,
  effectiveDest,
  locked,
  onDestChange,
  effectiveModel,
  modelLocked,
  onModelChange,
  effectiveEffort,
  onEffortChange,
}: {
  /** S3.6 — seletor de preset (persona), um nível acima da camada crua.
   *  `presetValue` = id do preset da conversa (ou NO_PRESET). Sem opções
   *  cadastradas o seletor não aparece (comportamento de hoje intacto). */
  presetValue?: string
  presetOptions?: { value: string; label: string; description?: string; badge?: string }[]
  onPresetChange?: (v: string) => void
  effectiveDest: string
  locked: boolean
  onDestChange: (v: string) => void
  effectiveModel: string
  /** O MODELO especificamente está travado. Normalmente acompanha `locked`,
   *  mas depois de um turno que FALHOU ele destrava sozinho (saída de
   *  emergência): o agent segue fixo e dá pra trocar de modelo e reenviar. */
  modelLocked: boolean
  onModelChange: (v: string) => void
  effectiveEffort: string
  onEffortChange: (v: string) => void
}) {
  const lockTitle = locked
    ? "Agent e modelo ficam fixos a partir do 1º envio desta conversa"
    : undefined
  return (
    <>
      {/* S3.6 — persona um nível ACIMA da camada crua: escolher um preset seta
          agent/modelo/esforço de uma vez e marca a conversa; "Sem preset"
          mantém o comportamento de hoje. Só aparece com presets cadastrados. */}
      {presetOptions && presetOptions.length > 0 && onPresetChange && (
        <RichSelect
          value={presetValue ?? NO_PRESET}
          onValueChange={onPresetChange}
          disabled={locked}
          title={locked ? lockTitle : "Iniciar a conversa como uma persona"}
          options={[
            {
              value: NO_PRESET,
              label: "Sem preset",
              description: "Camada crua: agent, modelo e esforço manuais",
            },
            ...presetOptions,
          ]}
          triggerClassName="h-8 gap-1 px-2.5 text-muted-foreground data-[size=default]:h-8"
          aria-label="Preset de persona"
        />
      )}
      <IdentityPicker
        effectiveDest={effectiveDest}
        locked={locked}
        onDestChange={onDestChange}
        effectiveModel={effectiveModel}
        modelLocked={modelLocked}
        onModelChange={onModelChange}
        effectiveEffort={effectiveEffort}
        onEffortChange={onEffortChange}
      />
    </>
  )
}

/**
 * Rodapé do composer: o que MODIFICA a mensagem (ditado, anexo), o que a
 * DESPACHA (o split de enviar), e — desde a ADR-051, referência Paseo.sh —
 * também permissão/planejar-antes/identidade, sempre visíveis (revertendo o
 * colapso atrás de um letreiro só que a ADR-049 tinha medido e implementado).
 * `identityControls`/`permissionControls`/`planFirstControls`/`contextRing`
 * chegam prontos do `CommandConsole`, que é quem monta cada um.
 */
export function ComposerActions({
  onFusion,
  fusionDisabled,
  fusionTitle,
  onMission,
  missionDisabled,
  onAttach,
  onEspecialistas,
  running,
  onStop,
  stopTitle,
  onSubmit,
  canSend,
  canEnqueue,
  onForceSendDraft,
  identityControls,
  permissionControls,
  planFirstControls,
  contextRing,
}: {
  onFusion: () => void
  fusionDisabled?: boolean
  fusionTitle?: string
  onMission?: () => void
  missionDisabled?: boolean
  onAttach: () => void
  /** Atalho ✦: abre o marketplace de Especialistas sobre a conversa. */
  onEspecialistas?: () => void
  running?: boolean
  onStop?: () => void
  /** Tooltip do Parar quando parar custa mais do que parece (ex. trabalho em
   *  background do provider morre junto — deferred-work-plan D1.4). */
  stopTitle?: string
  onSubmit: () => void
  canSend: boolean
  canEnqueue?: boolean
  onForceSendDraft?: () => void
  identityControls?: React.ReactNode
  permissionControls?: React.ReactNode
  planFirstControls?: React.ReactNode
  contextRing?: React.ReactNode
}) {
  const missionEnabled = useApp((s) => s.settings.missionEnabled)
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="icone-padrao"
          onClick={onAttach}
          className="rounded-full text-muted-foreground hover:text-foreground"
          title="Anexar arquivo"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="size-4" />
        </Button>
        {identityControls}
        {permissionControls}
        {planFirstControls}
        {onEspecialistas && (
          <Button
            variant="ghost"
            size="icone-padrao"
            onClick={onEspecialistas}
            className="rounded-full text-muted-foreground hover:text-foreground"
            title="Especialistas"
            aria-label="Especialistas"
          >
            <Sparkles className="size-4" />
          </Button>
        )}
        {/* overlay="composer": o pill de gravação ancora na raiz relative do CommandConsole e paira ACIMA do composer — a fileira não mexe. */}
        <MicButton overlay="composer" />
      </div>

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {contextRing}
        <SendSplit
          running={running}
          canSend={canSend}
          canEnqueue={canEnqueue}
          onForceSendDraft={onForceSendDraft}
          onSubmit={onSubmit}
          onStop={onStop}
          stopTitle={stopTitle}
          onFusion={onFusion}
          fusionDisabled={fusionDisabled}
          fusionTitle={fusionTitle}
          onMission={missionEnabled ? onMission : undefined}
          missionDisabled={missionDisabled}
        />
      </div>
    </>
  )
}

/**
 * Despacho: UM primário com as variantes penduradas. Enviar, Disputa e Missão
 * consomem o MESMO rascunho — os launchers recebem `initialTask={value}` e
 * limpam o composer (CommandConsole) —, então são a mesma ação com três
 * destinos, não três ferramentas. Como dois ícones soltos no meio da barra, esse
 * parentesco era invisível: ninguém adivinhava que ⚔/🚀 usam o texto digitado.
 *
 * Com turno rodando o primário vira Parar, com atalho de enfileirar ou envio
 * forçado imediato quando há texto no editor.
 */
function SendSplit({
  running,
  canSend,
  canEnqueue,
  onForceSendDraft,
  onSubmit,
  onStop,
  stopTitle,
  onFusion,
  fusionDisabled,
  fusionTitle,
  onMission,
  missionDisabled,
}: {
  running?: boolean
  canSend: boolean
  canEnqueue?: boolean
  onForceSendDraft?: () => void
  onSubmit: () => void
  onStop?: () => void
  stopTitle?: string
  onFusion: () => void
  fusionDisabled?: boolean
  fusionTitle?: string
  onMission?: () => void
  missionDisabled?: boolean
}) {
  // Parar é VERMELHO (STYLEGUIDE §2: parar/destruir tem tinta própria).
  if (running) {
    return (
      <div className="flex items-center gap-1.5">
        {canEnqueue && (
          <Button
            variant="secondary"
            size="compacto"
            onClick={onSubmit}
            className="rounded-full"
            title="Enfileirar próxima mensagem (Enter)"
            aria-label="Enfileirar"
          >
            <span>Enfileirar</span>
            <span className="font-mono text-[11px] text-muted-foreground">↵</span>
          </Button>
        )}
        {canEnqueue && onForceSendDraft && (
          <Button
            variant="ghost"
            size="compacto"
            onClick={onForceSendDraft}
            className="rounded-full bg-st-queued/15 text-st-queued hover:bg-st-queued/25 hover:text-st-queued"
            title="Interromper turno e enviar agora (⌘Enter)"
            aria-label="Interromper e enviar agora"
          >
            <Zap className="size-3 fill-current" />
            <span>Enviar agora</span>
            <span className="font-mono text-[11px] opacity-75">⌘↵</span>
          </Button>
        )}
        <Button
          variant="destructive"
          size="icone-padrao"
          onClick={onStop}
          className="rounded-full"
          aria-label="Parar"
          title={stopTitle ?? "Parar"}
        >
          <Square className="size-3 fill-current" />
        </Button>
      </div>
    )
  }
  // O chevron é GHOST ao lado do enviar, não fundido nele: fundir dobrava a área
  // preta (o `default` do Button é bg-primary) e o bloco pesava mais que tudo em
  // volta — fora do padrão da barra, onde todo secundário é ghost. Assim o
  // primário fica EXATAMENTE o que sempre foi e a variante é um affordance
  // discreto, do mesmo peso do microfone e do clipe.
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icone-padrao"
            aria-label="Outras formas de enviar"
            title="Outras formas de enviar (disputa, missão)"
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-60">
          <DropdownMenuItem onClick={onSubmit} disabled={!canSend}>
            <ArrowUp className="size-4 text-muted-foreground" />
            <span className="flex-1">Enviar</span>
            <span className="font-mono text-[11px] text-muted-foreground">⏎</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onFusion}
            disabled={fusionDisabled}
            title={fusionTitle}
            className="items-start"
          >
            <Swords className="mt-0.5 size-4 text-muted-foreground" />
            <span className="flex flex-col">
              Disputa entre agents
              <span className="text-[11px] text-muted-foreground">
                N candidatos, um juiz decide
              </span>
            </span>
          </DropdownMenuItem>
          {onMission && (
            <DropdownMenuItem
              onClick={onMission}
              disabled={missionDisabled}
              className="items-start"
            >
              <Rocket className="mt-0.5 size-4 text-muted-foreground" />
              <span className="flex flex-col">
                Missão em fases
                <span className="text-[11px] text-muted-foreground">
                  time de agents, worktree isolado
                </span>
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* O primário: idêntico ao que sempre foi (mesma Button/size/raio). */}
      <Button
        size="icone-padrao"
        onClick={onSubmit}
        disabled={!canSend}
        className="rounded-full"
        aria-label="Enviar"
        title="Enviar (⏎)"
      >
        <ArrowUp className="size-4" />
      </Button>
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
    // Sugestão é OFERTA, não instrução: pesa menos que o composer inteiro logo
    // acima. Antes cada pílula tinha borda brass + fundo brass + 13px + ícone
    // próprio — três delas gritavam e quebravam em duas linhas, comendo altura
    // útil. Agora: 12px, altura menor, borda neutra, e o brass só no hover (a
    // cor de marca marca a INTENÇÃO de clicar, não o repouso). O ícone saiu de
    // cada pílula e ficou só no estado "buscando", onde ele comunica atividade;
    // repetido 3x era ruído e ainda roubava ~20px de largura por pílula.
    <div className="flex flex-wrap items-center gap-1.5">
      {suggesting && suggestions.length === 0 ? (
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-2.5 py-1 text-[12px] text-muted-foreground">
          <Sparkles className="size-3 animate-pulse text-brass" />
          buscando sugestões…
        </span>
      ) : suggestions.length > 0 ? (
        suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(s)}
            title={s}
            className="max-w-[280px] truncate rounded-full border border-border/70 bg-card/40 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-brass/50 hover:bg-brass/10 hover:text-foreground"
          >
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
