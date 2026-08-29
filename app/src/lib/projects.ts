// Adição e configuração de projetos — seletor de pasta nativo + diálogo de criação.
// Toca a store (setProjects/addProject/setActiveProject) e o banco diretamente.
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import {
  isTauri,
  listProjects,
  insertProject,
  findProjectByPath,
  restoreProject,
  renameProject,
  setProjectColor,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { COPY_DA_PASTA, conferirPastas } from "@/lib/pastaDoProjeto"
import type { Project } from "@/lib/types"

/** Abre o picker nativo de pasta e devolve o caminho escolhido, ou null. */
export async function pickProjectDirectory(): Promise<string | null> {
  if (!isTauri()) {
    toast("Seleção de pasta disponível no app (tauri dev)")
    return null
  }
  try {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Escolha a pasta do projeto",
    })
    return typeof dir === "string" ? dir : null
  } catch (e) {
    console.error("Falha ao abrir seletor de pasta:", e)
    toast.error("Não foi possível abrir o seletor de pasta")
    return null
  }
}

/** Cria ou restaura um projeto com nome, caminho e cor especificados. */
export async function createProject(opts: {
  name: string
  path: string
  color?: string | null
}): Promise<Project | null> {
  const trimmedPath = opts.path.trim()
  if (!trimmedPath) {
    toast.error("Selecione a pasta do projeto")
    return null
  }
  // A pasta ainda está lá? O picker garante isso no instante do clique, mas
  // entre escolher e confirmar cabe um `mv` no Finder — e cadastrar um projeto
  // que já nasce apontando pro vazio é criar o defeito em vez de evitá-lo.
  const problema = (await conferirPastas([trimmedPath]))[trimmedPath]
  if (problema) {
    toast.error(COPY_DA_PASTA[problema])
    return null
  }
  const derivedName = trimmedPath.split("/").filter(Boolean).pop() ?? trimmedPath
  const name = opts.name.trim() || derivedName
  // `undefined` = o usuário não mexeu na cor; `null` = ele escolheu "sem cor".
  // A diferença importa no re-add: sem ela, abrir o diálogo (que nasce sem cor
  // escolhida) e confirmar APAGAVA a cor que o projeto já tinha.
  const color = opts.color

  const project: Project = {
    id: crypto.randomUUID(),
    name,
    path: trimmedPath,
    createdAt: Date.now(),
    hasClaudeMd: false,
    hasAgentsMd: false,
    color: color ?? null,
    status: "idle",
  }

  try {
    const inserted = await insertProject(project)
    if (!inserted) {
      // path já cadastrado (talvez arquivado): restaura/seleciona o registro
      // real em vez de criar um id fantasma que evapora no restart.
      const existing = await findProjectByPath(trimmedPath)
      if (existing) {
        if (existing.deleted) await restoreProject(existing.id)
        // Só mexe na cor se o usuário escolheu alguma NESTE diálogo — mesma
        // guarda que o nome, logo abaixo, já tinha.
        if (color !== undefined) await setProjectColor(existing.id, color)
        if (opts.name.trim()) await renameProject(existing.id, name)
        const fresh = await listProjects()
        if (fresh) useApp.getState().setProjects(fresh)
        useApp.getState().setActiveProject(existing.id)
        toast.success(
          existing.deleted
            ? `Projeto restaurado: ${name}`
            : `Projeto atualizado: ${name}`,
        )
        return fresh?.find((p) => p.id === existing.id) ?? project
      }
      // Insert recusado E nenhum registro com esse path: o banco não gravou
      // (sem DB, erro de escrita). Seguir daqui colocaria o projeto SÓ na
      // store — ele apareceria na sidebar e evaporaria no restart, que é
      // exatamente o id fantasma que o `findProjectByPath` acima existe pra
      // evitar. Falhar alto é o único desfecho honesto.
      toast.error("Não consegui gravar o projeto no banco")
      return null
    }
    useApp.getState().addProject(project)
    useApp.getState().setActiveProject(project.id)
    toast.success(`Projeto adicionado: ${name}`)
    return project
  } catch (e) {
    console.error("Falha ao adicionar projeto:", e)
    toast.error("Não foi possível adicionar o projeto")
    return null
  }
}

/** Abre o diálogo modal para adicionar projeto. */
export function addProjectViaDialog(): void {
  useApp.getState().setAddProjectOpen(true)
}
