import { invoke } from "@tauri-apps/api/core"

/** Espelha McConfig do Rust (.mycockpit/config.toml). null = chave ausente. */
export interface McConfigRaw {
  exists: boolean
  mode: string | null
  helper: string | null
  permission: string | null
}

export async function readMycockpitConfig(path: string): Promise<McConfigRaw> {
  return invoke<McConfigRaw>("read_mycockpit_config", { path })
}

/** Escreve as chaves fornecidas; auto-scaffold de .mycockpit/ + .gitignore. */
export async function writeMycockpitConfig(
  path: string,
  patch: { mode?: string; helper?: string; permission?: string },
): Promise<void> {
  await invoke("write_mycockpit_config", {
    path,
    mode: patch.mode ?? null,
    helper: patch.helper ?? null,
    permission: patch.permission ?? null,
  })
}
