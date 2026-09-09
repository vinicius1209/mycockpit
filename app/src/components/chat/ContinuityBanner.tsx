// UMA porta de continuidade acima do composer.
//
// O turno interrompido e a cota preventiva têm consequências diferentes, mas
// pedem a mesma decisão: escolher um agente elegível. A superfície permanece a
// mesma; o verbo do CTA é que diz se o gesto ENVIA agora ou só prepara o
// próximo envio. O transcript registra o incidente, sem repetir a decisão.

import { useState } from "react"
import { ArrowRightLeft, ChevronRight, RefreshCcw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import type { RevezamentoOpcao } from "@/lib/quotaExhausted"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import { cn } from "@/lib/utils"

export type ContinuityMode = "continue-now" | "next-send"

type ContinuityChoiceProps = {
  state: "choose"
  mode: ContinuityMode
  sourceLabel: string
  resetHint: string | null
  alternatives: RevezamentoOpcao[]
  scheduledResume?: {
    detail: string
    onCancel: () => void
  }
  onSelect: (agent: string) => void
}

type ContinuityStagedProps = {
  state: "staged"
  sourceLabel: string
  targetLabel: string
  busy?: boolean
  onUndo: () => void
}

export type ContinuityBannerProps =
  | ContinuityChoiceProps
  | ContinuityStagedProps

function quotaDetail(resetHint: string | null): string {
  const hint = resetHint?.trim()
  if (!hint) return "O horário de retorno ainda não foi informado."
  if (hint === "100%") return "A leitura mais recente chegou a 100%."
  if (/^(reseta|volta)\b/i.test(hint)) {
    return `${hint.charAt(0).toUpperCase()}${hint.slice(1)}.`
  }
  return `Volta ${hint}.`
}

function HandoffContents({ mode }: { mode: ContinuityMode }) {
  return (
    <details className="group/details relative">
      <summary
        className={cn(
          controle("compacto"),
          "w-max cursor-pointer list-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
        O que vai junto
      </summary>
      <div className="absolute bottom-full left-0 z-[120] mb-1.5 w-72 rounded-md border border-border-strong bg-popover px-3 py-2.5 shadow-[var(--shadow-pop)]">
        <p className="text-[12px] font-medium text-foreground">
          Ao continuar, o Frota leva
        </p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <li>{mode === "continue-now" ? "O pedido pendente integral" : "O pedido do próximo envio"}</li>
          <li>Histórico recente e decisões</li>
          <li>Branch e arquivos alterados</li>
          <li>Regras ativas do projeto</li>
        </ul>
      </div>
    </details>
  )
}

function ContinuityChoice({
  mode,
  sourceLabel,
  resetHint,
  alternatives,
  scheduledResume,
  onSelect,
}: Omit<ContinuityChoiceProps, "state">) {
  const [selectedId, setSelectedId] = useState(alternatives[0]?.id ?? "")
  const [dismissed, setDismissed] = useState(false)
  const selected =
    alternatives.find((alternative) => alternative.id === selectedId) ??
    alternatives[0]

  if (dismissed) return null

  const immediate = mode === "continue-now"
  const hasAlternatives = alternatives.length > 0

  return (
    <section
      data-continuity-state="choose"
      data-continuity-mode={mode}
      className="mb-2 rounded-lg border border-border-strong bg-card shadow-[var(--shadow-sm)]"
    >
      <div className="flex flex-wrap items-start gap-2.5 px-3 py-2.5">
        <RefreshCcw className="mt-0.5 size-4 shrink-0 text-st-warning" />
        <div className="min-w-[210px] flex-1">
          <p className="text-[13px] font-medium text-foreground">
            {immediate
              ? `${sourceLabel} parou antes de terminar`
              : `${sourceLabel} sem cota para o próximo turno`}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {immediate
              ? hasAlternatives
                ? "Escolha quem retoma agora o pedido que ficou pendente."
                : "Nenhum outro agente disponível foi confirmado nesta máquina."
              : hasAlternatives
                ? `Este turno terminou normalmente. ${quotaDetail(resetHint)} Escolha quem receberá o próximo pedido, sem enviar nada agora.`
                : `Este turno terminou normalmente. ${quotaDetail(resetHint)} Nenhum outro agente disponível foi confirmado nesta máquina.`}
          </p>
          {immediate && scheduledResume && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{scheduledResume.detail}</span>
              <Button
                type="button"
                size="icone-compacto"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                title="Cancelar retomada automática"
                aria-label="Cancelar retomada automática"
                onClick={scheduledResume.onCancel}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        {hasAlternatives && (
          <div
            role="group"
            aria-label="Escolher agente de destino"
            className="flex shrink-0 flex-wrap gap-0.5 rounded-md border bg-background p-0.5"
          >
            {alternatives.map((alternative) => {
              const chosen = alternative.id === selected?.id
              return (
                <Button
                  key={alternative.id}
                  type="button"
                  size="compacto"
                  variant="ghost"
                  aria-pressed={chosen}
                  className={cn(chosen ? SELECTED_FILL : UNSELECTED)}
                  onClick={() => setSelectedId(alternative.id)}
                >
                  {alternative.label}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 bg-background px-2 py-1.5 pl-10">
          <HandoffContents mode={mode} />
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="compacto"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setDismissed(true)}
            >
              {immediate
                ? scheduledResume
                  ? `Aguardar ${sourceLabel}`
                  : "Agora não"
                : `Manter ${sourceLabel}`}
            </Button>
            <Button
              type="button"
              size="compacto"
              onClick={() => onSelect(selected.id)}
            >
              {immediate
                ? `Continuar agora no ${selected.label}`
                : `Usar ${selected.label} no próximo envio`}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function ContinuityStaged({
  sourceLabel,
  targetLabel,
  busy = false,
  onUndo,
}: Omit<ContinuityStagedProps, "state">) {
  return (
    <section
      data-continuity-state="staged"
      className="mb-2 flex items-center gap-2.5 rounded-lg border border-border-strong bg-card px-3 py-2 shadow-[var(--shadow-sm)]"
    >
      <ArrowRightLeft className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">
          Próximo envio: {targetLabel}
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {sourceLabel} permanece nesta conversa até {targetLabel} abrir a nova sessão.
        </p>
      </div>
      <Button
        type="button"
        size="compacto"
        variant="ghost"
        disabled={busy}
        onClick={onUndo}
      >
        Desfazer
      </Button>
    </section>
  )
}

export function ContinuityBanner(props: ContinuityBannerProps) {
  if (props.state === "staged") {
    return (
      <ContinuityStaged
        sourceLabel={props.sourceLabel}
        targetLabel={props.targetLabel}
        busy={props.busy}
        onUndo={props.onUndo}
      />
    )
  }

  return (
    <ContinuityChoice
      mode={props.mode}
      sourceLabel={props.sourceLabel}
      resetHint={props.resetHint}
      alternatives={props.alternatives}
      scheduledResume={props.scheduledResume}
      onSelect={props.onSelect}
    />
  )
}
