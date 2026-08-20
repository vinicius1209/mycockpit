// Dono ÚNICO da leitura de worktrees do projeto.
//
// A faixa de status recusou "branch/alterações" com um motivo escrito
// (StatusBar.tsx): o diff é lido por efeito local do ContextPanel/DiffPanel, e
// uma segunda leitura de git só pra encher a faixa daria dois donos pro mesmo
// número. Esta store existe pra que a regra continue valendo com um sinal novo
// entrando: quem lê o git é UM, e o item da faixa e o diálogo leem a store.
//
// Sob demanda, nunca em laço. Worktree solto não muda sozinho — muda quando
// VOCÊ apaga uma conversa, tira um isolamento ou troca de projeto. Um poll
// periódico gastaria processo de git pra confirmar um número parado.

import { create } from "zustand"
import { deleteWorktreeBranch, listWorktrees, removeWorktree } from "@/lib/git"
import { type LooseWorktree, type WorktreeEntry } from "@/lib/worktrees"
import { isTauri } from "@/lib/db"

interface WorktreesState {
  /** Última leitura por projeto. Ausente = nunca lido (≠ lido e vazio). */
  byProject: Record<string, WorktreeEntry[]>
  refresh: (projectId: string, projectPath: string) => Promise<void>
  /** Recolhe UMA entrada. Devolve a mensagem de erro, ou `null` se deu certo. */
  reclaim: (
    projectId: string,
    projectPath: string,
    w: LooseWorktree,
  ) => Promise<string | null>
}

export const useWorktrees = create<WorktreesState>((set, get) => ({
  byProject: {},

  refresh: async (projectId, projectPath) => {
    if (!isTauri()) return // browser/dev: não há git pra consultar
    try {
      const entries = await listWorktrees(projectPath)
      set((s) => ({ byProject: { ...s.byProject, [projectId]: entries } }))
    } catch {
      // projeto que não é repo git, git ausente: não é erro do usuário, e a
      // faixa simplesmente não mostra item. Silêncio aqui é o correto.
    }
  },

  reclaim: async (projectId, projectPath, w) => {
    try {
      // Com pasta, `removeWorktree` já leva o branch junto; sem pasta, só o
      // branch sobrou e é ele o alvo. Nos dois casos o Rust usa `-d`, então o
      // git recusa se houver trabalho — a nossa contagem nunca é a última
      // palavra sobre apagar.
      if (w.path) await removeWorktree(projectPath, w.path)
      else await deleteWorktreeBranch(projectPath, w.branch)
    } catch (e) {
      return typeof e === "string" && e ? e : "o git recusou a remoção"
    }
    await get().refresh(projectId, projectPath)
    return null
  },
}))
