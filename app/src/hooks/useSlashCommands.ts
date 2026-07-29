import { useEffect, useState } from "react"
import { readProjectCommands } from "@/lib/sources"
import type { SlashCommand } from "@/lib/sources"
import { isTauri } from "@/lib/db"
import type { Project } from "@/lib/types"

/** Máx. de itens mostrados nos popovers de "/" (comandos) e "@" (referências). */
export const MAX_POPOVER_ITEMS = 8

/** Parse PURO do modo "/": o input INTEIRO precisa ser "/token" (sem espaço,
 *  sem quebra de linha). Devolve a query (o que vem depois da barra) ou null.
 *  Compartilhado pelos dois motores do composer — textarea e Lexical decidem o
 *  popover a partir da MESMA string do draft. */
export function slashQueryOf(value: string): string | null {
  return value.match(/^\/([\w:-]*)$/)?.[1] ?? null
}

/**
 * Estado + lógica do popover de "/" (comandos do projeto no início do input).
 * A precedência das teclas (slash > at > histórico > Enter) fica no onKeyDown
 * do CommandConsole; aqui só vivem os dados e os setters que ele consome.
 */
export function useSlashCommands({
  project,
  value,
  setValue,
  textareaRef,
}: {
  project: Project | null
  value: string
  setValue: React.Dispatch<React.SetStateAction<string>>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)

  // comandos do projeto p/ o "/" (.claude/commands)
  useEffect(() => {
    if (!project || !isTauri()) {
      setCommands([])
      return
    }
    let cancelled = false
    readProjectCommands(project.path)
      .then((c) => !cancelled && setCommands(c))
      .catch(() => !cancelled && setCommands([]))
    return () => {
      cancelled = true
    }
  }, [project?.path])

  // "/" no início do input (sem espaço) → modo slash
  const slashQuery = slashQueryOf(value)
  const slashMatches =
    slashQuery !== null
      ? commands
          .filter((c) => c.name.toLowerCase().includes(slashQuery.toLowerCase()))
          .slice(0, MAX_POPOVER_ITEMS)
      : []
  const showSlash = !slashDismissed && slashMatches.length > 0

  useEffect(() => {
    setSlashIdx(0)
  }, [slashQuery])

  function insertCommand(name: string) {
    setValue(`/${name} `)
    textareaRef.current?.focus()
  }

  return {
    commands,
    slashMatches,
    showSlash,
    slashIdx,
    setSlashIdx,
    setSlashDismissed,
    insertCommand,
  }
}
