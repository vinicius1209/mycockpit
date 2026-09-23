import { invoke } from "@tauri-apps/api/core"

/** Espelha ProjectConfig do Rust (frota_dir.rs) (.frota/config.toml). null = chave ausente. */
export interface ProjectConfigRaw {
  exists: boolean
  /** Nome da pasta da Frota NESTE projeto, resolvido pelo Rust (pode ser o
   *  nome legado num projeto que ainda não migrou). Vai para a tela: literal
   *  no front mentiria nesse caso. */
  pasta: string
  mode: string | null
  helper: string | null
  permission: string | null
  /** Pastas extras liberadas ao agent (viram --add-dir). Valores crus do TOML. */
  extra_dirs: string[]
}

export interface ResultadoDaMigracao {
  /** `["*"]` quando a pasta inteira mudou de nome. */
  movidos: string[]
  /** Existem nas duas pastas e ficaram na antiga: nada é sobrescrito. */
  conflitos: string[]
  viaGit: boolean
}

/** Move a pasta antiga do projeto para `.frota/` (ADR-236). Gesto da pessoa. */
export function migrarPastaDoProjeto(path: string): Promise<ResultadoDaMigracao> {
  return invoke<ResultadoDaMigracao>("migrar_pasta_do_projeto", { path })
}

export async function readProjectConfig(path: string): Promise<ProjectConfigRaw> {
  return invoke<ProjectConfigRaw>("read_project_config", { path })
}

/** Escreve as chaves fornecidas; auto-scaffold de .frota/ + .gitignore.
 *  extra_dirs: passe o array (mesmo vazio, p/ limpar); undefined = não mexe. */
export async function writeProjectConfig(
  path: string,
  patch: {
    mode?: string
    helper?: string
    permission?: string
    extraDirs?: string[]
  },
): Promise<void> {
  await invoke("write_project_config", {
    path,
    mode: patch.mode ?? null,
    helper: patch.helper ?? null,
    permission: patch.permission ?? null,
    extraDirs: patch.extraDirs ?? null,
  })
}
