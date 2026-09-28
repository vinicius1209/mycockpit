// A MECÂNICA DO ARRASTO DENTRO DA JANELA.
//
// Por ponteiro, não por HTML5: com `dragDropEnabled` o webview do macOS engole
// `dragover` e `drop` antes do DOM (a prova está em `lib/arrastoInterno.ts`).
// Aqui não existe sessão de arrasto do sistema — é `pointerdown`, `pointermove`
// e `pointerup`, que ninguém intercepta.
//
// Uma camada só para o app inteiro: as fontes apenas dizem "comecei a arrastar
// isto" (`iniciarArrasto`), e os alvos apenas se declaram no DOM com
// `data-arrasto-alvo`. Quem resolve quem está embaixo do cursor, desenha o
// fantasma e conclui o gesto é este componente.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { avisar } from "@/lib/avisos"
import {
  alvoDoAtributo,
  cancelarArrasto,
  cargaArrastada,
  comecarArrasto,
  concluirArrasto,
  pairarSobre,
  type AlvoDoArrasto,
  type CargaArrastada,
} from "@/lib/arrastoInterno"
import { nomeDoCaminho } from "@/lib/arquivoCitado"
import { aceitaNaConversa, anexosComOutro, caminhosDaCarga, planoDoArrasto, rotuloDoArrasto } from "@/lib/soltura"
import { soltarCaminhos } from "@/components/chat/SolturaNoComposer"
import { alvoDoVeu, VeuDeSoltura, type RetanguloDoVeu } from "@/components/chat/VeuDeSoltura"
import { FileIcon } from "@/components/ui/file-icon"
import { MAX_ATTACH_COUNT, type Attachment } from "@/lib/attachments"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

/** Movimento a partir do qual isto vira arrasto, e não clique com a mão trêmula. */
export const LIMIAR_DE_ARRASTO = 5

interface Pendente {
  carga: CargaArrastada
  rotulo: string
  x: number
  y: number
  pointerId: number
  /** Quem capturou o ponteiro, para devolver no fim. */
  captor: Element | null
}

let pendente: Pendente | null = null

/** Chamado pela FONTE no `pointerdown`. O arrasto só nasce quando o ponteiro
 *  anda: clicar continua sendo clicar. */
export function iniciarArrasto(
  ev: React.PointerEvent,
  carga: CargaArrastada,
  rotulo: string,
): void {
  if (ev.button !== 0) return
  // Guarda QUEM vai capturar, mas NÃO captura ainda. Captura aqui comia o
  // clique: a fonte é um `<div>` com um `<button>` dentro, e captura ativa num
  // ancestral redireciona os eventos de mouse derivados para quem capturou —
  // o `click` parava na div e o `onClick` do botão nunca rodava. Quem só clica
  // nunca chega a precisar de captura; ela nasce no `mover`, quando o gesto
  // realmente vira arrasto.
  pendente = {
    carga,
    rotulo,
    x: ev.clientX,
    y: ev.clientY,
    pointerId: ev.pointerId,
    captor: ev.currentTarget,
  }
}

/** Depois de arrastar, o `click` que o sistema manda em seguida não pode virar
 *  "abrir o projeto". Um ouvinte de uma vez só, na fase de captura. */
function engolirProximoClique(): void {
  const engolir = (ev: MouseEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
  }
  document.addEventListener("click", engolir, { capture: true, once: true })
  // Se o clique não vier (soltou fora de qualquer elemento clicável), o ouvinte
  // não pode ficar armado para o próximo clique de verdade.
  setTimeout(() => document.removeEventListener("click", engolir, { capture: true }), 0)
}

/** Bits de `compareDocumentPosition`, escritos aqui em vez de lidos de `Node`:
 *  a suíte roda em Node puro (sem jsdom), onde `Node` não existe. Valores da
 *  especificação do DOM, que não mudam. */
const PRECEDE = 2
const SEGUE = 4

/** De que lado do alvo o item vai cair.
 *
 *  Não é geometria do cursor: é a semântica de `reorderByIds`, que acha o
 *  índice do alvo na lista ORIGINAL e insere DEPOIS de remover a origem. Efeito
 *  prático: arrastando para baixo o item deposita DEPOIS do alvo, para cima
 *  deposita ANTES. A ordem no DOM espelha a ordem da lista, então
 *  `compareDocumentPosition` responde exatamente isso, sem a camada precisar
 *  conhecer as stores.
 *
 *  `null` quando não dá para saber (alvo que não é linha, origem sem elemento):
 *  aí nenhum traço aparece, porque traço no lado errado é pior que traço nenhum. */
export function ladoDoDestino(origem: Element | null, alvo: Element): "antes" | "depois" | null {
  if (!origem || origem === alvo) return null
  const rel = origem.compareDocumentPosition(alvo)
  if (rel & SEGUE) return "depois"
  if (rel & PRECEDE) return "antes"
  return null
}

function alvoSob(x: number, y: number): { alvo: AlvoDoArrasto; el: Element } | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-arrasto-alvo]")
  const alvo = alvoDoAtributo(el?.getAttribute("data-arrasto-alvo"))
  return alvo && el ? { alvo, el } : null
}

/** O que soltar no composer faz com o rascunho da conversa ativa. */
function soltarNoComposer(carga: CargaArrastada): void {
  const convId = useChat.getState().activeId
  if (!convId) {
    avisar.erro("Abra uma conversa para soltar aqui.")
    return
  }
  const app = useApp.getState()
  const projectPath = app.projects.find((p) => p.id === app.activeProjectId)?.path ?? null
  if (aceitaNaConversa(carga)) {
    // O arquivo da árvore segue o caminho do arquivo do Finder: imagem e PDF
    // viram anexo, o resto cartão (ADR-252).
    const caminhos = caminhosDaCarga(carga, projectPath).map((c) => c.caminho)
    void soltarCaminhos(caminhos).catch(() => avisar.erro("Não consegui usar os arquivos soltos."))
    return
  }
  const plano = planoDoArrasto(carga, projectPath)
  const drafts = useComposerDrafts.getState()
  if (plano.acao === "colagem") {
    drafts.addColagem(convId, plano.texto)
    return
  }
  if (plano.acao === "anexo" && carga.tipo === "imagem") {
    // A imagem já está no disco de anexos desta conversa: o rascunho aponta
    // para o MESMO arquivo, sem cópia. Teto de anexos e repetição decididos
    // pela regra de sempre.
    const atuais = drafts.byConv[convId]?.attachments ?? []
    const { anexos, coube } = anexosComOutro(atuais, carga.anexo as Attachment)
    if (!coube) {
      avisar.erro(`O rascunho já tem ${MAX_ATTACH_COUNT} anexos. Remova um para anexar esta imagem.`)
      return
    }
    drafts.setAttachments(convId, anexos)
    return
  }
  if (plano.acao === "texto") drafts.appendText(convId, plano.texto)
}

function soltarNaLinha(carga: CargaArrastada, alvoId: string): void {
  if (carga.tipo === "projeto") {
    useApp.getState().reorderProjects(carga.id, alvoId)
  } else if (carga.tipo === "conversa") {
    useChat.getState().reorderConversations(carga.projectId, carga.id, alvoId)
  }
}

/** O ponto está sobre o texto já selecionado? (as caixas do próprio Range) */
function pontoNaSelecao(selecao: Selection, x: number, y: number): boolean {
  for (let i = 0; i < selecao.rangeCount; i++) {
    const caixas = selecao.getRangeAt(i).getClientRects()
    for (const r of caixas) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
    }
  }
  return false
}

/** O fantasma de arquivo: ícone, nome e "+N", não o caminho inteiro. Puro. */
export function fantasmaDoArquivo(carga: CargaArrastada): { caminho: string; pasta: boolean; mais: number } | null {
  const itens = caminhosDaCarga(carga, null)
  return itens.length > 0 ? { ...itens[0], mais: itens.length - 1 } : null
}

export function CamadaDeArrasto() {
  const [fantasma, setFantasma] = useState<{ x: number; y: number; rotulo: string; carga: CargaArrastada } | null>(null)
  const [veu, setVeu] = useState<{ ret: RetanguloDoVeu; rotulo: string } | null>(null)
  const realcadoRef = useRef<Element | null>(null)
  const veuRef = useRef<string>("")

  useEffect(() => {
    function realcar(el: Element | null, lado: "antes" | "depois" | "" = "") {
      if (realcadoRef.current !== el) {
        realcadoRef.current?.removeAttribute("data-arrasto-sobre")
        realcadoRef.current = el
      }
      // O lado muda sem o alvo mudar (passar do topo para a base da mesma
      // linha não acontece hoje, mas trocar de origem no mesmo alvo sim), então
      // o atributo é reescrito mesmo quando o elemento é o mesmo.
      if (el) el.setAttribute("data-arrasto-sobre", lado)
    }
    /** O véu liga e desliga ao entrar e sair do alvo, não a cada movimento. */
    function mostrarVeu(proximo: { ret: RetanguloDoVeu; rotulo: string } | null) {
      const chave = proximo ? `${proximo.rotulo}|${proximo.ret.left}|${proximo.ret.top}|${proximo.ret.width}` : ""
      if (chave === veuRef.current) return
      veuRef.current = chave
      setVeu(proximo)
    }
    function limpar() {
      realcar(null)
      mostrarVeu(null)
      setFantasma(null)
      document.body.style.userSelect = ""
      const p = pendente
      pendente = null
      if (!p?.captor) return
      try {
        p.captor.releasePointerCapture(p.pointerId)
      } catch {
        /* já devolvido */
      }
    }
    // Fonte que não tem componente: a SELEÇÃO. Começar a arrastar de cima do
    // texto já selecionado leva o trecho; começar de fora dela é seleção nova,
    // como sempre foi.
    function aoApertar(ev: PointerEvent) {
      if (ev.button !== 0 || pendente || cargaArrastada()) return
      const alvo = ev.target instanceof Element ? ev.target : null
      if (!alvo?.closest("[data-selectable]") || alvo.closest("[data-composer-card]")) return
      const selecao = window.getSelection()
      const texto = selecao?.toString() ?? ""
      if (!selecao || selecao.isCollapsed || !texto.trim()) return
      if (!pontoNaSelecao(selecao, ev.clientX, ev.clientY)) return
      pendente = {
        carga: { tipo: "texto", id: `texto:${Date.now()}`, texto },
        rotulo: "Trecho selecionado",
        x: ev.clientX,
        y: ev.clientY,
        pointerId: ev.pointerId,
        captor: null,
      }
    }
    function mover(ev: PointerEvent) {
      const p = pendente
      if (!p) return
      const andou = Math.hypot(ev.clientX - p.x, ev.clientY - p.y) >= LIMIAR_DE_ARRASTO
      if (!cargaArrastada()) {
        if (!andou) return
        comecarArrasto(p.carga)
        // AGORA sim: virou arrasto, então o gesto precisa sobreviver ao ponteiro
        // sair da linha (ou da janela). Elemento que já saiu do DOM lança, e aí
        // o arrasto segue sem captura, que é o pior caso aceitável.
        try {
          p.captor?.setPointerCapture(p.pointerId)
        } catch {
          /* sem captura */
        }
        // Sem isto, arrastar sobre texto vira seleção no meio do gesto.
        document.body.style.userSelect = "none"
      }
      const sob = alvoSob(ev.clientX, ev.clientY)
      const naConversa = sob?.alvo.tipo === "composer" || sob?.alvo.tipo === "conversa"
      const rotulo = naConversa
        ? sob?.alvo.tipo === "conversa" && !aceitaNaConversa(p.carga)
          ? null
          : (rotuloDoArrasto(p.carga) ?? null)
        : p.rotulo
      const valido = Boolean(sob && rotulo)
      pairarSobre(valido && sob ? sob.alvo : null)
      const lado =
        valido && sob && sob.alvo.tipo === "reordenar"
          ? (ladoDoDestino(p.captor, sob.el) ?? "")
          : ""
      realcar(valido && sob ? sob.el : null, lado)
      // Arquivo acende a coluna inteira; texto e imagem, o composer.
      const cobre = valido && naConversa && sob ? (aceitaNaConversa(p.carga) ? (alvoDoVeu() ?? sob.el) : sob.el) : null
      const r = cobre?.getBoundingClientRect()
      mostrarVeu(r && rotulo ? { ret: { left: r.left, top: r.top, width: r.width, height: r.height }, rotulo } : null)
      setFantasma({ x: ev.clientX, y: ev.clientY, rotulo: rotulo ?? p.rotulo, carga: p.carga })
    }
    function soltar(ev: PointerEvent) {
      if (!pendente) return
      const arrastando = Boolean(cargaArrastada())
      const sob = arrastando ? alvoSob(ev.clientX, ev.clientY) : null
      limpar()
      if (!arrastando) return
      const feito = concluirArrasto(sob?.alvo ?? null)
      engolirProximoClique()
      if (!feito) return
      if (feito.alvo.tipo === "composer" || feito.alvo.tipo === "conversa") soltarNoComposer(feito.carga)
      else soltarNaLinha(feito.carga, feito.alvo.id)
    }
    function desistir(ev: KeyboardEvent) {
      if (ev.key !== "Escape" || !pendente) return
      limpar()
      cancelarArrasto()
    }
    document.addEventListener("pointerdown", aoApertar)
    document.addEventListener("pointermove", mover)
    document.addEventListener("pointerup", soltar)
    document.addEventListener("pointercancel", soltar)
    document.addEventListener("keydown", desistir)
    return () => {
      document.removeEventListener("pointerdown", aoApertar)
      document.removeEventListener("pointermove", mover)
      document.removeEventListener("pointerup", soltar)
      document.removeEventListener("pointercancel", soltar)
      document.removeEventListener("keydown", desistir)
      limpar()
      cancelarArrasto()
    }
  }, [])

  if (!fantasma) return null
  const arquivo = fantasmaDoArquivo(fantasma.carga)
  return (
    <>
      {veu && <VeuDeSoltura ret={veu.ret} rotulo={veu.rotulo} />}
      {createPortal(
        <div
          aria-live="polite"
          style={{ left: fantasma.x + 12, top: fantasma.y + 12 }}
          className="pointer-events-none fixed z-[200] flex max-w-72 items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-[12px] text-foreground shadow-[var(--shadow-pop)]"
        >
          {arquivo ? (
            <>
              <FileIcon path={arquivo.caminho} folder={arquivo.pasta} />
              <span className="truncate">{nomeDoCaminho(arquivo.caminho)}</span>
              {arquivo.mais > 0 && <span className="shrink-0 text-muted-foreground">+{arquivo.mais}</span>}
            </>
          ) : (
            <span className="truncate">{fantasma.rotulo}</span>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
