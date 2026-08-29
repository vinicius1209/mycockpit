// A ponte entre o ranqueamento puro (`lib/mentionRank`) e o contrato do
// `lexical-beautiful-mentions` (`onSearch`).
//
// Existe como hook, e não solto no componente, por dois motivos de CUSTO:
//
//  · o ÍNDICE é montado uma vez por lista, nunca por tecla — é ele que tira o
//    `split("/")` e o `toLowerCase()` do caminho quente;
//  · os arquivos TOCADOS entram por ref. Eles mudam quando o agent mexe num
//    arquivo, e recriar a função de busca no meio da digitação faria a lib
//    refazer a consulta e piscar o menu.

import { useCallback, useMemo, useRef } from "react"
import { indexarMencoes, rankearMencoes, type ItemDeMencao } from "@/lib/mentionRank"
import { MAX_POPOVER_ITEMS } from "@/hooks/useSlashCommands"

export function useMentionSearch(
  itens: readonly ItemDeMencao[],
  tocados?: ReadonlySet<string>,
) {
  const indice = useMemo(() => indexarMencoes(itens), [itens])
  const tocadosRef = useRef(tocados)
  tocadosRef.current = tocados

  // `async` porque o contrato da lib é Promise; o trabalho é síncrono sobre um
  // índice pronto, e por isso o `searchDelay` do plugin é 0 — atrasar só
  // adicionaria latência de digitação a algo que já é barato.
  return useCallback(
    async (_trigger: string, query?: string | null) =>
      rankearMencoes(
        indice,
        query,
        { tocados: tocadosRef.current },
        MAX_POPOVER_ITEMS,
      ).map((i) => ({ value: i.value, kind: i.kind })),
    [indice],
  )
}
