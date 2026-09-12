// O SELETOR UNIFICADO de agent + modelo + esforço — UM popover em vez de três
// RichSelect separados atrás do IdentityDoor. Aprovado via mock estático
// (docs/mocks/seletor-unificado.html, referência Traycer, 19/08/2026).
//
// cmdk (`@/components/ui/command`), não Radix Select: Select do Radix dentro
// de um popover flutuante briga por foco (ADR-049, e o comentário do próprio
// IdentityDoor) — cmdk não é Select, não porta esse risco.

import { useState } from "react"
import { Check } from "lucide-react"
import { toast } from "sonner"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { AgentLogo, AGENT_LOGO_LABEL, agentLogoLabel } from "@/components/common/AgentLogo"
import { DESTINATIONS, agentModels, agentEfforts } from "@/lib/agents"
import { effortFitsModel, SENTINELA } from "@/lib/modelList"
import { problemaNoSlug } from "@/lib/modelSlug"
import { estadoNaMaquina } from "@/lib/detect"
import { SELECTED_FILL } from "@/lib/selection"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

// Sentinela do "Modelo custom…" — nunca chega ao adapter: escolher abre o
// input inline; só o id digitado (confirmado) vira o model. Mesma regra que
// já existia em ComposerParts.tsx (IdentityControls), só migrada pra cá.
const CUSTOM_MODEL = "__custom__"
const CUSTOM_MODEL_AGENTS = new Set(["claude-code", "codex"])

// Agents com logo conhecido (AgentLogo.tsx) — hoje os únicos 3 no rail. Deriva
// de AGENT_LOGO_LABEL, não de DESTINATIONS inteiro: os "em breve"
// (opencode/modelo direto, available:false) não têm logo e ficam de fora por
// construção, sem lista de exceção pra manter em dia.
const RAIL_AGENTS = DESTINATIONS.filter((d) => d.id in AGENT_LOGO_LABEL)

export function IdentityPicker({
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
  effectiveDest: string
  /** Conversa já estabelecida. NÃO desabilita o trilho de motor (o clique
   *  engatilha revezamento pro próximo envio) nem modelo e esforço (eles têm
   *  trava própria, `modelLocked`/`effortLocked`, só enquanto há turno em voo);
   *  muda o que os controles PROMETEM no tooltip. */
  locked: boolean
  onDestChange: (v: string) => void
  effectiveModel: string
  modelLocked: boolean
  onModelChange: (v: string) => void
  effectiveEffort: string
  effortLocked: boolean
  onEffortChange: (v: string) => void
}) {
  const limited = useApp((s) => s.limitedAgents)
  const detectados = useApp((s) => s.settings.detected)
  const [customEditing, setCustomEditing] = useState(false)
  const [customDraft, setCustomDraft] = useState("")

  // O que o cadeado ainda prende. NÃO é mais o agent: desde o revezamento
  // proativo (ADR-165) o trilho de motor aceita clique numa conversa travada e
  // engatilha a troca pro PRÓXIMO envio. Esta copy servia aos três eixos e
  // continuou falando por todos depois que um saiu — dizer "agent fica fixo" ao
  // lado de um trilho que troca de agent é a UI se contradizendo na mesma tela.
  //
  // Desde 11/09/2026 o esforço segue o modelo: os dois só travam com turno em
  // voo (a flag já foi no spawn) e, fora disso, trocam valendo do próximo envio
  // sem perder a sessão.
  const emVooTitle = "Modelo e esforço trocam quando o turno em curso terminar"
  const trocaTitle = "Vale do próximo envio, na mesma sessão"
  const modelTitle = modelLocked ? emVooTitle : locked ? trocaTitle : undefined
  const effortTitle = effortLocked ? emVooTitle : locked ? trocaTitle : undefined

  const baseModels = agentModels(effectiveDest)
  const supportsCustom = CUSTOM_MODEL_AGENTS.has(effectiveDest)
  const isCustomValue =
    effectiveModel !== "default" && !baseModels.some((o) => o.value === effectiveModel)
  const modelOptions = isCustomValue
    ? [...baseModels, { value: effectiveModel, label: effectiveModel, description: "Modelo custom" }]
    : baseModels
  // A régua de esforço é do MODELO quando o CLI a declara: o mesmo motor
  // aceita `ultra` num modelo e para em `xhigh` no vizinho.
  const efforts = agentEfforts(effectiveDest, effectiveModel)

  function selectAgent(id: string) {
    setCustomEditing(false)
    onDestChange(id)
  }
  function selectModel(v: string) {
    if (v === CUSTOM_MODEL) {
      setCustomDraft(isCustomValue ? effectiveModel : "")
      setCustomEditing(true)
      return
    }
    onModelChange(v)
    // A régua de esforço é POR modelo desde a ADR-177, e as réguas divergem
    // dentro do MESMO motor (o gpt-6-astra aceita `ultra`, o gpt-5.5 para em
    // `xhigh`). Sem isto, trocar de modelo deixava um esforço escolhido que o
    // novo não aceita: a régua abria sem nenhum degrau aceso e o envio ia
    // falhar no backend. Volta pra sentinela, que todo modelo aceita.
    if (!effortFitsModel(agentEfforts(effectiveDest, v), effectiveEffort))
      onEffortChange(SENTINELA)
  }
  function confirmCustom() {
    const v = customDraft.trim()
    const problema = v ? problemaNoSlug(v) : null
    if (problema) toast.error(problema)
    else if (v) onModelChange(v)
    setCustomEditing(false)
  }

  return (
    <div className="w-[460px] max-w-[calc(100vw-2rem)]">
      {/* key={effectiveDest}: remonta o Command inteiro (busca + lista) ao
          trocar de agent — zera filtro e scroll de graça, e devolve o foco pro
          CommandInput (autoFocus do mount novo). A régua de esforço fica FORA
          do Command de propósito: não depende de cmdk, não precisa remontar. */}
      <Command
        key={effectiveDest}
        label="Buscar modelo"
        shouldFilter
        loop
        className="flex max-h-[320px] min-h-[220px] flex-col"
      >
        {customEditing ? (
          <div className="flex h-9 items-center gap-2 border-b px-3">
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
              className="h-full flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60"
            />
          </div>
        ) : (
          <div title={modelTitle}>
            <CommandInput
              disabled={modelLocked}
              placeholder={`Buscar modelo do ${agentLogoLabel(effectiveDest)}…`}
            />
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <div
            role="group"
            aria-label="Agent"
            title={locked ? "Escolha outro motor para revezar no próximo envio" : undefined}
            className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-secondary/30 py-2"
          >
            {RAIL_AGENTS.map((d) => {
              const isActive = d.id === effectiveDest
              const isLimited = d.id in limited
              const hint = limited[d.id]
              // "ausente" só quando o probe EXISTE e diz que não achou; sem
              // detecção o motor aparece normal (§5 camada 3). E a marca é
              // opacidade, não cor: pelo §2, "não instalado" é informação, e
              // o vocabulário de cor fica reservado pro que exige decisão.
              const ausente = estadoNaMaquina(d.id, detectados) === "ausente"
              return (
                <button
                  key={d.id}
                  type="button"
                  // SEM `disabled`, de propósito. O trilho é sempre clicável
                  // desde a ADR-165, e nem o motor ausente é desabilitado: o
                  // `title` é quem explica ("não encontrado nesta máquina"), e
                  // controle desabilitado não entrega tooltip de forma
                  // confiável. Quem barra o despacho é `dispatchBlockReason`, na
                  // hora do envio, com o motivo por extenso.
                  // (Havia aqui uma prop `disabled` que nenhum call site
                  // passava: atributo que nunca era verdade.)
                  aria-pressed={isActive}
                  aria-label={d.label}
                  title={[
                    d.label,
                    locked && !isActive
                      ? `Revezar para ${d.label} no próximo envio`
                      : isLimited
                        ? hint
                          ? `limite atingido, volta ${hint}`
                          : "limite de uso atingido"
                        : d.description,
                    ausente ? "não encontrado nesta máquina" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => selectAgent(d.id)}
                  className={cn(
                    "relative grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors",
                    isActive
                      ? SELECTED_FILL
                      : "hover:bg-sel-hover hover:text-foreground",
                  )}
                >
                  <AgentLogo
                    agent={d.id}
                    className={cn("size-4", ausente && !isActive && "opacity-40")}
                  />
                  {isLimited && (
                    <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-st-warning" />
                  )}
                </button>
              )
            })}
          </div>

          {customEditing ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground">
              Enter confirma · Esc cancela
            </div>
          ) : (
            <CommandList label="Modelo" className="flex-1">
              <CommandEmpty>Nenhum modelo bate com a busca</CommandEmpty>
              <CommandGroup>
                {modelOptions.map((o) => {
                  const isSelected = o.value === effectiveModel
                  return (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      keywords={[o.label, o.description ?? ""]}
                      disabled={modelLocked}
                      onSelect={selectModel}
                      className={cn("justify-between", isSelected && "bg-sel")}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] text-foreground">{o.label}</span>
                        {o.description && (
                          <span className="text-[11px] leading-snug text-muted-foreground">
                            {o.description}
                          </span>
                        )}
                      </div>
                      {isSelected && <Check className="size-3.5 shrink-0 text-brass" />}
                    </CommandItem>
                  )
                })}
                {supportsCustom && (
                  <CommandItem value={CUSTOM_MODEL} disabled={modelLocked} onSelect={selectModel}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] text-foreground">Modelo custom…</span>
                      <span className="text-[11px] text-muted-foreground">
                        Digitar o id exato do modelo
                      </span>
                    </div>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          )}
        </div>
      </Command>

      {!customEditing &&
        (efforts.length > 0 ? (
          <div
            role="radiogroup"
            aria-label="Esforço de raciocínio"
            title={effortTitle}
            className="flex flex-wrap items-center gap-1 border-t bg-secondary/30 p-2"
          >
            <span className="mr-1 font-mono text-[11px] tracking-wide text-muted-foreground/70 uppercase">
              esforço
            </span>
            {efforts.map((e) => {
              const active = e.value === effectiveEffort
              return (
                <button
                  key={e.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={e.label}
                  disabled={effortLocked}
                  onClick={() => onEffortChange(e.value)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[12px] transition-colors",
                    active
                      ? "bg-brass font-medium text-brass-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {e.label}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="border-t bg-secondary/30 p-2 text-[11px] text-muted-foreground italic">
            {agentLogoLabel(effectiveDest)} não tem esforço configurável
          </p>
        ))}
    </div>
  )
}
