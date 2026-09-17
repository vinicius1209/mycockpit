// Continuidade híbrida entre providers.
//
// PUSH: um working set pequeno (estado, falha, arquivos, histórico recente).
// PULL: manifesto + transcript no disco e MCP mc-context para buscar no SQLite
// e expandir somente as referências necessárias.

import { invoke } from "@tauri-apps/api/core"
import { agentDef, defaultModelFor } from "@/lib/agents"
import { contextWindowFor } from "@/lib/contextWindow"
import { memoriaDaConversa } from "@/lib/memoriaDaConversa"
import { CHARS_POR_TOKEN, orcamentoDaMemoria } from "@/lib/orcamentoDaMemoria"
import { loadGitDiff, type GitDiff } from "@/lib/git"
import { toolDigest } from "@/lib/fusion"
import { renderTranscript } from "@/lib/transcript"
import { conteudoDaMoldura, frameHistory } from "@/lib/trust"
import type { ChatItem } from "@/store/chat"

/** Piso do que o revezamento leva do fio (~2k tokens). Era o orçamento inteiro
 *  do contrato v1; no v2 é o mínimo, para janela desconhecida não levar MENOS
 *  do que já levava. O restante fica no transcript/SQLite. */
export const HANDOFF_RECENT_BUDGET_CHARS = 6_000
/** Parte do orçamento que vai para as últimas mensagens literais; o resto é a
 *  memória por significado (a mesma do `/compactar`). */
export const HANDOFF_FRACAO_DA_CAUDA = 0.25
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
  version: 2
  generated_at: string
  conversation_id: string
  source_agent: string
  target_agent: string
  objective: string
  /** Inteiro no manifesto, mas aparece uma única vez no prompt: no final. */
  pending_request: string
  source_failure: string | null
  /** Contrato v2: memória por significado (pedidos, decisões, falhas, onde
   *  parou), orçada pela janela do motor de destino. Sem moldura: quem
   *  renderiza emoldura memória e últimas mensagens juntas, num bloco só. */
  conversation_memory: string
  /** As últimas mensagens literais, com uma fração do orçamento. */
  recent_history: string
  changed_files: ChangedFilePointer[]
  branch: string | null
  lessons: string[]
  references: ContextReference[]
  truncation: {
    conversation_memory: boolean
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
  /** Janela do motor de destino em tokens. Ausente: a do modelo padrão dele;
   *  desconhecida, o piso. */
  janelaDoDestino?: number | null
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
  if (it.kind === "user") {
    // pedido endereçado a um conselheiro viaja marcado (mesmo rótulo do
    // serializeContext): o motor que recebe o bastão não pode ler a consulta
    // como uma ordem pendente pra ele.
    const to = it.advisorTo ? ` (para ${it.advisorTo.name})` : ""
    return `Usuário${to}: ${it.text}`
  }
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

/** Quanto o revezamento leva do fio para esta janela: a régua do `/compactar`
 *  (`transplante`), nunca abaixo do piso do contrato v1. */
export function orcamentoDoHandoff(janelaTokens: number | null): number {
  return Math.max(HANDOFF_RECENT_BUDGET_CHARS, orcamentoDaMemoria(janelaTokens, "transplante"))
}

/** Janela do motor de destino quando o chamador não sabe o modelo: a do modelo
 *  padrão do registry. `null` quando nem isso se conhece. */
export function janelaPadraoDoMotor(agent: string): number | null {
  return contextWindowFor(defaultModelFor(agent))
}

/** Quantos tokens do fio o revezamento para `targetAgent` levaria agora, pela
 *  MESMA montagem do envelope v2 e a mesma régua de caracteres por token do
 *  orçamento (que superestima de propósito). É estimativa, e a UI diz isso. */
export function estimativaDoHandoff(
  items: ChatItem[],
  targetAgent: string,
  janelaDoDestino: number | null = janelaPadraoDoMotor(targetAgent),
): number {
  if (items.length === 0) return 0
  const orcamento = orcamentoDoHandoff(janelaDoDestino)
  const cauda = Math.floor(orcamento * HANDOFF_FRACAO_DA_CAUDA)
  const memoria = memoriaDaConversa(items, orcamento - cauda).texto.length
  const recentes = Math.min(recentHistory(items, cauda).text.length, cauda)
  return Math.ceil((memoria + recentes) / CHARS_POR_TOKEN)
}

/** "leva ~12 mil tokens do histórico (estimativa)". */
export function rotuloDaEstimativa(tokens: number): string {
  if (tokens <= 0) return "sem histórico para levar"
  if (tokens < 1_000) return "leva menos de mil tokens do histórico (estimativa)"
  return `leva ~${Math.round(tokens / 1_000)} mil tokens do histórico (estimativa)`
}

/** Rótulo humano do motor para o prompt ("Claude Code", não "claude-code"). */
function rotuloDoMotor(agent: string): string {
  return agentDef(agent)?.label ?? agent
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
  janelaDoDestino?: number | null
}): ContextEnvelope {
  const pending = input.items[input.pendingUserIndex]
  if (!pending || pending.kind !== "user") {
    throw new Error("handoff sem pedido pendente")
  }
  const anteriores = input.items.slice(0, input.pendingUserIndex)
  const janela =
    input.janelaDoDestino === undefined ? janelaPadraoDoMotor(input.targetAgent) : input.janelaDoDestino
  const orcamento = orcamentoDoHandoff(janela)
  const cauda = Math.floor(orcamento * HANDOFF_FRACAO_DA_CAUDA)
  const memoria = anteriores.length > 0 ? memoriaDaConversa(anteriores, orcamento - cauda) : null
  const history = recentHistory(anteriores, cauda)
  const cortesDaMemoria = memoria
    ? memoria.cortes.ferramentas + memoria.cortes.respostas + memoria.cortes.outros
    : 0
  const changed = changedFiles(input.diff)
  return {
    version: 2,
    generated_at: (input.date ?? new Date()).toISOString(),
    conversation_id: input.convId,
    source_agent: input.sourceAgent,
    target_agent: input.targetAgent,
    objective: cap(pending.text, 1_000),
    pending_request: pending.text,
    source_failure: failureAfter(input.items, input.pendingUserIndex),
    conversation_memory: memoria ? conteudoDaMoldura(memoria.texto) : "",
    recent_history: cap(history.text, cauda),
    changed_files: changed.files,
    branch: input.diff.branch,
    lessons: lessonLines(input.lessonsBlock),
    references: input.references,
    truncation: {
      conversation_memory: cortesDaMemoria > 0,
      recent_history: history.truncated || history.text.length > cauda,
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
    "## Continuidade Frota",
    "",
    `Você está assumindo no ${rotuloDoMotor(envelope.target_agent)} uma conversa iniciada no ${rotuloDoMotor(envelope.source_agent)}, no MESMO diretório/worktree.`,
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
  // H3 — histórico serializado reinjetado viaja EMOLDURADO: instrução plantada
  // num turno antigo é dado, nunca pedido (frameHistory). Memória e últimas
  // mensagens entram na MESMA moldura: duas molduras seguidas deixariam texto
  // do fio entre um fechamento e a próxima abertura.
  const historico = [
    envelope.conversation_memory && `MEMÓRIA DA CONVERSA:\n${envelope.conversation_memory}`,
    envelope.recent_history && `ÚLTIMAS MENSAGENS:\n${envelope.recent_history}`,
  ].filter(Boolean)
  if (historico.length) {
    state.push("", "Histórico da conversa:", "", frameHistory(historico.join("\n\n")))
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
    janelaDoDestino: input.janelaDoDestino,
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
