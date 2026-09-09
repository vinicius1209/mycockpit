// A ponte entre o ranqueamento puro (`lib/mentionRank`) e o contrato do
// `lexical-beautiful-mentions` (`onSearch`).
//
// Existe como hook, e não solto no componente, por dois motivos de CUSTO:
//
//  · o índice LOCAL é montado uma vez por lista. O projeto inteiro nunca é
//    materializado: arquivos entram por busca paginada só depois da consulta;
//  · os arquivos TOCADOS entram por ref. Eles mudam quando o agent mexe num
//    arquivo, e recriar a função de busca no meio da digitação faria a lib
//    refazer a consulta e piscar o menu.

import { useCallback, useMemo, useRef } from "react"
import type { BeautifulMentionsItem } from "lexical-beautiful-mentions"
import { indexarMencoes, rankearMencoes, type ItemDeMencao } from "@/lib/mentionRank"
import { MAX_POPOVER_ITEMS } from "@/hooks/useSlashCommands"
import { isMentionableFile } from "@/hooks/useAtMentions"
import { searchProjectFileIndex } from "@/lib/projectFilesService"

export async function searchMentionItems(input: {
  indiceLocal: ReturnType<typeof indexarMencoes>
  query?: string | null
  tocados?: ReadonlySet<string>
  projectRoot?: string
  searchFiles?: typeof searchProjectFileIndex
}): Promise<BeautifulMentionsItem[]> {
  const local = rankearMencoes(
    input.indiceLocal,
    input.query,
    { tocados: input.tocados },
    MAX_POPOVER_ITEMS,
  )
  const query = input.query?.trim()
  if (!query || !input.projectRoot) return local.map((item) => ({ ...item }))
  try {
    const result = await (input.searchFiles ?? searchProjectFileIndex)({
      root: input.projectRoot,
      query,
      limit: MAX_POPOVER_ITEMS * 4,
    })
    const seen = new Set(input.indiceLocal.map((item) => item.value))
    const remote: ItemDeMencao[] = result.page.entries.flatMap((entry) =>
      entry.kind === "file" && isMentionableFile(entry.relPath) && !seen.has(entry.relPath)
        ? [{ value: entry.relPath, kind: "file" as const }]
        : [],
    )
    return rankearMencoes(
      [...input.indiceLocal, ...indexarMencoes(remote)],
      query,
      { tocados: input.tocados },
      MAX_POPOVER_ITEMS,
    ).map((item) => ({ ...item }))
  } catch {
    // O menu local continua útil se Git/disco falhar. Não há efeito para
    // fingir: a árvore oferece erro + retry quando a pessoa abre a superfície.
    return local.map((item) => ({ ...item }))
  }
}

export function useMentionSearch(
  itens: readonly ItemDeMencao[],
  tocados?: ReadonlySet<string>,
  projectRoot?: string,
) {
  const indice = useMemo(() => indexarMencoes(itens), [itens])
  const tocadosRef = useRef(tocados)
  tocadosRef.current = tocados
  const rootRef = useRef(projectRoot)
  rootRef.current = projectRoot

  return useCallback(
    async (_trigger: string, query?: string | null) =>
      searchMentionItems({
        indiceLocal: indice,
        query,
        tocados: tocadosRef.current,
        projectRoot: rootRef.current,
      }),
    [indice],
  )
}
