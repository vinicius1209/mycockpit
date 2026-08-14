// Resumo de um CONJUNTO de tool calls (o burst do fio): o cabeçalho do grupo, a
// contagem honesta e a duração congelada. Separado do `toolview` porque a
// pergunta é outra: lá é "como esta ação se apresenta", aqui é "o que este
// conjunto diz de uma linha só" (ADR-037: o resumo recolhido passa a SER a
// informação).

import { presentTool, type ToolEmphasis, type ToolView } from "@/lib/toolview"

export interface ToolActivityInput {
  name: string
  input: unknown
  result?: { ok: boolean } | null
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
  state: "running" | "ok" | "error" | "recorded"
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

/** Nome do trabalho quando o grupo inteiro é UM só: o primeiro nó que sabe
 * nomeá-lo. A tool de origem nem sempre sabe (o `Workflow` do provider cai no
 * balde genérico "Executar ferramenta"); quem carrega o nome humano nesse caso
 * é o nó sintético. Sem isso o marco recolhido esqueceria O QUE rodou, que é a
 * "amnésia do histórico" da auditoria. */
function soleWorkLabel(views: readonly ToolView[]): string {
  return (views.find((v) => v.kind !== "generic") ?? views[0]).label
}

/** Rótulo de um conjunto ASSENTADO de ações (todas com desfecho conhecido ou
 * todas apenas registradas). Extraído do summarizeToolGroup pra que o digest
 * do cabeçalho (describeToolGroup) use a mesma gramática sem recalcular.
 * `works` é a contagem de TRABALHOS (não de nós): é ela que aparece na copy. */
function settledLabel(
  views: readonly ToolView[],
  finished: boolean,
  works: number,
): string {
  const n = works
  // Um trabalho só NUNCA vira contagem: o fio tem que dizer o que rodou.
  if (n === 1) return soleWorkLabel(views)
  const categories = new Set(views.map((v) => v.category))
  if ([...categories].every((c) => c === "inspect" || c === "web"))
    return finished
      ? `${n} verificações concluídas`
      : `${n} verificações registradas`
  if (categories.size === 1 && categories.has("validate"))
    return finished ? `${n} validações concluídas` : `${n} validações registradas`
  if (categories.size === 1 && categories.has("change"))
    return finished ? `${n} alterações realizadas` : `${n} alterações registradas`
  if (finished && categories.size === 1 && categories.has("delegate"))
    return `${n} delegações concluídas`
  return finished ? `${n} ações concluídas` : `${n} ações registradas`
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
  const failed = tools.filter((t) => t.result?.ok === false).length
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
      label: presentTool(current.name, current.input).label,
      emphasis,
      state: "running",
    }
  }
  const allFinished = tools.every((t) => t.result != null)
  return {
    label: settledLabel(views, allFinished, countWorks(tools)),
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
  const failedIdx = tools.flatMap((t, i) => (t.result?.ok === false ? [i] : []))
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
    const culprit = views[failedIdx[0]].label
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
    return {
      ...base,
      label: views[currentIdx].label,
      labelWorkId: workKey(tools[currentIdx]),
      emphasis,
      state: "running",
    }
  }
  return {
    ...base,
    label: settledLabel(views, allFinished, works),
    // Grupo de UM trabalho: o rótulo é o nome dele, então o cabeçalho é o dono.
    labelWorkId: works === 1 ? workKey(tools[0]) : null,
    emphasis,
    state: allFinished ? "ok" : "recorded",
  }
}
