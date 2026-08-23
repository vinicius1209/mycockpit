// A API de FEEDBACK do fio: reagir a um turno e destilar uma lição.
//
// Saiu do ChatPanel pela catraca, e o recorte é fechado: tudo aqui depende de
// `getState()` e de duas funções de `lib/learning`, mais o ref das lições
// injetadas no turno — nada de props, nada de árvore de render. O ChatPanel
// ficou com QUANDO montar; o QUE o feedback faz mora aqui.

import { useMemo, type RefObject } from "react"
import { distillCandidate, reinforceLessons, saveLesson } from "@/lib/learning"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export function useFeedbackDoFio(
  viewMode: string,
  project: { id: string; path: string } | null | undefined,
  conv: { worktreePath?: string | null } | null | undefined,
  /** Lições injetadas por conversa no turno corrente — o reforço só vale pro
   *  ÚLTIMO resultado, então precisa do que foi injetado agora. */
  injectedLessonsRef: RefObject<Record<string, string[]>>,
) {
  return useMemo(() => {
    if (viewMode !== "linear" || !project) return null
    const cfg = useApp.getState().mycockpit[project.id]
    const helperModel = cfg
      ? cfg.helper
      : useApp.getState().settings.helperModel
    const cwd = conv?.worktreePath ?? project.path
    return {
      onReact: async (resultId: string, reaction: string) => {
        const convId = useChat.getState().activeId
        if (!convId) return false
        const added = await useChat
          .getState()
          .toggleTurnReaction(convId, resultId, reaction)
        // Reação positiva no ÚLTIMO resultado reforça as lições que realmente
        // foram injetadas nesse turno. Resultado histórico não usa o ref atual.
        const results = useChat
          .getState()
          .byId[convId]?.items.filter((it) => it.kind === "result")
        const isLatest = results?.at(-1)?.id === resultId
        if (added && reaction !== "👎" && isLatest) {
          const ids = injectedLessonsRef.current[convId] ?? []
          if (ids.length) await reinforceLessons(ids)
        }
        return added
      },
      distill: (agentTurn: string, userNote: string) =>
        distillCandidate({ cwd, helperModel, agentTurn, userNote }),
      save: (
        rule: string,
        scope: "global" | "project",
        reaction?: string | null,
      ) =>
        saveLesson({
          projectId: project.id,
          rule,
          scope,
          source: reaction ? `feedback:${reaction}` : "feedback:note",
        }),
    }
    // conv.worktreePath entra p/ o cwd acompanhar o worktree da conversa ativa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, project?.id, project?.path, conv?.worktreePath])
}
