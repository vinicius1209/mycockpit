import { useCallback, useEffect, useRef, useState } from "react"
import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { toast } from "sonner"

import {
  PointMenu,
  PointMenuItem,
  PointMenuSeparator,
} from "@/components/ui/context-menu"
import {
  alvoDe,
  DIVISOR,
  itensPara,
  ROTULOS,
  type Alvo,
  type ItemId,
  type LinhaMenu,
  type Sonda,
} from "@/lib/contextMenu"
import { instalarGuardaDoMenuNativo } from "@/lib/nativeMenu"
import { copyText } from "@/lib/clipboard"
import { isTauri } from "@/lib/db"

/**
 * O menu de contexto do app (ADR-042). Um host só, montado na raiz: o botão
 * direito é NOSSO em qualquer lugar, inclusive dentro de portais (dialog,
 * popover) que não descendem de trigger nenhum. Superfícies com menu próprio
 * (sidebar, onboarding) continuam com o delas e ganham na frente, porque o
 * Radix já marcou o evento como tratado quando o clique chega aqui.
 */
export function AppContextMenu() {
  const [estado, setEstado] = useState<{
    x: number
    y: number
    alvo: Alvo
    linhas: LinhaMenu[]
  } | null>(null)
  const focoRef = useRef<FocoSalvo | null>(null)

  const aoAssumir = useCallback((e: MouseEvent) => {
    const alvo = alvoDe(sondar(e))
    // Fora do Tauri (preview do e2e, browser puro) não há leitura de área de
    // transferência nem como revelar arquivo: o item some em vez de mentir.
    const noApp = isTauri()
    const linhas = itensPara(alvo, { colar: noApp, revelar: noApp })
    // Nada honesto a oferecer: o menu do motor já morreu, e menu vazio é pior
    // que menu ausente.
    if (!alvo || linhas.length === 0) return
    focoRef.current = salvarFoco()
    setEstado({ x: e.clientX, y: e.clientY, alvo, linhas })
  }, [])

  useEffect(
    () => instalarGuardaDoMenuNativo({ dev: import.meta.env.DEV, aoAssumir }),
    [aoAssumir],
  )

  if (!estado) return null
  const { x, y, alvo, linhas } = estado

  return (
    <PointMenu
      // Remonta a cada clique: o Radix ancora na montagem, então reaproveitar
      // a instância deixaria o menu preso na posição do clique anterior.
      key={`${x}:${y}`}
      x={x}
      y={y}
      open
      onOpenChange={(aberto) => {
        if (!aberto) setEstado(null)
      }}
    >
      {linhas.map((linha, i) =>
        linha === DIVISOR ? (
          <PointMenuSeparator key={`d${i}`} />
        ) : (
          <PointMenuItem
            key={linha}
            onSelect={() => {
              const foco = focoRef.current
              // Depois do fechamento: o Radix ainda está desfazendo o próprio
              // gerenciamento de foco durante o `onSelect`, e a ação precisa
              // do cursor de volta no campo. O gesto do usuário sobrevive ao
              // salto (medido: `execCommand` de copy/cut/insertText continua
              // valendo dentro de `setTimeout(0)` no WKWebView).
              setTimeout(() => void executar(linha, alvo, foco), 0)
            }}
          >
            {ROTULOS[linha]}
          </PointMenuItem>
        ),
      )}
    </PointMenu>
  )
}

// ── Sondagem do DOM ─────────────────────────────────────────────────────────

/** `input` que não carrega texto: ali o botão direito não tem o que oferecer. */
const TIPOS_SEM_TEXTO = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "range",
  "color",
  "image",
])

function sondar(e: MouseEvent): Sonda {
  const el = e.target instanceof Element ? e.target : null
  return {
    editavel: sondarEditavel(el),
    imagem: null,
    mensagem: null,
    selecao: (window.getSelection()?.toString() ?? "").trim(),
  }
}

function sondarEditavel(el: Element | null): Sonda["editavel"] {
  const campo = el?.closest<HTMLElement>(
    "input, textarea, [contenteditable='true'], [contenteditable='']",
  )
  if (!campo) return null

  if (campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) {
    if (campo instanceof HTMLInputElement && TIPOS_SEM_TEXTO.has(campo.type)) {
      return null
    }
    return {
      senha: campo instanceof HTMLInputElement && campo.type === "password",
      somenteLeitura: campo.readOnly || campo.disabled,
      temSelecao: campo.selectionStart !== campo.selectionEnd,
      temConteudo: campo.value.length > 0,
    }
  }

  // contenteditable (o composer do Lexical mora aqui)
  const sel = window.getSelection()
  return {
    senha: false,
    somenteLeitura: campo.getAttribute("contenteditable") === "false",
    temSelecao: Boolean(
      sel && !sel.isCollapsed && sel.anchorNode && campo.contains(sel.anchorNode),
    ),
    temConteudo: (campo.textContent ?? "").length > 0,
  }
}

// ── Foco e seleção ──────────────────────────────────────────────────────────
//
// Abrir o menu tira o foco do campo (o Radix leva pro conteúdo do menu, que é
// o certo pro teclado). Cortar/Colar/Selecionar tudo agem sobre o campo, então
// o host guarda elemento E seleção antes de abrir, e devolve os dois na hora
// de executar. Sem isso, "Cortar" cortaria o nada.

type FocoSalvo = {
  el: HTMLElement
  inicio: number | null
  fim: number | null
  range: Range | null
}

function salvarFoco(): FocoSalvo | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return null
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { el, inicio: el.selectionStart, fim: el.selectionEnd, range: null }
  }
  const sel = window.getSelection()
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null
  return { el, inicio: null, fim: null, range }
}

function restaurarFoco(foco: FocoSalvo | null) {
  if (!foco) return
  foco.el.focus({ preventScroll: true })
  if (
    foco.inicio !== null &&
    (foco.el instanceof HTMLInputElement || foco.el instanceof HTMLTextAreaElement)
  ) {
    foco.el.setSelectionRange(foco.inicio, foco.fim)
    return
  }
  if (foco.range) {
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(foco.range)
  }
}

// ── Execução ────────────────────────────────────────────────────────────────

async function executar(id: ItemId, alvo: Alvo, foco: FocoSalvo | null) {
  switch (id) {
    case "cortar":
      restaurarFoco(foco)
      document.execCommand("cut")
      return

    case "copiar":
      // Em campo editável a cópia é do campo (preserva a seleção exata do
      // usuário); fora dele, é o texto que estava selecionado na tela.
      if (alvo.tipo === "editavel") {
        restaurarFoco(foco)
        document.execCommand("copy")
        return
      }
      if (alvo.tipo === "mensagem") await copyText(alvo.selecao)
      else if (alvo.tipo === "selecao") await copyText(alvo.texto)
      return

    case "selecionar-tudo":
      restaurarFoco(foco)
      document.execCommand("selectAll")
      return

    case "colar": {
      let texto: string
      try {
        texto = await readText()
      } catch (err) {
        // ADR-017: quem clicou em "Colar" espera resultado; engolir aqui
        // deixaria o menu parecendo quebrado sem dizer por quê.
        console.error("[menu] não consegui ler a área de transferência", err)
        toast.error("Não consegui ler a área de transferência")
        return
      }
      if (!texto) return
      restaurarFoco(foco)
      document.execCommand("insertText", false, texto)
      return
    }

    default:
      return
  }
}
