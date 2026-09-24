// As exceções do turno (ADR-239): o que do manifesto pede a atenção da pessoa,
// uma frase por exceção, com o gesto quando há um. Desde a ADR-247 moram na
// gaveta "avisos" da base do composer. Sem exceção não aparece nada. A regra é pura (`lib/excecoesDoTurno`); o
// inventário completo mora na aba "O que o agente vê".

import { AlertTriangle, Info } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PENDING_DECISION } from "@/lib/attention"
import { startProjectBrowser } from "@/lib/browser"
import type { ExcecaoDoTurno } from "@/lib/excecoesDoTurno"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

export function ListaDeExcecoes({
  excecoes,
  onAcao,
  embutida = false,
}: {
  excecoes: ExcecaoDoTurno[]
  onAcao: (e: ExcecaoDoTurno) => void
  /** Dentro da gaveta da base do composer (ADR-247): sem moldura própria. */
  embutida?: boolean
}) {
  if (excecoes.length === 0) return null
  const atencao = excecoes.some((e) => e.tom === "atencao")
  return (
    <div className={embutida ? undefined : "mx-auto mb-1.5 max-w-[760px] px-8"}>
      <ul className={cn("px-3 py-1.5", !embutida && "rounded-lg border", !embutida && (atencao ? PENDING_DECISION : "bg-card/40"))}>
        {excecoes.map((e) => (
          <li key={e.id} className="flex items-start gap-2.5 py-1">
            {/* trilho de 18px: o ícone centra na primeira linha do texto */}
            <span className="flex h-[18px] shrink-0 items-center">
              {e.tom === "atencao" ? (
                <AlertTriangle className="size-3.5 text-st-warning" aria-hidden />
              ) : (
                <Info className="size-3.5 text-muted-foreground" aria-hidden />
              )}
            </span>
            <p className="min-w-0 flex-1 text-[12px] leading-[18px] text-foreground/90">
              {e.texto}
              {e.detalhe && <span className="text-muted-foreground"> {e.detalhe}</span>}
            </p>
            {e.acao && (
              <Button size="chip" variant="secondary" className="shrink-0" onClick={() => onAcao(e)}>
                {e.acao.rotulo}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** O gesto de uma exceção: Configurações na seção certa, ou ligar o navegador
 *  do projeto. Uma cópia só, usada pela gaveta da base do composer. */
export function agirNaExcecao(e: ExcecaoDoTurno, projectPath: string | null): void {
  if (!e.acao) return
  if (e.acao.tipo === "configuracoes") {
    useApp.getState().setSettingsOpen(true, e.acao.secao)
    return
  }
  if (!projectPath) return
  void startProjectBrowser(projectPath)
    .then(() => toast.success("Navegador do projeto ligado. Ele entra no próximo turno."))
    .catch((erro) => toast.error(erro instanceof Error ? erro.message : String(erro)))
}
