// O Histórico, recolhido no fim da aba Alterações: os últimos commits da branch
// com os ainda não enviados marcados, e "Desfazer último commit" enquanto ele
// não saiu da máquina (docs/explorador-de-arquivos-prd.md, BD4). Só lê quando
// abre, e relê quando a branch muda de posição.

import { useEffect, useRef, useState } from "react"
import { Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { avisar } from "@/lib/avisos"
import { confirm } from "@/lib/confirm"
import { comoErroDeGit, desfazerUltimoCommit, historico, quandoDaBranch, type CommitDoHistorico } from "@/lib/gitSync"
import { avisarGravacao } from "@/lib/sinaisDoDisco"
import { GitSection } from "./GitSection"

const PASSO = 20

export function HistoricoGit({ cwd, versao }: { cwd: string; versao: string }) {
  const [aberto, setAberto] = useState(false)
  const [quantos, setQuantos] = useState(PASSO)
  const [commits, setCommits] = useState<CommitDoHistorico[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const epoca = useRef(0)

  useEffect(() => {
    if (!aberto) return
    const minha = ++epoca.current
    historico(cwd, quantos)
      .then((c) => {
        if (epoca.current !== minha) return
        setCommits(c)
        setErro(null)
      })
      .catch((e) => {
        if (epoca.current === minha) setErro(comoErroDeGit(e).detalhe)
      })
  }, [aberto, cwd, quantos, versao])

  async function desfazer(c: CommitDoHistorico) {
    const ok = await confirm({
      title: "Desfazer o último commit?",
      description: `"${c.mensagem}" deixa de ser commit, e as alterações dele voltam para a área de trabalho, preparadas.`,
      confirmLabel: "Desfazer commit",
    })
    if (!ok) return
    try {
      await desfazerUltimoCommit(cwd)
      avisar.feito(`Commit ${c.curto} desfeito`)
      avisarGravacao(cwd)
    } catch (e) {
      avisar.erro("Não consegui desfazer o commit.", { detalhe: comoErroDeGit(e).detalhe })
    }
  }

  const now = Date.now()
  const ultimo = commits?.[0]

  return (
    <GitSection title="Histórico" isOpen={aberto} onToggle={() => setAberto((a) => !a)}>
      {erro ? (
        <p className="px-3 py-1.5 text-[12px] text-muted-foreground">{erro}</p>
      ) : commits === null ? (
        <p className="px-3 py-1.5 text-[12px] text-muted-foreground">Lendo…</p>
      ) : commits.length === 0 ? (
        <p className="px-3 py-1.5 text-[12px] text-muted-foreground">Nenhum commit ainda.</p>
      ) : (
        <>
          <ul>
            {commits.map((c) => (
              <li
                key={c.hash}
                title={`${c.mensagem}\n${c.autor} · ${new Date(c.quando).toLocaleString("pt-BR")}`}
                className="flex h-7 items-center gap-2 px-3 text-[12px]"
              >
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.curto}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/90">{c.mensagem}</span>
                {c.naoEnviado ? (
                  <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[11px] text-foreground/80">não enviado</span>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {quandoDaBranch({ quando: c.quando, atual: false }, now)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 px-3 pt-1">
            {ultimo?.naoEnviado && commits.length > 1 && (
              <Button type="button" variant="ghost" size="chip" onClick={() => void desfazer(ultimo)}>
                <Undo2 />
                Desfazer último commit
              </Button>
            )}
            {commits.length >= quantos && quantos < 200 && (
              <Button
                type="button"
                variant="ghost"
                size="chip"
                className="ml-auto text-muted-foreground"
                onClick={() => setQuantos((q) => q + PASSO)}
              >
                Ver mais
              </Button>
            )}
          </div>
        </>
      )}
    </GitSection>
  )
}
