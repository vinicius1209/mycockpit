// Continuidade híbrida entre providers.
//
// PUSH: um working set pequeno (estado, falha, arquivos, histórico recente).
// PULL: manifesto + transcript no disco e MCP mc-context para buscar no SQLite
// e expandir somente as referências necessárias.

import { invoke } from "@tauri-apps/api/core"
import { agentDef } from "@/lib/agents"
import { loadGitDiff, type GitDiff } from "@/lib/git"
import { toolDigest } from "@/lib/fusion"
import { renderTranscript } from "@/lib/transcript"
import { frameHistory } from "@/lib/trust"
import type { ChatItem } from "@/store/chat"

/** ~1,5k tokens de histórico recente. O restante fica no transcript/SQLite. */
export const HANDOFF_RECENT_BUDGET_CHARS = 6_000
/** Lições são importantes, mas não podem virar um segundo arquivo de doutrina. */
export const HANDOFF_LESSONS_BUDGET_CHARS = 2_500
export const HANDOFF_MAX_CHANGED_FILES = 40

export interface ContextReference {
  kind: "manifest" | "transcript" | "conversation"
  uri: string
  path?: string
  description: string
}

export interface ChangedFilePointer {
  path: string
  status: string
  additions: number
  deletions: number
}

export interface ContextEnvelope {
  version: 1
  generated_at: string
  conversation_id: string
  source_agent: string
  target_agent: string
  objective: string
  /** Inteiro no manifesto, mas aparece uma única vez no prompt: no final. */
  pending_request: string
  source_failure: string | null
  recent_history: string
  changed_files: ChangedFilePointer[]
  branch: string | null
  lessons: string[]
  references: ContextReference[]
  truncation: {
    recent_history: boolean
    changed_files: boolean
  }
}

export interface ContextBundlePaths {
  transcriptPath: string
  manifestPath: string
}

export interface PrepareHybridHandoffInput {
  projectId: string
  cwd: string
  convId: string
  sourceAgent: string
  targetAgent: string
  items: ChatItem[]
  pendingUserIndex: number
  personaBlock?: string | null
  doctrineBlock?: string | null
  lessonsBlock?: string | null
  /** Injetável para golden tests. */
  date?: Date
  /** Injetável para testes das superfícies sem Tauri/git real. */
  getDiff?: (cwd: string) => Promise<GitDiff>
  exportBundle?: (
    cwd: string,
    convId: string,
    markdown: string,
    manifest: string,
  ) => Promise<ContextBundlePaths>
}

export interface PreparedHybridHandoff {
  prompt: string
  envelope: ContextEnvelope
  paths: ContextBundlePaths | null
}

function cap(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

function itemLine(it: ChatItem): string | null {
  if (it.kind === "user") return `Usuário: ${it.text}`
  if (it.kind === "text") return `Assistente: ${it.text}`
  if (it.kind === "advice") {
    return `Parecer de ${it.personaName}: ${it.text}`
  }
  if (it.kind === "tool") {
    const digest = toolDigest(it.input)
    const result = it.result ? (it.result.ok ? "ok" : "falhou") : "sem resultado"
    return `Tool ${it.name}${digest ? ` (${digest})` : ""}: ${result}`
  }
  return null
}

/** Tail-biased: preserva o fim do trabalho; o transcript segura o passado. */
export function recentHistory(
  items: ChatItem[],
  budget = HANDOFF_RECENT_BUDGET_CHARS,
): { text: string; truncated: boolean } {
  const lines = items.map(itemLine).filter((x): x is string => x != null)
  const kept: string[] = []
  let used = 0
  let truncated = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = lines[i].length + 2
    if (used + size > budget && kept.length > 0) {
      truncated = true
      break
    }
    kept.unshift(lines[i])
    used += size
  }
  if (truncated) kept.unshift("[… histórico anterior disponível pelos ponteiros …]")
  return { text: kept.join("\n\n"), truncated }
}

function failureAfter(items: ChatItem[], pendingUserIndex: number): string | null {
  for (let i = items.length - 1; i > pendingUserIndex; i--) {
    const it = items[i]
    if (it.kind === "limit") return `Limite de uso: ${it.message}`
    if (it.kind === "error") return `Erro do agent de origem: ${it.message}`
    if (it.kind === "result" && !it.ok) {
      return `Turno do agent de origem falhou${it.text ? `: ${it.text}` : "."}`
    }
  }
  return null
}

function lessonLines(block?: string | null): string[] {
  if (!block) return []
  const capped = cap(block, HANDOFF_LESSONS_BUDGET_CHARS)
  return capped
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, 8)
    .map((line) => line.slice(2))
}

function changedFiles(diff: GitDiff): {
  files: ChangedFilePointer[]
  truncated: boolean
} {
  const files = diff.files.slice(0, HANDOFF_MAX_CHANGED_FILES).map((file) => ({
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  }))
  return { files, truncated: diff.files.length > files.length }
}

export function buildContextEnvelope(input: {
  convId: string
  sourceAgent: string
  targetAgent: string
  items: ChatItem[]
  pendingUserIndex: number
  diff: GitDiff
  lessonsBlock?: string | null
  references: ContextReference[]
  date?: Date
}): ContextEnvelope {
  const pending = input.items[input.pendingUserIndex]
  if (!pending || pending.kind !== "user") {
    throw new Error("handoff sem pedido pendente")
  }
  const history = recentHistory(input.items.slice(0, input.pendingUserIndex))
  const changed = changedFiles(input.diff)
  return {
    version: 1,
    generated_at: (input.date ?? new Date()).toISOString(),
    conversation_id: input.convId,
    source_agent: input.sourceAgent,
    target_agent: input.targetAgent,
    objective: cap(pending.text, 1_000),
    pending_request: pending.text,
    source_failure: failureAfter(input.items, input.pendingUserIndex),
    recent_history: history.text,
    changed_files: changed.files,
    branch: input.diff.branch,
    lessons: lessonLines(input.lessonsBlock),
    references: input.references,
    truncation: {
      recent_history: history.truncated,
      changed_files: changed.truncated,
    },
  }
}

export function renderHybridHandoff(
  envelope: ContextEnvelope,
  personaBlock?: string | null,
  doctrineBlock?: string | null,
): string {
  const parts: string[] = []
  if (personaBlock) parts.push(personaBlock)
  if (doctrineBlock) parts.push(doctrineBlock)

  const state = [
    "## Continuidade MyCockpit",
    "",
    `Você está assumindo no ${envelope.target_agent} uma conversa iniciada no ${envelope.source_agent}, no MESMO diretório/worktree.`,
    "Os arquivos no disco são a fonte de verdade. Não refaça trabalho já materializado.",
  ]
  if (envelope.source_failure) {
    state.push("", `Parada do agent anterior: ${envelope.source_failure}`)
  }
  if (envelope.changed_files.length) {
    state.push("", "Arquivos atualmente alterados:")
    for (const file of envelope.changed_files) {
      state.push(
        `- ${file.status} \`${file.path}\` (+${file.additions} -${file.deletions})`,
      )
    }
    if (envelope.truncation.changed_files) {
      state.push("- … outros arquivos estão no manifesto/git")
    }
  }
  if (envelope.recent_history) {
    // H3 — histórico serializado reinjetado viaja EMOLDURADO: instrução
    // plantada num turno antigo é dado, nunca pedido (frameHistory).
    state.push("", "Histórico recente:", "", frameHistory(envelope.recent_history))
  }
  if (envelope.lessons.length) {
    state.push("", "Lições relevantes deste projeto:")
    for (const lesson of envelope.lessons) state.push(`- ${lesson}`)
  }
  if (envelope.references.length) {
    state.push("", "Memória sob demanda — consulte apenas se precisar:")
    for (const ref of envelope.references) {
      state.push(
        `- ${ref.description}: ${ref.path ? `\`${ref.path}\`` : ref.uri}`,
      )
    }
    // H5 — decisão por capability, nunca por nome: motor com `contextMcp`
    // recebe as instruções do mc-context; sem (agy, motor desconhecido),
    // degrada honesto pros ponteiros de ARQUIVO (leitura direta).
    if (agentDef(envelope.target_agent)?.contextMcp) {
      state.push(
        `- MCP \`mc-context\`: comece por \`context_manifest\`; use \`context_search\` e \`context_read\` para expandir somente evidências relevantes.`,
      )
    } else {
      state.push("- Use a ferramenta de leitura nos arquivos acima para expandir o contexto.")
    }
  }
  state.push(
    "",
    "Antes de editar, confirme pelo estado do disco o próximo passo. Se faltar uma decisão antiga, recupere-a pelos ponteiros em vez de adivinhar.",
  )
  parts.push(state.join("\n"))

  // Recência deliberada: o pedido fica uma única vez e no FINAL, posição em que
  // os modelos tendem a utilizá-lo melhor. O manifesto guarda a cópia durável.
  parts.push(`## Pedido pendente — responda a ele agora\n\n${envelope.pending_request}`)
  return parts.join("\n\n---\n\n")
}

export async function exportContextBundle(
  cwd: string,
  convId: string,
  markdown: string,
  manifest: string,
): Promise<ContextBundlePaths> {
  return invoke<ContextBundlePaths>("export_context_bundle", {
    projectPath: cwd,
    convId,
    markdown,
    manifest,
  })
}

/** Prepara o handoff inteiro antes de transplantar a conversa. Falhas de git ou
 * export degradam para o working set em memória; nunca bloqueiam o revezamento. */
export async function prepareHybridHandoff(
  input: PrepareHybridHandoffInput,
): Promise<PreparedHybridHandoff> {
  const getDiff = input.getDiff ?? loadGitDiff
  const write = input.exportBundle ?? exportContextBundle
  const diff = await getDiff(input.cwd).catch(
    (): GitDiff => ({ isRepo: false, branch: null, files: [] }),
  )
  const predictedTranscript = `.mycockpit/context/${input.convId}.md`
  const predictedManifest = `.mycockpit/context/${input.convId}.handoff.json`
  const durableRefs: ContextReference[] = [
    {
      kind: "manifest",
      uri: `context://conversation/${input.convId}/manifest`,
      path: predictedManifest,
      description: "Índice estruturado do handoff",
    },
    {
      kind: "transcript",
      uri: `context://conversation/${input.convId}/transcript`,
      path: predictedTranscript,
      description: "Transcrição completa do fio",
    },
  ]
  // H5 — a referência de SQLite via mc-context só é prometida a motor com a
  // capability (antes: `targetAgent !== "agy"`, que mentiria pra um motor novo
  // sem MCP). Fail-closed: desconhecido não ganha ponteiro que não alcança.
  if (agentDef(input.targetAgent)?.contextMcp) {
    durableRefs.push({
      kind: "conversation",
      uri: `context://conversation/${input.convId}`,
      description: "Histórico SQLite consultável pelo mc-context",
    })
  }
  let envelope = buildContextEnvelope({
    convId: input.convId,
    sourceAgent: input.sourceAgent,
    targetAgent: input.targetAgent,
    items: input.items,
    pendingUserIndex: input.pendingUserIndex,
    diff,
    lessonsBlock: input.lessonsBlock,
    references: durableRefs,
    date: input.date,
  })
  const transcript = renderTranscript(input.items, {
    agent: input.sourceAgent,
    date: input.date,
  })
  let paths: ContextBundlePaths | null = null
  try {
    paths = await write(
      input.cwd,
      input.convId,
      transcript,
      JSON.stringify(envelope, null, 2),
    )
    // Backend é fonte do path real. Mantém o manifesto/prompt honestos caso a
    // convenção mude; regrava somente se divergiu do path previsto.
    if (
      paths.transcriptPath !== predictedTranscript ||
      paths.manifestPath !== predictedManifest
    ) {
      envelope = {
        ...envelope,
        references: envelope.references.map((ref) =>
          ref.kind === "transcript"
            ? { ...ref, path: paths!.transcriptPath }
            : ref.kind === "manifest"
              ? { ...ref, path: paths!.manifestPath }
              : ref,
        ),
      }
      await write(
        input.cwd,
        input.convId,
        transcript,
        JSON.stringify(envelope, null, 2),
      )
    }
  } catch {
    // O SQLite via MCP ainda pode estar disponível nos agents que suportam o
    // gateway, mas não promete arquivos que falharam ao gravar.
    envelope = {
      ...envelope,
      references: envelope.references.filter((ref) => ref.kind === "conversation"),
    }
  }
  return {
    envelope,
    paths,
    prompt: renderHybridHandoff(
      envelope,
      input.personaBlock,
      input.doctrineBlock,
    ),
  }
}

// Compatibilidade com auto-resume e fluxos legados de MESMO provider. Mantém o
// recap barato e tail-biased; transplants cross-provider usam prepareHybridHandoff.
const LEGACY_BUDGET_CHARS = 36_000

export function buildHandoff(items: ChatItem[]): string {
  const history = recentHistory(items, LEGACY_BUDGET_CHARS)
  return [
    "Você está CONTINUANDO uma conversa NESTE MESMO diretório.",
    "Os arquivos no disco já refletem o trabalho feito até aqui; não refaça o que já existe.",
    "",
    "Contexto da conversa até aqui:",
    "",
    // H3 — mesmo aqui no caminho legado, o histórico serializado é dado, não pedido.
    frameHistory(history.text),
  ].join("\n")
}
