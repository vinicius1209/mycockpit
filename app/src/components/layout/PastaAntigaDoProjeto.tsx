// O projeto ainda usa a pasta do nome antigo (ADR-236). A Frota lê as duas,
// então nada quebra; aqui a pessoa leva a pasta para `.frota/` com um gesto.
// Não roda com agente trabalhando no projeto: renomear por baixo de um turno
// vivo quebraria caminhos no meio do trabalho.

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { Button } from "@/components/ui/button"
import { migrarPastaDoProjeto } from "@/lib/configDoProjeto"
import { recarregarConfigDoProjeto } from "@/hooks/useProjectConfig"
import type { Project } from "@/lib/types"
import { useChat } from "@/store/chat"

/** O aviso do resultado, em pt-BR. Puro, para teste. */
export function avisoDaMigracao(r: { movidos: string[]; conflitos: string[] }): string {
  if (r.conflitos.length === 0) return "Pasta do projeto movida para .frota."
  return `Movido para .frota, menos ${r.conflitos.join(", ")}: já existia nas duas pastas e ficou na antiga para você decidir.`
}

export function PastaAntigaDoProjeto({
  project,
  pasta,
  onMigrou,
}: {
  project: Project
  pasta: string
  onMigrou: () => void
}) {
  const [movendo, setMovendo] = useState(false)
  const rodando = useChat((s) =>
    Object.values(s.byId).some((c) => c.projectId === project.id && (c.running || c.finalizing)),
  )

  async function mover() {
    setMovendo(true)
    try {
      const r = await migrarPastaDoProjeto(project.path)
      await recarregarConfigDoProjeto(project)
      onMigrou()
      if (r.conflitos.length > 0) avisar.nota(avisoDaMigracao(r))
      else avisar.feito(avisoDaMigracao(r))
    } catch (erro) {
      avisar.erro("Não consegui mover a pasta antiga do projeto.", { detalhe: mensagemDe(erro) })
    } finally {
      setMovendo(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-secondary/40 px-2.5 py-2">
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
        Este projeto ainda usa a pasta antiga (<span className="font-mono">{pasta}</span>).
        {rodando && " Espere o agente terminar para mover."}
      </p>
      <Button size="chip" variant="secondary" disabled={movendo || rodando} onClick={() => void mover()}>
        {movendo && <Loader2 className="animate-spin" />}
        Mover para .frota
      </Button>
    </div>
  )
}
