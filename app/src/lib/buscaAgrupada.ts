// A busca de arquivos agrupada (ADR-254, mock
// `docs/mocks/arvore-env-e-busca-agrupada.html`, variante A).
//
// A busca mostrava só o NOME do arquivo, numa lista corrida. Com a pasta
// `projetos` aberta (40 projetos), "config" trazia dez `tsconfig.json` iguais,
// sem dizer de qual projeto era cada um, e doze `vite.config.ts.timestamp-…`
// gerados em sequência. Agora os resultados se agrupam pela pasta de primeiro
// nível, com a contagem; até cinco por grupo e "mais N"; os gerados com o
// mesmo começo viram uma linha "N parecidos". Com um grupo só, não há o que
// agrupar: fica a lista, com o caminho à direita.
//
// Puro: o painel guarda o que está aberto e só pinta estas linhas.

/** Arquivos visíveis por grupo antes do "mais N". */
export const POR_GRUPO = 5
/** A partir de quantos nomes com o mesmo começo gerado viram "parecidos". */
const MINIMO_DE_PARECIDOS = 3

export interface EntradaDaBusca {
  relPath: string
  name: string
}

export type LinhaDaBusca<E extends EntradaDaBusca> =
  | { tipo: "grupo"; chave: string; nome: string; total: number; aberto: boolean }
  | { tipo: "arquivo"; entrada: E; onde: string }
  | { tipo: "mais"; grupo: string; quantos: number }
  | { tipo: "parecidos"; chave: string; modelo: string; quantos: number; entrada: E; onde: string }

export interface EstadoDaBusca {
  /** Grupos recolhidos pelo gesto da pessoa. */
  recolhidos: ReadonlySet<string>
  /** Grupos em que ela pediu "mais N". */
  inteiros: ReadonlySet<string>
  /** Linhas de parecidos que ela abriu. */
  parecidosAbertos: ReadonlySet<string>
}

export const ESTADO_INICIAL: EstadoDaBusca = {
  recolhidos: new Set(),
  inteiros: new Set(),
  parecidosAbertos: new Set(),
}

/** O nome com a parte gerada (sequência longa de dígitos ou hex) trocada por
 *  "…": `vite.config.ts.timestamp-1777853494596-f71e01b9.mjs` e o vizinho
 *  viram o mesmo modelo. Nome sem parte gerada devolve ele mesmo. */
export function modeloDoNome(nome: string): string {
  return nome.replace(/[0-9a-f]*\d[0-9a-f]{7,}/gi, "…").replace(/…(?:[-_.]…)+/g, "…")
}

function grupoDe(relPath: string): string {
  const i = relPath.indexOf("/")
  return i < 0 ? "" : relPath.slice(0, i)
}

/** A pasta do arquivo dentro do grupo ("src/lib"), vazia quando mora na raiz dele. */
function ondeNoGrupo(relPath: string, grupo: string): string {
  const semGrupo = grupo ? relPath.slice(grupo.length + 1) : relPath
  const i = semGrupo.lastIndexOf("/")
  return i < 0 ? "" : semGrupo.slice(0, i)
}

/** Dentro de um grupo: os nomes gerados parecidos viram uma linha só, no
 *  lugar do primeiro deles. */
function comParecidos<E extends EntradaDaBusca>(
  itens: E[],
  grupo: string,
  abertos: ReadonlySet<string>,
): LinhaDaBusca<E>[] {
  const porModelo = new Map<string, E[]>()
  for (const e of itens) {
    const m = modeloDoNome(e.name)
    if (m === e.name) continue
    porModelo.set(m, [...(porModelo.get(m) ?? []), e])
  }
  const linhas: LinhaDaBusca<E>[] = []
  const vistos = new Set<string>()
  for (const e of itens) {
    const m = modeloDoNome(e.name)
    const irmaos = porModelo.get(m)
    const chave = `${grupo}::${m}`
    if (irmaos && irmaos.length >= MINIMO_DE_PARECIDOS && !abertos.has(chave)) {
      if (vistos.has(m)) continue
      vistos.add(m)
      linhas.push({ tipo: "parecidos", chave, modelo: m, quantos: irmaos.length, entrada: e, onde: ondeNoGrupo(e.relPath, grupo) })
      continue
    }
    linhas.push({ tipo: "arquivo", entrada: e, onde: ondeNoGrupo(e.relPath, grupo) })
  }
  return linhas
}

/**
 * As linhas da busca, na ordem da tela. Grupos na ordem em que o primeiro
 * resultado de cada um chegou (a relevância da busca decide), e dentro deles
 * a mesma ordem. `nomeDaRaiz` rotula o que mora na raiz do projeto.
 */
export function linhasDaBusca<E extends EntradaDaBusca>(
  entradas: readonly E[],
  estado: EstadoDaBusca,
  nomeDaRaiz: string,
): LinhaDaBusca<E>[] {
  const grupos = new Map<string, E[]>()
  for (const e of entradas) {
    const g = grupoDe(e.relPath)
    grupos.set(g, [...(grupos.get(g) ?? []), e])
  }
  if (grupos.size <= 1) {
    // Um grupo só: não há o que agrupar, fica a lista com o caminho.
    return entradas.map((e) => ({ tipo: "arquivo" as const, entrada: e, onde: ondeNoGrupo(e.relPath, "") }))
  }
  const linhas: LinhaDaBusca<E>[] = []
  for (const [chave, itens] of grupos) {
    const aberto = !estado.recolhidos.has(chave)
    linhas.push({ tipo: "grupo", chave, nome: chave || nomeDaRaiz, total: itens.length, aberto })
    if (!aberto) continue
    const doGrupo = comParecidos(itens, chave, estado.parecidosAbertos)
    // Abrir os parecidos é pedir para ver: o grupo aparece inteiro, senão o
    // que acabou de abrir cairia atrás do "mais N".
    const inteiro =
      estado.inteiros.has(chave) || [...estado.parecidosAbertos].some((k) => k.startsWith(`${chave}::`))
    const mostradas = inteiro ? doGrupo : doGrupo.slice(0, POR_GRUPO)
    linhas.push(...mostradas)
    const restantes = doGrupo.length - mostradas.length
    if (restantes > 0) linhas.push({ tipo: "mais", grupo: chave, quantos: restantes })
  }
  return linhas
}

/** Onde a busca casou no nome, para marcar o trecho. Sem casar, tudo liso. */
export function trechosDoNome(nome: string, busca: string): { texto: string; casou: boolean }[] {
  // A busca casa termos separados por espaço, e "/pasta/" é escopo, não nome:
  // destaca o primeiro termo que aparece no nome.
  const minusculo = nome.toLocaleLowerCase("pt-BR")
  const termos = busca.toLocaleLowerCase("pt-BR").split(/\s+/).filter((t) => t && !t.startsWith("/"))
  const q = termos.find((t) => minusculo.includes(t)) ?? ""
  const i = q ? minusculo.indexOf(q) : -1
  if (i < 0) return [{ texto: nome, casou: false }]
  return [
    { texto: nome.slice(0, i), casou: false },
    { texto: nome.slice(i, i + q.length), casou: true },
    { texto: nome.slice(i + q.length), casou: false },
  ].filter((t) => t.texto)
}

/** Liga ou desliga uma chave num conjunto, sem mutar o original. */
export function alternar(conjunto: ReadonlySet<string>, chave: string): Set<string> {
  const novo = new Set(conjunto)
  if (novo.has(chave)) novo.delete(chave)
  else novo.add(chave)
  return novo
}
