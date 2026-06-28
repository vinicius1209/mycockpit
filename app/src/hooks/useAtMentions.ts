import { useEffect, useRef, useState } from "react"
import { listProjectFiles, readProjectSources } from "@/lib/sources"
import { isTauri } from "@/lib/db"
import type { Project } from "@/lib/types"
import { MAX_POPOVER_ITEMS } from "@/hooks/useSlashCommands"

export type AtItem = { kind: "agent" | "file"; value: string }

/**
 * Estado + lógica do popover de "@" (arquivos + agents do projeto, mid-text).
 * Possui o `cursor` (posição do caret) porque é o que delimita o token "@…".
 */
export function useAtMentions({
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
  const [files, setFiles] = useState<string[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [atIdx, setAtIdx] = useState(0)
  const [atDismissed, setAtDismissed] = useState(false)
  const mentionLoadedRef = useRef<string | null>(null)

  // token "@..." antes do cursor (precedido por início ou espaço)
  const before = value.slice(0, cursor)
  const atMatch = before.match(/(?:^|\s)@(\S*)$/)
  const atQuery = atMatch ? atMatch[1] : null

  // carrega arquivos + agents lazy (1ª vez que o @ aparece, cache por projeto)
  useEffect(() => {
    if (atQuery === null || !project || !isTauri()) return
    if (mentionLoadedRef.current === project.path) return
    const path = project.path
    mentionLoadedRef.current = path
    let cancelled = false
    let settled = false
    Promise.all([
      listProjectFiles(path).then(
        (f) => !cancelled && setFiles(f),
        () => !cancelled && setFiles([]),
      ),
      readProjectSources(path).then(
        (s) => !cancelled && setAgents(s.personas.map((p) => p.name)),
        () => !cancelled && setAgents([]),
      ),
    ]).finally(() => {
      settled = true
    })
    return () => {
      cancelled = true
      // cancelado ANTES de terminar (troca rápida de projeto) → libera o cache-once
      // p/ recarregar; se já terminou, mantém (não recarrega a cada tecla do @).
      if (!settled && mentionLoadedRef.current === path) {
        mentionLoadedRef.current = null
      }
    }
  }, [atQuery, project?.path])

  const atItems: AtItem[] =
    atQuery === null
      ? []
      : [
          ...agents
            .filter((a) => a.toLowerCase().includes(atQuery.toLowerCase()))
            .map((a) => ({ kind: "agent" as const, value: a })),
          ...files
            // tira os .claude/agents/*.md — já estão listados como AGENT acima
            .filter(
              (f) =>
                !f.startsWith(".claude/agents/") &&
                f.toLowerCase().includes(atQuery.toLowerCase()),
            )
            .map((f) => ({ kind: "file" as const, value: f })),
        ].slice(0, MAX_POPOVER_ITEMS)
  const showAt = !atDismissed && atItems.length > 0

  useEffect(() => {
    setAtIdx(0)
  }, [atQuery])

  function insertMention(val: string) {
    if (!atMatch) return
    const atStart = cursor - (atMatch[1].length + 1)
    const next = `${value.slice(0, atStart)}@${val} ${value.slice(cursor)}`
    const pos = atStart + val.length + 2
    setValue(next)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
      setCursor(pos)
    })
  }

  return {
    atItems,
    showAt,
    atIdx,
    setAtIdx,
    setAtDismissed,
    setCursor,
    insertMention,
  }
}
