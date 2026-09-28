import { useCallback, useEffect, useRef, useState } from "react"
import { readText } from "@tauri-apps/plugin-clipboard-manager"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { avisar } from "@/lib/avisos"

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
import { copyRich, copyText } from "@/lib/clipboard"
import { conteudoDaTabela, lerTabela } from "@/lib/tabelaClipboard"
import { citarTrecho } from "@/lib/citarTrecho"
import { openConvImage, revealConvImage } from "@/lib/evidence"
import { abrirNoEditor } from "@/components/common/executarAcaoDeArquivo"
import { useApp } from "@/store/app"
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
  // O elemento da imagem clicada: "Copiar imagem" copia o bitmap que está na
  // tela, então precisa do <img>, não só da descrição dele.
  const imgRef = useRef<HTMLImageElement | null>(null)

  const aoAssumir = useCallback((e: MouseEvent) => {
    const { sonda, img } = sondar(e)
    const alvo = alvoDe(sonda)
    // Fora do Tauri (preview do e2e, browser puro) não há leitura de área de
    // transferência nem como revelar arquivo: o item some em vez de mentir.
    const noApp = isTauri()
    const linhas = itensPara(alvo, { colar: noApp, revelar: noApp })
    // Nada honesto a oferecer: o menu do motor já morreu, e menu vazio é pior
    // que menu ausente.
    if (!alvo || linhas.length === 0) return
    focoRef.current = salvarFoco()
    imgRef.current = img
    setEstado({ x: e.clientX, y: e.clientY, alvo, linhas })
  }, [])

  useEffect(
    () =>
      instalarGuardaDoMenuNativo({
        dev: import.meta.env.DEV,
        aoAssumir,
        // Campo de texto ganha de menu de container (ex.: o campo de renomear
        // que mora dentro da linha da conversa, na sidebar).
        prioritario: (e) =>
          sondarEditavel(e.target instanceof Element ? e.target : null) !== null,
      }),
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
              const img = imgRef.current
              // Depois do fechamento: o Radix ainda está desfazendo o próprio
              // gerenciamento de foco durante o `onSelect`, e a ação precisa
              // do cursor de volta no campo. O gesto do usuário sobrevive ao
              // salto (medido: `execCommand` de copy/cut/insertText continua
              // valendo dentro de `setTimeout(0)` no WKWebView).
              setTimeout(() => void executar(linha, alvo, foco, img), 0)
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

function sondar(e: MouseEvent): { sonda: Sonda; img: HTMLImageElement | null } {
  const el = e.target instanceof Element ? e.target : null
  const img = acharImagem(el)
  const arquivo = acharArquivo(el)
  return {
    img,
    sonda: {
      editavel: sondarEditavel(el),
      imagem: img ? descreverImagem(img) : null,
      arquivo,
      bloco: sondarBloco(el),
      selecao: (window.getSelection()?.toString() ?? "").trim(),
    },
  }
}

/**
 * O marcador do bloco de texto é o `data-selectable` que o app já usa pra
 * liberar seleção (index.html deixa o resto da UI não-selecionável). Reusar
 * evita um segundo marcador dizendo a mesma coisa, e pega de graça a bolha do
 * usuário, o markdown do agent e o detalhe do painel de contexto.
 */
function sondarBloco(el: Element | null): Sonda["bloco"] {
  const bloco = el?.closest<HTMLElement>("[data-selectable]")
  if (!bloco) return null
  const texto = (bloco.innerText ?? bloco.textContent ?? "").trim()
  if (!texto) return null
  const tabela = el?.closest("table")
  const comTabela = tabela && bloco.contains(tabela) ? { texto, tabela: lerTabela(tabela) } : { texto }
  // Citável só quando a seleção inteira mora na mensagem do clique (R3).
  const citavel = el?.closest<HTMLElement>("[data-citavel]")
  const sel = window.getSelection()
  const selecaoDentro = Boolean(
    citavel && sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode &&
      citavel.contains(sel.anchorNode) && citavel.contains(sel.focusNode),
  )
  return selecaoDentro && citavel?.dataset.citavel ? { ...comTabela, citavel: citavel.dataset.citavel } : comTabela
}

function acharImagem(el: Element | null): HTMLImageElement | null {
  if (el instanceof HTMLImageElement) return el
  // Clique na moldura (o botão que abre o lightbox) também vale como clique
  // na imagem.
  const caixa = el?.closest<HTMLElement>("[data-ctx-imagem]")
  return caixa?.querySelector("img") ?? null
}

function descreverImagem(img: HTMLImageElement): Sonda["imagem"] {
  // Sem bitmap decodificado não há o que copiar (SVG sem tamanho intrínseco,
  // imagem quebrada): melhor não oferecer alvo nenhum.
  if (!img.naturalWidth || !img.naturalHeight) return null
  const caixa = img.closest<HTMLElement>("[data-ctx-imagem]")
  const path = caixa?.dataset.ctxImagem
  return { path: path || null, nome: img.alt || "imagem" }
}

function acharArquivo(el: Element | null): Sonda["arquivo"] {
  const caixa = el?.closest<HTMLElement>("[data-ctx-arquivo]")
  if (!caixa) return null
  const rel = caixa.dataset.ctxArquivo
  if (!rel) return null
  const abs = caixa.dataset.ctxArquivoAbs || undefined
  const lineRaw = caixa.dataset.ctxArquivoLinha
  const line = lineRaw ? parseInt(lineRaw, 10) : null
  return { rel, abs, line: line && !isNaN(line) && line > 0 ? line : null }
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

async function executar(
  id: ItemId,
  alvo: Alvo,
  foco: FocoSalvo | null,
  img: HTMLImageElement | null,
) {
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
      if (alvo.tipo === "bloco" || alvo.tipo === "arquivo") await copyText(alvo.selecao)
      else if (alvo.tipo === "selecao") await copyText(alvo.texto)
      return

    case "copiar-bloco":
      if (alvo.tipo === "bloco" || alvo.tipo === "arquivo") await copyText(alvo.texto)
      return

    case "citar-trecho":
      if (alvo.tipo === "bloco" && alvo.citavel) citarTrecho(alvo.citavel, alvo.selecao)
      return

    case "copiar-tabela-planilha":
    case "copiar-tabela-markdown":
      if (alvo.tipo !== "bloco" || !alvo.tabela) return
      await copyRich(
        conteudoDaTabela(alvo.tabela, id === "copiar-tabela-planilha" ? "planilha" : "markdown"),
        id === "copiar-tabela-planilha" ? "Tabela copiada para planilha" : "Tabela copiada como Markdown",
      )
      return

    case "copiar-imagem":
      await copiarImagem(img)
      return

    case "abrir-imagem":
      if (alvo.tipo !== "imagem" || !alvo.path) return
      await openConvImage(alvo.path).catch((err) => {
        console.error("[menu] não consegui abrir a imagem", err)
        avisar.erro("Não consegui abrir no app padrão (o arquivo ainda existe?)")
      })
      return

    case "revelar-imagem":
      if (alvo.tipo !== "imagem" || !alvo.path) return
      await revealConvImage(alvo.path).catch((err) => {
        console.error("[menu] não consegui mostrar a imagem na pasta", err)
        avisar.erro("Não consegui mostrar na pasta (o arquivo ainda existe?)")
      })
      return

    case "abrir-arquivo": {
      if (alvo.tipo !== "arquivo") return
      const state = useApp.getState()
      const projectPath = state.projects.find((p) => p.id === state.activeProjectId)?.path ?? ""
      await abrirNoEditor(projectPath, alvo.rel, alvo.line)
      return
    }

    case "copiar-caminho-relativo": {
      if (alvo.tipo !== "arquivo") return
      const texto = alvo.line ? `${alvo.rel}:${alvo.line}` : alvo.rel
      await copyText(texto)
      avisar.feito("Caminho relativo copiado")
      return
    }

    case "copiar-caminho-absoluto": {
      if (alvo.tipo !== "arquivo") return
      const base = alvo.abs || alvo.rel
      const texto = alvo.line ? `${base}:${alvo.line}` : base
      await copyText(texto)
      avisar.feito(`Caminho de ${base.split("/").pop() || base} copiado.`)
      return
    }

    case "revelar-arquivo": {
      if (alvo.tipo !== "arquivo" || !alvo.abs) return
      await revealItemInDir(alvo.abs).catch((err) => {
        console.error("[menu] não consegui mostrar na pasta", err)
        avisar.erro("Não consegui mostrar na pasta (o arquivo ainda existe?)")
      })
      return
    }

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
        avisar.erro("Não consegui ler a área de transferência")
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

/**
 * Copia o bitmap que está na tela. Passa por canvas porque a área de
 * transferência do WebKit só aceita `image/png` (medido: com o blob direto o
 * write resolve; com jpeg/webp ele recusaria), e porque assim a cópia sai na
 * resolução natural do arquivo, não no tamanho do thumbnail.
 */
async function copiarImagem(img: HTMLImageElement | null) {
  if (!img?.naturalWidth) return
  try {
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("sem contexto 2d")
    ctx.drawImage(img, 0, 0)
    const png = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, "image/png"),
    )
    if (!png) throw new Error("canvas não devolveu PNG")
    // O blob vai DIRETO: no WebKit, ClipboardItem com Promise é recusado com
    // NotAllowedError (medido em 14/08/2026).
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
    avisar.feito("Imagem copiada")
  } catch (err) {
    console.error("[menu] não consegui copiar a imagem", err)
    avisar.erro("Não consegui copiar a imagem")
  }
}
