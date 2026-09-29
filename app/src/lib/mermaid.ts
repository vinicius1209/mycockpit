// Mermaid no fio e nas notas (F6, ADR-284). A lib é pesada, então entra por
// import dinâmico só quando um bloco aparece: vira chunk próprio e o bundle
// principal não cresce. Tema com os tokens do app, rótulos em SVG puro (sem
// HTML dentro do SVG) para "Copiar imagem" desenhar no canvas.

type Mermaid = (typeof import("mermaid"))["default"]

let carregando: Promise<Mermaid> | null = null
let temaAplicado: string | null = null
let seq = 0

/** A linha do erro na mensagem do Mermaid ("Parse error on line 3:"). Puro. */
export function linhaDoErro(mensagem: string): number | null {
  const m = /line (\d+)/i.exec(mensagem)
  return m ? Number(m[1]) : null
}

/** O que dizer além da linha. O erro de sintaxe ("Parse error on line 3:")
 *  vem com eco do código e a lista de tokens do parser, que não ajuda quem lê:
 *  a linha basta, e a mensagem crua fica na dica. Outro erro ("No diagram
 *  type detected…") diz a primeira linha. Puro. */
export function resumoDoErro(mensagem: string): string | null {
  const primeira = mensagem.split("\n")[0].trim()
  if (!primeira || /^parse error on line \d+/i.test(primeira)) return null
  return primeira
}

/** As cores do tema a partir dos tokens do app, lidos na hora (claro ou
 *  escuro). `ler` devolve o valor da variável CSS. Puro. */
export function variaveisDoTema(ler: (nome: string) => string) {
  const v = (nome: string, reserva: string) => ler(nome).trim() || reserva
  const fundo = v("--card", "#ffffff")
  const texto = v("--foreground", "#16181b")
  const suave = v("--muted-foreground", "#5c6166")
  const aresta = v("--border-strong", "rgba(0,0,0,.14)")
  const destaque = v("--secondary", "#f4f4f2")
  return {
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif",
    fontSize: "13px",
    background: fundo,
    primaryColor: fundo,
    primaryTextColor: texto,
    primaryBorderColor: aresta,
    secondaryColor: destaque,
    tertiaryColor: destaque,
    lineColor: suave,
    textColor: texto,
    mainBkg: fundo,
    nodeBorder: aresta,
    clusterBkg: destaque,
    clusterBorder: aresta,
    edgeLabelBackground: fundo,
    noteBkgColor: destaque,
    noteBorderColor: aresta,
    noteTextColor: texto,
    actorBkg: fundo,
    actorBorder: aresta,
    actorTextColor: texto,
    signalColor: suave,
    signalTextColor: texto,
  }
}

function carregar(): Promise<Mermaid> {
  carregando ??= import("mermaid").then((m) => m.default)
  return carregando
}

/** O SVG do diagrama. Lança com a mensagem do parser se não compila. */
export async function desenharMermaid(fonte: string): Promise<string> {
  const mermaid = await carregar()
  const estilo = getComputedStyle(document.documentElement)
  const tema = variaveisDoTema((nome) => estilo.getPropertyValue(nome))
  const chave = JSON.stringify(tema)
  if (chave !== temaAplicado) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: tema,
      htmlLabels: false,
    })
    temaAplicado = chave
  }
  await mermaid.parse(fonte)
  const { svg } = await mermaid.render(`frota-mermaid-${++seq}`, fonte)
  return svg
}

/** O SVG em PNG, na escala pedida, com o fundo do cartão (colar em documento
 *  sem fundo transparente). */
export async function svgParaPng(svg: string, escala = 2): Promise<Uint8Array> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
  const raiz = doc.documentElement
  const caixa = raiz.getAttribute("viewBox")?.split(/[\s,]+/).map(Number)
  const largura = caixa?.[2] || Number.parseFloat(raiz.getAttribute("width") ?? "") || 800
  const altura = caixa?.[3] || Number.parseFloat(raiz.getAttribute("height") ?? "") || 600
  raiz.setAttribute("width", String(largura))
  raiz.setAttribute("height", String(altura))
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(raiz))}`
  const img = new Image()
  await new Promise<void>((ok, falha) => {
    img.onload = () => ok()
    img.onerror = () => falha(new Error("o SVG do diagrama não abriu como imagem"))
    img.src = url
  })
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(largura * escala)
  canvas.height = Math.ceil(altura * escala)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("canvas indisponível")
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(escala, escala)
  ctx.drawImage(img, 0, 0, largura, altura)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"))
  if (!blob) throw new Error("o canvas não gerou o PNG")
  return new Uint8Array(await blob.arrayBuffer())
}
