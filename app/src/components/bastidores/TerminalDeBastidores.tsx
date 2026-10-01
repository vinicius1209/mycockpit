// Terminal dos Bastidores (ADR-200): as vistas abertas moram na aba Bastidores
// do painel direito, que alarga enquanto elas existem. A conversa e o composer
// nunca dividem largura com elas (build #389: o composer quebrava em três linhas
// quando as vistas dividiam o cartão central).
//
// Um X por vista. Com uma vista só não há aba: há um cabeçalho de detalhe, com
// a volta para a lista escrita; com várias, cada uma tem a aba dela, e "lado a
// lado" empilha as vistas, cada uma com o próprio X. Fechar a última volta para
// a lista.
//
// Contêiner (`TerminalDeBastidores`) lê os stores; a apresentação
// (`TerminalView`) recebe tudo por props, para o teste renderizar sem o estado
// congelado do SSR.

import { Fragment, type KeyboardEvent } from "react"
import { ChevronLeft, List, Rows2, X } from "lucide-react"
import { BastidorVista, type CorpoDaVista } from "@/components/bastidores/BastidorVista"
import { PontoDeEstado } from "@/components/bastidores/partes"
import { useBastidoresDaConversa } from "@/components/bastidores/useBastidoresDaConversa"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { avisar } from "@/lib/avisos"
import { passosDoSubagente, type Bastidor } from "@/lib/bastidores"
import { cn } from "@/lib/utils"
import { stopManagedProcess } from "@/lib/work"
import { chaveDaSaida, useBastidores, vistasDa, type VistaAberta } from "@/store/bastidores"
import type { ChatItem } from "@/store/chat"

/** Ghost sobre a superfície escura: o hover do tema claro sumiria nela. */
const CONTROLE = "text-terminal-dim hover:bg-terminal-line hover:text-terminal-strong dark:hover:bg-terminal-line"

export function TerminalDeBastidores() {
  const { convId, items, lista } = useBastidoresDaConversa()
  const vistas = useBastidores((s) => s.vistas)
  const foco = useBastidores((s) => s.foco)
  const saidas = useBastidores((s) => s.saidas)
  const dividido = useBastidores((s) => s.dividido)
  if (!convId) return null
  const acoes = useBastidores.getState()
  return (
    <TerminalView
      lista={lista}
      vistas={vistasDa(vistas, convId)}
      foco={foco}
      dividido={dividido}
      corpoDe={(b) => corpoDaVista(b, items, (toolId) => saidas[chaveDaSaida(convId, toolId)])}
      onFocar={acoes.focar}
      onFechar={(itemId) => acoes.fechar(convId, itemId)}
      onFecharTodas={() => acoes.fecharTodas(convId)}
      onDividir={acoes.alternarDivisao}
      onVerIndice={() => acoes.verIndice(true)}
      onParar={(b) => {
        if (!b.processId) return
        void stopManagedProcess(b.processId).catch((error) =>
          avisar.erro("Não consegui parar o processo.", {
            detalhe: String(error),
          }),
        )
      }}
    />
  )
}

export function corpoDaVista(
  b: Bastidor,
  items: ChatItem[],
  saidaDoStream: (toolId: string) => CorpoDaVista["saida"],
): CorpoDaVista {
  if (b.fonte.tipo === "stream") return { saida: saidaDoStream(b.fonte.toolId) }
  if (b.fonte.tipo === "passos") return { passos: passosDoSubagente(items, b.fonte.paiId) }
  if (b.fonte.tipo === "resultado") {
    const it = items.find((i) => i.id === b.itemId)
    const r = it?.kind === "tool" ? it.result : undefined
    return r ? { resultado: { texto: r.text, linhas: r.lines } } : {}
  }
  if (b.fonte.tipo === "processo") {
    const it = items.find((i) => i.id === b.itemId)
    return { processoOutput: it?.kind === "tool" ? (it.managedProcess?.output ?? "") : "" }
  }
  return {}
}

export function TerminalView({
  lista,
  vistas,
  foco,
  dividido,
  corpoDe,
  onFocar,
  onFechar,
  onFecharTodas,
  onDividir,
  onVerIndice,
  onParar,
}: {
  lista: Bastidor[]
  vistas: VistaAberta[]
  foco: number
  dividido: boolean
  corpoDe: (b: Bastidor) => CorpoDaVista
  onFocar: (indice: number) => void
  onFechar: (itemId: string) => void
  onFecharTodas: () => void
  onDividir: () => void
  onVerIndice: () => void
  onParar?: (b: Bastidor) => void
}) {
  const abertos = vistas
    .map((v) => lista.find((b) => b.itemId === v.itemId))
    .filter((b): b is Bastidor => !!b)
  if (!abertos.length) return null
  const iFoco = Math.min(foco, abertos.length - 1)
  const atual = abertos[iFoco]
  const ladoALado = dividido && abertos.length > 1

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.preventDefault()
      onFecharTodas()
    }
  }

  function onKeyDownAbas(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    const proximo = (iFoco + (e.key === "ArrowRight" ? 1 : -1) + abertos.length) % abertos.length
    onFocar(proximo)
    const abas = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')
    abas[proximo]?.focus()
  }

  return (
    <section
      aria-label="Terminal dos Bastidores"
      onKeyDown={onKeyDown}
      className="@container/terminal flex min-h-0 flex-1 flex-col bg-terminal text-terminal-fg"
    >
      {abertos.length === 1 ? (
        // Uma vista só é um DETALHE da lista, não uma aba: um cabeçalho, com o
        // caminho de volta escrito, o título inteiro e o X. A faixa de abas por
        // cima de um cabeçalho de corpo dava três andares de moldura e o mesmo
        // título duas vezes (visto no build #415).
        <header className="flex min-h-9 shrink-0 items-start gap-2 border-b border-terminal-line bg-terminal-raised py-1.5 pr-1 pl-1.5">
          <Button
            type="button"
            variant="ghost"
            size="chip"
            onClick={onVerIndice}
            title="Ver a lista de trabalhos"
            aria-label="Ver a lista de trabalhos"
            className={cn("shrink-0", CONTROLE)}
          >
            <ChevronLeft className="size-3.5" />
            Bastidores
          </Button>
          {/* `min-h-6` + `items-center`: glifo e primeira linha do título na
              mesma altura do chip ao lado, mesmo quando o título quebra. */}
          <div className="flex min-h-6 min-w-0 flex-1 items-center gap-2">
            <PontoDeEstado estado={atual.estado} tom="terminal" />
            <h2 className="line-clamp-2 min-w-0 text-[12px] font-medium text-terminal-strong" title={atual.titulo}>
              {atual.titulo}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icone-chip"
            onClick={() => onFechar(atual.itemId)}
            title="Fechar esta vista (Esc)"
            aria-label={`Fechar ${atual.titulo}`}
            className={cn("shrink-0", CONTROLE)}
          >
            <X className="size-3.5" />
          </Button>
        </header>
      ) : (
        <div className="flex h-9 shrink-0 items-stretch border-b border-terminal-line bg-terminal-raised">
          <Button
            type="button"
            variant="ghost"
            size="icone-chip"
            onClick={onVerIndice}
            title="Ver a lista de trabalhos"
            aria-label="Ver a lista de trabalhos"
            className={cn("mx-1.5 self-center", CONTROLE)}
          >
            <List className="size-3.5" />
          </Button>
          <div role="tablist" aria-label="Vistas abertas" onKeyDown={onKeyDownAbas} className="flex min-w-0 flex-1 items-stretch">
            {abertos.map((b, i) => {
              const ativa = i === iFoco
              return (
                <div
                  key={b.itemId}
                  className={cn(
                    "flex min-w-0 max-w-64 items-center gap-1 border-x border-terminal-line pr-1 pl-3 first:border-l-0",
                    // Aba ativa = a superfície do terminal continuando, sem tinta
                    // (seleção não é cor, ADR-043).
                    ativa ? "bg-terminal text-terminal-strong" : "text-terminal-dim hover:text-terminal-fg",
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ativa}
                    tabIndex={ativa ? 0 : -1}
                    onClick={() => onFocar(i)}
                    title={b.titulo}
                    className="flex min-w-0 items-center gap-2 text-[12px] outline-none focus-visible:underline"
                  >
                    <PontoDeEstado estado={b.estado} tom="terminal" />
                    <span className="truncate">{b.titulo}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icone-chip"
                    onClick={() => onFechar(b.itemId)}
                    title="Fechar esta vista"
                    aria-label={`Fechar ${b.titulo}`}
                    className={CONTROLE}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
          {abertos.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icone-chip"
              onClick={onDividir}
              aria-pressed={dividido}
              title={dividido ? "Uma vista por vez" : "Ver as vistas lado a lado"}
              aria-label={dividido ? "Uma vista por vez" : "Ver as vistas lado a lado"}
              className={cn("mx-1.5 self-center", CONTROLE, dividido && "text-terminal-strong")}
            >
              <Rows2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {ladoALado ? (
          <ResizablePanelGroup orientation="vertical" className="h-full">
            {abertos.map((b, i) => (
              <Fragment key={b.itemId}>
                {i > 0 && <ResizableHandle className="bg-terminal-line" />}
                <ResizablePanel id={`vista-${b.itemId}`} minSize="80px">
                  <BastidorVista
                    b={b}
                    corpo={corpoDe(b)}
                    comCabecalho
                    emFoco={i === iFoco}
                    onFocar={() => onFocar(i)}
                    onFechar={() => onFechar(b.itemId)}
                    onParar={onParar}
                  />
                </ResizablePanel>
              </Fragment>
            ))}
          </ResizablePanelGroup>
        ) : (
          <BastidorVista
            key={atual.itemId}
            b={atual}
            corpo={corpoDe(atual)}
            tituloNoCorpo={abertos.length > 1}
            onParar={onParar}
          />
        )}
      </div>

      {/* O estado subiu para a primeira linha da vista. Aqui sobra o atalho, e só
          quando há abas para percorrer. */}
      {abertos.length > 1 && (
        <footer className="hidden h-7 shrink-0 items-center justify-end border-t border-terminal-line px-3 text-[11px] text-terminal-dim @min-[440px]/terminal:flex">
          ←→ abas · Esc fecha
        </footer>
      )}
    </section>
  )
}
