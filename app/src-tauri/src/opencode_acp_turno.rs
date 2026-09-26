//! O que um turno do OpenCode via ACP acumula até o desfecho: custo, contexto
//! e subagentes. Lógica pura, fora do laço de `opencode_acp.rs`, para caber
//! teste com payload real.
//!
//! Medido em 26/09/2026 (opencode 1.18.32, `opencode acp`), dois turnos na
//! mesma sessão com `gemini-3.5-flash-lite`:
//!   • `usage_update.cost.amount` é o ACUMULADO DA SESSÃO: 0,00430006 no 1º
//!     turno (= 0,0037526 + 0,00054746, os dois steps no banco do opencode) e
//!     0,00484787 no 2º (+ 0,00054781). O custo do turno é a diferença para o
//!     total que a sessão já tinha (ADR-226, o mesmo acumulado do Claude);
//!   • `usage_update.used`/`size` são o contexto ocupado e a janela do modelo;
//!   • o `usage` da resposta do `session/prompt` é SÓ o último step (651 de
//!     entrada num turno cujo 1º step leu 12067). Não serve para soma;
//!   • `session/load` REENVIA o histórico inteiro como `session/update` antes
//!     do prompt novo. Repassar isso pintava a resposta antiga no turno novo.

use crate::adapters::opencode_ferramentas as ferramentas;
use crate::adapters::{somar_filhos_opencode, UsoOpenCode};
use crate::agent::{AgentEvent, CostSource};
use serde_json::Value;
use std::collections::HashMap;

/// O modelo em uso, como a resposta do `session/new`/`session/load` anuncia
/// (`configOptions[id=model].currentValue`). Serve quando a Frota não pediu
/// modelo: sem ele a conversa e o ledger ficavam sem modelo.
pub fn modelo_anunciado(resposta: &Value) -> Option<String> {
    resposta
        .get("configOptions")?
        .as_array()?
        .iter()
        .find(|o| o.get("id").and_then(Value::as_str) == Some("model"))?
        .get("currentValue")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[derive(Default)]
pub struct TurnoAcp {
    /// Total que a sessão já tinha antes deste turno, guardado pelo front.
    base: Option<f64>,
    /// Retomada sem base conhecida: o acumulado não se deixa separar.
    retomada_sem_base: bool,
    total: Option<f64>,
    usado: u64,
    janela: Option<u64>,
    filhos: Vec<String>,
    /// Ferramentas do turno: nome do opencode e se a chamada já foi pro fio.
    ferramentas: HashMap<String, (String, bool)>,
}

impl TurnoAcp {
    pub fn new(retomada: bool, base: Option<f64>) -> Self {
        Self {
            base,
            retomada_sem_base: retomada && base.is_none(),
            ..Default::default()
        }
    }

    /// Lê um `session/update` DESTE turno (o chamador já descartou o replay
    /// do `session/load`).
    fn observar(&mut self, params: &Value) {
        let Some(u) = params.get("update") else {
            return;
        };
        match u.get("sessionUpdate").and_then(Value::as_str) {
            Some("usage_update") => {
                if let Some(c) = u.pointer("/cost/amount").and_then(Value::as_f64) {
                    self.total = Some(c);
                }
                self.usado = u.get("used").and_then(Value::as_u64).unwrap_or(self.usado);
                self.janela = u.get("size").and_then(Value::as_u64).or(self.janela);
            }
            // Subagente: o `rawOutput.metadata` do ACP é o mesmo objeto
            // `state.metadata` do `run` (conferido campo a campo no `read` e no
            // `bash`), e no `run` o `task` traz ali o `sessionId` do filho.
            // Inferido pelo formato: nenhum `task` concluiu pelo ACP na sonda.
            Some("tool_call_update") => {
                let id = u
                    .pointer("/rawOutput/metadata/sessionId")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty());
                if let Some(id) = id {
                    if !self.filhos.iter().any(|f| f == id) {
                        self.filhos.push(id.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    /// Os eventos da casa para um `session/update` deste turno. As
    /// ferramentas saem no contrato ("Ler", "Executar"…); o resto segue o
    /// mapeamento genérico de `acp.rs`.
    ///
    /// Medido em 26/09/2026: o `tool_call` chega `pending` com `rawInput: {}`
    /// e o `title` sendo o nome do opencode (`read`, `bash`, `task`); a
    /// entrada só vem no 1º `tool_call_update` `in_progress`, quando o `title`
    /// já virou descrição. Por isso o nome é guardado do `tool_call`, e a
    /// chamada só vai pro fio quando a entrada chega: um "Ler arquivo" vazio
    /// antes do "Ler a.txt" seria ruído. `kind` genérico (`read`, `execute`,
    /// `think`) era o que a tela recebia antes.
    pub fn traduzir(&mut self, params: &Value) -> Vec<AgentEvent> {
        self.observar(params);
        let Some(u) = params.get("update") else {
            return Vec::new();
        };
        let tipo = u.get("sessionUpdate").and_then(Value::as_str);
        if !matches!(tipo, Some("tool_call" | "tool_call_update")) {
            return crate::acp::mapear_update(params);
        }
        let Some(id) = u.get("toolCallId").and_then(Value::as_str) else {
            return Vec::new();
        };
        let texto = |k: &str| u.get(k).and_then(Value::as_str);
        let entry = self.ferramentas.entry(id.to_string()).or_insert_with(|| {
            let nome = texto("title")
                .filter(|t| ferramentas::conhecida(t))
                .or_else(|| texto("kind").and_then(ferramentas::nome_do_kind))
                .or_else(|| texto("title"))
                .unwrap_or("tool");
            (nome.to_string(), false)
        });
        let status = texto("status").unwrap_or("");
        let terminou = status == "completed" || status == "failed";
        let entrada = u
            .get("rawInput")
            .filter(|v| v.as_object().is_some_and(|o| !o.is_empty()));
        let mut out = Vec::new();
        if !entry.1 && (entrada.is_some() || terminou) {
            entry.1 = true;
            let (name, input) = ferramentas::no_contrato(&entry.0, entrada.unwrap_or(&Value::Null));
            out.push(AgentEvent::Tool {
                id: id.to_string(),
                name,
                input,
                parent_tool_id: None,
            });
        }
        if terminou {
            let saida = crate::acp::texto_do_conteudo(u.get("content"));
            out.push(ferramentas::resultado(id, status == "completed", &saida));
        }
        out
    }

    /// O custo deste turno, sem subagentes. `None` quando não dá para saber:
    /// o motor não mandou custo, ou a sessão foi retomada sem base (o
    /// acumulado inteiro não é deste turno, e cobrá-lo seria inventar).
    fn custo_proprio(&self) -> Option<f64> {
        let total = self.total?;
        if self.retomada_sem_base {
            return None;
        }
        Some(match self.base {
            Some(b) if total + 1e-9 >= b => (total - b).max(0.0),
            _ => total,
        })
    }

    /// Os eventos do desfecho: contexto, avisos e o `Result`.
    pub fn fechar(
        self,
        resposta: &Value,
        exportar: fn(&str) -> Result<String, String>,
    ) -> Vec<AgentEvent> {
        let (input, output, cache) = crate::acp::ler_usage(resposta);
        let mut out = Vec::new();
        if self.usado > 0 {
            out.push(AgentEvent::ContextUsage {
                tokens: self.usado,
                window_tokens: self.janela,
            });
        }
        let proprio = self.custo_proprio();
        let (filhos, avisos) = somar_filhos_opencode(None, self.filhos.clone(), exportar);
        out.extend(avisos);
        let filhos = filhos.unwrap_or_default();
        let cost_usd = proprio.map(|c| c + filhos.cost.unwrap_or(0.0));
        if self.retomada_sem_base && self.total.is_some() {
            out.push(AgentEvent::Notice {
                message: "Custo deste turno do OpenCode desconhecido: a sessão foi retomada \
                          sem o total anterior. Os próximos turnos saem certos."
                    .to_string(),
            });
        }
        let UsoOpenCode {
            input: fi,
            output: fo,
            cache_read: fc,
            ..
        } = filhos;
        out.push(AgentEvent::Result {
            ok: true,
            text: None,
            cost_source: if cost_usd.is_some() {
                CostSource::Reported
            } else {
                CostSource::Unknown
            },
            cost_usd,
            input_tokens: input + fi,
            output_tokens: output + fo,
            cache_read: cache + fc,
            cache_creation: 0,
            cumulative_usage: None,
            // O acumulado CRU volta ao front como base do próximo turno.
            reported_cost_total: self.total,
        });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    // Payloads REAIS de `opencode acp` (1.18.32, 26/09/2026), dois turnos na
    // mesma sessão com `opencode/gemini-3.5-flash-lite`.
    const USO_1: &str = r#"{"sessionId":"ses_f21ce4f6effezTmS8NFCW0kiik","update":{"sessionUpdate":"usage_update","used":12223,"size":1048576,"cost":{"amount":0.00430006,"currency":"USD"}}}"#;
    const USO_2: &str = r#"{"sessionId":"ses_f21ce4f6effezTmS8NFCW0kiik","update":{"sessionUpdate":"usage_update","used":12228,"size":1048576,"cost":{"amount":0.00484787,"currency":"USD"}}}"#;
    const RESPOSTA_1: &str = r#"{"stopReason":"end_turn","usage":{"inputTokens":651,"outputTokens":2,"totalTokens":12225,"cachedReadTokens":11572},"_meta":{}}"#;

    fn sem_export(_: &str) -> Result<String, String> {
        Err("não devia exportar".into())
    }

    fn result(ev: &[AgentEvent]) -> (Option<f64>, Option<f64>) {
        match ev.last() {
            Some(AgentEvent::Result {
                cost_usd,
                reported_cost_total,
                ..
            }) => (*cost_usd, *reported_cost_total),
            _ => panic!("esperava Result por último"),
        }
    }

    #[test]
    fn modelo_vem_do_anuncio_da_sessao() {
        // Recorte REAL da resposta do `session/new` (a lista de opções,
        // com 88 modelos, podada para um).
        let r = v(
            r#"{"sessionId":"ses_f21d0dc8cffeuG0LcFCw0PJ24J","configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"opencode/big-pickle","options":[{"value":"opencode-go/deepseek-v4-flash","name":"OpenCode Go/DeepSeek V4 Flash"}]}]}"#,
        );
        assert_eq!(modelo_anunciado(&r).as_deref(), Some("opencode/big-pickle"));
        assert_eq!(modelo_anunciado(&v("{}")), None);
    }

    #[test]
    fn sessao_nova_cobra_o_total_do_primeiro_turno() {
        let mut t = TurnoAcp::new(false, None);
        t.traduzir(&v(USO_1));
        let ev = t.fechar(&v(RESPOSTA_1), sem_export);
        assert_eq!(result(&ev), (Some(0.00430006), Some(0.00430006)));
    }

    #[test]
    fn turno_retomado_cobra_so_a_diferenca() {
        // O acumulado andou de 0,00430006 para 0,00484787: o turno custou
        // 0,00054781, exatamente o `cost` da mensagem no banco do opencode.
        let mut t = TurnoAcp::new(true, Some(0.00430006));
        t.traduzir(&v(USO_2));
        let (custo, total) = result(&t.fechar(&v(RESPOSTA_1), sem_export));
        assert!((custo.unwrap() - 0.00054781).abs() < 1e-12, "{custo:?}");
        assert_eq!(total, Some(0.00484787));
    }

    #[test]
    fn retomada_sem_base_nao_cobra_o_acumulado_inteiro() {
        // Cobrar 0,00484787 aqui seria somar de novo o turno anterior. O
        // total cru ainda volta, para o próximo turno sair certo.
        let mut t = TurnoAcp::new(true, None);
        t.traduzir(&v(USO_2));
        let ev = t.fechar(&v(RESPOSTA_1), sem_export);
        assert_eq!(result(&ev), (None, Some(0.00484787)));
        assert!(ev.iter().any(|e| matches!(e, AgentEvent::Notice { .. })));
    }

    #[test]
    fn sem_usage_update_o_custo_e_desconhecido_nao_zero() {
        let t = TurnoAcp::new(false, None);
        let ev = t.fechar(&v(RESPOSTA_1), sem_export);
        match ev.last() {
            Some(AgentEvent::Result {
                cost_usd,
                cost_source,
                ..
            }) => {
                assert_eq!(*cost_usd, None);
                assert!(matches!(cost_source, CostSource::Unknown));
            }
            _ => panic!("esperava Result"),
        }
    }

    #[test]
    fn contexto_vem_do_usage_update_com_a_janela() {
        let mut t = TurnoAcp::new(false, None);
        t.traduzir(&v(USO_1));
        match &t.fechar(&v(RESPOSTA_1), sem_export)[0] {
            AgentEvent::ContextUsage {
                tokens,
                window_tokens,
            } => {
                assert_eq!(*tokens, 12223);
                assert_eq!(*window_tokens, Some(1_048_576));
            }
            _ => panic!("esperava ContextUsage"),
        }
    }

    #[test]
    fn subagente_do_acp_soma_pelo_export() {
        fn exportar(id: &str) -> Result<String, String> {
            assert_eq!(id, "ses_filho");
            Ok(r#"{"info":{"cost":0.5,"tokens":{"input":10,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}},"messages":[]}"#.into())
        }
        let task = r#"{"update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed","rawOutput":{"output":"...","metadata":{"parentSessionId":"ses_pai","sessionId":"ses_filho"}}}}"#;
        let mut t = TurnoAcp::new(false, None);
        t.traduzir(&v(task));
        t.traduzir(&v(USO_1));
        let (custo, total) = result(&t.fechar(&v(RESPOSTA_1), exportar));
        assert!((custo.unwrap() - (0.00430006 + 0.5)).abs() < 1e-12);
        // A base do próximo turno é só a da sessão: o filho não entra no
        // acumulado que o `usage_update` vai reportar.
        assert_eq!(total, Some(0.00430006));
    }

    // A sequência REAL de uma leitura pelo ACP (1.18.32, 26/09/2026).
    const READ_PENDENTE: &str = r#"{"sessionId":"ses_f21d0dc8cffeuG0LcFCw0PJ24J","update":{"sessionUpdate":"tool_call","toolCallId":"call_function_51371l29x2h7_1","title":"read","kind":"read","status":"pending","locations":[],"rawInput":{}}}"#;
    const READ_ANDANDO: &str = r#"{"sessionId":"ses_f21d0dc8cffeuG0LcFCw0PJ24J","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_function_51371l29x2h7_1","status":"in_progress","kind":"read","title":"read","locations":[{"path":"/private/tmp/oc-probe/a.txt"}],"rawInput":{"filePath":"/private/tmp/oc-probe/a.txt"}}}"#;
    const READ_PRONTO: &str = r#"{"sessionId":"ses_f21d0dc8cffeuG0LcFCw0PJ24J","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_function_51371l29x2h7_1","status":"completed","title":"private/tmp/oc-probe/a.txt","content":[{"type":"content","content":{"type":"text","text":"hello"}}]}}"#;

    #[test]
    fn leitura_pelo_acp_vira_um_read_so_quando_a_entrada_chega() {
        let mut t = TurnoAcp::new(false, None);
        // `pending` com `rawInput: {}`: nada no fio ainda.
        assert!(t.traduzir(&v(READ_PENDENTE)).is_empty());
        let ev = t.traduzir(&v(READ_ANDANDO));
        let [AgentEvent::Tool { name, input, .. }] = ev.as_slice() else {
            panic!("esperava um Tool")
        };
        assert_eq!(name, "Read");
        assert_eq!(input["file_path"], "/private/tmp/oc-probe/a.txt");
        // O desfecho não repete a chamada.
        let ev = t.traduzir(&v(READ_PRONTO));
        let [AgentEvent::ToolResult { ok, text, .. }] = ev.as_slice() else {
            panic!("esperava só o ToolResult")
        };
        assert!(*ok);
        assert_eq!(text, "hello");
    }

    #[test]
    fn subagente_pelo_acp_vira_task_mesmo_com_kind_think() {
        // O `kind` do `task` é `think`: sem o nome guardado do `tool_call`,
        // a tela recebia "think" e não sabia que era delegação.
        let pendente = r#"{"sessionId":"ses_f21ca02e7ffemPxIMWQ52CeLwi","update":{"sessionUpdate":"tool_call","toolCallId":"call_function_ghnl2wpy4dew_1","title":"task","kind":"think","status":"pending","locations":[],"rawInput":{}}}"#;
        let andando = r#"{"sessionId":"ses_f21ca02e7ffemPxIMWQ52CeLwi","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_function_ghnl2wpy4dew_1","status":"in_progress","kind":"think","title":"List files in directory","locations":[],"rawInput":{"description":"List files in directory","prompt":"List all files and directories in /private/tmp/oc-probe (use ls -la).","subagent_type":"explore"}}}"#;
        let mut t = TurnoAcp::new(false, None);
        t.traduzir(&v(pendente));
        let ev = t.traduzir(&v(andando));
        let [AgentEvent::Tool { name, input, .. }] = ev.as_slice() else {
            panic!("esperava um Tool")
        };
        assert_eq!(name, "Task");
        assert_eq!(input["subagent_type"], "explore");
        // O 2º `in_progress` (chega mais de um) não duplica a chamada.
        assert!(t.traduzir(&v(andando)).is_empty());
    }
}
