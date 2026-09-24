// As abas do painel principal de cada CONVERSA (ADR-243, ADR-244; mock
// aprovado em docs/mocks/abas-de-arquivo-persistentes.html).
//
// Pedido de 24/09/2026: "quando eu saio do foco ou eu volto para a conversa,
// ele fecha". A aba do arquivo era UMA e passageira. Agora o que você abre fica
// aberto até você fechar e sobrevive a reabrir o app.
//
// E é da conversa, não do projeto (ADR-244, no mesmo dia): "se eu estou na aba
// do navegador e troco de conversa, a aba do navegador continua a mesma". Cada
// conversa tem a própria tira (arquivos, o do lado, o Navegador e o que estava
// à vista), e trocar de conversa, ou de projeto, troca a tira inteira. Isso
// também fecha uma fresta: o arquivo lê a worktree da conversa, e com abas do
// projeto a mesma aba mostrava outro conteúdo ao trocar de conversa.
//
// Tudo aqui é puro: quem guarda é `store/abasDeArquivo.ts`, quem decide a vista
// é o `mainTab` de `store/app.ts`, e quem liga os dois à conversa ativa é
// `components/layout/abasNoPrincipal.ts`.

/**
 * A chave de cada aba na tira. Arquivo aberto para LER é o próprio caminho
 * (relativo à raiz da conversa, ou absoluto se veio de fora dela). As
 * ALTERAÇÕES de um arquivo, abertas pelo painel do git, são outra aba, com
 * prefixo (pedido de 24/09/2026: "abri um arquivo pelo menu de alterações do
 * git e ao voltar pra conversa ele sumiu"). O prefixo começa com NUL, que não
 * existe em caminho, então não há como colidir com um arquivo de verdade
 * (ADR-248).
 */
const PREFIXO_DO_DIFF = "\u0000diff:"

export function chaveDoDiff(caminho: string): string {
  return PREFIXO_DO_DIFF + caminho
}

export function lerChave(chave: string): { tipo: "arquivo" | "diff"; caminho: string } {
  return chave.startsWith(PREFIXO_DO_DIFF)
    ? { tipo: "diff", caminho: chave.slice(PREFIXO_DO_DIFF.length) }
    : { tipo: "arquivo", caminho: chave }
}

export interface AbasDaConversa {
  /** Chaves (`chaveDoDiff` / caminho), na ordem da tira. */
  abertas: string[]
  /** A aba (chave) à vista quando se saiu da conversa; `null` = outra aba. */
  vista: string | null
  /** O arquivo aberto ao lado da conversa, se houver. Sempre um dos abertos. */
  aoLado: string | null
  /** A aba Navegador na tira desta conversa, e se era ela a que estava à vista. */
  navegador: "fechado" | "aberto" | "a-vista"
}

export const SEM_ABAS: AbasDaConversa = { abertas: [], vista: null, aoLado: null, navegador: "fechado" }

/** Quantas fechadas o ⌘⇧T lembra, por conversa. */
export const MEMORIA_DE_FECHADAS = 20

export function abrirAba(a: AbasDaConversa, caminho: string): AbasDaConversa {
  if (a.abertas.includes(caminho)) return a
  return { ...a, abertas: [...a.abertas, caminho] }
}

/** Quem vai à vista quando a aba à vista fecha: a da direita, senão a da
 *  esquerda, senão a Conversa (`null`). Igual às IDEs. */
export function vizinhaAoFechar(abertas: readonly string[], caminho: string): string | null {
  const i = abertas.indexOf(caminho)
  if (i < 0) return null
  return abertas[i + 1] ?? abertas[i - 1] ?? null
}

/** Fecha um conjunto de abas. `aoLado` sai junto se foi fechado. */
export function fecharAbas(a: AbasDaConversa, fechar: readonly string[]): AbasDaConversa {
  if (fechar.length === 0) return a
  const saem = new Set(fechar)
  return {
    ...a,
    abertas: a.abertas.filter((c) => !saem.has(c)),
    vista: a.vista && saem.has(a.vista) ? null : a.vista,
    aoLado: a.aoLado && saem.has(a.aoLado) ? null : a.aoLado,
  }
}

/** Os caminhos que "Fechar as outras" / "Fechar as da direita" levam. */
export function outrasAlemDe(abertas: readonly string[], caminho: string): string[] {
  return abertas.filter((c) => c !== caminho)
}
export function aDireitaDe(abertas: readonly string[], caminho: string): string[] {
  const i = abertas.indexOf(caminho)
  return i < 0 ? [] : abertas.slice(i + 1)
}

export function moverAba(a: AbasDaConversa, de: number, para: number): AbasDaConversa {
  if (de === para || de < 0 || para < 0 || de >= a.abertas.length || para >= a.abertas.length) return a
  const abertas = [...a.abertas]
  const [item] = abertas.splice(de, 1)
  abertas.splice(para, 0, item)
  return { ...a, abertas }
}

/** Empilha as fechadas (a mais recente por último), sem repetir e com teto. */
export function lembrarFechadas(pilha: readonly string[], fechadas: readonly string[]): string[] {
  const sem = pilha.filter((c) => !fechadas.includes(c))
  return [...sem, ...fechadas].slice(-MEMORIA_DE_FECHADAS)
}

function nomeDe(caminho: string): string {
  return caminho.split("/").pop() || caminho
}

/**
 * O rótulo de cada aba: o nome do arquivo, e a pasta de cima quando dois
 * abertos têm o mesmo nome ("AGENTS.md · chat"). Se a pasta de cima também
 * empata, sobe mais um nível até diferenciar. Puro.
 */
export function rotulosDasAbas(chaves: readonly string[]): Map<string, { nome: string; pasta: string | null }> {
  // O mesmo arquivo aberto para ler e nas alterações não é "nome repetido":
  // o ícone já diferencia as duas abas.
  const caminhos = [...new Set(chaves.map((c) => lerChave(c).caminho))]
  const porNome = new Map<string, string[]>()
  for (const c of caminhos) porNome.set(nomeDe(c), [...(porNome.get(nomeDe(c)) ?? []), c])
  const porCaminho = new Map<string, { nome: string; pasta: string | null }>()
  for (const [nome, mesmos] of porNome) {
    if (mesmos.length === 1) {
      porCaminho.set(mesmos[0], { nome, pasta: null })
      continue
    }
    const pastas = mesmos.map((c) => c.split("/").slice(0, -1))
    let niveis = 1
    const maximo = Math.max(...pastas.map((p) => p.length))
    const sufixo = (p: string[]) => p.slice(-niveis).join("/")
    while (niveis < maximo && new Set(pastas.map(sufixo)).size < mesmos.length) niveis++
    mesmos.forEach((c, i) => porCaminho.set(c, { nome, pasta: sufixo(pastas[i]) || "raiz" }))
  }
  return new Map(chaves.map((c) => [c, porCaminho.get(lerChave(c).caminho) ?? { nome: c, pasta: null }]))
}

/** A vista na ordem da tira: `null` é a Conversa, que é sempre a primeira. */
export function abaVizinha(
  abertas: readonly string[],
  atual: string | null,
  passo: 1 | -1,
): string | null {
  const ordem: (string | null)[] = [null, ...abertas]
  const i = Math.max(0, ordem.indexOf(atual))
  return ordem[(i + passo + ordem.length) % ordem.length]
}

/** Nada aberto além da Conversa: não precisa ser guardado. Puro. */
export function semNada(a: AbasDaConversa): boolean {
  return a.abertas.length === 0 && a.navegador === "fechado" && a.vista === null && a.aoLado === null
}
