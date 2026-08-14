// FECHAMENTO da missão: a ENTREGA (M1) e a LIÇÃO (M2). Extraído de
// store/mission.ts sem mudança de comportamento (a catraca de tamanho cobrou a
// divisão do arquivo). É a parte do "done" que não decide nada sobre o
// pipeline: só grava o que ele produziu.
//
// Best-effort SEMPRE: nada aqui pode quebrar o desfecho. Entrega não gravada
// custa recall futuro, não a missão.

import { insertDelivery } from "@/lib/db"
import { loadGitDiff } from "@/lib/git"
import { distillLesson } from "@/lib/learning"
import { readHandoff } from "@/lib/missionHandoff"
import { handoffFileName } from "@/lib/missionPaths"
import { noticeItem, summarize } from "@/lib/missionMarks"
import type {
  MissionDoneSummary,
  MissionPhaseDef,
  MissionReviewCaveat,
} from "@/lib/missionTypes"
import type { ChatItem } from "@/store/chat"

export interface MissionCloseArgs {
  projectId: string
  cwd: string
  dir: string
  task: string
  phases: MissionPhaseDef[]
  plannerSummary: string
  execAgent: string
  execModel: string | null
  costUsd: number
  /** Correções REAIS resolvidas no voo (a matéria-prima da lição). */
  corrections: string[]
  /** Modelo auxiliar da destilação. null = sem lição (não se inventa uma). */
  helperModel: string | null
}

/** M1 — grava a ENTREGA (evento de alto sinal: passou nos gates). Arquivos =
 *  paths do diff do worktree; fallback = files_touched dos handoffs. */
export async function recordDelivery(args: MissionCloseArgs): Promise<void> {
  try {
    let files: string[] = []
    const diff = await loadGitDiff(args.cwd)
    if (diff.isRepo && diff.files.length) {
      files = diff.files.map((f) => f.path)
    } else {
      const seen = new Set<string>()
      for (let j = 0; j < args.phases.length; j++) {
        const doc = await readHandoff(
          args.cwd,
          handoffFileName(args.dir, j, args.phases[j].persona),
        )
        for (const f of doc?.files_touched ?? []) seen.add(f)
      }
      files = [...seen]
    }
    await insertDelivery({
      projectId: args.projectId,
      task: args.task,
      planSummary: args.plannerSummary,
      filesTouched: files,
      costUsd: args.costUsd,
      agent: args.execAgent,
      model: args.execModel,
    })
  } catch {
    // entrega não gravada não invalida a missão — só perde o recall futuro.
  }
}

/** M2 — destila UMA lição das correções REAIS que foram resolvidas. Estágio 1
 *  do funil: grava como CANDIDATE (não injeta até ser promovida na auditoria).
 *  Sem correção ou sem modelo auxiliar, não há lição a inventar. */
export function recordLesson(args: MissionCloseArgs): void {
  if (!args.corrections.length || !args.helperModel) return
  void distillLesson({
    projectId: args.projectId,
    cwd: args.cwd,
    helperModel: args.helperModel,
    reviewerFeedback: args.corrections.join("\n\n---\n\n"),
  })
}

/** Os MARCOS do desfecho no fio: aviso de teto furado na última fase, ressalva
 *  do revisor, o `result` com o custo e o resumo estruturado. Puro (composição
 *  de itens; quem grava é o store).
 *
 *  O aviso de teto existe porque o checkBudget é gate de fase NOVA: depois da
 *  última ninguém checava, e a missão fechava `done` com costTotal acima do
 *  teto em silêncio. O desfecho não muda (o gasto já ocorreu e o trabalho foi
 *  entregue); o registro é o mínimo honesto. */
export function finishMarks(args: {
  presetName: string
  finalCost: number
  maxCostUsd: number | null
  reviewCaveat: MissionReviewCaveat | null
  doneSummary: MissionDoneSummary | null
}): ChatItem[] {
  const { reviewCaveat: rc, doneSummary: ds, finalCost } = args
  const marks: ChatItem[] = []
  if (args.maxCostUsd != null && finalCost > args.maxCostUsd) {
    marks.push(
      noticeItem(
        `⚠️ Custo final US$ ${finalCost.toFixed(2)} passou o teto de US$ ${args.maxCostUsd.toFixed(2)} (o estouro aconteceu na última fase, depois do último check).`,
      ),
    )
  }
  if (rc) {
    marks.push(
      noticeItem(
        rc.rounds > 0
          ? `⚠️ Concluída SEM aprovação do revisor após ${rc.rounds} ${rc.rounds === 1 ? "rodada" : "rodadas"} de correção. Revise o parecer antes de confiar na entrega.`
          : "⚠️ Concluída SEM aprovação do revisor (não havia executor para uma rodada de correção). Revise o parecer antes de confiar na entrega.",
      ),
    )
  }
  marks.push({
    kind: "result",
    id: crypto.randomUUID(),
    ok: true,
    costUsd: finalCost,
    text: rc
      ? `Missão concluída com ressalva do revisor · preset ${args.presetName}`
      : `Missão concluída · preset ${args.presetName}`,
  })
  const lines: string[] = []
  if (ds?.intent) lines.push(ds.intent)
  if (ds?.filesTouched.length) lines.push(`Arquivos: ${ds.filesTouched.join(", ")}`)
  if (ds?.openQuestions.length) {
    lines.push(`Pendências:\n${ds.openQuestions.map((q) => `- ${q}`).join("\n")}`)
  }
  if (rc?.feedback) lines.push(`Parecer do revisor:\n${summarize(rc.feedback)}`)
  if (lines.length) {
    marks.push({ kind: "text", id: crypto.randomUUID(), text: lines.join("\n\n") })
  }
  return marks
}

/** Marco terminal de ERRO (teto ou falha): result !ok com o custo total e o
 *  motivo. Puro; quem grava e quem notifica é o store. */
export function errorMark(costUsd: number, reason: string): ChatItem {
  return {
    kind: "result",
    id: crypto.randomUUID(),
    ok: false,
    costUsd,
    text: `Missão interrompida: ${reason}`,
  }
}
