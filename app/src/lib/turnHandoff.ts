import { prepareHybridHandoff } from "@/lib/handoff"
import { expandEmbeddedDraft } from "@/lib/slashDispatch"
import type { InstructionSourceClaim } from "@/lib/tooling"
import type { ChatItem, ConvState } from "@/store/chat"

export interface TurnTransplantArgs {
  conv: ConvState
  convId: string
  projectId: string
  cwd: string
  sourceAgent: string
  targetAgent: string
  text: string
  projectPath: string
  runId: string
  broughtAdvice?: string | null
  personaBlock?: string | null
  doctrineBlock?: string | null
  lessonsBlock?: string | null
}
export interface TurnTransplantResult {
  promptText: string
  instructionSources: InstructionSourceClaim[]
}

/**
 * Prepara o envelope híbrido de handoff/revezamento para um turno que troca de motor
 * (seja por mudança de persona/volante ou por revezamento proativo de motor).
 */
export async function prepareTurnTransplant({
  conv,
  convId,
  projectId,
  cwd,
  sourceAgent,
  targetAgent,
  text,
  projectPath,
  runId,
  broughtAdvice,
  personaBlock,
  doctrineBlock,
  lessonsBlock,
}: TurnTransplantArgs): Promise<TurnTransplantResult> {
  const wheelItems: ChatItem[] = [...conv.items]
  if (broughtAdvice) {
    wheelItems.push({
      kind: "text",
      id: `wheel-advice-${runId}`,
      text: `Parecer trazido para o executor:\n${broughtAdvice}`,
    })
  }
  const wheelExpansion = await expandEmbeddedDraft(text, projectPath, targetAgent)
  const instructionSources = wheelExpansion.instructionSources
  wheelItems.push({
    kind: "user",
    id: `wheel-request-${runId}`,
    // o novo agent recebe o pedido já EXPANDIDO (o /comando cru não
    // significaria nada pra ele). Embutido no envelope de handoff, nem o
    // comando nativo pode viajar cru (G2.3) — re-expande com embedded.
    text: wheelExpansion.text,
  })
  const prepared = await prepareHybridHandoff({
    projectId,
    cwd,
    convId,
    sourceAgent,
    targetAgent,
    items: wheelItems,
    pendingUserIndex: wheelItems.length - 1,
    personaBlock,
    doctrineBlock,
    lessonsBlock,
  })
  return {
    promptText: prepared.prompt,
    instructionSources,
  }
}

/**
 * Monta a cascata de envelopes de instrução no prompt (de dentro pra fora):
 * lições → parecer → doutrina → persona.
 */
export function assemblePromptCascade({
  promptText,
  lessonsBlock,
  broughtAdvice,
  doctrineBlock,
  personaBlock,
}: {
  promptText: string
  lessonsBlock?: string | null
  broughtAdvice?: string | null
  doctrineBlock?: string | null
  personaBlock?: string | null
}): string {
  let out = promptText
  if (lessonsBlock) out = `${lessonsBlock}\n\n---\n\n${out}`
  if (broughtAdvice) out = `${broughtAdvice}\n\n---\n\n${out}`
  if (doctrineBlock) out = `${doctrineBlock}\n\n${out}`
  if (personaBlock) out = `${personaBlock}\n\n${out}`
  return out
}
