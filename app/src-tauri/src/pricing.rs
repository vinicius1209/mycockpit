//! v0.2-β, cost adapter: catálogo dinâmico (catalog.rs, via models.dev) com a
//! tabela SEED estática como fallback offline/primeira execução + `estimate()`
//! p/ agents que não reportam $ (Codex não dá USD). O `cost_source=Estimated`
//! + o "~" na UI deixam claro que é estimativa.

use crate::agent::CostSource;
use crate::catalog::{self, CatalogModel};

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

/// Converte um modelo do catálogo em Price. None quando o catálogo traz preço
/// 0/0 (free tiers do models.dev) — "sem preço" de verdade, deixa o SEED
/// decidir. cache_read ausente = cache cobrado como input cheio (sem desconto).
fn catalog_price(c: CatalogModel) -> Option<Price> {
    if c.input <= 0.0 && c.output <= 0.0 {
        return None;
    }
    Some(Price {
        input: c.input,
        cached: c.cache_read.unwrap_or(c.input),
        output: c.output,
    })
}

/// $/1M tokens. Catálogo dinâmico (models.dev, exato > prefixo-mais-longo)
/// primeiro; SEED estático como fallback (offline/primeira execução/modelo
/// fora do catálogo). SEED conferido contra developers.openai.com/api/docs/
/// pricing e anthropic.com em 2026-07-14, e as linhas google contra
/// models.dev/api.json em 2026-08-16 (a MESMA fonte do catálogo dinâmico).
/// O "~" na UI comunica estimativa.
fn price_for(model: &str) -> Option<Price> {
    if let Some(p) = catalog::lookup(model).and_then(catalog_price) {
        return Some(p);
    }
    let m = model.to_lowercase();
    // Ordem importa: match por contains, então o mais ESPECÍFICO vem antes
    // ("gpt-5.4-mini" casaria com "gpt-5.4"; "gpt-5.5-pro" com "gpt-5.5"; tudo
    // casaria com "gpt-5"). Modelo custom digitado no picker cai aqui também.
    let p = if m.contains("gpt-5.6-sol") {
        // família 5.6 (Sol/Terra/Luna), GA 2026-07-09, oficial
        Price {
            input: 5.0,
            cached: 0.5,
            output: 30.0,
        }
    } else if m.contains("gpt-5.6-terra") {
        Price {
            input: 2.5,
            cached: 0.25,
            output: 15.0,
        }
    } else if m.contains("gpt-5.6-luna") {
        Price {
            input: 1.0,
            cached: 0.1,
            output: 6.0,
        }
    } else if m.contains("gpt-5.5-pro") || m.contains("gpt-5.4-pro") {
        // pro: sem preço de cache publicado → cache cobrado como input cheio
        Price {
            input: 30.0,
            cached: 30.0,
            output: 180.0,
        }
    } else if m.contains("gpt-5.5") {
        Price {
            input: 5.0,
            cached: 0.5,
            output: 30.0,
        }
    } else if m.contains("gpt-5.4-mini") {
        Price {
            input: 0.75,
            cached: 0.075,
            output: 4.5,
        }
    } else if m.contains("gpt-5.4-nano") {
        Price {
            input: 0.2,
            cached: 0.02,
            output: 1.25,
        }
    } else if m.contains("gpt-5.4") {
        Price {
            input: 2.5,
            cached: 0.25,
            output: 15.0,
        }
    } else if m.contains("gpt-5.3-codex") {
        Price {
            input: 1.75,
            cached: 0.175,
            output: 14.0,
        }
    } else if m.contains("gpt-5") {
        // gpt-5 / gpt-5.1 (legado), $/1M
        Price {
            input: 1.25,
            cached: 0.125,
            output: 10.0,
        }
    } else if m.contains("o3") {
        Price {
            input: 2.0,
            cached: 0.5,
            output: 8.0,
        }
    // Família Gemini (o motor `agy` fala com ela). O slug do agy carrega o
    // ESFORÇO no fim do id ("gemini-3.7-flash-high"), então o contains casa a
    // família e o sufixo é ignorado — nenhum código genérico precisa saber
    // que este motor embute esforço no modelo. Ordem: `-lite` ANTES da base
    // ("gemini-3.5-flash-lite-low" casaria com "gemini-3.5-flash", e o lite é
    // 3,6x mais barato no output). Sem estas linhas o Antigravity ficava
    // inteiro fora do ledger (incidente 2026-08-16 §6): 5 turnos reais,
    // ~7,3M tokens, ZERO linha em turn_costs.
    // ⚠️ models.dev publica `cost.tiers` para o Pro (acima de ~200k de
    // contexto o preço DOBRA); como o catálogo, o SEED ignora tiers — a
    // estimativa erra pra BAIXO em turno de contexto longo, nunca pra cima.
    } else if m.contains("gemini-3.7-flash") {
        Price {
            input: 0.75,
            cached: 0.075,
            output: 3.75,
        }
    } else if m.contains("gemini-3.6-flash") {
        Price {
            input: 1.5,
            cached: 0.15,
            output: 7.5,
        }
    } else if m.contains("gemini-3.5-flash-lite") {
        Price {
            input: 0.3,
            cached: 0.03,
            output: 2.5,
        }
    } else if m.contains("gemini-3.5-flash") {
        Price {
            input: 1.5,
            cached: 0.15,
            output: 9.0,
        }
    } else if m.contains("gemini-3.1-flash-lite") {
        Price {
            input: 0.25,
            cached: 0.025,
            output: 1.5,
        }
    } else if m.contains("gemini-3.1-pro") {
        // models.dev só publica o id `gemini-3.1-pro-preview`; o slug que o
        // `agy models` lista é `gemini-3.1-pro-{high,low}`. Mesmo modelo,
        // mesmo preço publicado — o preview é o único id com preço.
        Price {
            input: 2.0,
            cached: 0.2,
            output: 12.0,
        }
    } else if m.contains("gemini-3-flash") {
        Price {
            input: 0.5,
            cached: 0.05,
            output: 3.0,
        }
    } else if m.contains("fable-5-1") {
        // Fable 5.1: mesmo input/output do Fable 5, cache bem mais barato
        // (models.dev, 22/09/2026). Só responde sem catálogo carregado.
        Price {
            input: 10.0,
            cached: 0.25,
            output: 50.0,
        }
    } else if m.contains("fable") || m.contains("mythos") {
        // Claude Fable/Mythos 5 (cache 90% off, como o resto da família)
        Price {
            input: 10.0,
            cached: 1.0,
            output: 50.0,
        }
    } else if m.contains("opus-5-5") {
        // Opus 5.5 (22/09/2026): mais barato que o Opus 5. Conferido contra o
        // models.dev no mesmo dia; aqui só responde sem catálogo carregado.
        Price {
            input: 4.0,
            cached: 0.2,
            output: 20.0,
        }
    } else if m.contains("opus") {
        Price {
            input: 5.0,
            cached: 0.5,
            output: 25.0,
        }
    } else if m.contains("sonnet") {
        Price {
            input: 3.0,
            cached: 0.3,
            output: 15.0,
        }
    } else if m.contains("haiku") {
        Price {
            input: 1.0,
            cached: 0.1,
            output: 5.0,
        }
    } else {
        return None;
    };
    Some(p)
}

/// Preço de um modelo, $/1M tokens, com a procedência na cara.
///
/// Existe pro M3 do `model-autonomy-plan`: a perna "o preço existe" da promoção
/// automática pergunta AQUI. Sem isto o front teria que reimplementar a régua
/// de preço e nasceria uma SEGUNDA verdade — o seletor recusando um modelo por
/// "sem preço" enquanto o medidor de custo do turno estima o preço dele.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    pub input: f64,
    pub cached: f64,
    pub output: f64,
    /// Veio do catálogo dinâmico (models.dev)? `false` = tabela SEED embutida,
    /// que é preço de verdade e datado, só não é o catálogo vivo.
    pub from_catalog: bool,
}

/// O app sabe o preço deste modelo? `None` = não sabe, e turno com ele sairia
/// sem estimativa de custo (é o que a promoção usa pra segurar o candidato).
#[tauri::command]
pub fn model_price(model: String) -> Option<ModelPrice> {
    let from_catalog = catalog::lookup(&model).and_then(catalog_price).is_some();
    price_for(&model).map(|p| ModelPrice {
        input: p.input,
        cached: p.cached,
        output: p.output,
        from_catalog,
    })
}

/// O custo DO TURNO a partir do que o CLI reportou (ADR-226).
///
/// Medido em 23/09/2026 no claude 2.1.280: ao retomar uma sessão, o
/// `total_cost_usd` do `result` passou a ser o ACUMULADO da sessão, enquanto o
/// `usage` continua sendo do turno (10 in, 46 out, 6.524 cache lido reportaram
/// US$ 0,01436 = 0,01329 do turno anterior + 0,00107 deste). Até 21/09 o
/// mesmo campo era por execução. Para não quebrar nenhum dos dois, quem decide
/// é o preço dos tokens do próprio turno: entre o valor cru e a diferença para
/// o total anterior da sessão, vale o que estiver mais perto do estimado. Sem
/// total anterior, total que andou para trás (sessão nova) ou sem régua de
/// preço, o valor cru segue: não se inventa desconto sem prova.
pub fn custo_do_turno(reportado: f64, base: Option<f64>, estimado: Option<f64>) -> f64 {
    let Some(base) = base else { return reportado };
    if reportado + 1e-9 < base {
        return reportado;
    }
    let delta = (reportado - base).max(0.0);
    // Acumulado de verdade fica MUITO acima do que os tokens do turno custam
    // (15x no caso medido); por execução fica perto (a estimativa erra para
    // menos, porque cobra criação de cache como entrada). O piso de 2x impede
    // que um CLI por execução perca custo por um erro de estimativa.
    match estimado {
        Some(e) if reportado > 2.0 * e && (delta - e).abs() < (reportado - e).abs() => delta,
        _ => reportado,
    }
}

/// Uma linha do histórico de custo para replanejar (ADR-226): o que foi
/// gravado, o total cru da linha anterior da MESMA conversa e os tokens do
/// turno (que dão a régua de preço).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinhaDeCusto {
    pub model: Option<String>,
    pub reportado: f64,
    pub base: Option<f64>,
    pub input: u64,
    pub output: u64,
    pub cache: u64,
}

/// O custo do turno de cada linha, pela MESMA regra do runner. A correção do
/// histórico em Configurações usa isto em vez de reescrever a regra no front.
#[tauri::command]
pub fn planejar_custo_do_turno(linhas: Vec<LinhaDeCusto>) -> Vec<f64> {
    linhas
        .iter()
        .map(|l| {
            let estimado = l.model.as_deref().and_then(|m| {
                let nu = NormalizedUsage {
                    input: l.input + l.cache,
                    cached_input: l.cache,
                    output: l.output,
                };
                estimate(m, &nu).0
            });
            custo_do_turno(l.reportado, l.base, estimado)
        })
        .collect()
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
        price_for(model)
            .expect("modelo devia estar na tabela")
            .output
    }

    /// ADR-050 — modelo VAZIO (Codex sem `self.model`, depois que o adapter
    /// parou de chutar "gpt-5.5") não pode casar catálogo nem SEED: `""` não
    /// contém nenhuma das substrings da tabela, então cai no `else { None }`
    /// do fim da cadeia. Sem preço, não turno de graça — `Unknown`, não US$ 0.
    #[test]
    fn modelo_vazio_nao_casa_preco_nenhum() {
        assert!(price_for("").is_none());
        let (usd, src) = estimate(
            "",
            &NormalizedUsage {
                input: 100,
                cached_input: 0,
                output: 50,
            },
        );
        assert_eq!(usd, None);
        assert!(matches!(src, CostSource::Unknown));
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

    /// ADR-047 — o Antigravity fala com a família Gemini e o SEED não tinha
    /// NENHUMA linha google: todo turno do `agy` saía `Unknown` e o ledger não
    /// via um token sequer (incidente 2026-08-16 §6). O slug do `agy` carrega o
    /// esforço no fim ("-high"/"-medium"/"-low") e não pode cair na família
    /// errada — mesmo risco do contains que os gpt-5.x já tinham.
    #[test]
    fn gemini_rows_survive_the_effort_suffix() {
        assert_eq!(out_rate("gemini-3.7-flash-high"), 3.75);
        assert_eq!(out_rate("gemini-3.6-flash-medium"), 7.5);
        assert_eq!(out_rate("gemini-3.5-flash-low"), 9.0);
        // lite é 3,6x mais barato que a base: o específico tem que vir antes
        assert_eq!(out_rate("gemini-3.5-flash-lite-high"), 2.5);
        assert_eq!(out_rate("gemini-3.1-flash-lite-low"), 1.5);
        assert_eq!(out_rate("gemini-3.1-pro-high"), 12.0);
        assert_eq!(out_rate("gemini-3-flash-preview"), 3.0);
    }

    /// Fixture REAL (ADR-016): o `result` do item #69 da conversa
    /// ec1642c1-5328-409e-afc8-58e79a3cdca1, o turno que morreu no
    /// `--print-timeout` do incidente de 2026-08-16 e não deixou rastro nenhum
    /// no ledger. Números lidos do banco do usuário, não arredondados.
    #[test]
    fn incidente_2026_08_16_deixa_de_ser_invisivel() {
        let u = NormalizedUsage {
            input: 2_399_909,
            cached_input: 2_101_766,
            output: 11_098,
        };
        let (usd, src) = estimate("gemini-3.7-flash-high", &u);
        assert!(matches!(src, CostSource::Estimated));
        let usd = usd.expect("turno do agy passa a ter custo");
        // (2.399.909-2.101.766)×0,75 + 2.101.766×0,075 + 11.098×3,75, por 1M
        assert!((usd - 0.422_857_2).abs() < 1e-6, "custo estimado: {usd}");
    }

    /// Números REAIS do claude 2.1.280 (23/09/2026): 1ª chamada criou a sessão
    /// e reportou 0,013288; a 2ª, retomando, reportou 0,0143604 com um turno de
    /// 10 in, 46 out, 6.524 cache lido e 90 criado (haiku).
    #[test]
    fn custo_acumulado_da_sessao_vira_custo_do_turno() {
        let u = NormalizedUsage { input: 10 + 6_524 + 90, cached_input: 6_524, output: 46 };
        let (estimado, _) = estimate("claude-haiku-4-5-20251001", &u);
        let turno = custo_do_turno(0.0143604, Some(0.013288), estimado);
        assert!((turno - 0.0010724).abs() < 1e-6, "custo do turno: {turno}");
    }

    #[test]
    fn cli_que_reporta_por_execucao_nao_perde_nada() {
        // Custo por execução (como até 21/09): o valor cru bate com os tokens
        // e continua valendo mesmo sendo maior que o total anterior.
        let u = NormalizedUsage { input: 40_000, cached_input: 30_000, output: 2_000 };
        let (estimado, _) = estimate("claude-opus-5-5", &u);
        let cru = estimado.unwrap();
        assert_eq!(custo_do_turno(cru, Some(cru * 0.4), estimado), cru);
        // Sessão nova (total andou para trás) e sem base: valor cru.
        assert_eq!(custo_do_turno(0.5, Some(3.0), estimado), 0.5);
        assert_eq!(custo_do_turno(0.5, None, estimado), 0.5);
        // Sem régua de preço, não se inventa desconto.
        assert_eq!(custo_do_turno(3.2, Some(3.0), None), 3.2);
        // Estimativa que erra para menos (cache criado cobrado como entrada)
        // num CLI por execução: o cru segue, mesmo com a diferença mais perto.
        assert_eq!(custo_do_turno(1.00, Some(0.15), Some(0.80)), 1.00);
    }

    /// Linhas REAIS da `turn_costs` desta conversa (23/09/2026): o cru só
    /// cresce e os tokens são do turno. A 2ª vira a diferença.
    #[test]
    fn historico_replanejado_pela_mesma_regra() {
        let linhas = vec![
            LinhaDeCusto { model: Some("claude-opus-5-5[1m]".into()), reportado: 0.7924408, base: None, input: 18, output: 9_979, cache: 498_052 },
            LinhaDeCusto { model: Some("claude-opus-5-5[1m]".into()), reportado: 28.307669, base: Some(27.6985124), input: 8, output: 2_529, cache: 2_301_518 },
        ];
        let plano = planejar_custo_do_turno(linhas);
        assert_eq!(plano[0], 0.7924408);
        assert!((plano[1] - (28.307669 - 27.6985124)).abs() < 1e-9, "{}", plano[1]);
    }

    #[test]
    fn claude_family_rows() {
        assert_eq!(out_rate("claude-fable-5"), 50.0);
        assert_eq!(out_rate("claude-opus-4-8"), 25.0);
        assert_eq!(out_rate("claude-opus-5-5[1m]"), 20.0);
        assert_eq!(out_rate("claude-sonnet-4-6"), 15.0);
        assert_eq!(out_rate("claude-haiku-4-5"), 5.0);
    }

    #[test]
    fn unknown_model_estimates_nothing() {
        let (usd, src) = estimate("sei-la-9000", &NormalizedUsage::default());
        assert!(usd.is_none());
        assert!(matches!(src, CostSource::Unknown));
    }

    fn cm(input: f64, output: f64, cache_read: Option<f64>) -> CatalogModel {
        CatalogModel {
            provider: "openai".into(),
            id: "x".into(),
            name: "X".into(),
            input,
            output,
            cache_read,
            context: None,
            release_date: None,
        }
    }

    /// Free tier no catálogo (0/0) NÃO é preço: cai pro SEED, que continua
    /// respondendo — os testes acima rodam com catálogo global vazio e provam
    /// que o comportamento antigo segue intacto.
    #[test]
    fn zero_priced_catalog_model_falls_back_to_seed() {
        assert!(catalog_price(cm(0.0, 0.0, None)).is_none());
        assert_eq!(out_rate("claude-fable-5"), 50.0); // SEED responde
    }

    /// A perna "o preço existe" do M3 pergunta pela MESMA régua do custo do
    /// turno: o que o app sabe cobrar, ele sabe promover; o que ele não sabe
    /// cobrar segura o candidato (e o motivo vira frase pro humano).
    #[test]
    fn model_price_responde_pela_mesma_regua_do_custo_do_turno() {
        let p = model_price("gpt-5.6-luna".into()).expect("SEED conhece");
        assert_eq!(p.output, 6.0);
        assert!(!p.from_catalog); // catálogo global vazio no teste → SEED
        assert!(model_price("modelo-que-nunca-existiu-9-9".into()).is_none());
        // O que o estimador cobra é o que a promoção enxerga (uma verdade só).
        let (usd, _) = estimate(
            "modelo-que-nunca-existiu-9-9",
            &NormalizedUsage {
                input: 1000,
                cached_input: 0,
                output: 1000,
            },
        );
        assert!(usd.is_none());
    }

    /// cache_read ausente no catálogo = cache cobrado como input cheio.
    #[test]
    fn catalog_without_cache_read_charges_cache_as_input() {
        let p = catalog_price(cm(2.5, 15.0, None)).expect("tem preço");
        assert_eq!(p.cached, 2.5);
        let p = catalog_price(cm(2.5, 15.0, Some(0.25))).expect("tem preço");
        assert_eq!(p.cached, 0.25);
    }
}
