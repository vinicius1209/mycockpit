// O DESPACHO do composer: o primário e as variantes penduradas nele.
//
// Extraído do `ComposerParts.tsx` quando a catraca de tamanho disparou (a regra
// da casa é DIVIDIR, nunca subir o teto). O recorte é o natural: este arquivo
// responde por UMA pergunta — "o que acontece quando a pessoa despacha?" — e é o
// único lugar que conhece os três destinos (enviar, disputa, missão) e os
// estados do turno (preparo, rodando, finalizando).

import { ArrowUp, ChevronDown, ListEnd, Rocket, Square, Swords, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
export function SendSplit({
  running,
  finalizing,
  preparing,
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
  finalizing?: boolean
  /** O turno está sendo MONTADO (persona, doutrina, plano de MCP) e ainda não
   *  nasceu. Ver ADR-169: sem este sinal a espera do preflight lia como
   *  travamento, porque o único feedback era o primário ficar cinza. */
  preparing?: boolean
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
  // Abaixo de 560px de rodapé (medido: rótulos inteiros pedem ~320px ao lado da
  // identidade), Interromper e Enfileirar ficam só com o ícone; nome e atalho
  // seguem no `title` e no `aria-label`.
  if (running || finalizing) {
    return (
      <div className="flex items-center gap-1.5">
        {running && canEnqueue && onForceSendDraft && (
          <Button
            variant="secondary"
            size="compacto"
            onClick={onForceSendDraft}
            className="rounded-full"
            title="Interromper o turno e enviar esta mensagem (Enter)"
            aria-label="Interromper e enviar"
          >
            <Zap className="size-3 fill-current" />
            <span className="hidden @min-[560px]/composer:inline">Interromper e enviar</span>
            <span className="hidden font-mono text-[11px] text-muted-foreground @min-[560px]/composer:inline">↵</span>
          </Button>
        )}
        {canEnqueue && (
          <Button
            variant="ghost"
            size="compacto"
            onClick={onSubmit}
            className="rounded-full bg-st-queued/15 text-st-queued hover:bg-st-queued/25 hover:text-st-queued"
            title="Enfileirar para o próximo turno (Tab)"
            aria-label="Enfileirar"
          >
            <ListEnd className="size-3.5 @min-[560px]/composer:hidden" />
            <span className="hidden @min-[560px]/composer:inline">Enfileirar</span>
            <span className="hidden font-mono text-[11px] opacity-75 @min-[560px]/composer:inline">Tab</span>
          </Button>
        )}
        {running && (
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
        )}
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
      {/* O primário: idêntico ao que sempre foi (mesma Button/size/raio). No
          PREPARO ele troca a seta pelo círculo e diz o que está acontecendo —
          mesma geometria, então a fileira não dança. O `aria-label` muda junto,
          porque um botão que anuncia "Enviar" enquanto já está enviando mente
          pra quem não vê a tela. */}
      <Button
        size="icone-padrao"
        onClick={onSubmit}
        disabled={!canSend}
        className="rounded-full"
        aria-label={preparing ? "Preparando o envio" : "Enviar"}
        title={preparing ? "Preparando o envio…" : "Enviar (⏎)"}
        aria-busy={preparing || undefined}
      >
        {preparing ? (
          <span className="preparo-spin" aria-hidden />
        ) : (
          <ArrowUp className="size-4" />
        )}
      </Button>
    </>
  )
}
