// Tour narrativo (pré-wizard). Mesmo chrome do wizard funcional (overlay
// full-screen, cartão 560px), conteúdo diferente: aqui não se instala
// capacidade nenhuma, é a fábula de 4 atos que introduz o que o Frota é
// ANTES do wizard perguntar o que configurar. `IntroTour` e
// `OnboardingWizard` são contadores INDEPENDENTES de propósito (ver nota em
// OnboardingGate.tsx) — este não é "passo 0 de N" do outro.
//
// Cada ilustração de ato reusa classe/copy REAL do resto do app (nunca uma
// screenshot congelada, que ficaria desatualizada e mentirosa assim que a UI
// real mudasse — STYLEGUIDE §1.3, "nada de atividade inventada").

import { useState } from "react"
import { ArrowRight, ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import appIcon from "@/assets/app-icon.png"
import { cn } from "@/lib/utils"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import { PERMISSION_LABEL, PERMISSION_DESCRIPTION } from "@/lib/permission"
import type { PermissionMode } from "@/lib/types"
import { StepDots } from "./StepDots"

function EnginesVisual() {
  const engines = ["Claude Code", "Codex", "Antigravity"]
  return (
    <div className="flex flex-col gap-2">
      <div role="list" className="flex flex-col gap-1.5">
        {engines.map((label, i) => (
          <div
            key={label}
            role="listitem"
            className={cn(
              "rounded-lg border px-3 py-2 text-[13px]",
              i === 0 ? SELECTED_FILL : UNSELECTED,
            )}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        <ArrowRightLeft className="size-3.5 shrink-0" />
        Continuar no Codex
      </div>
    </div>
  )
}

function PermissionVisual() {
  const modes: PermissionMode[] = ["leitura", "padrao", "liberado"]
  return (
    <div role="list" className="flex flex-col gap-1.5">
      {modes.map((m) => (
        <div
          key={m}
          role="listitem"
          className={cn(
            "rounded-lg border px-3 py-2",
            m === "padrao" ? SELECTED_FILL : UNSELECTED,
          )}
        >
          <div className="text-[13px] font-medium">{PERMISSION_LABEL[m]}</div>
          <div className="text-[11px] text-muted-foreground">
            {PERMISSION_DESCRIPTION[m]}
          </div>
        </div>
      ))}
    </div>
  )
}

function MissionVisual() {
  const phases: Array<{ label: string; state: "done" | "run" | "pending" }> = [
    { label: "Planejar", state: "done" },
    { label: "Executar", state: "run" },
    { label: "Revisar", state: "pending" },
  ]
  return (
    <div className="flex flex-col gap-2">
      {phases.map((p) => (
        <div key={p.label} className="flex items-center gap-2.5">
          <span
            className={cn(
              "size-3.5 shrink-0 rounded-full border-2 bg-card",
              // "done" é cinza, não verde: aqui é ilustração de tour, não um
              // marco real acontecendo (§2, "verde é marco raro ou probe
              // real" — StatusDot.tsx já mapeia "success" pro mesmo cinza
              // de "idle" pelo mesmo motivo).
              p.state === "done" && "border-st-idle bg-st-idle",
              p.state === "run" &&
                "border-st-running bg-st-running shadow-[0_0_0_4px_color-mix(in_srgb,var(--st-running)_20%,transparent)]",
              p.state === "pending" && "border-border-strong",
            )}
          />
          <span
            className={cn(
              "text-[13px]",
              p.state === "pending" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {p.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function SpecialistsVisual() {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5 text-[13px] leading-snug text-foreground">
      Revisa a proposta com{" "}
      <span className="rounded bg-brass/[0.14] px-1 font-medium text-brass">
        @Revisor de Segurança
      </span>{" "}
      antes de aprovar.
    </div>
  )
}

interface Act {
  id: "engines" | "permission" | "mission" | "specialists"
  headline: string
  subline: string
  Visual: () => React.ReactElement
}

const ACTS: Act[] = [
  {
    id: "engines",
    headline: "Um cockpit, três motores",
    subline:
      "Claude Code, Codex e Antigravity dividem o mesmo fio de conversa. Numa trava de limite, trocar de motor leva o contexto junto, sem repetir o que já foi dito.",
    Visual: EnginesVisual,
  },
  {
    id: "permission",
    headline: "Você decide, o agente executa",
    subline:
      "Cada projeto roda num dos três modos de permissão: o quanto o agente faz sem te perguntar primeiro.",
    Visual: PermissionVisual,
  },
  {
    id: "mission",
    headline: "Missões com handoff e gate humano",
    subline:
      "Uma missão roda em fases, Planejar, Executar, Revisar, e só passa a fase adiante quando você aprova o resultado.",
    Visual: MissionVisual,
  },
  {
    id: "specialists",
    headline: "Especialistas opinam, você decide",
    subline:
      "Personas do projeto e globais, mencionadas com @ na conversa. Cada uma lê o contexto e opina; quem decide continua sendo você.",
    Visual: SpecialistsVisual,
  },
]

/** 4 atos, sem SkipConfirm: diferente do wizard, o tour não grava nada, então
 *  não há progresso a perder saindo no meio — "Pular introdução" é um botão
 *  fantasma direto. */
export function IntroTour({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0)
  const last = index === ACTS.length - 1
  const act = ACTS[index]

  function goNext() {
    if (last) {
      onDone()
      return
    }
    setIndex((i) => i + 1)
  }
  function goBack() {
    setIndex((i) => Math.max(0, i - 1))
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm">
      <div className="relative flex w-[560px] max-w-full flex-col rounded-2xl border bg-card p-6 shadow-[var(--shadow-pop)]">
        <header className="mb-5 flex items-center gap-3">
          <img src={appIcon} alt="" className="size-8 rounded-lg" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground">Frota</div>
            <div className="text-[11px] text-muted-foreground">
              Sobre o Frota · Ato {index + 1} de {ACTS.length}
            </div>
          </div>
          <StepDots total={ACTS.length} index={index} />
        </header>

        <div key={act.id} className="animate-cockpit-rise flex flex-col gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">
              {act.headline}
            </h2>
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
              {act.subline}
            </p>
          </div>
          <div className="border-t border-border/60 pt-3">
            <act.Visual />
          </div>
        </div>

        <footer className="mt-6 flex items-center justify-between gap-2">
          <div>
            {index > 0 && (
              <Button
                variant="ghost"
                size="padrao"
                onClick={goBack}
                className="text-muted-foreground"
              >
                Voltar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!last && (
              <Button
                variant="ghost"
                size="padrao"
                onClick={onDone}
                className="text-muted-foreground"
              >
                Pular introdução
              </Button>
            )}
            <Button size="padrao" onClick={goNext} className="gap-1.5">
              {last ? "Ir para a configuração" : "Continuar"}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
