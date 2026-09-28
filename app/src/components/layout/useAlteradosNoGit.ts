// Os arquivos com mudança no git na pasta `root`, para a árvore: lidos uma vez
// ao montar e de novo só pelos sinais de `lib/sinaisDoDisco` (uma leitura por
// rajada, nunca por linha).

import { useEffect, useState } from "react"
import { isTauri } from "@/lib/db"
import { assinarMudancasNaPasta } from "@/lib/sinaisDoDisco"
import { caminhosAlterados, lerStatusDoGit, statusEmCache, type LetraDoGit } from "@/lib/statusCompartilhado"

export function useAlteradosNoGit(root: string | null): Map<string, LetraDoGit> {
  const [alterados, setAlterados] = useState(() => caminhosAlterados(root ? statusEmCache(root) : null))

  useEffect(() => {
    if (!root || !isTauri()) return
    let vivo = true
    const reler = () =>
      void lerStatusDoGit(root)
        .then((s) => {
          if (vivo) setAlterados(caminhosAlterados(s))
        })
        // Sem status, a árvore só deixa de oferecer "Ver alterações".
        .catch((e) => console.warn("[arvore] não consegui ler o git status", e))
    setAlterados(caminhosAlterados(statusEmCache(root)))
    reler()
    const sair = assinarMudancasNaPasta(root, reler)
    return () => {
      vivo = false
      sair()
    }
  }, [root])

  return alterados
}
