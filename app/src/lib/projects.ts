// Adição de projeto via seletor de pasta nativo — extraído do App.tsx p/ ser
// reusado pela Sidebar E pelo wizard de onboarding (mesma lógica de dedupe/
// restauração). Toca a store (setProjects/addProject/setActiveProject) direto.
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import {
  isTauri,
  listProjects,
  insertProject,
  findProjectByPath,
  restoreProject,
} from "@/lib/db"
import { useApp } from "@/store/app"
import type { Project } from "@/lib/types"

/** Abre o picker de pasta, insere o projeto (dedupe por path; restaura se
 *  arquivado) e o seleciona. Não devolve nada — os chamadores observam a store
 *  (projects) reativamente. */
export async function addProjectViaDialog(): Promise<void> {
  if (!isTauri()) {
    toast("Seleção de pasta disponível no app (tauri dev)")
    return
  }
  try {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Escolha a pasta do projeto",
    })
    if (typeof dir !== "string") return
    const name = dir.split("/").filter(Boolean).pop() ?? dir
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      path: dir,
      createdAt: Date.now(),
      hasClaudeMd: false,
      hasAgentsMd: false,
      status: "idle",
    }
    const inserted = await insertProject(project)
    if (!inserted) {
      // path já cadastrado (talvez arquivado): restaura/seleciona o registro
      // real em vez de criar um id fantasma que evapora no restart.
      const existing = await findProjectByPath(dir)
      if (existing) {
        if (existing.deleted) await restoreProject(existing.id)
        const fresh = await listProjects()
        if (fresh) useApp.getState().setProjects(fresh)
        useApp.getState().setActiveProject(existing.id)
        toast.success(
          existing.deleted
            ? `Projeto restaurado: ${name}`
            : `Projeto já existia: ${name}`,
        )
        return
      }
    }
    useApp.getState().addProject(project)
    useApp.getState().setActiveProject(project.id)
    toast.success(`Projeto adicionado: ${name}`)
  } catch (e) {
    console.error(e)
    toast.error("Não foi possível adicionar o projeto")
  }
}
