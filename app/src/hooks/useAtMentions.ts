import { useEffect, useRef, useState } from "react"
import { listProjectFiles } from "@/lib/sources"
import { listAgentDefs, type AgentDef } from "@/lib/agentDefs"
import { isTauri } from "@/lib/db"
import type { Project } from "@/lib/types"
import { MAX_POPOVER_ITEMS } from "@/hooks/useSlashCommands"

// `value` é o que entra como "@nome" (comportamento do insertMention); `id` é a
// identidade resolvível da persona (scope:slug) — reservado pro Sprint 1 saber
// QUAL persona invocar sem ambiguidade de nome. `def` carrega só o que o
// <AgentAvatar> precisa pra desenhar a cara da persona no popover. Item de
// arquivo só tem `value` (sem `id`/`def`).
export type AtItem = {
  kind: "agent" | "file"
  value: string
  id?: string
  def?: Pick<AgentDef, "category" | "avatarStyle" | "avatarSeed" | "slug" | "name">
}

/** Personas (as reais do app, `.mycockpit/agents`) + arquivos, filtrados pela
 *  query do "@" e limitados. Personas antes de arquivos; os `.md` das duas
 *  pastas de agents ficam de fora dos arquivos (já entram como persona ou são
 *  contexto de code agent externo). Puro, testável sem React. */
export function buildAtItems(
  agents: AgentDef[],
  files: string[],
  query: string,
): AtItem[] {
  const q = query.toLowerCase()
  return [
    ...agents
      .filter((a) => a.name.toLowerCase().includes(q))
      .map((a) => ({
        kind: "agent" as const,
        value: a.name,
        id: a.id,
        def: {
          category: a.category,
          avatarStyle: a.avatarStyle,
          avatarSeed: a.avatarSeed,
          slug: a.slug,
          name: a.name,
        },
      })),
    ...files
      .filter(
        (f) =>
          !f.startsWith(".claude/agents/") &&
          !f.startsWith(".mycockpit/agents/") &&
          f.toLowerCase().includes(q),
      )
      .map((f) => ({ kind: "file" as const, value: f })),
  ].slice(0, MAX_POPOVER_ITEMS)
}

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
  const [agents, setAgents] = useState<AgentDef[]>([])
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
      listAgentDefs(path).then(
        (defs) => !cancelled && setAgents(defs),
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
    atQuery === null ? [] : buildAtItems(agents, files, atQuery)
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
