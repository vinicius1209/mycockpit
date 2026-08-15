// Wizard de primeira instalação (docs/onboarding.md · R2 do roadmap). Overlay
// full-screen sobre o layout; o boot de projetos segue rodando por baixo.
//
// TESE: o onboarding INSTALA CAPACIDADES, não faz tour. Cada passo desbloqueia
// algo mecânico e diz o benefício na frase; passo que não instala nada NESTA
// máquina some do contador (nunca vira bolinha morta). Termina em AÇÃO
// (adicionar o primeiro projeto), não num "Concluir" decorativo.
//
// Toda decisão mora em ./flow.ts (puro, testado); aqui é só montagem e I/O.

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, FolderPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import appIcon from "@/assets/app-icon.png"
import { isTauri } from "@/lib/db"
import { addProjectViaDialog } from "@/lib/projects"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import { AgentStep } from "./AgentStep"
import { NotificationStep } from "./NotificationStep"
import { ThemeStep } from "./ThemeStep"
import {
  FLOW_VERSION,
  attemptClose,
  createCloseLatch,
  isEditableTarget,
  isLastStep,
  resolveStartIndex,
  shouldAdvance,
  stepCounter,
  themeAfterExit,
  visibleSteps,
  type StepId,
  type Theme,
} from "./flow"
import { readRecord, writeRecord } from "./persistence"

/** Diálogo de saída. O caminho de saída NUNCA é destrutivo (§7): "Continuar" é
 *  o botão default (primário, com foco), "Pular" é ghost. Escape aqui dentro
 *  volta pro wizard, jamais fecha os dois de uma vez. */
function SkipConfirm({
  onKeepGoing,
  onSkip,
}: {
  onKeepGoing: () => void
  onSkip: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/80 backdrop-blur-[2px]"
    >
      <div className="w-[340px] max-w-[90%] rounded-xl border bg-card p-4 shadow-[var(--shadow-pop)]">
        <h3 className="text-[13px] font-medium text-foreground">
          Sair da configuração?
        </h3>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          O que você já escolheu fica salvo. Dá pra retomar em Configurações ▸
          Sobre.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Pular
          </Button>
          <Button ref={ref} size="sm" onClick={onKeepGoing}>
            Continuar
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Bolinhas do progresso: uma por passo VISÍVEL. Passo condicional que sumiu
 *  não deixa bolinha morta pra trás. */
function StepDots({ total, index }: { total: number; index: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 rounded-full transition-all",
            // "Onde eu estou" é largura + peso, não tinta (§2).
            i === index ? "w-4 bg-foreground" : "w-1 bg-border",
          )}
        />
      ))}
    </div>
  )
}

export function OnboardingWizard() {
  const setSettings = useApp((s) => s.setSettings)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const hasProjects = useApp((s) => s.projects.length > 0)

  // A sequência é resolvida UMA vez: condição síncrona, contador que não muda
  // no meio do caminho ("1 de 3" que vira "1 de 2" é a mesma mentira que a
  // bolinha morta). Passo assíncrono alimenta o CONTEÚDO, nunca a sequência.
  const [steps] = useState<StepId[]>(() =>
    visibleSteps({ canNotify: isTauri() }),
  )
  const [index, setIndex] = useState(() =>
    resolveStartIndex(readRecord(), steps.length),
  )
  const [confirming, setConfirming] = useState(false)

  const latch = useRef(createCloseLatch())
  // tema com que o usuário ENTROU no passo de tema (o que o skip devolve).
  const themeEntry = useRef<Theme | null>(null)
  const current = steps[index]

  useEffect(() => {
    if (current === "theme") {
      if (themeEntry.current === null) themeEntry.current = theme
    } else {
      themeEntry.current = null
    }
    // `theme` de propósito FORA das deps: a captura é da ENTRADA no passo; se
    // reagisse à troca, o preview reescreveria o valor a reverter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  function applyTheme(target: Theme) {
    if (theme !== target) toggleTheme()
  }

  /** Guarda o progresso de retomada. Best-effort de propósito: ninguém espera
   *  resultado aqui (é conveniência de retomada), e a MESMA falha reaparece no
   *  fechamento, onde ela é tratada e dita ao usuário. */
  function markCompleted(stepIndex: number) {
    writeRecord({ flowVersion: FLOW_VERSION, lastCompletedStep: stepIndex })
  }

  /** Fechamento único. `finish` = terminou os passos; `skip` = saiu antes.
   *  O latch garante um fechamento só (clique duplo, Cmd+Enter junto do clique)
   *  e destrava quando a gravação falha, senão o usuário fica preso num wizard
   *  que não fecha. */
  function close(mode: "finish" | "skip") {
    const lastCompleted = mode === "finish" ? steps.length - 1 : index - 1
    const outcome = attemptClose(latch.current, () =>
      writeRecord({
        flowVersion: FLOW_VERSION,
        lastCompletedStep: lastCompleted,
      }),
    )
    if (outcome === "already") return
    if (outcome === "retry") {
      toast.error("Não consegui salvar o progresso da configuração.", {
        description: "Nada foi perdido. Tente de novo.",
      })
      return
    }

    // regra do tema: quem pula o passo de tema não escolheu nada.
    if (mode === "skip" && current === "theme" && themeEntry.current) {
      applyTheme(themeAfterExit("skip", themeEntry.current, theme))
    }

    setSettings({ onboarded: true })
    // termina em AÇÃO: sem nenhum projeto, o passo seguinte natural é escolher
    // a pasta. Com projeto já cadastrado, abrir o seletor seria atropelo.
    if (!hasProjects) void addProjectViaDialog()
  }

  function goNext() {
    if (isLastStep(steps, index)) {
      close("finish")
      return
    }
    markCompleted(index)
    setIndex((i) => i + 1)
  }

  function goBack() {
    setIndex((i) => Math.max(0, i - 1))
  }

  // Cmd/Ctrl+Enter avança. Captura pra vencer handler de filho; guarda de campo
  // editável ANTES de olhar a tecla (quem digita é dono do próprio Enter).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        setConfirming((open) => !open)
        return
      }
      if (confirming) return
      if (
        !shouldAdvance({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          editableTarget: isEditableTarget(e.target),
        })
      )
        return
      e.preventDefault()
      goNext()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  const { position, total } = stepCounter(steps, index)
  const last = isLastStep(steps, index)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        // clique FORA do cartão pede confirmação; dentro (inclusive no diálogo
        // de saída, que é filho) não faz nada.
        if (confirming) return
        const el = e.target as HTMLElement
        if (el.closest("[data-onboarding-modal]")) return
        setConfirming(true)
      }}
    >
      <div
        data-onboarding-modal
        className="relative flex w-[560px] max-w-full flex-col rounded-2xl border bg-card p-6 shadow-[var(--shadow-pop)]"
      >
        <header className="mb-5 flex items-center gap-3">
          <img
            src={appIcon}
            alt=""
            className="size-8 rounded-lg"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground">Frota</div>
            <div className="text-[11px] text-muted-foreground">
              Configuração inicial · {position} de {total}
            </div>
          </div>
          <StepDots total={total} index={index} />
        </header>

        {current === "agents" && <AgentStep />}
        {current === "theme" && <ThemeStep />}
        {current === "notifications" && <NotificationStep />}

        <footer className="mt-6 flex items-center justify-between gap-2">
          <div>
            {index > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                className="gap-1.5 text-muted-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Voltar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!last && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => close("skip")}
                className="text-muted-foreground"
              >
                Pular para o projeto
              </Button>
            )}
            <Button size="sm" onClick={goNext} className="gap-1.5">
              {last ? (
                <>
                  <FolderPlus className="size-3.5" />
                  {hasProjects
                    ? "Voltar ao cockpit"
                    : "Adicionar seu primeiro projeto"}
                </>
              ) : (
                <>
                  Continuar
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          </div>
        </footer>

        {confirming && (
          <SkipConfirm
            onKeepGoing={() => setConfirming(false)}
            onSkip={() => {
              setConfirming(false)
              close("skip")
            }}
          />
        )}
      </div>
    </div>
  )
}
