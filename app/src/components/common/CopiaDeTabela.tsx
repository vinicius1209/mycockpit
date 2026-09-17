// Seleção que cruza uma tabela do fio sai como planilha (capricho PRD R2,
// C-T2), e clique duplo numa célula seleciona o conteúdo dela.
//
// Um ouvinte de `copy` único, montado na raiz: só age quando a seleção começa
// e termina dentro da MESMA tabela de um bloco selecionável. Fora disso (texto
// comum, bloco de código, seleção que sai da tabela) a cópia do motor segue
// intocada.

import { useEffect } from "react"
import { conteudoDaTabela, recorteDaSelecao, textoDaCelula } from "@/lib/tabelaClipboard"

function tabelaDe(no: Node | null): HTMLTableElement | null {
  const el = no instanceof Element ? no : (no?.parentElement ?? null)
  const tabela = el?.closest("table") ?? null
  return tabela?.closest("[data-selectable]") ? tabela : null
}

function aoCopiar(e: ClipboardEvent) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !e.clipboardData) return
  const tabela = tabelaDe(sel.anchorNode)
  if (!tabela || tabela !== tabelaDe(sel.focusNode)) return
  const trs = Array.from(tabela.querySelectorAll("tr"))
  const linhas = trs.map((tr) =>
    Array.from(tr.querySelectorAll("th,td")).map((c) => ({
      texto: textoDaCelula(c.textContent ?? ""),
      selecionada: sel.containsNode(c, true),
    })),
  )
  const primeira = trs[0]
  const cabecalho = Boolean(primeira?.querySelector("th") && !primeira.querySelector("td"))
  const recorte = recorteDaSelecao(linhas, cabecalho)
  if (!recorte) return
  const { plain, html } = conteudoDaTabela(recorte, "planilha")
  e.preventDefault()
  e.clipboardData.setData("text/plain", plain)
  if (html) e.clipboardData.setData("text/html", html)
}

function aoClicarDuasVezes(e: MouseEvent) {
  const el = e.target instanceof Element ? e.target : null
  const celula = el?.closest<HTMLTableCellElement>("td,th")
  if (!celula || !tabelaDe(celula)) return
  const range = document.createRange()
  range.selectNodeContents(celula)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function CopiaDeTabela() {
  useEffect(() => {
    document.addEventListener("copy", aoCopiar)
    document.addEventListener("dblclick", aoClicarDuasVezes)
    return () => {
      document.removeEventListener("copy", aoCopiar)
      document.removeEventListener("dblclick", aoClicarDuasVezes)
    }
  }, [])
  return null
}
