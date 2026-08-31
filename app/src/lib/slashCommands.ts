// Comandos "/" honestos por fonte×motor. O único caso em que o `/nome` viaja
// CRU pro CLI é conversa claude-code com comando de fonte claude (o `claude -p`
// interpreta nativamente, preservando frontmatter rico que a expansão perderia).
// QUALQUER outra combinação — comando da casa (.mycockpit/commands) em qualquer
// motor, prompt do codex, qualquer coisa em conversa codex/agy — expande
// APP-SIDE: o texto enviado vira o corpo do .md (sem frontmatter), com
// $ARGUMENTS substituído. Sem isso o /nome ia como texto literal que o motor
// ignora — o popover oferecia comandos que não executavam (a mentira que esta
// fase conserta). `/nome` que não casa com comando nenhum segue como texto
// (fail-open, comportamento de sempre).

import { agentDef } from "@/lib/agents"
import { readProjectCommands, type SlashCommand } from "@/lib/sources"
import type { InstructionSourceClaim } from "@/lib/tooling"

// ---------------------------------------------------------------------------
// Comandos BUILTIN do app (source "app") — comandos de PRIMEIRA CLASSE do
// MyCockpit, definidos em código, visíveis no popover "/" de TODA conversa
// (chip "app"). Eles NÃO são texto: são AÇÃO — as duas superfícies de envio
// (ChatPanel.handleSend e lib/fleet/send.sendFromDesk) interceptam ANTES
// da expansão de .md e nunca deixam o /nome viajar cru pro motor. O primeiro
// é o /compactar (fluxo em lib/compact.ts); próximos builtins entram na lista.
// ---------------------------------------------------------------------------

export interface AppSlashCommand {
  name: string
  description: string
}

export const APP_SLASH_COMMANDS: AppSlashCommand[] = [
  {
    name: "compactar",
    description: "Compacta o contexto da conversa; libera janela",
  },
]

/** O texto é uma invocação de comando BUILTIN do app? Puro; casa pelo nome
 *  (args são ignorados pelo /compactar, mas o parse os aceita). */
export function findAppCommand(text: string): AppSlashCommand | null {
  const inv = parseSlashInvocation(text.trim())
  if (!inv) return null
  return APP_SLASH_COMMANDS.find((c) => c.name === inv.name) ?? null
}

/** Inventário do popover "/": builtins do app na FRENTE (chip "app"), sempre
 *  presentes; um .md de mesmo nome fica sombreado — a interceptação no send
 *  acontece antes da expansão, então listar os dois seria mentira. */
export function withAppCommands(commands: SlashCommand[]): SlashCommand[] {
  const app: SlashCommand[] = APP_SLASH_COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
    kind: "command",
    origin: "app",
    source: "app",
    // body null de propósito: se algum caminho tentar expandir, o fail-open
    // devolve o texto intacto (e a interceptação no send já o capturou antes).
    body: null,
  }))
  const shadowed = new Set(app.map((c) => c.name))
  return [...app, ...commands.filter((c) => !shadowed.has(c.name))]
}

/** Fila coalescida × builtin do app: o join "\n\n" transformaria o `/compactar`
 *  no meio da fila em texto morto (a invocação exige o prompt inteiro) — e um
 *  builtin no join nunca seria interceptado. Então a drenagem despacha em
 *  LOTES: o primeiro lote vai até (exclusive) o primeiro builtin — ou é o
 *  próprio builtin sozinho, se ele é o primeiro — e o resto volta pra fila
 *  (o próximo fim de turno drena de novo). Sem builtin na fila, tudo é um
 *  lote só (comportamento de sempre). Pura, testável. */
export function splitQueueForAppCommand<T extends { text: string }>(
  pending: T[],
): { batch: T[]; rest: T[] } {
  if (pending.length <= 1) return { batch: pending, rest: [] }
  if (findAppCommand(pending[0].text)) {
    return { batch: [pending[0]], rest: pending.slice(1) }
  }
  const idx = pending.findIndex((m) => findAppCommand(m.text) != null)
  if (idx === -1) return { batch: pending, rest: [] }
  return { batch: pending.slice(0, idx), rest: pending.slice(idx) }
}

/** Invocação "/" no INÍCIO da mensagem: `/nome` sozinho ou `/nome args…`
 *  (args podem ter quebras de linha). Qualquer outra coisa não é invocação. */
export function parseSlashInvocation(
  text: string,
): { name: string; args: string } | null {
  const m = text.match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  return { name: m[1], args: (m[2] ?? "").trim() }
}

export interface SlashExpansion {
  text: string
  instructionSources: InstructionSourceClaim[]
}

function instructionSource(command: SlashCommand): InstructionSourceClaim | null {
  if (
    command.source !== "plugin" ||
    !command.pluginKey ||
    !command.pluginFingerprint ||
    !command.contributionId
  ) {
    return null
  }
  return {
    kind: "plugin-skill",
    pluginKey: command.pluginKey,
    fingerprint: command.pluginFingerprint,
    contributionId: command.contributionId,
    invocation: command.name,
  }
}

export function mergeInstructionSources(
  ...groups: InstructionSourceClaim[][]
): InstructionSourceClaim[] {
  const unique = new Map<string, InstructionSourceClaim>()
  for (const source of groups.flat()) {
    const key = `${source.kind}:${source.pluginKey}:${source.contributionId}:${source.fingerprint}`
    if (!unique.has(key)) unique.set(key, source)
  }
  return [...unique.values()]
}

/** Remove o frontmatter YAML (bloco `---` inicial) do corpo do comando. */
export function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? md.slice(m[0].length).replace(/^\s*\n/, "") : md
}

/** Expansão por fonte×motor (pura, testável):
 *  - motor com `nativeSlash` + comando da PRÓPRIA fonte nativa → texto CRU
 *    (o CLI interpreta, preservando frontmatter rico) — decisão pela
 *    definição do agent (lib/agents), nunca pelo nome;
 *  - qualquer outra combinação → corpo do .md, frontmatter removido,
 *    `$ARGUMENTS` substituído (sem `$ARGUMENTS` no corpo → args anexados ao
 *    fim, convenção do Claude);
 *  - sem match (ou corpo ilegível/vazio) → texto original (fail-open).
 *  `opts.embedded` (G2.2/G2.3): o texto vai EMBUTIDO num prompt maior (fila
 *  coalescida, preâmbulo de handoff, fase de missão) — aí nem o comando
 *  nativo pode viajar cru (o CLI só interpreta "/" no início do prompt
 *  inteiro), então a expansão app-side vale pra TODA combinação. */
export function expandSlashCommand(
  text: string,
  commands: SlashCommand[],
  agent: string,
  opts?: { embedded?: boolean },
): string {
  return expandSlashCommandWithSources(text, commands, agent, opts).text
}

export function expandSlashCommandWithSources(
  text: string,
  commands: SlashCommand[],
  agent: string,
  opts?: { embedded?: boolean },
): SlashExpansion {
  const inv = parseSlashInvocation(text.trim())
  if (!inv) return { text, instructionSources: [] }
  const cmd = commands.find((c) => c.name === inv.name)
  if (!cmd) return { text, instructionSources: [] }
  const def = agentDef(agent)
  if (!opts?.embedded && def?.nativeSlash && cmd.source === def.nativeCommandSource)
    return { text, instructionSources: [] }
  const body = cmd.body ? stripFrontmatter(cmd.body).trim() : ""
  if (!body) return { text, instructionSources: [] }
  const source = instructionSource(cmd)
  const instructionSources = source ? [source] : []
  if (body.includes("$ARGUMENTS")) {
    return {
      text: body.replaceAll("$ARGUMENTS", inv.args),
      instructionSources,
    }
  }
  return {
    text: inv.args ? `${body}\n\n${inv.args}` : body,
    instructionSources,
  }
}

/** Wrapper de envio: só toca o disco quando o texto É uma invocação "/".
 *  Inventário indisponível → texto original (fail-open: o comando que não
 *  resolve segue como texto, nunca bloqueia o envio). */
export async function expandDraftForAgent(
  text: string,
  projectPath: string,
  agent: string,
  opts?: { embedded?: boolean },
): Promise<string> {
  return (await expandDraftForAgentWithSources(text, projectPath, agent, opts)).text
}

export async function expandDraftForAgentWithSources(
  text: string,
  projectPath: string,
  agent: string,
  opts?: { embedded?: boolean },
): Promise<SlashExpansion> {
  if (!parseSlashInvocation(text.trim())) return { text, instructionSources: [] }
  try {
    const commands = await readProjectCommands(projectPath, agent)
    return expandSlashCommandWithSources(text, commands, agent, opts)
  } catch (e) {
    console.warn("inventário de comandos indisponível; enviando como texto", e)
    return { text, instructionSources: [] }
  }
}

/** Correção do review gate G2 (usada por ChatPanel.handleSend e pelo
 *  sendFromDesk da mesa): quando QUALQUER bloco vai prepender ao pedido
 *  (doutrina, lições, parecer, persona), o pedido deixa de ser o prompt
 *  INTEIRO — e um comando nativo que sobreviveu CRU na expansão normal vira
 *  barra morta atrás do bloco (o CLI só interpreta "/" quando o prompt inteiro
 *  é a invocação; contrato no topo deste arquivo). Neste caso re-expande a
 *  partir do texto ORIGINAL com `embedded`. Sem prefixo, ou com o pedido já
 *  expandido/não-invocação, devolve `expanded` como está (zero disco a mais). */
export async function reexpandIfEmbedded(
  expanded: string,
  original: string,
  projectPath: string,
  agent: string,
  willPrefix: boolean,
): Promise<string> {
  return (
    await reexpandIfEmbeddedWithSources(
      { text: expanded, instructionSources: [] },
      original,
      projectPath,
      agent,
      willPrefix,
    )
  ).text
}

export async function reexpandIfEmbeddedWithSources(
  expanded: SlashExpansion,
  original: string,
  projectPath: string,
  agent: string,
  willPrefix: boolean,
): Promise<SlashExpansion> {
  if (!willPrefix || !parseSlashInvocation(expanded.text.trim())) return expanded
  return expandDraftForAgentWithSources(original, projectPath, agent, {
    embedded: true,
  })
}

/** Fila coalescida (G2.2): expande CADA texto pendente individualmente ANTES
 *  do join "\n\n" — depois do join, um `/comando` no meio vira barra morta que
 *  a expansão do envio (que só olha o texto inteiro) nunca alcança. Com 2+
 *  itens tudo é EMBUTIDO (até comando nativo precisa do corpo); com 0..1 item
 *  devolve intacto: o caminho normal de envio expande com a semântica plena
 *  (inclusive o cru nativo do claude). Pura, testável. */
export function expandQueuedForJoin(
  texts: string[],
  commands: SlashCommand[],
  agent: string,
): string[] {
  if (texts.length <= 1) return texts
  return texts.map((t) => expandSlashCommand(t, commands, agent, { embedded: true }))
}

/** Revezamento (G2.3): o pedido pendente viaja EMBUTIDO no preâmbulo do
 *  handoff, então `/comando` expande app-side pro inventário do motor de
 *  DESTINO (a barra crua seria texto morto lá). Sem match no inventário do
 *  destino → o texto segue (fail-open) e a `note` honesta explica no
 *  preâmbulo; inventário indisponível → texto sem nota (não afirma ausência
 *  sem evidência). */
export async function expandPendingForTarget(
  text: string,
  projectPath: string,
  targetAgent: string,
): Promise<SlashExpansion & { note: string | null }> {
  const inv = parseSlashInvocation(text.trim())
  if (!inv) return { text, note: null, instructionSources: [] }
  let commands: SlashCommand[]
  try {
    commands = await readProjectCommands(projectPath, targetAgent)
  } catch (e) {
    console.warn("inventário do destino indisponível; pendente segue como texto", e)
    return { text, note: null, instructionSources: [] }
  }
  const targetLabel = agentDef(targetAgent)?.label ?? targetAgent
  const cmd = commands.find((c) => c.name === inv.name)
  if (!cmd) {
    return {
      text,
      note: `nota do revezamento: "/${inv.name}" não existe no inventário do ${targetLabel}; trate a linha acima como texto do pedido.`,
      instructionSources: [],
    }
  }
  const expanded = expandSlashCommandWithSources(text, commands, targetAgent, {
    embedded: true,
  })
  if (expanded.text === text) {
    // match, mas corpo ilegível/vazio: expandir era impossível — nota honesta.
    return {
      text,
      note: `nota do revezamento: o comando "/${inv.name}" existe mas o corpo está ilegível; trate a linha acima como texto do pedido.`,
      instructionSources: [],
    }
  }
  return { ...expanded, note: null }
}

/** Chips do item no popover "/" (discretos): fonte sempre; "global" quando não
 *  é do projeto; "skill" quando é skill (command é o caso comum, sem chip). */
export function commandBadges(
  c: Pick<SlashCommand, "source" | "origin" | "kind">,
): string[] {
  const chips = [c.source]
  if (c.origin === "global") chips.push("global")
  if (c.kind === "skill") chips.push("skill")
  return chips
}

/** Copy do empty-state do "/" por agent da conversa: a casa
 *  (.mycockpit/commands) sempre aparece; a convenção nativa do motor vem da
 *  definição no registry (`slashEmptyExtra`), não de comparação de nome.
 *  Sem travessão (regra da casa). */
export function slashEmptyHint(agent: string): string {
  const casa = "Nenhum comando neste projeto. Crie arquivos .md em .mycockpit/commands (valem para qualquer agent)"
  const extra = agentDef(agent)?.slashEmptyExtra
  return extra ? `${casa}${extra}` : `${casa}.`
}
