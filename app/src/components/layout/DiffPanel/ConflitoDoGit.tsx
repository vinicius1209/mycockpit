// Rebase ou merge parado no meio: os arquivos em conflito, cada um abrindo no
// editor da Frota, e as três saídas à vista (docs/explorador-de-arquivos-prd.md,
// BD6). "Pedir ao agente" só escreve no composer; quem envia é você.

import { useState } from "react"
import { GitMerge, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { avisar, mensagemDe } from "@/lib/avisos"
import { confirm } from "@/lib/confirm"
import { comoErroDeGit, continuarOuAbortar, pedidoDeConflito, type EstadoDoRepo, type OperacaoEmCurso } from "@/lib/gitSync"
import { avisarGravacao } from "@/lib/sinaisDoDisco"
import { useApp } from "@/store/app"

/** "rebase 2 de 3", "merge". Puro. */
export function rotuloDaOperacao(op: OperacaoEmCurso): string {
  return op.tipo === "rebase" && op.atual && op.total ? `rebase ${op.atual} de ${op.total}` : op.tipo
}

export function ConflitoDoGit({
  cwd,
  estado,
  onPedirAoAgente,
}: {
  cwd: string
  estado: EstadoDoRepo & { operacao: OperacaoEmCurso }
  onPedirAoAgente?: (texto: string) => void
}) {
  const [ocupado, setOcupado] = useState<"continuar" | "abortar" | null>(null)
  const { operacao, conflitos } = estado

  async function seguir(continuar: boolean) {
    if (!continuar) {
      const ok = await confirm({
        title: `Abortar o ${operacao.tipo}?`,
        description: "A branch volta a como estava antes de ele começar. O que você resolveu nos arquivos se perde.",
        confirmLabel: `Abortar o ${operacao.tipo}`,
        danger: true,
      })
      if (!ok) return
    }
    setOcupado(continuar ? "continuar" : "abortar")
    try {
      await continuarOuAbortar(cwd, continuar)
    } catch (e) {
      const erro = comoErroDeGit(e)
      // Continuar que para no próximo conflito não é falha: a lista se refaz.
      if (erro.tipo !== "conflito") avisar.erro(`Não consegui ${continuar ? "continuar" : "abortar"} o ${operacao.tipo}.`, { detalhe: mensagemDe(erro.detalhe) })
    } finally {
      setOcupado(null)
      avisarGravacao(cwd)
    }
  }

  return (
    <div className="shrink-0 border-b border-border/40">
      <div className="flex items-center gap-2 px-3 pt-2.5 text-[12px] font-medium text-foreground">
        <TriangleAlert className="size-3.5 shrink-0 text-st-warning" aria-hidden="true" />
        {conflitos.length > 0 ? "Em conflito" : `${rotuloDaOperacao(operacao)} parado`}
        {conflitos.length > 0 && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{conflitos.length}</span>}
        <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground">{rotuloDaOperacao(operacao)}</span>
      </div>
      {conflitos.length > 0 && (
        <ul className="mt-1.5">
          {conflitos.map((p) => {
            const barra = p.lastIndexOf("/")
            return (
              <li key={p} className="flex h-7 items-center gap-2 px-3 text-[12px]">
                <span className="w-3 shrink-0 text-center font-mono text-[11px] text-st-warning">!</span>
                <span className="truncate text-foreground">{p.slice(barra + 1)}</span>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">{p.slice(0, barra + 1)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="chip"
                  className="ml-auto"
                  onClick={() => useApp.getState().openFileTab(p)}
                >
                  Abrir
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="px-3 pt-2 text-[12px] text-muted-foreground">
        {conflitos.length > 0
          ? "Resolva nos arquivos e continue, ou peça ao agente."
          : `Os conflitos foram resolvidos. Continue o ${operacao.tipo} ou aborte.`}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-2.5">
        {conflitos.length > 0 && onPedirAoAgente && (
          <Button type="button" variant="outline" size="chip" onClick={() => onPedirAoAgente(pedidoDeConflito(operacao, conflitos))}>
            Pedir ao agente para resolver
          </Button>
        )}
        <Button type="button" variant="outline" size="chip" disabled={!!ocupado || conflitos.length > 0} onClick={() => void seguir(true)}>
          {ocupado === "continuar" ? <Loader2 className="animate-spin" /> : <GitMerge />}
          Continuar
        </Button>
        <Button type="button" variant="ghost" size="chip" disabled={!!ocupado} onClick={() => void seguir(false)}>
          Abortar o {operacao.tipo}
        </Button>
      </div>
    </div>
  )
}
