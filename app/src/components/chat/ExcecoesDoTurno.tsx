// As exceções do turno acima do composer (ADR-239): o que do manifesto pede a
// atenção da pessoa, uma frase por exceção, com o gesto quando há um. Sem
// exceção não aparece nada. A regra é pura (`lib/excecoesDoTurno`); o
// inventário completo mora na aba "O que o agente vê".

import { AlertTriangle, Info } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { agentLabel } from "@/lib/agent"
import { PENDING_DECISION } from "@/lib/attention"
import { startProjectBrowser } from "@/lib/browser"
import { excecoesDoTurno, type ExcecaoDoTurno } from "@/lib/excecoesDoTurno"
import type { EffectiveRunManifest } from "@/lib/tooling"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

export function ListaDeExcecoes({
  excecoes,
  onAcao,
}: {
  excecoes: ExcecaoDoTurno[]
  onAcao: (e: ExcecaoDoTurno) => void
}) {
  if (excecoes.length === 0) return null
  const atencao = excecoes.some((e) => e.tom === "atencao")
  return (
    <div className="mx-auto mb-1.5 max-w-[760px] px-8">
      <ul className={cn("rounded-lg border px-3 py-1.5", atencao ? PENDING_DECISION : "bg-card/40")}>
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

export function ExcecoesDoTurno({ manifest, agent }: { manifest?: EffectiveRunManifest; agent: string }) {
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path ?? null)
  const excecoes = excecoesDoTurno(manifest, agentLabel(agent))
  function agir(e: ExcecaoDoTurno) {
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
  return <ListaDeExcecoes excecoes={excecoes} onAcao={agir} />
}
