// A ÁRVORE do Fio Vivo: topologia reportada pelo provider + as perguntas que o
// render faz sobre um ramo (tem falha? tem trabalho vivo? quem é o passo mais
// profundo em execução? de quem é o nome?). Puro e testável — fora do
// componente, que só desenha o que estas funções respondem.
import type { ToolItem } from "@/components/chat/messageNodes"

export interface ToolTreeNode {
  item: ToolItem
  children: ToolTreeNode[]
}

/** Reconstrói a topologia reportada pelo provider. Pai ausente/desconhecido
 * vira raiz (fail-open para históricos e adapters sem hierarquia). */
export function buildToolForest(tools: ToolItem[]): ToolTreeNode[] {
  const byToolId = new Map(
    tools.filter((t) => t.toolId).map((t) => [t.toolId!, t] as const),
  )
  const children = new Map<string, ToolItem[]>()
  const roots: ToolItem[] = []
  for (const tool of tools) {
    if (tool.parentToolId && byToolId.has(tool.parentToolId)) {
      const list = children.get(tool.parentToolId) ?? []
      list.push(tool)
      children.set(tool.parentToolId, list)
    } else {
      roots.push(tool)
    }
  }
  const building = new Set<string>()
  const node = (item: ToolItem): ToolTreeNode => {
    const key = item.toolId ?? item.id
    if (building.has(key)) return { item, children: [] }
    building.add(key)
    const out = {
      item,
      children: (item.toolId ? children.get(item.toolId) : undefined)?.map(node) ?? [],
    }
    building.delete(key)
    return out
  }
  return roots.map(node)
}

export function branchContains(node: ToolTreeNode, itemId: string | null | undefined): boolean {
  if (!itemId) return false
  return (
    node.item.id === itemId ||
    node.children.some((child) => branchContains(child, itemId))
  )
}

/** O ramo carrega trabalho diferido do provider ainda VIVO (D1.2)? Mantém o nó
 *  do Workflow exposto (fora do histórico recolhido) enquanto o background
 *  task roda de verdade dentro do CLI. */
export function branchHasLiveDeferred(node: ToolTreeNode): boolean {
  return (
    node.item.deferred?.status === "running" ||
    node.children.some(branchHasLiveDeferred)
  )
}

/** O ramo carrega alguma FALHA? Ramo falhado nunca entra no stub de concluídas
 *  (a falha não se esconde — despoluição do fio, mock B ③). */
export function branchHasFailure(node: ToolTreeNode): boolean {
  return (
    // Ação cortada por você parou, não falhou (ADR-180).
    (node.item.result?.ok === false && !node.item.result.interrupted) ||
    node.children.some(branchHasFailure)
  )
}

/** Ações no ramo (plano, inclui descendentes) — alimenta a contagem honesta do
 *  stub "N concluídas · mostrar". */
export function branchSize(node: ToolTreeNode): number {
  return 1 + node.children.reduce((acc, child) => acc + branchSize(child), 0)
}

/** Este nó está EM EXECUÇÃO (mesma conta que a `ToolLine` faz pra si)? */
export function nodeIsRunning(
  node: ToolTreeNode,
  activeToolId?: string | null,
): boolean {
  if (node.item.result) return false
  return (
    branchContains(node, activeToolId) ||
    node.item.managedProcess?.status === "running" ||
    node.item.managedProcess?.status === "stopping" ||
    node.item.deferred?.status === "running"
  )
}

/** Algum DESCENDENTE em execução? Então o indicador animado é dele: um único
 *  ponto vivo por linhagem (§2/§6). Um trabalho em background acendia três
 *  spinners na mesma linhagem (cabeçalho + tool_use + nó do trabalho). */
export function hasRunningDescendant(
  node: ToolTreeNode,
  activeToolId?: string | null,
): boolean {
  return node.children.some(
    (child) =>
      nodeIsRunning(child, activeToolId) ||
      hasRunningDescendant(child, activeToolId),
  )
}

/** Trabalhos cujo NOME um ancestral visível já mostrou. Posse é da ENTIDADE
 *  (`workKey`), não da string, e desce por toda a subárvore: o nó sintético
 *  `DeferredWork` mora no nível 2 (pendurado no `tool_use` de origem), então
 *  uma prop que parava no nível 1 nunca o alcançava (docs/fio-poluicao-2.md,
 *  B1 furo B). Set vazio compartilhado pra não quebrar o `memo` da ToolLine. */
export const NO_NAMED_WORK: ReadonlySet<string> = new Set<string>()
