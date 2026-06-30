//! v0.2-β, cost adapter: tabela de preço (SEED embutido, refinável depois via
//! models.dev) + `estimate()` p/ agents que não reportam $ (Codex não dá USD).
//! O `cost_source=Estimated` + o "~" na UI deixam claro que é estimativa.

use crate::agent::CostSource;

#[derive(Default)]
pub struct NormalizedUsage {
    /// Total de input (pode INCLUIR o cache, convenção varia por CLI).
    pub input: u64,
    pub cached_input: u64,
    /// Output, JÁ inclui o reasoning no Codex, então NÃO somamos reasoning à
    /// parte (seria cobrar em dobro); por isso não guardamos reasoning_tokens.
    pub output: u64,
}

struct Price {
    input: f64,
    cached: f64,
    output: f64,
}

/// $/1M tokens. SEED, Claude validado; OpenAI aproximado (refinar via models.dev
/// na v0.2.x). O label Estimated + "~" comunicam que é estimativa.
fn price_for(model: &str) -> Option<Price> {
    let m = model.to_lowercase();
    // Ordem importa: "gpt-5.5".contains("gpt-5") == true, então o 5.5 vem ANTES.
    let p = if m.contains("gpt-5.5") {
        // OFICIAL OpenAI (developers.openai.com/api/docs/pricing), $/1M
        Price { input: 5.0, cached: 0.5, output: 30.0 }
    } else if m.contains("gpt-5") {
        // gpt-5 / gpt-5.1 (legado), $/1M
        Price { input: 1.25, cached: 0.125, output: 10.0 }
    } else if m.contains("o3") {
        Price { input: 2.0, cached: 0.5, output: 8.0 }
    } else if m.contains("opus") {
        Price { input: 5.0, cached: 0.5, output: 25.0 }
    } else if m.contains("sonnet") {
        Price { input: 3.0, cached: 0.3, output: 15.0 }
    } else if m.contains("haiku") {
        Price { input: 1.0, cached: 0.1, output: 5.0 }
    } else {
        return None;
    };
    Some(p)
}

/// Estima o custo em USD a partir do usage + modelo. Unknown se o modelo não está
/// na tabela (a UI mostra só tokens nesse caso).
pub fn estimate(model: &str, u: &NormalizedUsage) -> (Option<f64>, CostSource) {
    match price_for(model) {
        Some(p) => {
            // assume input total inclui o cache → cobra o não-cacheado em cheio
            let non_cached = u.input.saturating_sub(u.cached_input);
            let usd = (non_cached as f64 * p.input
                + u.cached_input as f64 * p.cached
                + u.output as f64 * p.output)
                / 1_000_000.0;
            (Some(usd), CostSource::Estimated)
        }
        None => (None, CostSource::Unknown),
    }
}
