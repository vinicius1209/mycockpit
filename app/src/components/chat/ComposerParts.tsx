import {
  FileText,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Sparkles,
  X,
  Zap,
} from "lucide-react"
import { RichSelect } from "@/components/ui/RichSelect"
import { Button } from "@/components/ui/button"
import { SendSplit } from "@/components/chat/ComposerDispatch"
import { EspecialistasTrigger } from "@/components/chat/EspecialistasTrigger"
import { IdentityPicker } from "@/components/chat/IdentityPicker"
import { MicButton } from "@/components/chat/MicButton"
import { useApp } from "@/store/app"
import { DESTINATIONS } from "@/lib/agents"
import type { Attachment } from "@/lib/attachments"
import { useChat, type QueuedMsg } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { BlocosDoRascunho } from "@/components/chat/BlocosDoRascunho"
import type { Destination } from "@/lib/types"
import { cn } from "@/lib/utils"
import { fmtBytes } from "@/lib/format"
import { resolverHelper } from "@/lib/helperDoProjeto"

const CHIPS = [
  { label: "Explicar o projeto", prompt: "Explique a arquitetura deste projeto em alto nível." },
  { label: "Rodar os testes", prompt: "Rode a suíte de testes e me mostre o resultado." },
  { label: "Criar uma branch", prompt: "Crie uma branch nova a partir da main para esta tarefa." },
]

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
  // Citações do rascunho da conversa ativa (capricho R4): moram no store, não
  // no editor, e aparecem aqui junto com os anexos.
  const activeId = useChat((s) => s.activeId)
  const blocos = useComposerDrafts((s) => (activeId ? s.byConv[activeId]?.blocos : undefined))
  if (attachments.length === 0 && !blocos?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {activeId &&
        blocos?.length ? <BlocosDoRascunho convId={activeId} blocos={blocos} /> : null}
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
            <span className="font-mono text-[11px] tabular-nums opacity-70">{fmtBytes(a.bytes)}</span>
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
  turnState,
}: {
  queued: QueuedMsg[]
  onRemove: (index: number) => void
  onEdit?: (index: number) => void
  onForceSend?: (index: number) => void
  turnState: "running" | "finalizing" | "idle"
}) {
  if (queued.length === 0) return null
  const queueLabel =
    turnState === "running"
      ? "Na fila · enviam quando este turno terminar"
      : turnState === "finalizing"
        ? "Na fila · aguardando o fechamento do turno"
        : "Prontas para enviar"
  return (
    <div className="mb-1 flex flex-col gap-1.5 rounded-xl border bg-st-queued/10 p-2">
      <div className="flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-st-queued uppercase">
          <span className="rounded-full bg-st-queued/25 px-1.5 py-px font-mono text-[11px] font-bold text-st-queued">
            {queued.length}
          </span>
          {queueLabel}
        </span>
      </div>
      {queued.map((msg, i) => (
        <span
          key={i}
          title={msg.text}
          className="flex items-center gap-2 rounded-md border bg-card/85 px-2.5 py-1 text-[12px] text-foreground/90 shadow-xs"
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
                title={
                  turnState === "running"
                    ? "Priorizar, interromper o turno e enviar a fila"
                    : "Priorizar e enviar a fila"
                }
                aria-label={
                  turnState === "running"
                    ? "Interromper e enviar a fila"
                    : "Enviar a fila"
                }
              >
                <Zap className="size-2.5 fill-current" />
                <span>{turnState === "running" ? "Interromper e enviar" : "Enviar"}</span>
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
  effortLocked,
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
  /** O ESFORÇO está travado. Mesma regra do `modelLocked`: só enquanto o
   *  turno está em voo. */
  effortLocked: boolean
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
        effortLocked={effortLocked}
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
  preparing,
  onFusion,
  fusionDisabled,
  fusionTitle,
  onMission,
  missionDisabled,
  onAttach,
  onEspecialistas,
  running,
  finalizing,
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
  finalizing?: boolean
  /** Turno em MONTAGEM (ver SendSplit). */
  preparing?: boolean
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
        {onEspecialistas && <EspecialistasTrigger onOpen={onEspecialistas} />}
        {/* overlay="composer": o pill de gravação ancora na raiz relative do CommandConsole e paira ACIMA do composer — a fileira não mexe. */}
        <MicButton overlay="composer" />
      </div>

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {contextRing}
        <SendSplit
          running={running}
          finalizing={finalizing}
          preparing={preparing}
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

/** Container: pergunta se ESTE projeto tem inteligência utilitária e entrega a
 *  resposta pronta pra linha desenhar. A leitura do store fica aqui em cima
 *  porque `LinhaDeSugestoes` precisa continuar puro: componente que lê `useApp`
 *  direto enxerga o estado INICIAL congelado sob `renderToStaticMarkup`, e era
 *  justamente o desligado que o teste precisava provar. */
export function SuggestionChips(props: {
  suggesting: boolean
  suggestions: string[]
  onPick: (text: string) => void
}) {
  const activeId = useChat((s) => s.activeId)
  const projectId = useChat((s) => (activeId ? s.byId[activeId]?.projectId : null))
  // Selector devolve booleano (primitivo): não recria referência a cada render,
  // e reage tanto ao default global quanto à config do projeto.
  const temHelper = useApp((s) =>
    projectId ? resolverHelper({
      cfg: s.mycockpit[projectId],
      global: s.settings.helperModel,
    }) !== null : false,
  )
  return <LinhaDeSugestoes {...props} temHelper={temHelper} />
}

/** Linha de sugestões (chips) abaixo do composer: spinner → sugestões → CHIPS.
 *
 *  `temHelper === false` some com a linha INTEIRA, e o composer não reserva a
 *  altura dela. Os três chips estáticos são o fallback de uma oferta que existe
 *  ("o modelo ainda não escreveu as suas sugestões"); com o helper desligado nas
 *  Configurações não há oferta nenhuma, e oferecer o gesto de uma camada
 *  desligada é teatro — além de comer altura útil de graça. */
export function LinhaDeSugestoes({
  suggesting,
  suggestions,
  onPick,
  temHelper,
}: {
  suggesting: boolean
  suggestions: string[]
  onPick: (text: string) => void
  temHelper: boolean
}) {
  // Sugestão já entregue continua na tela mesmo se o helper for desligado no
  // meio: ela é fato consumado, não promessa. O que some é a OFERTA.
  if (!temHelper && suggestions.length === 0) return null
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
