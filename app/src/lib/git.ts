// Parse do unified diff (git) → files → hunks → lines, espelhando o modelo do
// code_review do Warp (DiffLine/DiffHunk). O Rust (git.rs) entrega o patch cru.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export type DiffLineType = "add" | "del" | "ctx"

export interface DiffLine {
  type: DiffLineType
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface DiffHunk {
  header: string // "@@ -a,b +c,d @@ …"
  lines: DiffLine[]
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed"

export interface DiffFile {
  path: string
  oldPath: string | null
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
}

export interface GitDiff {
  isRepo: boolean
  branch: string | null
  files: DiffFile[]
}

interface GitDiffRaw {
  isRepo: boolean
  branch: string | null
  patch: string
}

export interface WorktreeInfo {
  path: string
  branch: string
}

/** Cria (ou reusa) um worktree isolado pra uma conversa. O cockpit dirige. */
export async function createWorktree(
  projectPath: string,
  convId: string,
): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("create_worktree", { projectPath, convId })
}

/** Remove o worktree de uma conversa (sem --force; preserva se houver mudança). */
export async function removeWorktree(
  projectPath: string,
  path: string,
): Promise<void> {
  return invoke("remove_worktree", { projectPath, path })
}

/** Carrega + parseia o diff da working tree de um diretório (cwd da conversa). */
export async function loadGitDiff(cwd: string): Promise<GitDiff> {
  if (!isTauri()) return { isRepo: false, branch: null, files: [] }
  try {
    const raw = await invoke<GitDiffRaw>("git_diff", { cwd })
    return {
      isRepo: raw.isRepo,
      branch: raw.branch ?? null,
      files: raw.isRepo ? parsePatch(raw.patch) : [],
    }
  } catch {
    return { isRepo: false, branch: null, files: [] }
  }
}

/** "a/src/x.ts" | "b/src/x.ts" → "src/x.ts". */
function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, "")
}

/** Quebra o patch em blocos por arquivo (cada um começa em "diff --git"). */
function parsePatch(patch: string): DiffFile[] {
  if (!patch.trim()) return []
  const files: DiffFile[] = []
  const blocks = patch.split(/^diff --git /m).slice(1)
  for (const block of blocks) {
    const f = parseFile("diff --git " + block)
    if (f) files.push(f)
  }
  return files
}

function parseFile(block: string): DiffFile | null {
  const lines = block.split("\n")
  let oldPath: string | null = null
  let newPath: string | null = null
  let status: FileStatus = "modified"
  let binary = false
  const hunks: DiffHunk[] = []
  let additions = 0
  let deletions = 0

  let i = 0
  // cabeçalho do arquivo (até o 1º hunk @@)
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("@@")) break
    if (l.startsWith("diff --git")) {
      const m = l.match(/^diff --git a\/(.+) b\/(.+)$/)
      if (m) {
        oldPath = m[1]
        newPath = m[2]
      }
    } else if (l.startsWith("new file")) status = "added"
    else if (l.startsWith("deleted file")) status = "deleted"
    else if (l.startsWith("rename from")) {
      status = "renamed"
      oldPath = l.replace("rename from ", "").trim()
    } else if (l.startsWith("rename to")) {
      newPath = l.replace("rename to ", "").trim()
    } else if (l.startsWith("Binary files") || l.startsWith("GIT binary patch")) {
      binary = true
    } else if (l.startsWith("--- ")) {
      const p = l.slice(4).trim()
      if (p === "/dev/null") status = "added"
      else oldPath = stripPrefix(p)
    } else if (l.startsWith("+++ ")) {
      const p = l.slice(4).trim()
      if (p === "/dev/null") status = "deleted"
      else newPath = stripPrefix(p)
    }
  }

  // hunks + numeração de linha (old/new)
  let cur: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("@@")) {
      const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
      oldNo = m ? parseInt(m[1], 10) : 0
      newNo = m ? parseInt(m[2], 10) : 0
      cur = { header: l, lines: [] }
      hunks.push(cur)
    } else if (cur) {
      if (l.startsWith("+")) {
        cur.lines.push({ type: "add", oldNo: null, newNo, text: l.slice(1) })
        newNo++
        additions++
      } else if (l.startsWith("-")) {
        cur.lines.push({ type: "del", oldNo, newNo: null, text: l.slice(1) })
        oldNo++
        deletions++
      } else if (l.startsWith("\\")) {
        // "\ No newline at end of file" — ignora
      } else {
        const text = l.startsWith(" ") ? l.slice(1) : l
        cur.lines.push({ type: "ctx", oldNo, newNo, text })
        oldNo++
        newNo++
      }
    }
  }

  const path = newPath ?? oldPath
  if (!path) return null
  return {
    path,
    oldPath: status === "renamed" ? oldPath : null,
    status,
    additions,
    deletions,
    binary,
    hunks,
  }
}
