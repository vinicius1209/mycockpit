import {
  expandDraftForAgentWithSources,
  reexpandIfEmbeddedWithSources,
  type SlashExpansion,
} from "@/lib/slashCommands"

/** Vocabulário pequeno para superfícies de dispatch. Mantém a regra de
 * embedding fora dos componentes/stores sem esconder a proveniência. */
export const expandDraftWithSources = expandDraftForAgentWithSources
export const finalizeSlashExpansion = reexpandIfEmbeddedWithSources

export function expandEmbeddedDraft(
  text: string,
  projectPath: string,
  agent: string,
): Promise<SlashExpansion> {
  return expandDraftForAgentWithSources(text, projectPath, agent, {
    embedded: true,
  })
}

export async function expandPrefixedDraft(
  text: string,
  projectPath: string,
  agent: string,
  embedded: boolean,
  prefix: string,
): Promise<SlashExpansion> {
  const expansion = await expandDraftForAgentWithSources(
    text,
    projectPath,
    agent,
    { embedded },
  )
  return { ...expansion, text: `${prefix}${expansion.text}` }
}
