import { useEffect, useRef, useState } from "react"
import { listProjectFiles } from "@/lib/sources"
import { isTauri } from "@/lib/db"
import type { Project } from "@/lib/types"

/** Regra ÚNICA de arquivo mencionável no "@": os `.md` das duas pastas de
 *  agents ficam fora (já entram como persona ou são contexto de code agent
 *  externo). */
export function isMentionableFile(f: string): boolean {
  return !f.startsWith(".claude/agents/") && !f.startsWith(".mycockpit/agents/")
}

/** Item de menção do composer (editor Lexical): só valor + tipo (o menu
 *  resolve avatar por nome via usePresets; arquivo leva ícone). O `kind`
 *  viaja como data do item do beautiful-mentions e agrupa o menu
 *  (Especialistas antes de Arquivos). */
export type LexicalAtItem = { value: string; kind: "agent" | "file" | "nota" }

/** Montagem PURA dos itens do "@": personas primeiro, arquivos depois
 *  (contíguos — o menu insere o cabeçalho na troca de kind), arquivos passando
 *  pela regra de exclusão única. SEM slice: o filtro por query e o limite
 *  (MAX_POPOVER_ITEMS) ficam com o beautiful-mentions na hora de renderizar,
 *  senão cortar aqui esconderia arquivos da busca. */
export function buildLexicalAtItems(
  names: string[],
  files: string[],
  notas: string[] = [],
): LexicalAtItem[] {
  return [
    ...names.map((n) => ({ value: n, kind: "agent" as const })),
    // Notas ANTES dos arquivos: são poucas e são suas; a lista de arquivos do
    // projeto tem centenas e empurraria a nota pra fora da primeira tela do
    // menu (o corte por query e o teto de itens são do beautiful-mentions).
    ...notas.map((n) => ({ value: n, kind: "nota" as const })),
    ...files
      .filter(isMentionableFile)
      .map((f) => ({ value: f, kind: "file" as const })),
  ]
}

/**
 * Arquivos mencionáveis do "@" do composer: lista os arquivos do projeto na
 * montagem (cache por projeto) — o editor Lexical precisa deles prontos quando
 * o menu do "@" abrir (buildLexicalAtItems monta os itens a partir daqui; as
 * personas vêm da usePresets, fonte única do marketplace).
 */
export function useAtMentions({ project }: { project: Project | null }) {
  const [files, setFiles] = useState<string[]>([])
  const mentionLoadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!project || !isTauri()) return
    if (mentionLoadedRef.current === project.path) return
    const path = project.path
    mentionLoadedRef.current = path
    let cancelled = false
    let settled = false
    listProjectFiles(path)
      .then(
        (f) => !cancelled && setFiles(f),
        () => !cancelled && setFiles([]),
      )
      .finally(() => {
        settled = true
      })
    return () => {
      cancelled = true
      // cancelado ANTES de terminar (troca rápida de projeto) → libera o
      // cache-once p/ recarregar; se já terminou, mantém (não recarrega à toa).
      if (!settled && mentionLoadedRef.current === path) {
        mentionLoadedRef.current = null
      }
    }
  }, [project?.path])

  return {
    /** Arquivos crus do projeto (cacheados) — viram itens do menu "@" via
     *  buildLexicalAtItems, sem duplicar a listagem. */
    files,
  }
}
