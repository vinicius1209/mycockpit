// A JANELA DE CONTEXTO conhecida de um modelo, pro anel de contexto do
// composer. Extraído de `lib/agents.ts` só pela catraca de tamanho (o
// arquivo passou do teto quando a família Gemini/GPT/gpt-oss entrou) —
// DIVIDA O ARQUIVO, não sobe o teto.

/** Janela de contexto CONHECIDA do modelo da sessão (tokens). `null` = não
 *  sabe, e o anel não inventa porcentagem (honesto, `ContextRing.tsx`). O
 *  marcador "1m" do Claude ("claude-…[1m]") indica a janela de 1M — ver
 *  `curatedModels.ts` (Opus 5/4.8, Sonnet 5 e Fable 5 já vêm com 1M como
 *  DEFAULT, sem precisar do sufixo; esta função ainda não reflete isso pro
 *  resto da família — furo pré-existente, fora do escopo desta passada).
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
