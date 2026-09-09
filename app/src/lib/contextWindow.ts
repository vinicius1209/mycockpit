// A JANELA DE CONTEXTO conhecida de um modelo, pro anel de contexto do
// composer. Extraído de `lib/agents.ts` só pela catraca de tamanho (o
// arquivo passou do teto quando a família Gemini/GPT/gpt-oss entrou) —
// DIVIDA O ARQUIVO, não sobe o teto.

// O CATÁLOGO (models.dev, via catalog.rs) é a primeira fonte, e a tabela
// escrita à mão abaixo virou fallback. O furo que forçou a inversão, em
// 09/09/2026: uma chamada real de `claude-opus-5` mediu 320.702 tokens contra
// uma "janela" de 200.000, e o anel escondeu o percentual em vez de forçar
// 100% (comportamento certo, sintoma honesto de dado errado). O catálogo NESTA
// máquina já dizia `claude-opus-5 → context: 1_000_000`: o app tinha baixado o
// número, guardado em disco e nunca perguntado.
//
// A tabela abaixo continua existindo porque o catálogo NÃO cobre tudo: os
// slugs do agy (`gemini-3.6-flash-high`) e os do Codex (`sol`/`terra`/`luna`)
// não são ids de models.dev. Ela é chute declarado; o catálogo é dado.

let janelaPorId: Map<string, number> | null = null

/** Alimenta o cache com o catálogo já carregado (boot, e depois de um refresh).
 *  Sem isto a função cai direto no fallback — degradação honesta, não erro. */
export function hidratarJanelasDoCatalogo(
  models: ReadonlyArray<{ id: string; context: number | null }>,
): void {
  const mapa = new Map<string, number>()
  for (const m of models) {
    const id = (m.id ?? "").trim().toLowerCase()
    if (id && m.context != null && m.context > 0) mapa.set(id, m.context)
  }
  janelaPorId = mapa.size > 0 ? mapa : null
}

/** Reset entre casos (cache de módulo não se carrega de um teste pro outro). */
export function _resetJanelasForTests(): void {
  janelaPorId = null
}

/** O id sem o marcador de janela do Claude: `claude-opus-5[1m]` casa com o
 *  `claude-opus-5` do catálogo. O sufixo é dialeto de flag, não id de modelo. */
function idDeCatalogo(model: string): string {
  return model.toLowerCase().replace(/\[1m\]$/, "").trim()
}

/** Janela de contexto CONHECIDA do modelo da sessão (tokens). `null` = não
 *  sabe, e o anel não inventa porcentagem (honesto, `ContextRing.tsx`). O
 *  marcador "1m" do Claude ("claude-…[1m]") indica a janela de 1M — ver
 *  `curatedModels.ts`.
 *
 *  Família Gemini/GPT/gpt-oss (17/08/2026): `gemini-3.7-flash` é a ÚNICA
 *  confirmada contra o catálogo desta casa (`catalog.rs`, fonte models.dev):
 *  `limit.context: 1_048_576` — arredondado aqui pra 1_000_000, a mesma
 *  convenção de casa dos-outros-todos-redondos. As demais linhas (Gemini
 *  Pro, gpt-oss, a família `gpt-5.6-{sol,terra,luna}`) são estimativa por
 *  conhecimento geral do fornecedor (Gemini Pro 2M, GPT-5-classe ~272k),
 *  SEM fixture própria nesta casa — se um turno real contradisser, a fonte
 *  certa é auditar como `catalog.rs`/`pricing.rs` fizeram (`agy models`,
 *  models.dev), não ajustar o chute. */
export function contextWindowFor(model: string | null): number | null {
  if (!model) return null
  const doCatalogo = janelaPorId?.get(idDeCatalogo(model))
  if (doCatalogo != null) return doCatalogo
  const m = model.toLowerCase()
  if (m.includes("claude")) {
    return m.includes("1m") ? 1_000_000 : 200_000
  }
  if (m.includes("gemini")) {
    if (m.includes("pro")) return 2_000_000
    return 1_000_000
  }
  if (m.includes("gpt-oss")) {
    return 200_000
  }
  if (m.includes("gpt") || m.includes("sol") || m.includes("terra") || m.includes("luna")) {
    return 272_000
  }
  return null
}
