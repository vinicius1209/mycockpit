// Cabeçalho da vista dos Bastidores: estado do processo, início e comando de lançamento.
// O comando longo inicia recolhido para priorizar a saída do processo.

import { createContext, useContext, useState } from "react"
import { Copy, Square } from "lucide-react"
import { Elapsed } from "@/components/chat/LiveTime"
import { ESTADO, TIPO, duracaoDe } from "@/components/bastidores/partes"
import { Button } from "@/components/ui/button"
import { avisar } from "@/lib/avisos"
import type { Bastidor } from "@/lib/bastidores"
import { copyText } from "@/lib/clipboard"
import { fmtTime, fmtTokens } from "@/lib/format"
import { cn } from "@/lib/utils"
import { stopManagedProcess } from "@/lib/work"

/** Linhas do comando que aparecem enquanto ele está recolhido. */
export const LINHAS_RECOLHIDAS = 3
/** Uma linha só também recolhe quando passa disto (pipeline comprido). */
const COMANDO_LONGO = 240

/** Ghost sobre a superfície escura: o hover do tema claro sumiria nela. */
const CONTROLE = "text-terminal-dim hover:bg-terminal-line hover:text-terminal-strong dark:hover:bg-terminal-line"

/** O título só entra no corpo quando a faixa de cima o CORTA (várias abas). Com
 *  uma vista só, ou lado a lado, ele já está inteiro logo acima, e repetir dava
 *  o mesmo texto duas vezes em 30px (visto no build #415). Contexto e não prop
 *  porque a cabeça nasce cinco componentes abaixo da vista. */
export const TituloNoCorpo = createContext(false)

/** Uma linha só com os fatos do trabalho. O glifo do estado não entra: ele já
 *  está ao lado do título, na faixa de cima. */
function LinhaDeEstado({ b }: { b: Bastidor }) {
  const inicio = fmtTime(b.desde || null)
  const durou = duracaoDe(b)
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 font-sans text-[11px] text-terminal-dim">
      {b.estado === "vivo" ? (
        <>
          <span className="text-terminal-fg">rodando ·</span>
          <Elapsed since={b.desde} className="font-mono text-terminal-fg" />
        </>
      ) : (
        <span className={cn(b.estado === "falhou" ? "text-terminal-error" : "text-terminal-fg")}>
          {ESTADO[b.estado]}
          {durou ? ` · ${durou}` : ""}
        </span>
      )}
      {inicio && <span>· começou às {inicio}</span>}
      <span>· {TIPO[b.tipo]}</span>
      {b.tokens != null && <span>· {fmtTokens(b.tokens)} tokens</span>}
    </p>
  )
}

/** O título repete o comando quando o motor não deu descrição: aí ele não
 *  aparece duas vezes. */
function tituloRepeteComando(b: Bastidor): boolean {
  if (!b.comando) return false
  return b.comando.trim().startsWith(b.titulo.replace(/…$/, ""))
}

/** Uma linha do comando inteiro. A continuação da quebra recua dois caracteres
 *  ALÉM da indentação da própria linha: sem isso ela voltava pra coluna 0 e um
 *  script indentado (Python) ficava ilegível. */
function LinhaDoComando({ linha }: { linha: string }) {
  const recuo = (linha.match(/^[ \t]*/)?.[0].length ?? 0) + 2
  return (
    <div
      className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]"
      style={{ paddingLeft: `${recuo}ch`, textIndent: `-${recuo}ch` }}
    >
      {linha || " "}
    </div>
  )
}

export function CabecaDaVista({
  b,
  onParar,
}: {
  b: Bastidor
  onParar?: (b: Bastidor) => void
}) {
  const comTitulo = useContext(TituloNoCorpo)
  const [inteiro, setInteiro] = useState(false)
  const linhas = b.comando ? b.comando.split("\n") : []
  const recolhe = linhas.length > LINHAS_RECOLHIDAS || (b.comando?.length ?? 0) > COMANDO_LONGO
  const recolhido = recolhe && !inteiro

  function handleParar() {
    if (onParar) {
      onParar(b)
      return
    }
    if (!b.processId) return
    void stopManagedProcess(b.processId).catch((error) =>
      avisar.erro("Não consegui parar o processo.", {
        detalhe: String(error),
      }),
    )
  }

  return (
    <div className="mb-2 border-b border-terminal-line pb-2">
      {comTitulo && !tituloRepeteComando(b) && (
        <p className="font-sans text-[13px] font-medium break-words text-terminal-strong">{b.titulo}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <LinhaDeEstado b={b} />
        {b.tipo === "processo" && b.estado === "vivo" && (
          <Button
            type="button"
            variant="ghost"
            size="chip"
            onClick={handleParar}
            title={
              b.processStatus === "stopping"
                ? "Processo encerrando. Clique para forçar a parada imediata."
                : "Para este processo e os filhos dele"
            }
            aria-label={
              b.processStatus === "stopping"
                ? `Forçar parada de ${b.titulo}`
                : `Parar ${b.titulo}`
            }
            className="shrink-0 text-terminal-dim hover:bg-destructive/20 hover:text-destructive dark:hover:bg-destructive/20"
          >
            <Square className="size-2.5 fill-current" />
            <span>{b.processStatus === "stopping" ? "Forçar parada" : "Parar"}</span>
          </Button>
        )}
      </div>
      {b.detalhe && <p className="text-terminal-dim">{b.detalhe}</p>}

      {b.comando && (
        <div className="group/comando relative mt-1.5 flex items-start gap-1">
          <span aria-hidden className="shrink-0 text-terminal-prompt">❯ </span>
          <div data-selectable className="min-w-0 flex-1 text-terminal-fg">
            {recolhido
              ? linhas.slice(0, LINHAS_RECOLHIDAS).map((linha, i) => (
                  <div key={i} className="truncate whitespace-pre">{linha || " "}</div>
                ))
              : linhas.map((linha, i) => <LinhaDoComando key={i} linha={linha} />)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icone-chip"
            onClick={() => void copyText(b.comando ?? "", "Comando copiado")}
            title="Copiar o comando"
            aria-label="Copiar o comando"
            // Fora do fluxo: no fluxo ele reservava uma coluna na altura toda
            // do comando, que quebrava de linha com espaço sobrando.
            className={cn(
              "absolute top-0 right-0 bg-terminal-raised opacity-0 group-hover/comando:opacity-100 focus-visible:opacity-100",
              CONTROLE,
            )}
          >
            <Copy className="size-3.5" />
          </Button>
        </div>
      )}
      {recolhe && (
        <Button
          type="button"
          variant="ghost"
          size="chip"
          onClick={() => setInteiro(!inteiro)}
          aria-expanded={inteiro}
          className={cn("mt-0.5 font-sans", CONTROLE)}
        >
          {inteiro
            ? "Recolher o comando"
            : linhas.length > LINHAS_RECOLHIDAS
              ? `Ver o comando inteiro (${linhas.length} linhas)`
              : "Ver o comando inteiro"}
        </Button>
      )}
    </div>
  )
}
