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

/// $/1M tokens. Conferido contra developers.openai.com/api/docs/pricing e
/// anthropic.com em 2026-07-14. O label Estimated + "~" comunicam que é estimativa.
fn price_for(model: &str) -> Option<Price> {
    let m = model.to_lowercase();
    // Ordem importa: match por contains, então o mais ESPECÍFICO vem antes
    // ("gpt-5.4-mini" casaria com "gpt-5.4"; "gpt-5.5-pro" com "gpt-5.5"; tudo
    // casaria com "gpt-5"). Modelo custom digitado no picker cai aqui também.
    let p = if m.contains("gpt-5.6-sol") {
        // família 5.6 (Sol/Terra/Luna), GA 2026-07-09, oficial
        Price { input: 5.0, cached: 0.5, output: 30.0 }
    } else if m.contains("gpt-5.6-terra") {
        Price { input: 2.5, cached: 0.25, output: 15.0 }
    } else if m.contains("gpt-5.6-luna") {
        Price { input: 1.0, cached: 0.1, output: 6.0 }
    } else if m.contains("gpt-5.5-pro") || m.contains("gpt-5.4-pro") {
        // pro: sem preço de cache publicado → cache cobrado como input cheio
        Price { input: 30.0, cached: 30.0, output: 180.0 }
    } else if m.contains("gpt-5.5") {
        Price { input: 5.0, cached: 0.5, output: 30.0 }
    } else if m.contains("gpt-5.4-mini") {
        Price { input: 0.75, cached: 0.075, output: 4.5 }
    } else if m.contains("gpt-5.4-nano") {
        Price { input: 0.2, cached: 0.02, output: 1.25 }
    } else if m.contains("gpt-5.4") {
        Price { input: 2.5, cached: 0.25, output: 15.0 }
    } else if m.contains("gpt-5.3-codex") {
        Price { input: 1.75, cached: 0.175, output: 14.0 }
    } else if m.contains("gpt-5") {
        // gpt-5 / gpt-5.1 (legado), $/1M
        Price { input: 1.25, cached: 0.125, output: 10.0 }
    } else if m.contains("o3") {
        Price { input: 2.0, cached: 0.5, output: 8.0 }
    } else if m.contains("fable") || m.contains("mythos") {
        // Claude Fable/Mythos 5 (cache 90% off, como o resto da família)
        Price { input: 10.0, cached: 1.0, output: 50.0 }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn out_rate(model: &str) -> f64 {
        price_for(model).expect("modelo devia estar na tabela").output
    }

    /// A REGRESSÃO que motivou os testes: variantes 5.x novas caindo na linha
    /// legada "gpt-5" ($10 out) por causa do match por contains.
    #[test]
    fn specific_gpt_variants_do_not_fall_into_legacy_row() {
        assert_eq!(out_rate("gpt-5.6-sol"), 30.0);
        assert_eq!(out_rate("gpt-5.6-terra"), 15.0);
        assert_eq!(out_rate("gpt-5.6-luna"), 6.0);
        assert_eq!(out_rate("gpt-5.5"), 30.0);
        assert_eq!(out_rate("gpt-5.4"), 15.0);
        assert_eq!(out_rate("gpt-5.4-mini"), 4.5);
        assert_eq!(out_rate("gpt-5.4-nano"), 1.25);
        assert_eq!(out_rate("gpt-5.3-codex"), 14.0);
        assert_eq!(out_rate("gpt-5.5-pro"), 180.0);
        assert_eq!(out_rate("gpt-5"), 10.0); // legado continua legado
    }

    #[test]
    fn claude_family_rows() {
        assert_eq!(out_rate("claude-fable-5"), 50.0);
        assert_eq!(out_rate("claude-opus-4-8"), 25.0);
        assert_eq!(out_rate("claude-sonnet-4-6"), 15.0);
        assert_eq!(out_rate("claude-haiku-4-5"), 5.0);
    }

    #[test]
    fn unknown_model_estimates_nothing() {
        let (usd, src) = estimate("sei-la-9000", &NormalizedUsage::default());
        assert!(usd.is_none());
        assert!(matches!(src, CostSource::Unknown));
    }
}
