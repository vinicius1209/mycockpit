import type { ConvState } from "@/store/chat"
import type { Project } from "@/lib/types"

/** Alvo resolvido de um envio: a conversa + o projeto DONO dela. */
export type SendTarget =
  | { status: "ok"; convId: string; conv: ConvState; project: Project }
  /** Nenhuma conversa alvo (nada selecionado) — o envio é ignorado em silêncio. */
  | { status: "none" }
  /** Conversa ainda não hidratada em byId (janela do switch de projeto). */
  | { status: "loading"; convId: string }
  /** A conversa existe mas o projeto dono sumiu (removido) — nada a rodar. */
  | { status: "orphan"; convId: string }

/** Resolve PARA ONDE um envio vai (conversa + projeto).
 *
 *  Regra: o projeto sai de `conv.projectId` — o dono do fio —, NUNCA do projeto
 *  em foco. Envios RE-ENTRANTES (drenagem da fila no fim do turno, auto-resume)
 *  disparam tempo depois do turno começar; lendo o foco, a mensagem enfileirada
 *  na conversa do projeto X ia parar na conversa aberta do projeto Y — com o
 *  cwd, a permissão e as lições do projeto errado. */
export function resolveSendTarget(
  convId: string | null,
  byId: Record<string, ConvState>,
  projects: Project[],
): SendTarget {
  if (!convId) return { status: "none" }
  const conv = byId[convId]
  if (!conv) return { status: "loading", convId }
  const project = projects.find((p) => p.id === conv.projectId)
  if (!project) return { status: "orphan", convId }
  return { status: "ok", convId, conv, project }
}
