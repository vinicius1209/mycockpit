// As sessões de motor que rodam FORA do app.
//
// Usa o `PainelDaFaixa` — a régua única de "o item da faixa foi clicado".
//
// Encerrar é UM a UM, com confirmação e com o alvo dito na cara. Nada de
// "limpar tudo": processo alheio pode ser trabalho de alguém, e um botão que
// mata cinco coisas transforma um engano em cinco.

import { Activity } from "lucide-react"
import { toast } from "sonner"
import {
  LinhaDoPainel,
  PainelDaFaixa,
} from "@/components/layout/statusBarChrome"
import { confirm } from "@/lib/confirm"
import {
  PARADO_SEGUNDOS,
  idadeCurta,
  matarProcesso,
  type ProcessoDeMotor,
} from "@/lib/processos"

function Linha({
  p,
  onEncerrar,
}: {
  p: ProcessoDeMotor
  onEncerrar: (p: ProcessoDeMotor) => void
}) {
  return (
    <LinhaDoPainel>
      <span className="font-mono text-[12px] font-medium text-foreground">
        {p.motor}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
        {p.pid}
      </span>
      {/* Órfã é FATO (pai morto), não suspeita — por isso é a única marca
          escrita; "parada" já está dita pela idade. */}
      {p.orfao && (
        <span className="rounded border border-border/40 bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          órfã
        </span>
      )}
      <span className="ml-auto font-mono text-[11px] text-muted-foreground/75 tabular-nums">
        {idadeCurta(p.idade_s)} · {p.rss_mb} MB
      </span>
      <button
        type="button"
        onClick={() => onEncerrar(p)}
        className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        Encerrar
      </button>
    </LinhaDoPainel>
  )
}

export function ProcessosPopover({
  open,
  onOpenChange,
  lista,
  onMudou,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  lista: readonly ProcessoDeMotor[]
  onMudou: () => void
  children: React.ReactNode
}) {
  async function encerrar(p: ProcessoDeMotor) {
    // Fecha ANTES de perguntar: o confirm é modal e disputaria foco com o
    // painel aberto — e a pergunta merece a tela, não um canto dela.
    onOpenChange(false)
    const ok = await confirm({
      title: `Encerrar ${p.motor} (pid ${p.pid})?`,
      description: `Roda há ${idadeCurta(p.idade_s)} e ocupa ${p.rss_mb} MB. Se tiver trabalho não salvo, ele morre junto.`,
      confirmLabel: "Encerrar",
      danger: true,
    })
    if (!ok) return
    try {
      await matarProcesso(p.pid)
      onMudou()
    } catch (err) {
      toast.error("Não consegui encerrar.", { description: String(err) })
    }
  }

  return (
    <PainelDaFaixa
      open={open}
      onOpenChange={onOpenChange}
      titulo="Sessões fora do app"
      icone={<Activity className="size-3.5" />}
      conteudo={
        <div className="space-y-1.5">
          {lista.map((p) => (
            <Linha key={p.pid} p={p} onEncerrar={(x) => void encerrar(x)} />
          ))}
        </div>
      }
      nota={
        <>
          Agents rodando nesta máquina que o app não iniciou. Os que ele iniciou
          não aparecem: têm dono na tela e morrem junto com ele. Sessão recente
          não é problema (pode ser você, noutro terminal); a faixa só chama
          acima de {idadeCurta(PARADO_SEGUNDOS)} parada, ou quando o pai morreu.
        </>
      }
    >
      {children}
    </PainelDaFaixa>
  )
}
