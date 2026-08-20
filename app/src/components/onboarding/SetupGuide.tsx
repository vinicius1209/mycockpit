// Guia de setup na sidebar (R2 fase 2). Uma linha discreta com anel de
// progresso: nada de badge colorido, porque isto não é status da frota, é
// lembrete de configuração.
//
// Regras (todas em setupItems.ts, testadas):
//   • aparece só enquanto `pronto && !completo && !dispensado`;
//   • some SOZINHA ao completar (dismissal é pra quem não quer os opcionais);
//   • cada item é marcado por PROBE do estado real, com teto de tempo:
//     leitura travada mantém o guia visível em vez de escondê-lo pra sempre;
//   • clicar mostra a LISTA inteira (cada item já é a explicação — "o que
//     desbloqueia", não o nome da feature); escolher um item navega até ele.
//     Antes o clique pulava direto pro primeiro incompleto, sem checklist
//     nenhuma — "4/5" sem UMA tela que dissesse qual item era o 5º.

import { useCallback, useEffect, useState } from "react"
import { Check, Circle } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { addProjectViaDialog } from "@/lib/projects"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import {
  guideView,
  ringDash,
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

  // Toda a decisão de exibição é pura e testada (guideView). Não há cache de
  // "última contagem visível" aqui de propósito: `refresh()` troca os probes
  // só depois do await, então a contagem antiga já fica na tela durante a
  // releitura sem ajuda nenhuma. O cache não protegia de tremida e ainda
  // segurava a linha na tela quando o guia completava.
  const view = guideView({ probes, caps, ready, dismissed, onboarded })
  if (!view) return null

  function openItem(item: GuideItem) {
    if (item.target.kind === "add-project") {
      void addProjectViaDialog()
      return
    }
    setSettingsOpen(true, item.target.section)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="O que falta configurar"
          className={cn(
            "flex h-[34px] w-full shrink-0 items-center gap-2.5 border-t px-3 text-left",
            "transition-colors hover:bg-accent",
          )}
        >
          <ProgressRing done={view.done} total={view.total} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            Configuração
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
            {view.done}/{view.total}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        // O trigger é w-full (a largura inteira da sidebar); alinhar por
        // "center" devolvia o cálculo do Radix colado na borda mesmo assim
        // (a colisão contra a lateral vencia a centralização). `alignOffset`
        // + `collisionPadding` são determinísticos: SEMPRE essa folga da
        // borda, sem depender da largura do trigger nem da colisão.
        alignOffset={12}
        collisionPadding={12}
        sideOffset={8}
        className="w-64"
        // Radix devolve o foco pro trigger ao fechar (padrão de acessibilidade
        // dele) — o outline nativo do browser nesse botão w-full h-[34px] lia
        // como uma barra azul cortando a linha inteira. Mesma supressão já
        // usada em UsagePill/ContextMenuContent da sidebar: sem isso, TODO
        // menu fechado nesta lateral deixaria o mesmo rastro.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Sem cabeçalho: o gatilho logo abaixo já diz "Configuração 4/5" —
            repetir o rótulo dentro do popover era eco, não orientação. */}
        {view.items.map((item) => {
          const done = item.state === "done"
          return (
            <DropdownMenuItem
              key={item.id}
              disabled={done}
              onSelect={() => openItem(item)}
              className={cn(
                "flex items-start gap-2 whitespace-normal",
                done && "opacity-60",
              )}
            >
              {done ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <span className={cn("text-[12px]", done && "line-through")}>
                {item.label}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => setSettings({ setupGuideDismissed: true })}
        >
          Esconder da barra lateral
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
