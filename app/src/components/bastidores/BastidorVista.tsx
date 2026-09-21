// Uma vista do terminal dos Bastidores (ADR-200): o corpo conforme a fonte da
// saída, com a cara de terminal (superfície `terminal`, escura nos dois temas).
// Cada fonte diz a verdade do motor: arquivo ao vivo, deltas do stream, saída
// do processo, passos do subagente, resultado no fim ou "só no fim".
//
// A Frota não emula terminal: ela LÊ a saída que o motor já produz e mostra
// como texto. Nada aqui abre shell ou manda tecla para processo.

import type { ReactNode } from "react"
import { X } from "lucide-react"
import { CabecaDaVista, TituloNoCorpo } from "@/components/bastidores/CabecaDaVista"
import { PontoDeEstado, TIPO } from "@/components/bastidores/partes"
import { SaidaDeLog } from "@/components/bastidores/SaidaDeLog"
import { useSaidaDeArquivo } from "@/components/bastidores/useSaidaDeArquivo"
import { Button } from "@/components/ui/button"
import {
  SAIDA_VAZIA,
  somarTexto,
  type Bastidor,
  type PassoDeSubagente,
  type SaidaViva,
} from "@/lib/bastidores"
import { cn } from "@/lib/utils"

export { ESTADO, PontoDeEstado, RotuloDeTempo, TIPO, duracaoDe } from "@/components/bastidores/partes"

/** Por que acabou, quando o motor matou o trabalho junto com o turno. */
function avisoDeFim(b: Bastidor): string | null {
  if (b.estado !== "interrompido") return null
  if (b.tipo === "tarefa" || b.tipo === "comando") {
    return "O motor encerrou este trabalho. Sem terminal aberto, comandos em segundo plano terminam junto com o turno."
  }
  return "Este trabalho foi interrompido."
}

/** A última linha: o cursor enquanto vive. Terminado não ganha linha aqui: o
 *  estado e a duração já estão no rodapé (abas) ou na faixa da vista (lado a
 *  lado), e "concluído · 1min 27s" aparecia duas vezes na mesma tela. */
function Fim({ b }: { b: Bastidor }) {
  if (b.estado !== "vivo") return null
  return <span aria-hidden className="terminal-cursor mt-0.5 inline-block h-[1.1em] w-[0.6em] bg-terminal-prompt align-[-2px]" />
}

/** Corpo sem log (passos, espera, aviso): mesma tipografia do terminal. */
function Texto({ b, children }: { b: Bastidor; children: ReactNode }) {
  return (
    <div data-selectable className="min-h-0 flex-1 overflow-auto px-3.5 py-3">
      <CabecaDaVista b={b} />
      {children}
      <Fim b={b} />
    </div>
  )
}

function Log({ b, saida, vazio }: { b: Bastidor; saida: SaidaViva; vazio: string }) {
  return <SaidaDeLog saida={saida} vazio={vazio} cabeca={<CabecaDaVista b={b} />} fim={<Fim b={b} />} />
}

function VistaDeArquivo({ caminho, b }: { caminho: string; b: Bastidor }) {
  const { saida, fim, erro } = useSaidaDeArquivo(caminho)
  return (
    <>
      <Log b={b} saida={saida} vazio={b.estado === "vivo" ? "Aguardando a primeira linha…" : "Nenhuma saída foi gravada."} />
      {(erro || fim) && <Rodape texto={erro ?? fim ?? ""} />}
    </>
  )
}

function VistaDeResultado({ b, resultado }: { b: Bastidor; resultado: CorpoDaVista["resultado"] }) {
  if (b.estado === "vivo") {
    return <Texto b={b}><p className="text-terminal-dim">A saída deste comando chega quando ele terminar.</p></Texto>
  }
  const texto = resultado?.texto.trimEnd() ?? ""
  const mostradas = texto ? texto.split("\n").length : 0
  return (
    <>
      <Log b={b} saida={texto ? somarTexto(SAIDA_VAZIA, `${texto}\n`) : SAIDA_VAZIA} vazio="O comando não escreveu nada." />
      {resultado && resultado.linhas > mostradas && (
        <Rodape texto={`Mostrando ${mostradas} de ${resultado.linhas} linhas, o trecho que a conversa guardou.`} />
      )}
    </>
  )
}

function Rodape({ texto }: { texto: string }) {
  return <p className="shrink-0 border-t border-terminal-line px-3.5 py-1.5 font-sans text-[11px] text-terminal-dim">{texto}</p>
}

function Passos({ passos, b }: { passos: PassoDeSubagente[]; b: Bastidor }) {
  return (
    <Texto b={b}>
      {passos.length ? (
        <ol className="flex flex-col">
          {passos.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center gap-2">
              <PontoDeEstado estado={p.estado} tom="terminal" />
              <span className="shrink-0 text-terminal-strong">{p.nome}</span>
              {p.alvo && <span className="min-w-0 truncate text-terminal-dim">{p.alvo}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-terminal-dim">
          {b.estado === "vivo" ? "O subagente ainda não usou nenhuma ferramenta." : "O subagente não usou ferramentas."}
        </p>
      )}
    </Texto>
  )
}

export interface CorpoDaVista {
  /** Resultado guardado no item, para o comando que só entrega no fim. */
  resultado?: { texto: string; linhas: number }
  /** Saída do stream (comando) ou do processo, já resolvida pelo contêiner. */
  saida?: SaidaViva
  passos?: PassoDeSubagente[]
  processoOutput?: string
}

/**
 * `comCabecalho`: no modo dividido cada vista tem a própria faixa com título e
 * o SEU X. Em abas, a aba já é o cabeçalho, e repetir título e X aqui era o
 * "dois X" visto no build #389.
 */
export function BastidorVista({
  b,
  corpo,
  comCabecalho = false,
  tituloNoCorpo = false,
  emFoco = false,
  onFocar,
  onFechar,
}: {
  b: Bastidor
  corpo: CorpoDaVista
  comCabecalho?: boolean
  /** As abas cortam o título: aí o corpo o traz inteiro. */
  tituloNoCorpo?: boolean
  emFoco?: boolean
  onFocar?: () => void
  onFechar?: () => void
}) {
  const aviso = avisoDeFim(b)
  return (
    <section
      aria-label={`${TIPO[b.tipo]}: ${b.titulo}`}
      data-em-foco={emFoco || undefined}
      onMouseDown={onFocar}
      onFocusCapture={onFocar}
      className="flex h-full min-h-0 flex-col bg-terminal font-mono text-[12px] leading-relaxed text-terminal-fg"
    >
      {comCabecalho && (
        <header
          className={cn(
            "flex h-8 shrink-0 items-center gap-2 border-b border-terminal-line pr-1 pl-3 font-sans",
            // Foco = quem recebe o próximo "abrir". Seleção não é cor (ADR-043):
            // faixa mais clara e título forte, como a aba ativa.
            emFoco ? "bg-terminal-raised" : "bg-terminal",
          )}
        >
          <PontoDeEstado estado={b.estado} tom="terminal" />
          <span
            className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", emFoco ? "text-terminal-strong" : "text-terminal-fg")}
            title={b.titulo}
          >
            {b.titulo}
          </span>
          {onFechar && (
            <Button
              type="button"
              variant="ghost"
              size="icone-chip"
              onClick={onFechar}
              title="Fechar esta vista"
              aria-label={`Fechar ${b.titulo}`}
              className="text-terminal-dim hover:bg-terminal-line hover:text-terminal-strong"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </header>
      )}
      <TituloNoCorpo.Provider value={tituloNoCorpo && !comCabecalho}>
        {b.fonte.tipo === "arquivo" ? (
          <VistaDeArquivo caminho={b.fonte.caminho} b={b} />
        ) : b.fonte.tipo === "resultado" ? (
          <VistaDeResultado b={b} resultado={corpo.resultado} />
        ) : b.fonte.tipo === "stream" ? (
          <Log b={b} saida={corpo.saida ?? SAIDA_VAZIA} vazio={b.estado === "vivo" ? "Aguardando a primeira linha…" : "Nenhuma saída chegou."} />
        ) : b.fonte.tipo === "processo" ? (
          <Log
            b={b}
            saida={somarTexto(SAIDA_VAZIA, `${corpo.processoOutput ?? ""}\n`)}
            vazio={b.estado === "vivo" ? "Aguardando a primeira linha…" : "O processo não escreveu nada."}
          />
        ) : b.fonte.tipo === "passos" ? (
          <Passos passos={corpo.passos ?? []} b={b} />
        ) : (
          <Texto b={b}>
            <p className="text-terminal-dim">
              {b.estado === "vivo"
                ? "Este motor só entrega a saída quando o trabalho termina."
                : "O motor não entregou saída para este trabalho. O resultado, se houver, está na conversa."}
            </p>
          </Texto>
        )}
      </TituloNoCorpo.Provider>
      {aviso && <Rodape texto={aviso} />}
    </section>
  )
}
