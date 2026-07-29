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

/** Regra ÚNICA de arquivo mencionável: os `.md` das duas pastas de agents ficam
 *  fora (já entram como persona ou são contexto de code agent externo). Vale
 *  pros DOIS motores do composer — textarea (buildAtItems) e Lexical
 *  (buildLexicalAtItems). */
export function isMentionableFile(f: string): boolean {
  return !f.startsWith(".claude/agents/") && !f.startsWith(".mycockpit/agents/")
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
      .filter((f) => isMentionableFile(f) && f.toLowerCase().includes(q))
      .map((f) => ({ kind: "file" as const, value: f })),
  ].slice(0, MAX_POPOVER_ITEMS)
}

/** Item de menção do motor Lexical: só valor + tipo (o menu resolve avatar por
 *  nome via usePresets; arquivo leva ícone). O `kind` viaja como data do item
 *  do beautiful-mentions e agrupa o menu (Especialistas antes de Arquivos). */
export type LexicalAtItem = { value: string; kind: "agent" | "file" }

/** Montagem PURA dos itens do "@" do Lexical: personas primeiro, arquivos
 *  depois (contíguos — o menu insere o cabeçalho na troca de kind), arquivos
 *  passando pela MESMA regra de exclusão do textarea. SEM slice: o filtro por
 *  query e o limite (MAX_POPOVER_ITEMS) ficam com o beautiful-mentions na hora
 *  de renderizar, senão cortar aqui esconderia arquivos da busca. */
export function buildLexicalAtItems(
  names: string[],
  files: string[],
): LexicalAtItem[] {
  return [
    ...names.map((n) => ({ value: n, kind: "agent" as const })),
    ...files
      .filter(isMentionableFile)
      .map((f) => ({ value: f, kind: "file" as const })),
  ]
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
  eager,
}: {
  project: Project | null
  value: string
  setValue: React.Dispatch<React.SetStateAction<string>>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** Motor Lexical: carrega arquivos+agents já na montagem (lá não existe o
   *  rastreio de cursor do textarea que dispara o lazy pelo "@" digitado). */
  eager?: boolean
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

  // carrega arquivos + agents lazy (1ª vez que o @ aparece, cache por projeto;
  // no motor Lexical `eager` antecipa pra montagem — mesma carga, mesmo cache)
  useEffect(() => {
    if ((atQuery === null && !eager) || !project || !isTauri()) return
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
  }, [atQuery, eager, project?.path])

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
    /** Arquivos crus do projeto (cacheados) — o motor Lexical monta os itens
     *  dele a partir daqui (buildLexicalAtItems), sem duplicar a listagem. */
    files,
  }
}
