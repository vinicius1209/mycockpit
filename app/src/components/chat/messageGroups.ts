// Agrupamento por AUTOR do fio (layout estilo Slack): sobre os nós de render
// (buildNodes), colapsa nós CONTÍGUOS do mesmo autor num grupo — o avatar e o
// cabeçalho (nome) aparecem uma vez, os demais nós indentam sob o mesmo gutter.
// Puro e testável: a costura da prosa (messageNodes) já rodou antes; aqui só se
// decide quem "assina" cada bloco e onde a fita muda de dono.
import { nasceuAgora } from "@/lib/nascimento"
import type { Node } from "./messageNodes"

/** Quem assina um bloco. `especialista` carrega a persona (id+nome) pra que
 *  pareceres de personas DIFERENTES não colapsem no mesmo grupo. `system` é a
 *  voz sem dono (interrupção/aviso) — sem avatar, centralizada. */
export type GroupAuthor =
  | { kind: "you"; aoEspecialista?: true }
  | { kind: "executor" }
  | { kind: "especialista"; personaId: string; personaName: string; mensagem?: true }
  | { kind: "system" }

/** Chave de colapso: nós contíguos com a MESMA chave viram um grupo. O
 *  especialista entra por persona (troca de persona = troca de grupo). */
export function authorKey(a: GroupAuthor): string {
  switch (a.kind) {
    case "you":
      // O pedido a um especialista vai à direita (ADR-267): não cola no grupo
      // das suas mensagens ao executor.
      return a.aoEspecialista ? "you:especialista" : "you"
    case "executor":
      return "executor"
    case "system":
      return "system"
    case "especialista":
      return `especialista:${a.personaId}`
  }
}

/** Autor de um nó de render. Prosa/tools/plano são sempre do EXECUTOR (o
 *  turno do code agent). Nos itens avulsos: user→você; advice→especialista (por
 *  persona); cancelled/notice→sistema (voz sem dono); o resto do turno
 *  (text/result/error/limit)→executor. */
export function nodeAuthor(node: Node): GroupAuthor {
  if (
    node.type === "prose" ||
    node.type === "tools" ||
    node.type === "plan" ||
    node.type === "incident"
  )
    return { kind: "executor" }
  const it = node.item
  switch (it.kind) {
    case "user":
      return it.advisorTo ? { kind: "you", aoEspecialista: true } : { kind: "you" }
    case "advice":
      return {
        kind: "especialista",
        personaId: it.personaId,
        personaName: it.personaName,
        ...(it.estilo === "mensagem" ? { mensagem: true as const } : {}),
      }
    case "cancelled":
    case "notice":
      return { kind: "system" }
    default:
      return { kind: "executor" }
  }
}

/** Um grupo de nós contíguos do mesmo autor. `key` é estável (chave do autor +
 *  key do 1º nó) pra o React não remontar o grupo a cada delta. */
export interface MessageGroup {
  key: string
  author: GroupAuthor
  nodes: Node[]
}

/** Hora (epoch ms) de um GRUPO = o `ts` do PRIMEIRO item dele. buildNodes usa o
 *  id do 1º item de cada segmento como `key` do nó, então a key do 1º nó do
 *  grupo resolve, via `tsById`, o carimbo do item que abriu o grupo (estilo
 *  Slack: o cabeçalho mostra quando a conversa daquele autor começou).
 *  `undefined` quando o item é antigo e não tem `ts` — a UI omite a hora (sem
 *  "undefined" fantasma). Puro. */
export function groupTs(
  group: MessageGroup,
  tsById: Map<string, number | undefined>,
): number | undefined {
  const first = group.nodes[0]
  return first ? tsById.get(first.key) : undefined
}

/** Colapsa nós contíguos do mesmo autor. Troca de autor abre um grupo novo. */
export function groupByAuthor(nodes: Node[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const node of nodes) {
    const author = nodeAuthor(node)
    const key = authorKey(author)
    const last = groups[groups.length - 1]
    if (last && authorKey(last.author) === key) {
      last.nodes.push(node)
    } else {
      groups.push({ key: `${key}#${node.key}`, author, nodes: [node] })
    }
  }
  return groups
}

/** O grupo é o marco de um corte (ADR-180)? Voz de sistema com um `cancelled`.
 *  Permanente: é o que a régua desenha como emenda. */
export function grupoDeCorte(group: MessageGroup | undefined): boolean {
  if (!group || group.author.kind !== "system") return false
  return group.nodes.some((n) => n.type === "item" && n.item.kind === "cancelled")
}

/** O corte deste grupo ACABOU de nascer? É ele que acende a brasa no bloco do
 *  executor logo acima. Decidido no render, não na montagem: o bloco cortado já
 *  estava na tela quando o corte chegou. */
export function corteNasceu(
  group: MessageGroup | undefined,
  now: number = Date.now(),
): boolean {
  if (!grupoDeCorte(group)) return false
  return group!.nodes.some(
    (n) => n.type === "item" && n.item.kind === "cancelled" && nasceuAgora(n.item.ts, now),
  )
}

/** Os grupos em que um especialista ESTREIA na conversa (ADR-267): o primeiro
 *  de cada persona, e só no estilo mensagem (o "entrou na conversa" não se
 *  pinta no histórico antigo). Puro. */
export function estreiasDeEspecialista(groups: MessageGroup[]): Set<string> {
  const vistos = new Set<string>()
  const estreias = new Set<string>()
  for (const g of groups) {
    if (g.author.kind !== "especialista" || vistos.has(g.author.personaId)) continue
    vistos.add(g.author.personaId)
    if (g.author.mensagem) estreias.add(g.key)
  }
  return estreias
}
