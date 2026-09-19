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
import { toast } from "sonner"
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
import { planoDoArrasto, rotuloDoArrasto } from "@/lib/soltura"
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

function alvoSob(x: number, y: number): { alvo: AlvoDoArrasto; el: Element } | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-arrasto-alvo]")
  const alvo = alvoDoAtributo(el?.getAttribute("data-arrasto-alvo"))
  return alvo && el ? { alvo, el } : null
}

/** O que soltar no composer faz com o rascunho da conversa ativa. */
function soltarNoComposer(carga: CargaArrastada): void {
  const convId = useChat.getState().activeId
  if (!convId) {
    toast.error("Abra uma conversa para soltar aqui.")
    return
  }
  const plano = planoDoArrasto(carga)
  const drafts = useComposerDrafts.getState()
  if (plano.acao === "colagem") drafts.addColagem(convId, plano.texto)
  else if (plano.acao !== "nada") drafts.appendText(convId, plano.texto)
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

export function CamadaDeArrasto() {
  const [fantasma, setFantasma] = useState<{ x: number; y: number; rotulo: string } | null>(null)
  const realcadoRef = useRef<Element | null>(null)

  useEffect(() => {
    function realcar(el: Element | null) {
      if (realcadoRef.current === el) return
      realcadoRef.current?.removeAttribute("data-arrasto-sobre")
      if (el) el.setAttribute("data-arrasto-sobre", "")
      realcadoRef.current = el
    }
    function limpar() {
      realcar(null)
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
      const rotulo =
        sob?.alvo.tipo === "composer" ? (rotuloDoArrasto(p.carga) ?? null) : p.rotulo
      const valido = Boolean(sob && rotulo)
      pairarSobre(valido && sob ? sob.alvo : null)
      realcar(valido && sob ? sob.el : null)
      setFantasma({ x: ev.clientX, y: ev.clientY, rotulo: rotulo ?? p.rotulo })
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
      if (feito.alvo.tipo === "composer") soltarNoComposer(feito.carga)
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
  return createPortal(
    <div
      aria-live="polite"
      style={{ left: fantasma.x + 12, top: fantasma.y + 12 }}
      className="pointer-events-none fixed z-[200] max-w-72 truncate rounded-md border bg-popover px-2 py-1 text-[12px] text-foreground shadow-[var(--shadow-pop)]"
    >
      {fantasma.rotulo}
    </div>,
    document.body,
  )
}
