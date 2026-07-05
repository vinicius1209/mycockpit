// Inbox de decisões: TUDO que espera o humano, num lugar só. O trabalho do
// piloto num cockpit multi-agent não é ler chats, é DECIDIR: disputa esperando
// veredito (fusion_runs pendentes no DB), PRD esperando aprovação e PR aberto
// (manifests do SDD no disco). Varredura barata (SQL + fs), sob demanda.

import { listPendingDecisions } from "@/lib/db"
import { loadSddPlans } from "@/lib/sdd"
import type { Project } from "@/lib/types"

export type Decision =
  | {
      kind: "fusion"
      convId: string
      projectId: string
      projectName: string
      title: string
    }
  | {
      kind: "prd"
      projectId: string
      projectName: string
      slug: string
      planTitle: string
    }
  | {
      kind: "pr"
      projectId: string
      projectName: string
      slug: string
      planTitle: string
      prUrl: string
    }

export async function scanDecisions(projects: Project[]): Promise<Decision[]> {
  const out: Decision[] = []
  const byId = new Map(projects.map((p) => [p.id, p]))

  // 1. disputas do Fusion esperando o veredito (persistidas, cross-restart).
  const pendings = await listPendingDecisions()
  for (const f of pendings) {
    const p = byId.get(f.projectId)
    if (!p) continue // projeto arquivado: a disputa reaparece se ele voltar
    out.push({
      kind: "fusion",
      convId: f.convId,
      projectId: f.projectId,
      projectName: p.name,
      title: f.title ?? "Disputa aguardando decisão",
    })
  }

  // 2. gates do SDD por projeto (fs; projeto sem .claude/plans devolve []).
  const scans = await Promise.all(
    projects.map(async (p) => ({ p, plans: await loadSddPlans(p.path) })),
  )
  for (const { p, plans } of scans) {
    for (const plan of plans) {
      if (plan.stage === "prd" && plan.artifacts.prd && !plan.artifacts.prd.approved) {
        out.push({
          kind: "prd",
          projectId: p.id,
          projectName: p.name,
          slug: plan.slug,
          planTitle: plan.title,
        })
      } else if (plan.links.pr_url && plan.stage !== "done" && !plan.mergedAt) {
        out.push({
          kind: "pr",
          projectId: p.id,
          projectName: p.name,
          slug: plan.slug,
          planTitle: plan.title,
          prUrl: plan.links.pr_url,
        })
      }
    }
  }
  return out
}
