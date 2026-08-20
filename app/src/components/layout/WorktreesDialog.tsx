// Worktrees soltos do projeto — ver e recolher.
//
// Aberto pelo item da faixa de status. A faixa CONSTATA o número; aqui é onde
// ele vira nome, motivo e ação. Duas regras de honestidade mandam no desenho:
//
// 1. Recolher só aparece pra quem não tem trabalho próprio. Um worktree com
//    commit que só existe ali não ganha botão nenhum — ganha o número de
//    commits, que é o que faz o usuário ir buscar em vez de achar que travou.
// 2. O git tem a última palavra. Mesmo no que a gente chama de "limpo", o Rust
//    usa `branch -d`: se ele recusar, a recusa vira mensagem, não um sumiço
//    silencioso da linha.

import { useEffect, useState } from "react"
import { Check, GitBranch } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { type LooseWorktree, worktreeStatusText } from "@/lib/worktrees"
import { useWorktrees } from "@/store/worktrees"
import { cn } from "@/lib/utils"

export function WorktreesDialog({
  open,
  onOpenChange,
  projectId,
  projectPath,
  loose,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  projectId: string
  projectPath: string
  loose: LooseWorktree[]
}) {
  const reclaim = useWorktrees((s) => s.reclaim)
  // Erro POR LINHA, não um toast global: com várias linhas, um toast solto não
  // diz qual delas o git recusou.
  const [erros, setErros] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [feitos, setFeitos] = useState<Set<string>>(new Set())

  // SNAPSHOT ao abrir. Sem ele a linha recolhida simplesmente sumia da lista
  // (a store relê e a entrada some) — e sumir não é feedback, é o mesmo
  // silêncio que este trabalho inteiro existe pra tirar do lugar. Congelando a
  // lista, cada linha fica no lugar e conta o próprio desfecho.
  const [linhas, setLinhas] = useState<LooseWorktree[]>([])
  useEffect(() => {
    if (!open) return
    setLinhas(loose)
    setFeitos(new Set())
    setErros({})
    // `loose` de fora das deps de propósito: a releitura da store muda a
    // referência dele a cada recolhida, e re-snapshotar apagaria justamente a
    // confirmação que acabou de aparecer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function recolher(w: LooseWorktree) {
    setOcupado(w.branch)
    const erro = await reclaim(projectId, projectPath, w)
    setOcupado(null)
    setErros((e) => {
      const next = { ...e }
      if (erro) next[w.branch] = erro
      else delete next[w.branch]
      return next
    })
    if (!erro) setFeitos((f) => new Set(f).add(w.branch))
  }

  const limpos = linhas.filter((w) => w.clean && !feitos.has(w.branch))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        // Sem isto o Radix foca o 1º botão ao abrir, e "Recolher" nascia com o
        // anel âmbar aceso — que lê como bug de foco, não como convite. Mesmo
        // conserto que o popover de Configuração levou (lá no `onCloseAutoFocus`).
        // O foco não fica solto: o Radix cai no próprio content (tabIndex -1,
        // `outline-none`), então Esc e Tab seguem funcionando dentro do diálogo.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <GitBranch className="size-4 text-muted-foreground" />
            Worktrees soltos
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Pastas isoladas que nenhuma conversa usa mais. Recolher devolve a
            pasta e o branch ao repositório.
          </DialogDescription>
        </DialogHeader>

        {linhas.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Nada solto por aqui.
          </p>
        ) : (
          <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
            {linhas.map((w) => {
              const feito = feitos.has(w.branch)
              return (
                <div
                  key={w.branch}
                  // `transition-colors` e nada além: a linha recolhida esmaece
                  // pra confirmar sem se mexer. Movimento de verdade é do §6,
                  // e um item de lista não é o "agora" de ninguém.
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors",
                    feito ? "border-border/30 bg-secondary/20" : "border-border/55",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "truncate font-mono text-[12px] transition-colors",
                        feito ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {w.branch}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {feito
                        ? w.path
                          ? "recolhido · pasta e branch devolvidos ao repositório"
                          : "recolhido · branch apagado"
                        : worktreeStatusText(w)}
                    </div>
                    {erros[w.branch] && (
                      <div className="mt-1 text-[11px] text-st-error">
                        {erros[w.branch]}
                      </div>
                    )}
                  </div>
                  {feito ? (
                    <span className="flex shrink-0 items-center gap-1 py-1 text-[11px] text-muted-foreground">
                      <Check className="size-3" aria-hidden />
                      feito
                    </span>
                  ) : w.clean ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-[12px]"
                      disabled={ocupado === w.branch}
                      onClick={() => void recolher(w)}
                    >
                      {ocupado === w.branch ? "Recolhendo…" : "Recolher"}
                    </Button>
                  ) : (
                    // Sem botão de propósito: oferecer "recolher" pra quem tem
                    // trabalho é convidar pra perda, e o `-d` recusaria mesmo.
                    <span className="shrink-0 py-1 text-[11px] text-muted-foreground">
                      preservado
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {limpos.length > 1 && (
          <Button
            variant="outline"
            className="w-full text-[12px]"
            disabled={ocupado != null}
            onClick={async () => {
              // Em série, não em paralelo: são comandos git no MESMO repo, e
              // git concorrente no mesmo índice é corrida por lock.
              for (const w of limpos) await recolher(w)
            }}
          >
            Recolher os {limpos.length} sem trabalho próprio
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
