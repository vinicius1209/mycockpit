import { toast } from "sonner"
import { agentLabel, runAgent } from "@/lib/agent"
import { agentDef, dispatchBlockReason } from "@/lib/agents"
import { buildDoctrineBlock, doctrineFingerprint, readDoctrine } from "@/lib/doctrine"
import { prepareHybridHandoff } from "@/lib/handoff"
import { buildLearningBlocks, markLessonsUsed } from "@/lib/learning"
import { notifyTurnEnd } from "@/lib/notify"
import { personaHandoffBlock } from "@/lib/presets"
import {
  modoEfetivoDoSpawn,
  permissaoDoSpawn,
  type SessionMode,
} from "@/lib/sessionMode"
import { expandPendingForTarget } from "@/lib/slashCommands"
import { pendingExecutorRequest } from "@/lib/turnOutcome"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

function recordHandoffError(convId: string, error: unknown) {
  const message = typeof error === "string" ? error : "Falha no revezamento"
  const conv = useChat.getState().byId[convId]
  const last = conv?.items[conv.items.length - 1]
  if (!last || last.kind !== "error" || last.message !== message) {
    useChat.getState().handleEvent(convId, { type: "error", message })
  }
  toast.error(message)
}

export async function continueConversationWith({
  convId,
  projectId,
  projectPath,
  permissionMode,
  target,
  recordLessons,
  onPrepared,
}: {
  convId: string
  projectId: string
  projectPath: string
  permissionMode: SessionMode | null | undefined
  target: string
  recordLessons: (ids: string[]) => void
  onPrepared: () => void
}) {
  const conv = useChat.getState().byId[convId]
  if (
    !conv ||
    conv.running ||
    conv.finalizing ||
    conv.preparing ||
    conv.corrupt
  ) {
    return
  }
  const dispatchBlock = dispatchBlockReason(
    target,
    useApp.getState().settings.detected ?? {},
  )
  if (dispatchBlock) {
    toast.error(dispatchBlock)
    return
  }
  const pending = pendingExecutorRequest(conv.items)
  if (!pending?.text) return

  const runId = crypto.randomUUID()
  let accepted = false
  useChat.getState().beginPreparation(convId, runId)
  useChat.getState().cancelAutoResume(convId)
  useChat.getState().invalidateSuggestions(convId)

  try {
    // O gesto já está visível no composer antes do primeiro await. Qualquer
    // falha abaixo cai no finally e devolve o campo ao repouso.
    onPrepared()
    const pendingForTarget = await expandPendingForTarget(
      pending.text,
      projectPath,
      target,
    )
    const pendingText = pendingForTarget.note
      ? `${pendingForTarget.text}\n\n(${pendingForTarget.note})`
      : pendingForTarget.text
    const handoffItems = conv.items.map((item, index) =>
      index === pending.index && item.kind === "user"
        ? { ...item, text: pendingText }
        : item,
    )
    let personaBlock = await personaHandoffBlock(
      conv.presetId,
      conv.presetDigest,
      projectPath,
    )
    const doctrineRaw = buildDoctrineBlock(
      (await readDoctrine(projectPath)).content,
    )
    let doctrine = doctrineRaw
    let systemPrompt: string | null = null
    if (agentDef(target)?.systemChannel) {
      systemPrompt =
        [personaBlock, doctrine].filter(Boolean).join("\n\n") || null
      personaBlock = null
      doctrine = null
    }
    let lessonsBlock: string | null = null
    let lessonIds: string[] = []
    try {
      const blocks = await buildLearningBlocks(projectId, pending.text, false)
      lessonsBlock = blocks.lessons
      lessonIds = blocks.lessonIds
    } catch {
      lessonIds = []
    }
    const cwd = conv.worktreePath ?? projectPath
    const prepared = await prepareHybridHandoff({
      projectId,
      cwd,
      convId,
      sourceAgent: conv.agent,
      targetAgent: target,
      items: handoffItems,
      pendingUserIndex: pending.index,
      personaBlock,
      doctrineBlock: doctrine,
      lessonsBlock,
    })
    const fresh = useChat.getState().byId[convId]
    if (
      !fresh ||
      fresh.running ||
      fresh.finalizing ||
      (fresh.preparing && fresh.preparing.runId !== runId)
    ) {
      return
    }

    await runAgent(
      runId,
      convId,
      target,
      null,
      null,
      prepared.prompt,
      cwd,
      null,
      permissaoDoSpawn(
        modoEfetivoDoSpawn(fresh.sessionMode, permissionMode),
      ),
      pending.attachments,
      (event) => {
        if (event.type === "preflight_blocked") {
          useChat.getState().blockPreparation(convId, runId, event.gate)
          return
        }
        if (event.type === "run_manifest" && !accepted) {
          accepted = true
          useChat.getState().beginTransplant(convId, runId, target)
          useChat.getState().handleEvent(convId, {
            type: "notice",
            message: prepared.paths
              ? `revezamento: memória híbrida pronta · preparando ${agentLabel(target)}`
              : `revezamento: contexto compacto · preparando ${agentLabel(target)} (export indisponível)`,
          })
          if (doctrineRaw) {
            useChat.getState().recordInjectedFingerprint(
              convId,
              "doctrine",
              doctrineFingerprint(doctrineRaw),
            )
          }
          recordLessons(lessonIds)
          if (lessonIds.length > 0) void markLessonsUsed(lessonIds)
        }
        if (accepted) useChat.getState().handleEvent(convId, event)
      },
      false,
      null,
      systemPrompt,
      useChat.getState().byId[convId]?.injected?.mcp ?? null,
      pendingForTarget.instructionSources,
    )
  } catch (error) {
    if (accepted) recordHandoffError(convId, error)
    else toast.error("O revezamento não foi iniciado.")
  } finally {
    if (accepted) {
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
      void notifyTurnEnd(convId, target)
      useChat.getState().scheduleSuggestions(convId)
    } else {
      useChat.getState().clearPreparation(convId, runId)
    }
  }
}
