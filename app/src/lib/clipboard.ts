import { toast } from "sonner"

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
    await navigator.clipboard.writeText(text)
    toast.success(label)
    return true
  } catch {
    toast.error("Não consegui copiar")
    return false
  }
}

export interface ConteudoRico {
  plain: string
  html?: string
}

/** `ClipboardItem` com os dois formatos. Sem HTML, é só texto. */
async function escreverItem(c: ConteudoRico): Promise<boolean> {
  if (!c.html) {
    await navigator.clipboard.writeText(c.plain)
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
 *  Toast de sucesso ou de erro, como `copyText`. */
export async function copyRich(conteudo: ConteudoRico, label = "Copiado"): Promise<boolean> {
  if (!conteudo.plain.trim()) return false
  let ok = false
  try {
    ok = await escreverItem(conteudo)
  } catch {
    ok = false
  }
  if (!ok) {
    try {
      ok = copiarPorEvento(conteudo)
    } catch {
      ok = false
    }
  }
  if (ok) toast.success(label)
  else toast.error("Não consegui copiar")
  return ok
}
