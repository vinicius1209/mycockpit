// Leitura dos artefatos de UMA missão pro viewer no app (onda 3). As pastas de
// missão (.mycockpit/missions/<slug>/) são gitignoradas — o app lê direto do
// disco via comandos Rust escopados. Resolve o "concern 2": o plano/relatórios
// deixam de ser um arquivo gitignorado que só dá pra abrir no Finder.

import { invoke } from "@tauri-apps/api/core"

/** Lista os arquivos da pasta da missão (relativos ao dir; recursivo). Vazio em
 *  falha ou pasta ausente — o viewer degrada pra "sem artefatos". */
export async function listMissionFiles(
  cwd: string,
  dir: string,
): Promise<string[]> {
  try {
    return await invoke<string[]>("list_mission_files", { cwd, relDir: dir })
  } catch {
    return []
  }
}

/** Lê o conteúdo de um arquivo da missão (relFile relativo ao dir). null em
 *  falha (o viewer mostra "não consegui ler"). */
export async function readMissionFile(
  cwd: string,
  dir: string,
  relFile: string,
): Promise<string | null> {
  try {
    return await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${dir}/${relFile}`,
    })
  } catch {
    return null
  }
}

/** Nome-base de um caminho relativo (sem a pasta). */
function baseName(relFile: string): string {
  const i = relFile.lastIndexOf("/")
  return i >= 0 ? relFile.slice(i + 1) : relFile
}

/** Promove um artefato da missão pra `docs/<slug>/<arquivo>` no repo (versionado
 *  no git). Lê da pasta gitignorada e grava em docs/ via o write escopado
 *  (docs/ está sob o cwd, sem `..` → passa no guard de traversal). Devolve o
 *  caminho relativo gravado, ou lança com mensagem pro toast. */
export async function promoteToDocs(
  cwd: string,
  dir: string,
  relFile: string,
  slug: string,
): Promise<string> {
  const content = await readMissionFile(cwd, dir, relFile)
  if (content == null) throw new Error("Não consegui ler o arquivo da missão")
  const dest = `docs/${slug}/${baseName(relFile)}`
  await invoke("write_mission_state", { cwd, relPath: dest, content })
  return dest
}
