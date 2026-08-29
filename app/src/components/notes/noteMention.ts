/**
 * A nota chega no agente pelo "@" — núcleo PURO (frente N5).
 *
 * O problema que isto fecha: até aqui `targetAgent` prometia entrega e
 * entregava filtro de lista. A nota só alcançava o agente pelo botão que colava
 * o texto no rascunho, sem moldura e sem vínculo — depois de colado, virava
 * texto solto que ninguém sabia de onde veio.
 *
 * O desenho: a nota vira um **endereço mencionável** (`@nota/slug`), no mesmo
 * idioma dos arquivos do projeto (`@src/lib/agents.ts`) que o composer já tem.
 * No envio, o endereço é trocado pelo CONTEÚDO ATUAL da nota, dentro de uma
 * moldura que diz de quem é e o que é — a mesma que `lib/notes.ts` já usa para
 * as notas do fio.
 *
 * Três decisões que o formato carrega:
 *
 * 1. **Slug, não título cru.** O matcher do "@" quebra o token em espaço e em
 *    `:` (`AT_PUNCTUATION` no `LexicalComposer`), então "Runbook da migração"
 *    viraria três menções quebradas. `/` sobrevive de propósito (é o que
 *    permite `@src/lib/...`), e é o separador que usamos.
 * 2. **O conteúdo é resolvido no ENVIO, não na inserção.** Você menciona, edita
 *    a nota, manda: vai a versão nova. Colar o texto no rascunho congelaria uma
 *    cópia que envelhece em silêncio.
 * 3. **Menção que não resolve NÃO é apagada.** Nota renomeada ou apagada deixa
 *    o `@nota/slug` visível no prompt em vez de sumir. O agente lê um endereço
 *    que não achou — que é a verdade — em vez de receber um texto a menos sem
 *    ninguém notar.
 */

import { tituloEPreview } from "@/components/notes/noteText"
import type { StickyNote } from "@/components/notes/types"

/** O prefixo que separa nota de arquivo no menu do "@". */
export const PREFIXO_NOTA = "nota/"

/** Teto do slug: endereço é para ser lido e clicado, não para carregar a nota
 *  inteira no meio do prompt. */
export const LIMITE_SLUG = 48

/**
 * Título → endereço estável e digitável: sem acento, minúsculo, hífens no lugar
 * de tudo que não for letra ou número.
 *
 * Nota sem título utilizável cai em `nota` puro — quem desempata é o sufixo de
 * id que `slugsDeNotas` acrescenta.
 */
export function slugDeTitulo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITE_SLUG)
    .replace(/-+$/g, "")
  return base || "nota"
}

/**
 * Endereço de cada nota, único dentro da lista.
 *
 * Duas notas com o mesmo título são comuns ("Runbook" hoje, "Runbook" ontem) e
 * um endereço ambíguo mandaria a nota errada — sem erro, sem aviso. O desempate
 * é um sufixo curto do id, e ele só aparece em quem colidiu: o caso comum
 * continua com o endereço limpo.
 */
export function slugsDeNotas(notas: readonly StickyNote[]): Map<string, string> {
  const usados = new Map<string, number>()
  const porId = new Map<string, string>()
  for (const nota of notas) {
    const base = slugDeTitulo(tituloEPreview(nota.content).titulo)
    const vistos = usados.get(base) ?? 0
    usados.set(base, vistos + 1)
    porId.set(nota.id, vistos === 0 ? base : `${base}-${nota.id.slice(0, 4)}`)
  }
  return porId
}

/** Item do menu do "@" (o `value` é o que serializa no texto). */
export interface ItemDeNota {
  value: string
  titulo: string
}

export function itensDeNota(notas: readonly StickyNote[]): ItemDeNota[] {
  const slugs = slugsDeNotas(notas)
  return notas.map((n) => ({
    value: `${PREFIXO_NOTA}${slugs.get(n.id)}`,
    titulo: tituloEPreview(n.content).titulo,
  }))
}

/** O endereço pronto pra colar no rascunho (o que o botão da nota insere). */
export function mencaoDaNota(
  nota: StickyNote,
  notas: readonly StickyNote[],
): string {
  return `@${PREFIXO_NOTA}${slugsDeNotas(notas).get(nota.id) ?? slugDeTitulo(tituloEPreview(nota.content).titulo)}`
}

/**
 * O endereço vira rótulo de novo: `nota/ver-o-log-do-dia-26` → "ver o log do
 * dia 26".
 *
 * Tem que ser derivável do VALOR sozinho, e não de um título carregado ao lado,
 * porque o pill é reconstruído a partir do TEXTO do rascunho (o `DraftSync` lê
 * `@x` e remonta a menção): qualquer dado extra se perde nessa volta, e o pill
 * apareceria diferente depois de recarregar a conversa.
 *
 * Não é o título original de volta — é o slug legível. Perfeito seria guardar o
 * título, e guardar o título é justamente o que não sobrevive ao round-trip.
 */
export function rotuloDaMencao(value: string): string {
  const sem = value.startsWith(PREFIXO_NOTA) ? value.slice(PREFIXO_NOTA.length) : value
  return sem.replace(/-/g, " ").trim() || sem
}

/** `@nota/<slug>` no texto. O `/` está no conjunto porque o slug o usa como
 *  separador; espaço e pontuação terminam o endereço. */
const MENCAO = /@nota\/([a-z0-9/-]+)/g

/**
 * As notas endereçadas num texto, na ordem em que aparecem e sem repetir.
 *
 * Endereço que não resolve é ignorado AQUI (a menção fica no texto, ver a
 * decisão 3 no topo): esta função responde "quais notas existem", não "o que
 * fazer com o que não existe".
 */
export function notasMencionadas(
  texto: string,
  notas: readonly StickyNote[],
): StickyNote[] {
  const slugs = slugsDeNotas(notas)
  const porSlug = new Map<string, StickyNote>()
  for (const n of notas) {
    const s = slugs.get(n.id)
    if (s) porSlug.set(s, n)
  }
  const achadas: StickyNote[] = []
  const vistos = new Set<string>()
  for (const [, slug] of texto.matchAll(MENCAO)) {
    const nota = porSlug.get(slug)
    if (!nota || vistos.has(nota.id)) continue
    vistos.add(nota.id)
    achadas.push(nota)
  }
  return achadas
}

/**
 * A moldura que viaja com a nota.
 *
 * Mesmo idioma do `notesBlock` de `lib/notes.ts` — e pelo mesmo motivo: a nota
 * precisa chegar marcada como DIREÇÃO do humano, não como fala a ser respondida
 * como conversa. Sem a moldura ela se dilui no meio do prompt.
 */
export function blocoDeNotas(notas: readonly StickyNote[]): string | null {
  if (notas.length === 0) return null
  const corpos = notas.map((n) => {
    const { titulo } = tituloEPreview(n.content)
    return `- ${titulo}\n  ${n.content.trim().split("\n").join("\n  ")}`
  })
  return [
    "<notas-do-usuario>",
    "Anotações que o usuário endereçou a este turno pelo bloco de notas. São",
    "DIREÇÃO dele, não falas a responder: leve em conta no que vier a seguir.",
    ...corpos,
    "</notas-do-usuario>",
  ].join("\n")
}

export interface PromptComNotas {
  prompt: string
  /** Ids entregues — quem chama carimba o estado (uma nota entregue não volta
   *  sozinha no turno seguinte). */
  ids: string[]
}

/**
 * Compõe o prompt final: bloco das notas endereçadas, depois o texto do humano.
 *
 * O endereço PERMANECE no texto de propósito. Ele é a marca de que a nota veio
 * dali — no fio e no transcript, quem lê depois vê o que foi mencionado, e o
 * bloco logo acima diz o que aquilo continha na hora.
 */
export function comporNotasNoPrompt(
  texto: string,
  notas: readonly StickyNote[],
): PromptComNotas {
  const mencionadas = notasMencionadas(texto, notas)
  const bloco = blocoDeNotas(mencionadas)
  if (!bloco) return { prompt: texto, ids: [] }
  return {
    prompt: `${bloco}\n\n---\n\n${texto}`,
    ids: mencionadas.map((n) => n.id),
  }
}
