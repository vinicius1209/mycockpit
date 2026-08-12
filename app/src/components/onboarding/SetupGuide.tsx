// Guia de setup na sidebar (R2 fase 2). Uma linha discreta com anel de
// progresso: nada de badge colorido, porque isto não é status da frota, é
// lembrete de configuração.
//
// Regras (todas em setupItems.ts, testadas):
//   • aparece só enquanto `pronto && !completo && !dispensado`;
//   • some SOZINHA ao completar (dismissal é pra quem não quer os opcionais);
//   • cada item é marcado por PROBE do estado real, com teto de tempo:
//     leitura travada mantém o guia visível em vez de escondê-lo pra sempre;
//   • clicar abre no primeiro item incompleto.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { addProjectViaDialog } from "@/lib/projects"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import {
  buildItems,
  firstIncomplete,
  guideProgress,
  isComplete,
  ringDash,
  shouldShowGuide,
  type GuideItem,
  type ProbeMap,
} from "./setupItems"
import { capabilitiesOf, runProbes } from "./setupProbes"

const R = 6
const CIRC = 2 * Math.PI * R

function ProgressRing({ done, total }: { done: number; total: number }) {
  // Progresso de configuração não é medidor de quota: alto é BOM, então os
  // limiares âmbar/vermelho do §2 não se aplicam. Fica cinza (o anel informa,
  // não alarma) e nunca brass, que é tinta de gesto.
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0 -rotate-90"
      aria-hidden
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r={R}
        fill="none"
        strokeWidth="2"
        className="stroke-border"
      />
      <circle
        cx="8"
        cy="8"
        r={R}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={ringDash(done, total, CIRC)}
        className="stroke-muted-foreground transition-[stroke-dashoffset] duration-[var(--dur)]"
      />
    </svg>
  )
}

export function SetupGuide() {
  const ready = useApp((s) => s.ready)
  const detected = useApp((s) => s.settings.detected)
  const usageMeterEnabled = useApp((s) => s.settings.usageMeterEnabled)
  const companionEnabled = useApp((s) => s.settings.companionEnabled)
  const dismissed = useApp((s) => s.settings.setupGuideDismissed)
  const onboarded = useApp((s) => s.settings.onboarded)
  const hasProject = useApp((s) => s.projects.length > 0)
  const setSettings = useApp((s) => s.setSettings)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  const [probes, setProbes] = useState<ProbeMap | null>(null)
  const caps = capabilitiesOf({ detected, usageMeterEnabled, companionEnabled })

  const refresh = useCallback(async () => {
    const result = await runProbes({ caps, detected, hasProject })
    setProbes(result)
    // caps é derivado de detected/flags, já nas deps: incluí-lo criaria objeto
    // novo a cada render e re-rodaria os probes em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, hasProject, usageMeterEnabled, companionEnabled])

  useEffect(() => {
    if (!ready) return
    void refresh()
  }, [ready, refresh])

  // Instalar hooks/statusline e parear celular acontece FORA desta tela (e às
  // vezes fora do app). Reler ao voltar pro app é o que faz o item marcar sem
  // precisar reiniciar.
  useEffect(() => {
    if (!ready) return
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [ready, refresh])

  const items = probes ? buildItems(caps, probes) : []
  const progress = guideProgress(items)

  // Anti-tremida: enquanto uma releitura não voltou, a linha continua com a
  // última contagem visível em vez de sumir e reaparecer.
  const lastVisible = useRef<{ items: GuideItem[]; done: number; total: number } | null>(
    null,
  )
  const settled = probes !== null
  const visible = shouldShowGuide({
    ready: ready && settled,
    complete: settled && isComplete(items),
    dismissed,
  })
  useEffect(() => {
    if (visible) lastVisible.current = { items, ...progress }
  })

  // Durante o onboarding o guia não existe: o wizard está fazendo esse
  // trabalho, e dois lugares cobrando setup ao mesmo tempo é ruído.
  if (!onboarded) return null
  const shown = visible ? { items, ...progress } : dismissed ? null : lastVisible.current
  if (!shown) return null

  const next = firstIncomplete(shown.items)

  function open() {
    if (!next) return
    if (next.target.kind === "add-project") {
      void addProjectViaDialog()
      return
    }
    setSettingsOpen(true, next.target.section)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={open}
          title={next ? next.label : undefined}
          className={cn(
            "flex h-[34px] w-full shrink-0 items-center gap-2.5 border-t px-3 text-left",
            "transition-colors hover:bg-accent",
          )}
        >
          <ProgressRing done={shown.done} total={shown.total} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            Configuração
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
            {shown.done}/{shown.total}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => setSettings({ setupGuideDismissed: true })}
        >
          Esconder da barra lateral
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
