// Resumo de um CONJUNTO de tool calls (o burst do fio): o cabeçalho do grupo, a
// contagem honesta e a duração congelada. Separado do `toolview` porque a
// pergunta é outra: lá é "como esta ação se apresenta", aqui é "o que este
// conjunto diz de uma linha só" (ADR-037: o resumo recolhido passa a SER a
// informação).

import { presentTool, type ToolEmphasis, type ToolView } from "@/lib/toolview"

export interface ToolActivityInput {
  name: string
  input: unknown
  result?: { ok: boolean; interrupted?: true } | null
  /** Nascimento da ação (epoch ms) — alimenta a duração congelada do grupo. */
  ts?: number
  /** Último evento observável da ação. Ausente em histórico antigo. */
  activityAt?: number
  /** `tool_use_id` do provider: a âncora da correlação com nós sintéticos. */
  toolId?: string | null
  /** Trabalho diferido que ESTE nó apresenta (o nó sintético do reducer):
   *  `toolUseId` aponta pro `toolId` do `tool_use` que o pariu. */
  deferred?: { id: string; toolUseId?: string | null } | null
}

/** Identidade da ENTIDADE de trabalho que um nó apresenta.
 *
 *  Um `tool_use` (Agent/Workflow) e o nó sintético `DeferredWork` que ele pariu
 *  são O MESMO trabalho: `deferred.toolUseId` é o `toolId` da origem, então os
 *  dois devolvem a mesma chave. É essa chave que decide posse de nome e
 *  contagem — nome é propriedade da ENTIDADE, não da string, e comparar rótulo
 *  foi justamente o remendo que vazou (docs/fio-poluicao-2.md, B1/B2).
 *
 *  `null` = nó sem correlação conhecida (histórico antigo, adapter que não
 *  reporta `tool_use_id`): conta como entidade própria e NUNCA herda posse
 *  (fail-open, o nome continua aparecendo). */
export function workKey(
  t: Pick<ToolActivityInput, "toolId" | "deferred">,
): string | null {
  const d = t.deferred
  if (d) return `work:${d.toolUseId ?? d.id}`
  return t.toolId ? `work:${t.toolId}` : null
}

export interface ToolGroupView {
  label: string
  emphasis: ToolEmphasis
  /** `stopped`: alguma ação parou por um corte seu (ADR-180), sem falhar. */
  state: "running" | "ok" | "error" | "recorded" | "stopped"
}

/** Quantos TRABALHOS distintos o conjunto contém (não quantos nós). Um
 * `tool_use` e o `DeferredWork` que ele pariu são UM: contar nó dava
 * "2 delegações concluídas" para um trabalho só, e contagem sem fonte única é
 * proibida (STYLEGUIDE §7). Nó sem chave conta como trabalho próprio. */
function countWorks(tools: readonly ToolActivityInput[]): number {
  const seen = new Set<string>()
  let works = 0
  for (const t of tools) {
    const key = workKey(t)
    if (key == null) {
      works++
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    works++
  }
  return works
}

/** A ação numa frase só, para CABEÇALHO (trabalho único, culpada, parada). O
 *  rótulo de sempre vale: a narração do agente nomeia melhor uma culpada do que
 *  o comando ("Gerar PDF (iPhone SE)" contra "node probe.mjs"). A exceção é a
 *  tool genérica, cujo rótulo era a constante "Executar ferramenta": ali a
 *  frase é verbo + objeto, que é o único jeito de dizer O QUE rodou. */
export function fraseDaAcao(v: ToolView): string {
  if (v.kind !== "generic" || !v.object) return v.label
  const o = v.object
  const alvo =
    o.kind === "file" ? `${o.path.split("/").pop()}${o.range ? ` ${o.range}` : ""}` : o.text
  return `${v.verb} ${alvo}${o.mais ? ` +${o.mais}` : ""}`
}

/** Nome do trabalho quando o grupo inteiro é UM só: o primeiro nó que sabe
 * nomeá-lo. A tool de origem nem sempre sabe (o `Workflow` do provider cai no
 * balde genérico); quem carrega o nome humano nesse caso é o nó sintético. Sem
 * isso o marco recolhido esqueceria O QUE rodou, que é a "amnésia do
 * histórico" da auditoria. */
function soleWorkLabel(views: readonly ToolView[]): string {
  return fraseDaAcao(views.find((v) => v.kind !== "generic" || v.category === "coordinate") ?? views[0])
}

/** Pretérito de cada verbo da linha: [verbo, singular, plural, conta por].
 *  `arquivo` conta arquivos DISTINTOS (ler o mesmo arquivo em três trechos é
 *  ler um arquivo); `vez` conta chamadas; `frase` não conta, só diz. A ordem é a
 *  da frase: mudança primeiro, porque é o que a pessoa mais precisa saber. */
const PRETERITO: ReadonlyArray<[string[], string, string, string, "arquivo" | "vez" | "frase"]> = [
  [["Editar"], "editou", "arquivo", "arquivos", "arquivo"],
  [["Criar"], "criou", "arquivo", "arquivos", "arquivo"],
  [["Testar"], "rodou", "teste", "testes", "vez"],
  [["Rodar"], "rodou", "comando", "comandos", "vez"],
  [["Processo", "Iniciar processo"], "iniciou", "processo", "processos", "vez"],
  [["Ler"], "leu", "arquivo", "arquivos", "arquivo"],
  [["Buscar", "Listar"], "buscou", "vez", "vezes", "vez"],
  [["Consultar"], "consultou", "página", "páginas", "vez"],
  [["Pesquisar"], "pesquisou", "vez", "vezes", "vez"],
  [["Delegar", "Trabalho em background"], "delegou", "tarefa", "tarefas", "vez"],
  [["Consultar processo", "Parar processo"], "acompanhou", "processo", "processos", "vez"],
  [["Publicar o plano", "Concluir etapa", "Começar etapa", "Reabrir etapa", "Atualizar etapa"], "atualizou o plano", "", "", "frase"],
  [["Perguntar a você"], "perguntou a você", "", "", "frase"],
  [["Pedir aprovação"], "pediu aprovação", "", "", "frase"],
  [["Carregar ferramentas"], "carregou ferramentas", "", "", "frase"],
  [["Ler o índice da memória", "Buscar na memória", "Ler a memória"], "consultou a memória", "", "", "frase"],
  [["Ver o estado da tela", "Capturar a tela", "Clicar na tela", "Digitar na tela", "Apertar tecla", "Mover o ponteiro"], "usou a tela", "", "", "frase"],
  [["Abrir no navegador", "Ler a página", "Capturar a página", "Rodar script na página", "Enviar arquivo à página", "Clicar na página", "Digitar na página", "Usar o navegador"], "usou o navegador", "", "", "frase"],
  [["Usar"], "usou", "ferramenta", "ferramentas", "vez"],
]

/** O resumo de um conjunto por VERBOS CONTADOS (ADR-241): "Rodou 3 testes ·
 *  editou 1 arquivo · leu 2 arquivos". Um vocabulário só: antes o mesmo grupo
 *  de shells se chamava "ações", "verificações" ou "validações" conforme a
 *  categoria, e nenhum dos três dizia o que aconteceu. Conta TRABALHOS, não
 *  nós: um `tool_use` e o `DeferredWork` que ele pariu entram uma vez só. */
export function resumoPorVerbos(
  tools: readonly ToolActivityInput[],
  views: readonly ToolView[],
): string {
  const vistos = new Set<string>()
  const contas = PRETERITO.map(() => ({ n: 0, alvos: new Set<string>() }))
  let outros = 0
  tools.forEach((t, ix) => {
    const k = workKey(t)
    if (k != null) {
      if (vistos.has(k)) return
      vistos.add(k)
    }
    const v = views[ix]
    const linha = PRETERITO.findIndex(([verbos]) => verbos.includes(v.verb))
    if (linha < 0) {
      outros++
      return
    }
    const c = contas[linha]
    c.n++
    if (v.object?.kind === "file") c.alvos.add(v.object.path)
  })
  const partes: string[] = []
  PRETERITO.forEach(([, passado, um, varios, modo], ix) => {
    const c = contas[ix]
    if (c.n === 0) return
    if (modo === "frase") return partes.push(passado)
    const n = modo === "arquivo" ? Math.max(1, c.alvos.size) : c.n
    partes.push(`${passado} ${n} ${n === 1 ? um : varios}`)
  })
  if (outros) partes.push(`${outros} ${outros === 1 ? "outra ação" : "outras ações"}`)
  const frase = partes.join(" · ")
  return frase.charAt(0).toUpperCase() + frase.slice(1)
}

/** Rótulo de um conjunto ASSENTADO de ações (todas com desfecho conhecido ou
 * todas apenas registradas). Um trabalho só NUNCA vira contagem: o fio tem que
 * dizer o que rodou. Histórico sem desfecho não finge que acabou. */
function settledLabel(
  tools: readonly ToolActivityInput[],
  views: readonly ToolView[],
  finished: boolean,
  works: number,
): string {
  const base = works === 1 ? soleWorkLabel(views) : resumoPorVerbos(tools, views)
  return finished ? base : `${base} · sem desfecho registrado`
}

/** Grupo com ação que PAROU por um corte seu (ADR-180): a mesma gramática da
 * falha ("1 de 7 parou · Culpada"), sem o tom de falha. null = nada parou. */
function stoppedLabel(
  tools: readonly ToolActivityInput[],
  views: readonly ToolView[],
): string | null {
  const idx = tools.findIndex((t) => t.result?.interrupted)
  if (idx < 0) return null
  const culprit = fraseDaAcao(views[idx])
  if (tools.length === 1) return `${culprit} parou`
  const stopped = tools.filter((t) => t.result?.interrupted).length
  return stopped === 1
    ? `1 de ${tools.length} parou · ${culprit}`
    : `${stopped} de ${tools.length} pararam`
}

/** Resume um burst sem olhar o comando cru. O grupo descreve a natureza do
 * trabalho; a lista expandida explica cada ação; o raw fica no nível técnico. */
export function summarizeToolGroup(
  tools: readonly ToolActivityInput[],
  active = false,
): ToolGroupView {
  if (tools.length === 0)
    return { label: "Atividade técnica", emphasis: "quiet", state: "recorded" }
  const views = tools.map((t) => presentTool(t.name, t.input))
  const emphasis: ToolEmphasis = views.some((v) => v.emphasis === "warning")
    ? "warning"
    : views.some((v) => v.emphasis === "normal")
      ? "normal"
      : "quiet"
  const failed = tools.filter((t) => t.result?.ok === false && !t.result.interrupted).length
  if (failed > 0) {
    return {
      label: failed === 1 ? "Uma ação falhou" : `${failed} ações falharam`,
      emphasis: "warning",
      state: "error",
    }
  }
  if (active) {
    const current = tools.findLast((t) => !t.result) ?? tools.at(-1)!
    return {
      label: fraseDaAcao(presentTool(current.name, current.input)),
      emphasis,
      state: "running",
    }
  }
  const allFinished = tools.every((t) => t.result != null)
  const cut = stoppedLabel(tools, views)
  if (cut) return { label: cut, emphasis, state: "stopped" }
  return {
    label: settledLabel(tools, views, allFinished, countWorks(tools)),
    emphasis,
    state: allFinished ? "ok" : "recorded",
  }
}

/** Digest do CABEÇALHO do grupo (despoluição do fio, direção B + paleta A):
 * o resumo passa a SER a informação — contagem, duração congelada, contagens
 * pro sussurro e, na falha, a CULPADA nomeada ("1 de 7 falhou · Gerar PDF").
 * Tudo numa passada só sobre presentTool: este código roda no componente mais
 * quente do app, então não repete varredura por dado. */
export interface ToolGroupDigest extends ToolGroupView {
  /** Total de ações no grupo (plano, inclui descendentes de subagentes). */
  total: number
  /** Ações com result.ok === false. */
  failed: number
  /** Subagentes delegados (Task/Agent) — sussurro do cabeçalho. */
  agents: number
  /** Ações de shell — sussurro do cabeçalho. */
  shells: number
  /** TRABALHOS distintos (entidades), não nós: um `tool_use` e o `DeferredWork`
   * que ele pariu são UM. É esta a contagem que a copy recolhida usa. */
  works: number
  /** Duração TOTAL congelada (1º nascimento → última atividade observada).
   * null enquanto roda (o "agora" pertence à linha viva do rodapé), quando o
   * histórico não tem carimbos, ou abaixo de 1s (regra do Warp: nunca "0s"). */
  durationMs: number | null
  /** Entidade de trabalho cujo NOME o `label` está carregando (`workKey`), ou
   * null quando o rótulo é genérico ("3 verificações concluídas") ou nomeia uma
   * culpada (falha nunca dedupa). Quem recebe isso é dono do nome, e a posse
   * desce por toda a subárvore — não só um nível (B1, furo B). */
  labelWorkId: string | null
}

export function describeToolGroup(
  tools: readonly ToolActivityInput[],
  active = false,
): ToolGroupDigest {
  if (tools.length === 0)
    return {
      label: "Atividade técnica",
      emphasis: "quiet",
      state: "recorded",
      total: 0,
      failed: 0,
      agents: 0,
      shells: 0,
      works: 0,
      durationMs: null,
      labelWorkId: null,
    }
  const views = tools.map((t) => presentTool(t.name, t.input))
  const agents = tools.filter(
    (t) => t.name === "Task" || t.name === "Agent",
  ).length
  const shells = views.filter((v) => v.kind === "bash").length
  const emphasis: ToolEmphasis = views.some((v) => v.emphasis === "warning")
    ? "warning"
    : views.some((v) => v.emphasis === "normal")
      ? "normal"
      : "quiet"
  const failedIdx = tools.flatMap((t, i) =>
    t.result?.ok === false && !t.result.interrupted ? [i] : [],
  )
  const allFinished = tools.every((t) => t.result != null)
  const total = tools.length
  // Duração congelada: só quando o grupo terminou de verdade (todo mundo com
  // desfecho) e há carimbos. Pretérito congela; o vivo não ganha relógio aqui.
  let durationMs: number | null = null
  if (allFinished && !active) {
    let min = Infinity
    let max = -Infinity
    for (const t of tools) {
      if (t.ts != null) min = Math.min(min, t.ts)
      const end = t.activityAt ?? t.ts
      if (end != null) max = Math.max(max, end)
    }
    const span = max - min
    if (Number.isFinite(span) && span >= 1000) durationMs = span
  }
  const works = countWorks(tools)
  const base = {
    total,
    failed: failedIdx.length,
    agents,
    shells,
    works,
    durationMs,
    labelWorkId: null as string | null,
  }
  if (failedIdx.length > 0) {
    // A falha não se esconde nem vira frase genérica: nomeia a culpada quando
    // ela é uma só; com várias, a contagem manda e o detalhe fica nas linhas.
    const culprit = fraseDaAcao(views[failedIdx[0]])
    const label =
      failedIdx.length === 1
        ? total === 1
          ? `${culprit} falhou`
          : `1 de ${total} falhou · ${culprit}`
        : `${failedIdx.length} de ${total} falharam`
    return { ...base, label, emphasis: "warning", state: "error" }
  }
  if (active) {
    let currentIdx = tools.length - 1
    for (let i = tools.length - 1; i >= 0; i--) {
      if (!tools[i].result) {
        currentIdx = i
        break
      }
    }
    // Trabalho DELEGADO é uma entidade com nome: o cabeçalho é o dono dele e
    // a árvore mostra só o delta (ADR-037). Rajada de shell/leitura não é
    // entidade: o cabeçalho conta o que já aconteceu e a linha viva é a própria
    // ação. Nomear a corrente aqui deixava, na árvore, um órfão "em execução"
    // sem dizer o quê (print de 23/09/2026).
    const current = views[currentIdx]
    if (current.kind === "agent")
      return {
        ...base,
        label: current.label,
        labelWorkId: workKey(tools[currentIdx]),
        emphasis,
        state: "running",
      }
    return {
      ...base,
      label: resumoPorVerbos(tools, views),
      emphasis,
      state: "running",
    }
  }
  const cut = stoppedLabel(tools, views)
  if (cut) return { ...base, label: cut, emphasis, state: "stopped" }
  return {
    ...base,
    label: settledLabel(tools, views, allFinished, works),
    // Grupo de UM trabalho: o rótulo é o nome dele, então o cabeçalho é o dono.
    labelWorkId: works === 1 ? workKey(tools[0]) : null,
    emphasis,
    state: allFinished ? "ok" : "recorded",
  }
}
