import { useEffect, useRef, useState } from "react"
import { readCommandInventory } from "@/lib/sources"
import type { CommandInventoryView, SlashCommand } from "@/lib/sources"
import { withAppCommands } from "@/lib/slashCommands"
import { slashSections } from "@/lib/slashSections"
import { agentDef } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import type { Project } from "@/lib/types"

/** Procedência do inventário mostrado (ADR-189), sem os itens. */
export type SlashInventoryMeta = Omit<CommandInventoryView, "commands">

/** Máx. de itens mostrados nos popovers de "/" (comandos) e "@" (referências). */
export const MAX_POPOVER_ITEMS = 8

/** Parse PURO do modo "/": o input INTEIRO precisa ser "/token" (sem espaço,
 *  sem quebra de linha). Devolve a query (o que vem depois da barra) ou null —
 *  o popover é decidido a partir da string do draft. */
export function slashQueryOf(value: string): string | null {
  return value.match(/^\/([\w:.-]*)$/)?.[1] ?? null
}

/**
 * Estado + lógica do popover de "/" (comandos do projeto no início do input).
 * O teclado (navegar/escolher/fechar) chega pelo SlashMenuKeysPlugin do editor
 * Lexical, via slashBridge do CommandConsole; aqui só vivem os dados e os
 * setters que ele consome.
 */
export function useSlashCommands({
  project,
  agent,
  value,
  setValue,
  focus,
}: {
  project: Project | null
  /** Agent EFETIVO da conversa: a descoberta é por motor (a casa
   *  .frota/commands vale pra todos; cada motor soma a convenção nativa). */
  agent: string
  value: string
  setValue: React.Dispatch<React.SetStateAction<string>>
  /** Foco programático do editor (insertCommand devolve o caret ao composer). */
  focus?: () => void
}) {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [inventory, setInventory] = useState<SlashInventoryMeta | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)

  // "/" no início do input (sem espaço) → modo slash
  const slashQuery = slashQueryOf(value)
  // Cada ABERTURA do "/" relê o inventário: o turno que acabou de terminar pode
  // ter anunciado plugins novos (ADR-189). Custo por gesto, não por tecla.
  const [aberturas, setAberturas] = useState(0)
  const estavaAberto = useRef(false)
  useEffect(() => {
    const aberto = slashQuery !== null
    if (aberto && !estavaAberto.current) setAberturas((n) => n + 1)
    estavaAberto.current = aberto
  }, [slashQuery])

  // Inventário por agent da conversa: casa e plugins da Frota sempre; o que o
  // motor anunciou (ou as pastas dele) conforme a capability. Os BUILTINS do
  // app (source "app", ex. /compactar) entram na frente em TODA conversa, não
  // dependem do disco, então a falha da leitura não os apaga.
  useEffect(() => {
    if (!project || !isTauri()) {
      setCommands([])
      setInventory(null)
      return
    }
    let cancelled = false
    readCommandInventory(project.path, agent)
      .then(({ commands: c, ...meta }) => {
        if (cancelled) return
        setCommands(withAppCommands(c))
        setInventory(meta)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn("inventário do / indisponível", error)
        setCommands(withAppCommands([]))
        setInventory(null)
      })
    return () => {
      cancelled = true
    }
  }, [project?.path, agent, aberturas])

  const { sections: slashSectionList, flat: slashMatches } =
    slashQuery !== null
      ? slashSections(commands, slashQuery, agentDef(agent)?.label ?? agent)
      : { sections: [], flat: [] }
  const showSlash = !slashDismissed && slashMatches.length > 0

  useEffect(() => {
    setSlashIdx(0)
  }, [slashQuery])

  function insertCommand(name: string) {
    setValue(`/${name} `)
    focus?.()
  }

  return {
    commands,
    inventory,
    slashSectionList,
    slashMatches,
    showSlash,
    slashIdx,
    setSlashIdx,
    setSlashDismissed,
    insertCommand,
  }
}
