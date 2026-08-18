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
import { problemaNoSlug } from "@/lib/modelSlug"
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
  onEffortChange,
}: {
  effectiveDest: string
  locked: boolean
  onDestChange: (v: string) => void
  effectiveModel: string
  modelLocked: boolean
  onModelChange: (v: string) => void
  effectiveEffort: string
  onEffortChange: (v: string) => void
}) {
  const limited = useApp((s) => s.limitedAgents)
  const [customEditing, setCustomEditing] = useState(false)
  const [customDraft, setCustomDraft] = useState("")

  const lockTitle = locked
    ? "Agent e modelo ficam fixos a partir do 1º envio desta conversa"
    : undefined
  const modelTitle = modelLocked
    ? lockTitle
    : locked
      ? "O turno anterior falhou, então dá para trocar o modelo e enviar de novo"
      : undefined

  const baseModels = agentModels(effectiveDest)
  const supportsCustom = CUSTOM_MODEL_AGENTS.has(effectiveDest)
  const isCustomValue =
    effectiveModel !== "default" && !baseModels.some((o) => o.value === effectiveModel)
  const modelOptions = isCustomValue
    ? [...baseModels, { value: effectiveModel, label: effectiveModel, description: "Modelo custom" }]
    : baseModels
  const efforts = agentEfforts(effectiveDest)

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
          <div title={modelLocked ? modelTitle : undefined}>
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
            title={locked ? lockTitle : undefined}
            className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-secondary/30 py-2"
          >
            {RAIL_AGENTS.map((d) => {
              const isActive = d.id === effectiveDest
              const isLimited = d.id in limited
              const hint = limited[d.id]
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={locked}
                  aria-pressed={isActive}
                  aria-label={d.label}
                  title={[
                    d.label,
                    isLimited
                      ? hint
                        ? `limite atingido, volta ${hint}`
                        : "limite de uso atingido"
                      : d.description,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => selectAgent(d.id)}
                  className={cn(
                    "relative grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors",
                    isActive
                      ? "bg-brass/10 text-brass"
                      : "hover:bg-accent hover:text-foreground",
                  )}
                >
                  <AgentLogo agent={d.id} className="size-4" />
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
            title={locked ? lockTitle : undefined}
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
                  disabled={locked}
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
