// Citar outra conversa do projeto com "@" (F4, ADR-287). Núcleo puro, no
// idioma da menção de nota (`@nota/slug`): o endereço serializa no texto, o
// pill mostra o nome, e o envio resolve.
//
// O endereço é `conversa/<slug do título>-<8 do id>`. O rótulo sai do próprio
// valor (sobrevive ao rascunho recarregado, que remonta o pill só do texto), e
// o id resolve mesmo que a conversa seja renomeada depois.
//
// No envio a menção vira a moldura `<conversas-citadas>` com os ids, e a
// concessão que o MCP de contexto recebe sai DESSA moldura (`concessaoDoPrompt`):
// o agente pode ler exatamente o que o prompt diz que ele pode.

export const PREFIXO_CONVERSA = "conversa/"
/** "Todas as conversas deste projeto" (D13): só existe quando citado. */
export const CONVERSA_TODAS = `${PREFIXO_CONVERSA}todas`

export interface ConversaCitavel {
  id: string
  title: string | null
  updatedAt: number
}

export interface CitacaoDeConversas {
  ids: string[]
  todas: boolean
}

const LIMITE_SLUG = 40

function slug(titulo: string | null): string {
  const base = (titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITE_SLUG)
    .replace(/-+$/g, "")
  return base || "conversa"
}

const id8 = (id: string) => id.replace(/-/g, "").slice(0, 8).toLowerCase()

/** O endereço de uma conversa. Puro. */
export function enderecoDaConversa(c: ConversaCitavel): string {
  return `${PREFIXO_CONVERSA}${slug(c.title)}-${id8(c.id)}`
}

/** Os endereços do menu: "todas" primeiro, depois as do projeto por última
 *  atividade, sem a conversa aberta (ela o agente já lê). Puro. */
export function enderecosDeConversa(metas: readonly ConversaCitavel[], atual: string | null): string[] {
  const outras = metas.filter((m) => m.id !== atual).sort((a, b) => b.updatedAt - a.updatedAt)
  if (outras.length === 0) return []
  return [CONVERSA_TODAS, ...outras.map(enderecoDaConversa)]
}

/** O nome no pill e no menu: `conversa/refatorar-o-parser-1a2b3c4d` vira
 *  "refatorar o parser". Puro. */
export function rotuloDaConversa(value: string): string {
  if (value === CONVERSA_TODAS) return "Todas as conversas deste projeto"
  const sem = value.startsWith(PREFIXO_CONVERSA) ? value.slice(PREFIXO_CONVERSA.length) : value
  return sem.replace(/-[0-9a-f]{8}$/, "").replace(/-/g, " ").trim() || sem
}

const MENCAO = /@conversa\/([a-z0-9-]+)/g

/** As conversas citadas num texto, resolvidas pelo id; endereço que não
 *  resolve fica no texto e fora da concessão. Puro. */
export function conversasCitadas(
  texto: string,
  metas: readonly ConversaCitavel[],
): { conversas: ConversaCitavel[]; todas: boolean } {
  const conversas: ConversaCitavel[] = []
  let todas = false
  for (const [, resto] of texto.matchAll(MENCAO)) {
    if (resto === "todas") {
      todas = true
      continue
    }
    const sufixo = /-([0-9a-f]{8})$/.exec(resto)?.[1]
    const achada = sufixo ? metas.find((m) => id8(m.id) === sufixo) : undefined
    if (achada && !conversas.includes(achada)) conversas.push(achada)
  }
  return { conversas, todas }
}

/** O texto em pedaços, separando cada `@conversa/…` (a bolha desenha como
 *  chip com o nome). Puro. */
export function partesComConversas(texto: string): { texto: string; conversa: boolean }[] {
  const partes: { texto: string; conversa: boolean }[] = []
  let desde = 0
  for (const m of texto.matchAll(MENCAO)) {
    if (m.index > desde) partes.push({ texto: texto.slice(desde, m.index), conversa: false })
    partes.push({ texto: m[0], conversa: true })
    desde = m.index + m[0].length
  }
  if (desde < texto.length) partes.push({ texto: texto.slice(desde), conversa: false })
  return partes
}

const ABRE = "<conversas-citadas>"
const FECHA = "</conversas-citadas>"

/** A moldura que viaja no prompt. Diz o que o agente pode ler e com quais
 *  ferramentas; a lista de ids é também a concessão. Puro. */
export function blocoDeConversas(conversas: readonly ConversaCitavel[], todas: boolean): string | null {
  if (conversas.length === 0 && !todas) return null
  return [
    ABRE,
    "A pessoa citou conversas deste projeto para você consultar neste turno. Busque com",
    "context_search passando conversation (o id abaixo) e expanda os refs com context_read.",
    "Outras conversas não estão acessíveis.",
    ...conversas.map((c) => `- conversation: ${c.id} · ${c.title?.trim() || "sem título"}`),
    ...(todas ? ['- conversation: todas · todas as conversas deste projeto (busque com conversation: "todas")'] : []),
    FECHA,
  ].join("\n")
}

/** Compõe o prompt: a moldura antes do texto, que mantém os endereços (quem
 *  lê o fio depois vê o que foi citado). Puro. */
export function comporConversasNoPrompt(texto: string, metas: readonly ConversaCitavel[]): string {
  if (!texto.includes("@conversa/")) return texto
  const { conversas, todas } = conversasCitadas(texto, metas)
  const bloco = blocoDeConversas(conversas, todas)
  return bloco ? `${bloco}\n\n${texto}` : texto
}

/** A concessão do run, lida da moldura do prompt. `null` sem moldura. Puro. */
export function concessaoDoPrompt(prompt: string): CitacaoDeConversas | null {
  const inicio = prompt.indexOf(ABRE)
  if (inicio < 0) return null
  const fim = prompt.indexOf(FECHA, inicio)
  if (fim < 0) return null
  const ids: string[] = []
  let todas = false
  for (const [, id] of prompt.slice(inicio, fim).matchAll(/^- conversation: (\S+)/gm)) {
    if (id === "todas") todas = true
    else if (!ids.includes(id)) ids.push(id)
  }
  return { ids, todas }
}
