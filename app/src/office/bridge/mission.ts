// office/bridge/mission.ts — lançamento REAL de missão da mesa de reunião
// (O-2, docs/agent-office.md §8/§5 item 9): via useMission.launch DIRETO —
// nunca requestMissionLaunch (que depende do CommandConsole dentro do
// ChatPanel oculto). Fora do send.ts de propósito: lançar missão não é a
// coreografia de turno da mesa (§9) — é registrar uma conversa nova no
// projeto escolhido e entregar ao motor de missões, que roda sozinho.
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import {
  DEFAULT_MISSION_PRESETS,
  type MissionPreset,
  type MissionRun,
} from "@/lib/missionTypes"

// Re-exports pra ui/ não importar lib/stores do app diretamente (regra §6).
export { parseCapInput } from "@/lib/missionDraft"
export type { MissionPhaseRun, MissionPreset, MissionRun } from "@/lib/missionTypes"

/** Preset padrão da mesa de reunião: o "feature" das Settings (editável lá),
 *  senão o primeiro preset salvo, senão o de fábrica. A mesa NÃO edita fases
 *  (isso é papel do MissionLauncher do Linear) — só o teto de custo. */
export function missionTablePreset(): MissionPreset {
  const presets = useApp.getState().settings.missionPresets
  return (
    presets.find((p) => p.id === "feature") ??
    presets[0] ??
    DEFAULT_MISSION_PRESETS[0]
  )
}

/** Lança a missão de verdade: registra uma conversa NOVA em background no
 *  projeto (título fixo "Missão · …", agent da 1ª fase carimbado — sem o
 *  carimbo a mesa do claude-code adotaria a conversa, mesma razão do
 *  ensureDeskConversation) e entrega ao useMission.launch com a permissão do
 *  projeto (permissionMode ?? "padrao" — mesma resolução do MissionLauncher).
 *  Retorna o convId da missão, ou null se o projeto sumiu do store. */
export async function launchTableMission(args: {
  projectId: string
  title: string
  task: string
  preset: MissionPreset
}): Promise<string | null> {
  const { projectId, title, task, preset } = args
  const project = useApp.getState().projects.find((p) => p.id === projectId)
  if (!project) return null
  const convId = crypto.randomUUID()
  const chat = useChat.getState()
  await chat.registerConversation(projectId, convId, title, preset.phases[0]?.agent)
  await chat.ensureConversationLoaded(projectId, convId)
  void useMission
    .getState()
    .launch(
      convId,
      preset,
      task.trim(),
      projectId,
      project.path,
      project.permissionMode ?? "padrao",
    )
  return convId
}

/** Aborta a missão lançada da mesa (Stop do MissionDock — mesmo gesto do
 *  MissionTimeline do ChatPanel; cancel_agent da fase corrente sai do store). */
export function abortTableMission(convId: string): void {
  useMission.getState().abort(convId)
}

/** MissionRun da conversa lançada da mesa (acompanhamento no MissionDock —
 *  assinatura larga como o useDeskConversation do DeskDock: o painel É a
 *  superfície do stream). null = sem missão. */
export function useMissionTableRun(convId: string | null): MissionRun | null {
  return useMission((s) => (convId ? (s.byConv[convId] ?? null) : null))
}

/** Andamento por VALOR (assinatura "status:current:total") pro MENU-BALÃO —
 *  string estável evita re-render do overlay a cada onProgress da missão
 *  (mesma regra dos seletores estreitos do Prompts). null = sem missão. */
export function useMissionTableSig(convId: string | null): string | null {
  return useMission((s) => {
    if (!convId) return null
    const run = s.byConv[convId]
    return run ? `${run.status}:${run.current}:${run.phases.length}` : null
  })
}
