/**
 * Núcleo PURO do texto de uma nota (Frente N, story N2).
 *
 * A regra do desenho A é "a primeira linha da nota vira título, o resto vira
 * preview de uma linha". Isso não pode virar formatação na marra dentro do JSX
 * por dois motivos que já custaram caro neste app:
 *
 *   1. a regra tem casos de borda de verdade (nota vazia, nota de uma linha só,
 *      nota que começa com `# ` ou com `- [ ]`), e caso de borda escondido em
 *      JSX é caso de borda não testado;
 *   2. a MESMA regra é usada em dois lugares (a linha da lista e o cabeçalho da
 *      folha). Duas cópias divergem; uma função pura, não.
 *
 * O que esta função NÃO faz: renderizar markdown. Ela DESCASCA a decoração pra
 * produzir texto de rótulo. Quem quer markdown de verdade continua chamando o
 * `Markdown` no corpo da folha.
 */

import type { StickyNote } from "@/components/notes/types"

/** O que a lista escreve quando a nota ainda não tem uma letra.
 *  Nota recém-criada nasce vazia e em edição: mentir um título ("Nova nota")
 *  faria a lista inventar conteúdo que não existe. */
export const TITULO_VAZIO = "Nota sem texto"

/** Tetos de corte. A coluna da lista tem 214px e o CSS já elide com `…`; estes
 *  limites existem pra não jogar uma nota de 40 KB dentro de um nó de texto que
 *  nunca vai ser lido. */
export const LIMITE_TITULO = 120
export const LIMITE_PREVIEW = 160

export interface TituloEPreview {
  /** Primeira linha com conteúdo, sem decoração de markdown. */
  titulo: string
  /** Todo o resto colapsado em UMA linha. Vazio quando a nota tem uma linha só. */
  preview: string
  /** Nota sem nenhum caractere útil (só espaço, ou só decoração). */
  vazia: boolean
}

/** Decoração de INÍCIO de linha: cabeçalho, item de lista, citação, checkbox.
 *  O marcador exige espaço OU fim de linha de propósito: sem o espaço a regra
 *  comeria a primeira estrela de `*ênfase*`; sem o fim de linha, um `#` sozinho
 *  (a linha em branco que o editor deixou) viraria o título da nota. */
const DECORACAO_DE_LINHA =
  /^\s*(?:#{1,6}(?:\s+|$)|[-*+](?:\s+|$)|>\s*|\d+[.)]\s+|\[[ xX]\]\s+)/

/** Marcas de ênfase inline. Some o marcador, fica a palavra. */
const ENFASE = /(\*\*|__|~~|\*|_|`)/g

/** Regra horizontal (`---`, `***`, `___`) sozinha na linha: separador, não
 *  texto. Sem isto, a nota que começa com `---` ganhava o título literal
 *  "---" — a lista escrevendo a decoração em vez do conteúdo. `***` e `___`
 *  já caíam pela ênfase; o traço não tinha quem o descascasse. */
const REGRA_HORIZONTAL = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

/** Descasca uma linha até virar rótulo. O laço existe porque a decoração
 *  EMPILHA na vida real (`> - [ ] conferir o log`). */
function limparLinha(linha: string): string {
  if (REGRA_HORIZONTAL.test(linha)) return ""
  let s = linha
  for (let i = 0; i < 4 && DECORACAO_DE_LINHA.test(s); i++) {
    s = s.replace(DECORACAO_DE_LINHA, "")
  }
  return s.replace(ENFASE, "").trim()
}

function cortar(texto: string, limite: number): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite).trimEnd()}…`
}

/**
 * Título e preview de um conteúdo de nota.
 *
 * @param content texto cru da nota (pode ser vazio, pode ter markdown)
 */
export function tituloEPreview(content: string): TituloEPreview {
  const linhas = (content ?? "")
    .split("\n")
    .map(limparLinha)
    .filter((l) => l.length > 0)

  if (linhas.length === 0) {
    return { titulo: TITULO_VAZIO, preview: "", vazia: true }
  }

  const [primeira, ...resto] = linhas
  return {
    titulo: cortar(primeira, LIMITE_TITULO),
    preview: cortar(resto.join(" ").replace(/\s+/g, " ").trim(), LIMITE_PREVIEW),
    vazia: false,
  }
}

export interface FolhaDaNota {
  /** Primeira linha com conteúdo, descascada — o TÍTULO da folha. */
  titulo: string
  /** Tudo o que vem depois, **cru**: a folha renderiza markdown de verdade,
   *  então aqui não se descasca nada. Vazio quando a nota tem uma linha só. */
  corpo: string
  vazia: boolean
}

/**
 * O mesmo "primeira linha é o título" da lista, agora para a FOLHA.
 *
 * A diferença que justifica a segunda função em vez de um parâmetro: a lista
 * quer o resto COLAPSADO numa linha de preview, a folha quer o resto INTACTO
 * (com quebras, listas, código). Colapsar na folha seria destruir a nota pra
 * caber num lugar que não tem essa restrição.
 */
export function folhaDaNota(content: string): FolhaDaNota {
  const linhas = (content ?? "").split("\n")
  const iTitulo = linhas.findIndex((l) => limparLinha(l).length > 0)
  if (iTitulo === -1) return { titulo: "", corpo: "", vazia: true }
  return {
    titulo: cortar(limparLinha(linhas[iTitulo]), LIMITE_TITULO),
    corpo: linhas
      .slice(iTitulo + 1)
      .join("\n")
      .replace(/^\s*\n/, "")
      .trimEnd(),
    vazia: false,
  }
}

/** Normaliza pra busca: sem acento, minúsculo, sem borda em branco.
 *  "migracao" tem que achar "migração" — quem digita numa caixa de busca de
 *  214px não vai parar pra acentuar. */
export function normalizarBusca(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Filtra a lista por texto. Busca no conteúdo E no `title` opcional (o campo
 * existe no tipo desde sempre e algumas notas persistidas o têm).
 *
 * Termo vazio devolve a lista inteira — a busca FILTRA, não navega, então sem
 * termo não há o que filtrar.
 */
export function filtrarPorBusca<T extends Pick<StickyNote, "content" | "title">>(
  notas: readonly T[],
  termo: string,
): T[] {
  const alvo = normalizarBusca(termo)
  if (!alvo) return [...notas]
  return notas.filter((n) =>
    normalizarBusca(`${n.title ?? ""}\n${n.content ?? ""}`).includes(alvo),
  )
}

/**
 * POR QUE a lista está vazia. Três estados diferentes que a gaveta pintava com
 * a MESMA frase, e duas delas eram mentira sobre o estado: com 20 notas e uma
 * busca por "zzz", a folha dizia "Nenhuma nota ainda" ao lado da coluna que
 * dizia, certo, "Nenhuma nota com esse texto".
 *
 * "Não existe nota" e "a busca não achou" não podem compartilhar empty state:
 * o primeiro convida a criar, os outros dois convidam a DESFAZER o recorte.
 *
 * @param total notas do escopo, ANTES da busca e do filtro (o universo).
 */
export type MotivoDeVazio = "sem-notas" | "busca" | "filtro"

export function motivoDeVazio({
  total,
  busca,
  filtroAtivo,
}: {
  total: number
  busca: string
  filtroAtivo: boolean
}): MotivoDeVazio {
  if (total === 0) return "sem-notas"
  // Busca vence filtro quando os dois estão ligados: o termo é o gesto que a
  // pessoa acabou de fazer, e os chips de filtro estão à vista logo acima.
  if (normalizarBusca(busca)) return "busca"
  if (filtroAtivo) return "filtro"
  // Universo cheio, nenhum recorte ligado e nada na tela não deveria existir.
  // Se acontecer, "sem-notas" é o único texto que não promete um gesto que
  // não desfaz nada.
  return "sem-notas"
}

/** A copy dos três vazios, em UM lugar: a folha e a coluna da lista dizem a
 *  mesma coisa sobre o mesmo estado (era exatamente o que divergia). */
export const COPY_DE_VAZIO: Record<
  MotivoDeVazio,
  { titulo: string; dica: string; curto: string }
> = {
  "sem-notas": {
    titulo: "Nenhuma nota ainda",
    dica: "Deixe pensamentos, snippets e lembretes anotados para usar quando quiser no prompt.",
    curto: "Nenhuma nota ainda.",
  },
  busca: {
    titulo: "Nenhuma nota com esse texto",
    dica: "A busca não achou nada. Suas notas continuam aqui.",
    curto: "Nenhuma nota com esse texto.",
  },
  filtro: {
    titulo: "Nenhuma nota neste filtro",
    dica: "O filtro por agente escondeu as outras. Volte para \"Todas\" para ver tudo.",
    curto: "Nenhuma nota neste filtro.",
  },
}
