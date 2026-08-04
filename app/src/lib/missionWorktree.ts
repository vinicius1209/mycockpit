// MH1.4 — VERDADE no modal e no launch da missão: o subtítulo do launcher
// promete "no worktree desta conversa", então sem worktree a missão CRIA um
// antes de rodar (MESMO mecanismo do toggle da sidebar: create_worktree do
// backend, com a mesma convenção de nome/branch por convId). Falha na criação
// NUNCA degrada em silêncio (o comportamento antigo caía na pasta do projeto
// sem avisar, store/mission.ts:374): o usuário confirma explicitamente rodar
// na pasta do projeto, ou a missão não larga.
//
// Deps injetáveis (create/ask/inTauri) pra teste puro; o store passa os reais.

import { confirm, type ConfirmReq } from "@/lib/confirm"
import { isTauri } from "@/lib/db"
import { createWorktree } from "@/lib/git"

export interface EnsureMissionCwdArgs {
  convId: string
  projectPath: string
  /** Worktree JÁ ligado à conversa (useChat), se houver. */
  worktreePath: string | null
  /** Retomada NUNCA muda o cwd: o run-state e os handoffs já moram onde a
   *  missão começou (criar worktree agora os deixaria para trás). */
  resume: boolean
}

export interface EnsureMissionCwdDeps {
  create?: typeof createWorktree
  ask?: (req: ConfirmReq) => Promise<boolean>
  inTauri?: () => boolean
}

export interface EnsureMissionCwdResult {
  /** false = a criação falhou E o usuário recusou rodar na pasta do projeto —
   *  a missão NÃO deve largar (fail-closed no efeito). */
  ok: boolean
  cwd: string
  /** Worktree criado AGORA (o chamador liga na conversa via setWorktree). */
  created: boolean
  /** Branch do worktree criado (pro notice honesto no fio). */
  branch?: string
  /** Caiu na pasta do projeto após falha de criação, COM confirmação. */
  fallback: boolean
}

/** Resolve o cwd da missão: worktree existente > worktree criado agora >
 *  pasta do projeto (só com confirmação explícita após falha). Fora do Tauri
 *  (dev/browser/teste) não há backend de git — degrada pra pasta do projeto
 *  sem perguntar (não há o que criar, nem promessa de isolamento a quebrar). */
export async function ensureMissionCwd(
  args: EnsureMissionCwdArgs,
  deps: EnsureMissionCwdDeps = {},
): Promise<EnsureMissionCwdResult> {
  const { convId, projectPath, worktreePath, resume } = args
  if (worktreePath) {
    return { ok: true, cwd: worktreePath, created: false, fallback: false }
  }
  if (resume) {
    return { ok: true, cwd: projectPath, created: false, fallback: false }
  }
  const inTauri = deps.inTauri ?? isTauri
  if (!inTauri()) {
    return { ok: true, cwd: projectPath, created: false, fallback: false }
  }
  const create = deps.create ?? createWorktree
  try {
    const info = await create(projectPath, convId)
    return {
      ok: true,
      cwd: info.path,
      created: true,
      branch: info.branch,
      fallback: false,
    }
  } catch (e) {
    // git.rs rejeita com string legível (mesma leitura do toggle da sidebar).
    const reason = typeof e === "string" && e ? `${e}\n\n` : ""
    const ask = deps.ask ?? confirm
    const accepted = await ask({
      title: "Não consegui criar o worktree",
      description:
        `${reason}A missão pode rodar direto na pasta do projeto, sem isolamento (as mudanças acontecem nos arquivos reais). Continuar mesmo assim?`,
      confirmLabel: "Rodar na pasta do projeto",
      cancelLabel: "Cancelar missão",
      danger: true,
    })
    return accepted
      ? { ok: true, cwd: projectPath, created: false, fallback: true }
      : { ok: false, cwd: projectPath, created: false, fallback: false }
  }
}
