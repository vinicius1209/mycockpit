// COPIAR — a porta única de escrita na área de transferência.
//
// A escrita é NATIVA (plugin do Tauri), e não `navigator.clipboard`, porque a
// do WebView depende de estado do WebView: gesto do clique ainda válido,
// documento focado, main thread respondendo. Durante um turno do agente a
// thread está renderizando o stream, e o botão de copiar do bloco de código
// falhava com "Não consegui copiar" até o turno acabar. Copiar não tem nada a
// ver com o turno; o acoplamento era o caminho, não o gesto.
//
// A LEITURA já era nativa (`readText` em `AppContextMenu`). Isto encerra o
// desencontro de ter dois donos para o mesmo gesto.
//
// Fora do Tauri (teste, browser puro) cai no `navigator.clipboard`, que lá é o
// único caminho que existe.

import { writeImage as writeImageNativo, writeText as writeTextNativo } from "@tauri-apps/plugin-clipboard-manager"
import { avisar } from "@/lib/avisos"

import { isTauri } from "@/lib/db"

/** Por que a cópia falhou, para o log. O `DOMException` traz o nome que
 *  distingue "documento sem foco" de "API indisponível", e engolir isso foi o
 *  que fez este bug durar: a pessoa via "não consegui" e mais nada. */
function motivo(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

function falhou(onde: string, e: unknown): false {
  console.error(`[clipboard] ${onde} falhou · ${motivo(e)}`)
  avisar.erro("Não consegui copiar")
  return false
}

/** Escreve texto puro pelo caminho nativo; fora do Tauri, pelo WebView. */
async function escreverTexto(texto: string): Promise<void> {
  if (isTauri()) return writeTextNativo(texto)
  await navigator.clipboard.writeText(texto)
}

/** Copia texto pra área de transferência + toast "copiado". Reusado por
 *  blocos de código, tabelas e blockquotes no render do chat. Silencioso se
 *  não houver texto; erra com toast discreto se o clipboard falhar. */
export async function copyText(
  text: string,
  label = "Copiado",
): Promise<boolean> {
  const s = text.trim()
  if (!s) return false
  try {
    await escreverTexto(text)
    avisar.feito(label)
    return true
  } catch (e) {
    return falhou("copyText", e)
  }
}

/** Copia uma imagem PNG (os bytes do arquivo) + toast. Nativo no app; fora
 *  dele, `ClipboardItem`. */
export async function copyImage(png: Uint8Array, label = "Imagem copiada"): Promise<boolean> {
  try {
    if (isTauri()) await writeImageNativo(png)
    else await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([png as BlobPart], { type: "image/png" }) })])
    avisar.feito(label)
    return true
  } catch (e) {
    return falhou("copyImage", e)
  }
}

export interface ConteudoRico {
  plain: string
  html?: string
}

/** `ClipboardItem` com os dois formatos. Sem HTML, é só texto. */
async function escreverItem(c: ConteudoRico): Promise<boolean> {
  if (!c.html) {
    await escreverTexto(c.plain)
    return true
  }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([c.plain], { type: "text/plain" }),
      "text/html": new Blob([c.html], { type: "text/html" }),
    }),
  ])
  return true
}

/** Fallback medido no WebKit: o evento `copy` do `execCommand` aceita os dois
 *  formatos em `clipboardData` quando a escrita assíncrona não existe. */
function copiarPorEvento(c: ConteudoRico): boolean {
  let escreveu = false
  const aoCopiar = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.preventDefault()
    e.clipboardData.setData("text/plain", c.plain)
    if (c.html) e.clipboardData.setData("text/html", c.html)
    escreveu = true
  }
  document.addEventListener("copy", aoCopiar)
  try {
    return document.execCommand("copy") && escreveu
  } finally {
    document.removeEventListener("copy", aoCopiar)
  }
}

/** Copia texto e, quando houver, HTML (tabela para planilha e documento).
 *  Toast de sucesso ou de erro, como `copyText`.
 *
 *  O HTML só existe no WebView: o plugin nativo escreve texto. Então a ordem é
 *  `ClipboardItem` → evento `copy` → texto nativo. O último é degradação
 *  DECLARADA: a tabela vai como Markdown em vez de formatada, e isso é melhor
 *  do que não copiar nada durante um turno. */
export async function copyRich(conteudo: ConteudoRico, label = "Copiado"): Promise<boolean> {
  if (!conteudo.plain.trim()) return false
  let ok = false
  let ultimoErro: unknown = null
  try {
    ok = await escreverItem(conteudo)
  } catch (e) {
    ultimoErro = e
    ok = false
  }
  if (!ok) {
    try {
      ok = copiarPorEvento(conteudo)
    } catch (e) {
      ultimoErro = e
      ok = false
    }
  }
  if (!ok && conteudo.html) {
    // Último recurso: o texto, pelo caminho que não depende do WebView.
    try {
      await escreverTexto(conteudo.plain)
      avisar.feito("Copiado como texto")
      return true
    } catch (e) {
      ultimoErro = e
    }
  }
  if (ok) {
    avisar.feito(label)
    return true
  }
  return falhou("copyRich", ultimoErro)
}
