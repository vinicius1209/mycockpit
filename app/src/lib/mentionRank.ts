/**
 * O ranqueamento do "@" (frente N7, itens 1 e 2).
 *
 * O problema medido: o menu filtrava a lista CRUA por substring, na ordem do
 * disco. Digitar `@send` num repo grande devolvia tudo que tem "send" em
 * qualquer segmento do caminho — `docs/legacy/sender/README.md` antes de
 * `lib/fleet/send.ts`. Hoje o projeto inteiro não entra mais nesta lista: a
 * busca traz candidatos paginados e este índice ordena o conjunto quente.
 *
 * Duas mudanças, e as duas importam:
 *
 * 1. **Índice montado UMA vez** por lista (`indexarMencoes`): nome do arquivo,
 *    minúsculas e ordem original já resolvidos. O filtro por tecla passa a ser
 *    comparação de string pronta, não parsing.
 * 2. **Ranqueamento por comparador explícito**, não por peso mágico. A ordem é
 *    uma sequência de perguntas, cada uma testável:
 *
 *    | # | Pergunta | Por quê |
 *    |---|---|---|
 *    | 1 | casou onde? | NOME do arquivo vale mais que caminho: você digita o que quer abrir, não a pasta onde ele mora |
 *    | 2 | a conversa TOCOU este arquivo? | o que o agent acabou de mexer é o que você mais provavelmente vai mencionar em seguida |
 *    | 3 | que tipo é? | Especialista e Nota antes de Arquivo: são poucos e são seus |
 *    | 4 | qual é o mais curto? | `lib/send.ts` antes de `lib/legacy/v1/send.ts` |
 *    | 5 | quem veio antes? | desempate ESTÁVEL: sem ele a lista embaralha entre teclas |
 *
 * Nada aqui sabe de React, de Lexical ou de projeto: entra lista + consulta +
 * sinais, sai lista ordenada.
 */

export type KindDeMencao = "agent" | "nota" | "conversa" | "file"

export interface ItemDeMencao {
  value: string
  kind: KindDeMencao
}

export interface CandidatoIndexado extends ItemDeMencao {
  /** Nome do arquivo (o que vem depois da última barra). Para persona e nota é
   *  o próprio valor — eles não têm caminho. */
  base: string
  baseLower: string
  valueLower: string
  /** Posição na lista original: o desempate que impede a lista de embaralhar. */
  ordem: number
}

/** Onde a consulta casou. Menor é melhor; `NAO_CASOU` sai da lista. */
export const CLASSE = {
  nomeExato: 0,
  nomeComeca: 1,
  nomeContem: 2,
  caminhoContem: 3,
} as const

const NAO_CASOU = 99

const PESO_KIND: Record<KindDeMencao, number> = {
  agent: 0,
  nota: 1,
  conversa: 2,
  file: 3,
}

function nomeDe(value: string, kind: KindDeMencao): string {
  // A conversa casa pelo nome, não pelo `conversa/` que todas têm.
  if (kind === "conversa") return value.slice(value.indexOf("/") + 1)
  if (kind !== "file") return value
  const corte = value.lastIndexOf("/")
  return corte < 0 ? value : value.slice(corte + 1)
}

/**
 * Prepara a lista para as consultas seguintes.
 *
 * Chamar isto a cada tecla anula o ganho — quem usa memoiza por lista, não por
 * consulta.
 */
export function indexarMencoes(
  itens: readonly ItemDeMencao[],
): CandidatoIndexado[] {
  return itens.map((it, ordem) => {
    const base = nomeDe(it.value, it.kind)
    return {
      ...it,
      base,
      baseLower: base.toLowerCase(),
      // Na conversa o "caminho" é o próprio nome: o `conversa/` casaria tudo.
      valueLower: it.kind === "conversa" ? base.toLowerCase() : it.value.toLowerCase(),
      ordem,
    }
  })
}

/** Em que classe o candidato casa a consulta (já em minúsculas). */
export function classeDeCasamento(
  c: Pick<CandidatoIndexado, "baseLower" | "valueLower">,
  queryLower: string,
): number {
  if (c.baseLower === queryLower) return CLASSE.nomeExato
  if (c.baseLower.startsWith(queryLower)) return CLASSE.nomeComeca
  if (c.baseLower.includes(queryLower)) return CLASSE.nomeContem
  if (c.valueLower.includes(queryLower)) return CLASSE.caminhoContem
  return NAO_CASOU
}

export interface SinaisDeRank {
  /** Caminhos que a conversa tocou (tool calls). Sobem dentro da MESMA classe
   *  de casamento — nunca atravessam classe: relevância recente não compra
   *  qualidade de casamento. */
  tocados?: ReadonlySet<string>
}

/** Quantos de cada seção o "@" recém-aberto mostra. Sem cota, os arquivos que
 *  a conversa tocou enchiam o menu e as outras seções nem apareciam (numa
 *  conversa longa, só "Arquivos"). O resto das vagas vai para os arquivos. */
const COTA_SEM_CONSULTA: Record<Exclude<KindDeMencao, "file">, number> = { agent: 3, nota: 2, conversa: 4 }
/** O menu recém-aberto é um mapa das seções; ele rola. */
export const TETO_SEM_CONSULTA = 12

function semConsulta(
  indice: readonly CandidatoIndexado[],
  tocados: ReadonlySet<string> | undefined,
  teto: number,
): ItemDeMencao[] {
  let vagas = Math.max(teto, TETO_SEM_CONSULTA)
  const out: ItemDeMencao[] = []
  for (const kind of ["agent", "nota", "conversa"] as const) {
    const doKind = indice.filter((c) => c.kind === kind).slice(0, Math.min(COTA_SEM_CONSULTA[kind], vagas))
    out.push(...doKind.map((c) => ({ value: c.value, kind: c.kind })))
    vagas -= doKind.length
  }
  // Nos arquivos, o tocado sobe: é o único sinal que já existe antes da tecla.
  const arquivos = indice
    .filter((c) => c.kind === "file")
    .sort((a, b) => Number(!tocados?.has(a.value)) - Number(!tocados?.has(b.value)) || a.ordem - b.ordem)
  out.push(...arquivos.slice(0, vagas).map((c) => ({ value: c.value, kind: c.kind })))
  return out
}

/**
 * Filtra e ordena. Sem consulta, devolve a ordem original (o menu recém-aberto
 * não deve reordenar nada: você ainda não disse o que procura) — só com os
 * tocados promovidos, que é a única informação que já existe antes da primeira
 * tecla.
 */
export function rankearMencoes(
  indice: readonly CandidatoIndexado[],
  query: string | null | undefined,
  sinais: SinaisDeRank = {},
  teto = 8,
): ItemDeMencao[] {
  const tocados = sinais.tocados
  const q = (query ?? "").trim().toLowerCase()
  if (!q) return semConsulta(indice, tocados, teto)

  const comClasse = q
    ? indice
        .map((c) => ({ c, classe: classeDeCasamento(c, q) }))
        .filter((x) => x.classe !== NAO_CASOU)
    : indice.map((c) => ({ c, classe: CLASSE.nomeExato }))

  comClasse.sort((a, b) => {
    if (a.classe !== b.classe) return a.classe - b.classe
    const ta = tocados?.has(a.c.value) ? 0 : 1
    const tb = tocados?.has(b.c.value) ? 0 : 1
    if (ta !== tb) return ta - tb
    const ka = PESO_KIND[a.c.kind]
    const kb = PESO_KIND[b.c.kind]
    if (ka !== kb) return ka - kb
    if (a.c.value.length !== b.c.value.length) {
      return a.c.value.length - b.c.value.length
    }
    return a.c.ordem - b.c.ordem
  })

  return comClasse.slice(0, teto).map(({ c }) => ({ value: c.value, kind: c.kind }))
}

/** Chaves em que os motores põem caminho de arquivo no input da tool. São as
 *  mesmas que o `presentTool` já lê — os CLIs não combinaram um nome só. */
const CHAVES_DE_CAMINHO = [
  "path",
  "file_path",
  "filePath",
  "notebook_path",
  "target_file",
]

/**
 * Os arquivos que ESTA conversa tocou, em caminho relativo ao projeto.
 *
 * É o sinal que o ranqueamento usa pra promover o que o agent acabou de mexer.
 * Puro e barato: uma passada nos itens, olhando só as tool calls, sem regex no
 * texto (varrer prosa atrás de caminho traria falso positivo de qualquer
 * menção casual a um arquivo).
 *
 * Caminho absoluto é relativizado contra o projeto; o que estiver fora dele
 * sai — mencionar arquivo de fora da pasta não é o gesto desta feature.
 */
export function arquivosTocados(
  items: readonly { kind: string; input?: unknown }[],
  projectPath: string,
): Set<string> {
  const raiz = projectPath.endsWith("/") ? projectPath : `${projectPath}/`
  const out = new Set<string>()
  for (const it of items) {
    if (it.kind !== "tool" || !it.input || typeof it.input !== "object") continue
    const input = it.input as Record<string, unknown>
    for (const chave of CHAVES_DE_CAMINHO) {
      const v = input[chave]
      if (typeof v !== "string" || !v.trim()) continue
      if (v.startsWith(raiz)) out.add(v.slice(raiz.length))
      else if (!v.startsWith("/")) out.add(v.replace(/^\.\//, ""))
    }
  }
  return out
}
