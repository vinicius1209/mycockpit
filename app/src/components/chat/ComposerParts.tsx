import { useState } from "react"
import {
  ArrowUp,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Rocket,
  Sparkles,
  Square,
  Swords,
  X,
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
import { MicButton } from "@/components/chat/MicButton"
import { useApp } from "@/store/app"
import { DESTINATIONS, agentModels, agentEfforts } from "@/lib/agents"
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
 *  juntas, num único envio, quando o turno atual termina. */
export function QueuedChips({
  queued,
  onRemove,
}: {
  queued: QueuedMsg[]
  onRemove: (index: number) => void
}) {
  if (queued.length === 0) return null
  return (
    <div className="flex flex-col gap-1 px-1 pb-1">
      <span className="px-1 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
        Na fila · enviam juntas ao terminar
      </span>
      {queued.map((msg, i) => (
        <span
          key={i}
          title={msg.text}
          className="flex items-center gap-1.5 rounded-md border border-brass/30 bg-brass/5 px-2 py-1 text-[12px] text-foreground/80"
        >
          <span className="text-muted-foreground/60">{i + 1}.</span>
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
          <button
            onClick={() => onRemove(i)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Remover da fila"
          >
            <X className="size-3" />
          </button>
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

// Sentinela do "Modelo custom…" no select de modelo — NUNCA chega ao adapter:
// escolher abre o input inline; só o id digitado (confirmado) vira o model.
const CUSTOM_MODEL = "__custom__"
/** Agents cujas CLIs aceitam id arbitrário via --model/-m (dia-1 de modelo). */
const CUSTOM_MODEL_AGENTS = new Set(["claude-code", "codex"])

/** IDENTIDADE do turno: preset (persona) + agent + modelo + esforço. Os quatro
 *  TRAVAM no 1º envio da conversa, então não moram mais no rodapé (onde ficavam
 *  ocupando o melhor espaço para exibir estado imutável) — a `ExecutionRow` os
 *  revela sob demanda atrás do chip colapsado. */
export function IdentityControls({
  presetValue,
  presetOptions,
  onPresetChange,
  effectiveDest,
  locked,
  onDestChange,
  effectiveModel,
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
  onModelChange: (v: string) => void
  effectiveEffort: string
  onEffortChange: (v: string) => void
}) {
  const lockTitle = locked
    ? "Agent e modelo ficam fixos a partir do 1º envio desta conversa"
    : undefined

  // "Modelo custom…" (claude-code/codex): id exato digitado num input inline.
  // O select só muda quando o valor é confirmado (Enter); Esc/vazio cancela.
  const [customEditing, setCustomEditing] = useState(false)
  const [customDraft, setCustomDraft] = useState("")
  const baseModels = agentModels(effectiveDest)
  const supportsCustom = CUSTOM_MODEL_AGENTS.has(effectiveDest)
  // valor atual fora da lista = modelo custom em uso → vira opção visível no
  // select (senão o Radix não exibe o selecionado, inclusive em conv travada).
  const isCustomValue =
    effectiveModel !== "default" &&
    !baseModels.some((o) => o.value === effectiveModel)
  const modelOptions = supportsCustom
    ? [
        ...baseModels,
        ...(isCustomValue
          ? [
              {
                value: effectiveModel,
                label: effectiveModel,
                description: "Modelo custom",
              },
            ]
          : []),
        {
          value: CUSTOM_MODEL,
          label: "Modelo custom…",
          description: "Digitar o id exato do modelo",
        },
      ]
    : baseModels

  function handleModelChange(v: string) {
    if (v === CUSTOM_MODEL) {
      setCustomDraft(isCustomValue ? effectiveModel : "")
      setCustomEditing(true)
      return
    }
    onModelChange(v)
  }
  function confirmCustom() {
    const v = customDraft.trim()
    if (v) onModelChange(v)
    setCustomEditing(false)
  }

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
      <AgentSelect
        value={effectiveDest}
        onValueChange={onDestChange}
        disabled={locked}
        title={lockTitle}
      />

      {customEditing ? (
        <input
          autoFocus
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              confirmCustom()
            } else if (e.key === "Escape") {
              e.preventDefault()
              setCustomEditing(false)
            }
          }}
          onBlur={confirmCustom}
          placeholder="id exato do modelo"
          aria-label="Modelo custom"
          className="h-8 w-44 rounded-md border border-border bg-secondary/40 px-2 font-mono text-[12px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-brass/50"
        />
      ) : (
        <RichSelect
          value={effectiveModel}
          onValueChange={handleModelChange}
          disabled={locked}
          title={lockTitle}
          options={modelOptions}
          triggerClassName="h-8 gap-1 px-2.5 text-muted-foreground data-[size=default]:h-8"
          aria-label="Modelo"
        />
      )}

      {/* Esforço só existe pra quem TEM o eixo. O agy embute o esforço no id do
          modelo (`gemini-3.6-flash-low`), então `efforts` é vazio — e um
          RichSelect sem opções renderizava uma pílula VAZIA e inútil no meio da
          linha. Mesma guarda que o seletor de preset já tinha. */}
      {agentEfforts(effectiveDest).length > 0 && (
        <RichSelect
          value={effectiveEffort}
          onValueChange={onEffortChange}
          disabled={locked}
          title={lockTitle}
          options={agentEfforts(effectiveDest)}
          triggerClassName="h-8 gap-1 px-2.5 text-muted-foreground data-[size=default]:h-8"
          aria-label="Esforço de raciocínio"
        />
      )}
    </>
  )
}

/**
 * Rodapé do composer — só o que MODIFICA a mensagem (ditado, anexo) e o que a
 * DESPACHA (o split de enviar). A identidade (preset/agent/modelo/esforço) e o
 * estado do turno (permissão, planejar, contexto) subiram pra `ExecutionRow`.
 *
 * Antes eram 13 alvos nesta linha, todos com o mesmo peso — e em tela estreita
 * cortava justamente os acionáveis, que ficavam à direita.
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
}) {
  const missionEnabled = useApp((s) => s.settings.missionEnabled)
  return (
    <>
      <span className="flex items-center gap-1.5 pl-1 font-mono text-[11px] text-muted-foreground/70">
        <kbd className="rounded border border-border bg-secondary/50 px-1 py-px">/</kbd>
        comandos
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {/* overlay="composer": o pill de gravação ancora na raiz relative do
            CommandConsole e paira ACIMA do composer — a fileira não mexe. */}
        <MicButton overlay="composer" />
        {onEspecialistas && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onEspecialistas}
            className="rounded-full text-muted-foreground hover:text-foreground"
            title="Especialistas"
            aria-label="Especialistas"
          >
            <Sparkles className="size-4" />
          </Button>
        )}
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
        <SendSplit
          running={running}
          canSend={canSend}
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
 * Com turno rodando o primário vira Parar e o chevron desabilita (não há
 * rascunho para despachar enquanto o turno corrente não termina).
 */
function SendSplit({
  running,
  canSend,
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
  onSubmit: () => void
  onStop?: () => void
  stopTitle?: string
  onFusion: () => void
  fusionDisabled?: boolean
  fusionTitle?: string
  onMission?: () => void
  missionDisabled?: boolean
}) {
  // Parar é VERMELHO (STYLEGUIDE §2: parar/destruir tem tinta própria). Antes
  // era o `default` bg-primary, o que dava duas tintas pra mesma família de
  // ação: o stop do fio já era vermelho.
  if (running) {
    return (
      <Button
        variant="destructive"
        size="icon-sm"
        onClick={onStop}
        className="rounded-full"
        aria-label="Parar"
        title={stopTitle ?? "Parar"}
      >
        <Square className="size-3 fill-current" />
      </Button>
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
            size="icon-sm"
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
        size="icon-sm"
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
