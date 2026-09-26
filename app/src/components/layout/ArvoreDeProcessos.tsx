// Um turno (ou um Chromium) no painel da máquina, que se abre na árvore de
// processos (ADR-263, mock `docs/mocks/processos-do-turno.html`): papel, nome,
// memória, CPU e tempo de cada um, e o Encerrar no hover do que pode ser
// encerrado. A ação do grupo inteiro (Parar o turno, Desligar o navegador)
// fica na linha de cima, como antes.

import { useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PAPEL, linhasDaArvore, type LinhaDaArvore } from "@/lib/arvoreDoTurno"
import { fmtDuration } from "@/lib/format"
import { fmtGb, type ProcessoNaArvore } from "@/lib/maquina"
import { cn } from "@/lib/utils"

/** Memória de um processo: MB até 1 GB, GB daí para cima. */
function fmtMb(mb: number): string {
  return mb >= 1024 ? `${fmtGb(mb)} GB` : `${mb} MB`
}

const COLUNAS = "grid grid-cols-[12px_60px_minmax(0,1fr)_56px_40px_64px_68px] items-center gap-x-2"

function Linha({
  l,
  rotuloDaRaiz,
  aoEncerrar,
}: {
  l: LinhaDaArvore
  rotuloDaRaiz: string
  aoEncerrar?: (l: LinhaDaArvore) => void
}) {
  return (
    <div className={cn(COLUNAS, "group/proc rounded-md py-1 hover:bg-sel-hover")} title={l.comando}>
      <span aria-hidden className="font-mono text-[11px] text-muted-foreground/50">
        {l.profundidade > 0 ? "└" : ""}
      </span>
      <span className="justify-self-start rounded bg-secondary px-1.5 text-[11px] text-muted-foreground">
        {l.profundidade === 0 ? rotuloDaRaiz : PAPEL[l.papel]}
      </span>
      <span
        className="min-w-0 truncate font-mono text-[12px] text-foreground"
        // A indentação é da profundidade real, além do primeiro nível.
        style={{ paddingLeft: `${Math.max(0, l.profundidade - 1) * 12}px` }}
      >
        {l.nome}
        {l.executor && <span className="text-[11px] text-muted-foreground/70"> · {l.executor}</span>}
      </span>
      <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{fmtMb(l.rssMb)}</span>
      <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {Math.round(l.cpuPct)}%
      </span>
      <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {fmtDuration(l.tempoS * 1000)}
      </span>
      <span className="justify-self-end">
        {l.encerravel && aoEncerrar && (
          <Button
            size="chip"
            variant="outline"
            className="opacity-0 group-hover/proc:opacity-100 focus-visible:opacity-100"
            onClick={() => aoEncerrar(l)}
          >
            Encerrar
          </Button>
        )}
      </span>
    </div>
  )
}

export function GrupoDeProcessos({
  icone,
  titulo,
  mb,
  processos,
  rotuloDaRaiz,
  acao,
  aoEncerrar,
}: {
  icone?: ReactNode
  titulo: string
  mb: number
  processos: ProcessoNaArvore[]
  /** O papel da raiz: "motor" num turno, "principal" num navegador. */
  rotuloDaRaiz: string
  /** Parar o turno, Desligar o navegador. */
  acao: ReactNode
  aoEncerrar?: (l: LinhaDaArvore) => void
}) {
  const [aberto, setAberto] = useState(false)
  const linhas = linhasDaArvore(processos)
  return (
    <div className={cn("rounded-lg border bg-secondary/25", aberto && "bg-secondary/35")}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")}
          />
          {icone && <span className="grid size-4 shrink-0 place-items-center">{icone}</span>}
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{titulo}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {fmtGb(mb)} GB · {processos.length} proc.
          </span>
        </button>
        {acao}
      </div>
      {aberto && (
        // O recuo lateral mora no contêiner: a linha é de tabela, não
        // controle, e a altura vem do conteúdo (§13 fica para o que se aperta).
        <div className="border-t border-border/40 px-1.5 py-1">
          <div className={cn(COLUNAS, "pb-0.5 text-[11px] text-muted-foreground/70")}>
            <span />
            <span>papel</span>
            <span>processo</span>
            <span className="text-right">memória</span>
            <span className="text-right">CPU</span>
            <span className="text-right">tempo</span>
            <span />
          </div>
          {linhas.map((l) => (
            <Linha key={l.chave} l={l} rotuloDaRaiz={rotuloDaRaiz} aoEncerrar={aoEncerrar} />
          ))}
        </div>
      )}
    </div>
  )
}
