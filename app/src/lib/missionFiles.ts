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

/** Separa "nome.ext" em ["nome", ".ext"] (sem extensão → ["nome", ""]). */
function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".")
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""]
}

async function readAt(cwd: string, relPath: string): Promise<string | null> {
  try {
    return await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${relPath}`,
    })
  } catch {
    return null
  }
}

/** Resultado da promoção: caminho gravado + se já estava idêntico em docs/. */
export interface PromoteResult {
  path: string
  alreadyThere: boolean
}

/** Promove um artefato da missão pra `docs/<slug>/<arquivo>` no repo (versionado
 *  no git). Lê da pasta gitignorada e grava em docs/ via o write escopado
 *  (docs/ está sob o cwd, sem `..` → passa no guard de traversal). NUNCA
 *  sobrescreve conteúdo DIFERENTE em silêncio: se o destino já existe idêntico,
 *  é no-op (re-promoção idempotente); se existe e difere (edição manual, ou 2
 *  artefatos de mesmo nome), grava num nome numerado (`nome-2.md`…). */
export async function promoteToDocs(
  cwd: string,
  dir: string,
  relFile: string,
  slug: string,
): Promise<PromoteResult> {
  const content = await readMissionFile(cwd, dir, relFile)
  if (content == null) throw new Error("Não consegui ler o arquivo da missão")
  const base = baseName(relFile)
  const [stem, ext] = splitExt(base)
  for (let n = 0; n < 50; n++) {
    const name = n === 0 ? base : `${stem}-${n + 1}${ext}`
    const rel = `docs/${slug}/${name}`
    const cur = await readAt(cwd, rel)
    if (cur === content) return { path: rel, alreadyThere: true } // já idêntico
    if (cur == null) {
      // livre → grava aqui (sem esmagar nada).
      await invoke("write_mission_state", { cwd, relPath: rel, content })
      return { path: rel, alreadyThere: false }
    }
    // existe e DIFERE → tenta o próximo número (não sobrescreve).
  }
  throw new Error("Muitas versões deste relatório em docs/ — renomeie manualmente")
}
