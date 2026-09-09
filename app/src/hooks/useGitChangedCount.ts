import { useEffect, useState } from "react"
import { loadGitStatus } from "@/lib/git"

/** Conta caminhos alterados pelo status estruturado, sem transportar o patch. */
export function useGitChangedCount(cwd: string | undefined, revision: unknown): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!cwd) {
      setCount(0)
      return
    }
    void loadGitStatus(cwd)
      .then((status) => {
        if (cancelled) return
        const paths = new Set([
          ...status.staged.map((file) => file.path),
          ...status.unstaged.map((file) => file.path),
        ])
        setCount(status.isRepo ? paths.size : 0)
      })
      .catch((error) => {
        console.warn("[ContextPanel] não foi possível atualizar o badge do Git", error)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, revision])

  return count
}
