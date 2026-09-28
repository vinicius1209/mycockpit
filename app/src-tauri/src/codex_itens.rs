//! Mapeamento dos `ThreadItem` do `codex app-server` para eventos normalizados.
//!
//! Recorte fechado do `codex_appserver.rs`: aqui mora só a tradução de item
//! (aberto e concluído) e o estado que ela precisa entre notificações. O
//! transporte, o handshake e as aprovações continuam lá.

use crate::agent::AgentEvent;
use crate::pricing::NormalizedUsage;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Estado de parsing que precisa sobreviver entre notificações do stream.
#[derive(Default)]
pub struct StreamState {
    /// itemIds de agentMessage que JÁ receberam delta: no `item/completed` deles
    /// basta fechar a bolha (TextStop). Sem isso o texto sairia DUPLICADO — uma
    /// vez em streaming e outra inteiro no fim.
    pub(crate) streamed: HashSet<String>,
    /// Último `tokenUsage.last` visto — o `turn/completed` não traz usage, então
    /// o Result é montado com este.
    pub(crate) last_usage: Option<NormalizedUsage>,
    /// Modelo (do config/seleção) p/ estimar o custo: o Codex não reporta USD.
    pub(crate) model: Option<String>,
    /// Evidência visual (browser-plan B1): destino em disco dos blocos image
    /// que vierem no `result` de um mcpToolCall. None = degrada sem evidência.
    pub(crate) evidence: Option<crate::evidence::EvidenceSink>,
    /// `commandExecution` que começou e ainda não fechou: id → linha de comando.
    pub(crate) comandos_abertos: HashMap<String, String>,
    /// Dos abertos, os que CEDERAM o controle (passaram do `yield_time_ms`): o
    /// modelo já seguiu adiante e eles continuam rodando. Já viraram
    /// `DeferredWork`; o fim deles fecha o mesmo trabalho.
    pub(crate) comandos_cedidos: HashSet<String>,
}

impl StreamState {
    pub fn new(model: Option<String>) -> Self {
        Self {
            model,
            ..Default::default()
        }
    }
}

/// Corta um output longo p/ o cartão da tool (mesma régua do `codex_tool_result`).
pub(crate) fn clip(full: &str) -> (String, u64) {
    let lines = if full.trim().is_empty() {
        0
    } else {
        full.lines().count() as u64
    };
    let mut text: String = full.chars().take(600).collect();
    if full.chars().count() > 600 {
        text.push('…');
    }
    (text, lines)
}

/// Item que começou a executar: publica a folha imediatamente. O completed
/// posterior repete o mesmo id e o reducer deduplica a tool, anexando o result.
pub(crate) fn map_item_started(item: &Value) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return vec![];
    }
    let text_of = |key: &str| {
        item.get(key)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string()
    };
    match item.get("type").and_then(|value| value.as_str()).unwrap_or("") {
        "commandExecution" => vec![AgentEvent::Tool {
            id,
            name: "Bash".into(),
            input: json!({ "command": text_of("command") }),
            parent_tool_id: None,
        }],
        "fileChange" => vec![AgentEvent::Tool {
            id,
            name: "Edit".into(),
            input: item.get("changes").cloned().unwrap_or(Value::Null),
            parent_tool_id: None,
        }],
        "mcpToolCall" | "dynamicToolCall" => vec![AgentEvent::Tool {
            id,
            name: item
                .get("tool")
                .and_then(|value| value.as_str())
                .unwrap_or("mcp")
                .to_string(),
            input: item.get("arguments").cloned().unwrap_or(Value::Null),
            parent_tool_id: None,
        }],
        "webSearch" => vec![AgentEvent::Tool {
            id,
            name: "WebSearch".into(),
            input: json!({ "query": text_of("query") }),
            parent_tool_id: None,
        }],
        // AUTO-COMPACTAÇÃO do codex. Descoberta no binário 0.149: o system
        // prompt dele diz "when you run out of context, the conversation is
        // automatically summarized for you", há a chave
        // `auto_compact_token_limit`, e o item chega como `ContextCompactionItem`
        // (aqui, camelCase, como os irmãos).
        //
        // Isto CAÍA no `_ => vec![]`: a conversa era compactada, o modelo perdia
        // detalhe e você não ficava sabendo. O claude já avisava (compact_boundary,
        // ADR-015) — a diferença entre os motores era invisível, que é o defeito
        // que o §2.2 e o selo do sandbox vêm corrigindo em outros eixos.
        "contextCompaction" => vec![AgentEvent::Notice {
            message: "Contexto cheio: o Codex resumiu a conversa sozinho — o detalhe antigo virou resumo.".to_string(),
        }],
        "imageGeneration" => vec![tool_de_imagem_gerada(id, item)],
        "imageView" => vec![tool_de_imagem_vista(id, item)],
        _ => vec![],
    }
}

/// A geração de imagem entra no vocabulário do contrato como `GenerateImage`,
/// com o prompt que o motor usou. O `result` (a imagem em base64) nunca vai no
/// input: ele é a própria imagem, e mora no disco (ver `store_generated_image`).
fn tool_de_imagem_gerada(id: String, item: &Value) -> AgentEvent {
    let prompt = item
        .get("revisedPrompt")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty());
    AgentEvent::Tool {
        id,
        name: "GenerateImage".into(),
        input: json!({ "prompt": prompt }),
        parent_tool_id: None,
    }
}

/// O agente olhando uma imagem local é leitura de arquivo, no mesmo `Read` de
/// sempre.
fn tool_de_imagem_vista(id: String, item: &Value) -> AgentEvent {
    AgentEvent::Tool {
        id,
        name: "Read".into(),
        input: json!({ "file_path": item.get("path").and_then(|x| x.as_str()).unwrap_or("") }),
        parent_tool_id: None,
    }
}

/// Motivo legível de uma geração que falhou. O contrato só conhece
/// `usageLimitExceeded`; tipo novo sai pelo nome, nunca em silêncio.
fn motivo_da_falha_de_imagem(failure: &Value) -> String {
    match failure.get("type").and_then(|x| x.as_str()) {
        Some("usageLimitExceeded") => {
            let agora = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let volta = failure
                .get("resetsAt")
                .and_then(|x| x.as_i64())
                .and_then(|s| volta_em(s - agora))
                .map(|t| format!(" Volta em {t}."))
                .unwrap_or_default();
            format!("Limite de geração de imagem atingido.{volta}")
        }
        Some(outro) => format!("A geração falhou ({outro})."),
        None => "A geração falhou.".to_string(),
    }
}

/// "2h 10min", "40min", "1h". Reset no passado ou agora: None (não promete).
fn volta_em(segundos: i64) -> Option<String> {
    if segundos <= 0 {
        return None;
    }
    let min = ((segundos + 59) / 60).max(1);
    let (h, m) = (min / 60, min % 60);
    Some(match (h, m) {
        (0, m) => format!("{m}min"),
        (h, 0) => format!("{h}h"),
        (h, m) => format!("{h}h {m}min"),
    })
}

/// Um `ThreadItem` concluído → Tool + ToolResult. No app-server a Tool pode já
/// ter vindo no `item/started`; repetir o id é intencional e replay-safe porque
/// o reducer deduplica a abertura e anexa este resultado.
pub(crate) fn map_item_completed(item: &Value, st: &mut StreamState) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let kind = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let text_of = |k: &str| {
        item.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };

    let tool_result = |name_ok: bool, out: String, images: Vec<String>| {
        let (text, lines) = clip(&out);
        AgentEvent::ToolResult {
            id: id.clone(),
            ok: name_ok,
            text,
            lines,
            images,
        }
    };

    match kind {
        "agentMessage" => {
            // já streamado por delta → só fecha a bolha; senão manda o texto cheio
            // (agent sem partial messages nunca fica mudo).
            if st.streamed.remove(&id) {
                return vec![AgentEvent::TextStop];
            }
            let t = text_of("text");
            if t.trim().is_empty() {
                return vec![];
            }
            vec![AgentEvent::Text { text: t }, AgentEvent::TextStop]
        }
        "commandExecution" => {
            let exit = item.get("exitCode").and_then(|x| x.as_i64());
            let ok = exit.map(|c| c == 0).unwrap_or(true);
            let out = item
                .get("aggregatedOutput")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                AgentEvent::Tool {
                    id: id.clone(),
                    name: "Bash".to_string(),
                    input: json!({ "command": text_of("command") }),
                    parent_tool_id: None,
                },
                tool_result(ok, out, Vec::new()),
            ]
        }
        "fileChange" => {
            let status = item.get("status").and_then(|x| x.as_str()).unwrap_or("");
            let ok = !matches!(status, "failed" | "declined" | "cancelled");
            vec![
                AgentEvent::Tool {
                    id: id.clone(),
                    name: "Edit".to_string(),
                    input: item.get("changes").cloned().unwrap_or(Value::Null),
                    parent_tool_id: None,
                },
                tool_result(ok, status.to_string(), Vec::new()),
            ]
        }
        "mcpToolCall" | "dynamicToolCall" => {
            let err = item.get("error").filter(|x| !x.is_null());
            // B1: blocos image do CallToolResult MCP viram evidência em disco;
            // com content estruturado, o texto do cartão vem dos blocos `text`
            // (antes o JSON cru — base64 incluso — entrava no clip de 600).
            let images = crate::evidence::collect_images(
                st.evidence.as_ref(),
                &id,
                item.pointer("/result/content").unwrap_or(&Value::Null),
            );
            let out = match err {
                Some(e) => e.to_string(),
                None => match item.pointer("/result/content").and_then(|c| c.as_array()) {
                    Some(blocks) => blocks
                        .iter()
                        .filter_map(|b| b.get("text").and_then(|x| x.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    None => item
                        .get("result")
                        .map(|r| r.to_string())
                        .unwrap_or_default(),
                },
            };
            vec![
                AgentEvent::Tool {
                    id: id.clone(),
                    name: item
                        .get("tool")
                        .and_then(|x| x.as_str())
                        .unwrap_or("mcp")
                        .to_string(),
                    input: item.get("arguments").cloned().unwrap_or(Value::Null),
                    parent_tool_id: None,
                },
                tool_result(err.is_none(), out, images),
            ]
        }
        "webSearch" => vec![
            AgentEvent::Tool {
                id: id.clone(),
                name: "WebSearch".to_string(),
                input: json!({ "query": text_of("query") }),
                parent_tool_id: None,
            },
            tool_result(true, String::new(), Vec::new()),
        ],
        "imageGeneration" => {
            let failure = item.get("failure").filter(|x| !x.is_null());
            let status = item.get("status").and_then(|x| x.as_str()).unwrap_or("");
            let images = if failure.is_none() {
                crate::evidence::store_generated_image(
                    st.evidence.as_ref(),
                    &id,
                    item.get("savedPath").and_then(|x| x.as_str()),
                    item.get("result").and_then(|x| x.as_str()),
                )
            } else {
                Vec::new()
            };
            let ok = failure.is_none() && status != "failed";
            let out = match failure {
                Some(f) => motivo_da_falha_de_imagem(f),
                None if !ok => "A geração falhou.".to_string(),
                None => String::new(),
            };
            vec![
                tool_de_imagem_gerada(id.clone(), item),
                tool_result(ok, out, images),
            ]
        }
        "imageView" => vec![
            tool_de_imagem_vista(id.clone(), item),
            tool_result(true, String::new(), Vec::new()),
        ],
        // userMessage (o nosso próprio prompt), reasoning, plan… não viram cartão.
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evidence::EvidenceSink;

    // Item `imageGeneration` no formato do schema do app-server 0.157.1, com os
    // valores reais da geração de 29/07/2026 (codex 0.144.6): id, status e o
    // prompt revisado são do payload; o `result` real tinha 3,3 MB e aqui é o
    // PNG 1×1 dos testes de evidência. NEEDS-VERIFY: trocar por captura ao vivo
    // do app-server quando houver conta com geração de imagem.
    const PNG_1X1_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const ID_REAL: &str = "call_KcvAs3rGnXZjAQIXtbIifhBO";
    const PROMPT_REAL: &str = "Use case: ads-marketing\nAsset type: landscape social preview card for the PWA Nossa Casa";

    fn sink(tag: &str) -> (EvidenceSink, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("frota-codex-img-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (EvidenceSink::new(dir.clone(), "evidence/conv-1".into()), dir)
    }

    fn item(saved_path: Option<&str>, result: &str, failure: Value) -> Value {
        json!({
            "type": "imageGeneration",
            "id": ID_REAL,
            "status": "completed",
            "revisedPrompt": PROMPT_REAL,
            "result": result,
            "transparentBackground": null,
            "failure": failure,
            "savedPath": saved_path,
        })
    }

    #[test]
    fn imagem_gerada_abre_como_generate_image_com_o_prompt_do_motor() {
        let evs = map_item_started(&item(None, PNG_1X1_B64, Value::Null));
        match &evs[..] {
            [AgentEvent::Tool { id, name, input, .. }] => {
                assert_eq!(id, ID_REAL);
                assert_eq!(name, "GenerateImage");
                assert_eq!(input["prompt"], PROMPT_REAL);
            }
            outro => panic!("esperava uma Tool, veio {} eventos", outro.len()),
        }
    }

    #[test]
    fn imagem_gerada_vira_evidencia_a_partir_do_arquivo_salvo() {
        let (s, dir) = sink("salvo");
        let origem = std::env::temp_dir().join(format!("frota-codex-img-origem-{}.png", std::process::id()));
        std::fs::write(&origem, crate::evidence::decode_base64(PNG_1X1_B64).unwrap()).unwrap();
        let mut st = StreamState::new(None);
        st.evidence = Some(s);
        let evs = map_item_completed(&item(origem.to_str(), "", Value::Null), &mut st);
        let AgentEvent::ToolResult { ok, images, .. } = &evs[1] else { panic!("sem ToolResult") };
        assert!(ok);
        assert_eq!(images, &vec![format!("evidence/conv-1/{ID_REAL}-0.png")]);
        assert!(dir.join(format!("{ID_REAL}-0.png")).is_file());
        let _ = std::fs::remove_file(origem);
    }

    #[test]
    fn sem_arquivo_salvo_a_imagem_sai_do_base64() {
        let (s, dir) = sink("b64");
        let mut st = StreamState::new(None);
        st.evidence = Some(s);
        let evs = map_item_completed(&item(None, PNG_1X1_B64, Value::Null), &mut st);
        let AgentEvent::ToolResult { images, .. } = &evs[1] else { panic!("sem ToolResult") };
        assert_eq!(images.len(), 1);
        assert!(dir.join(format!("{ID_REAL}-0.png")).is_file());
    }

    #[test]
    fn o_base64_da_imagem_nunca_atravessa_o_channel() {
        // O `result` real chegava com 3,3 MB. Nada dele pode ir no evento.
        let enorme = format!("iVBORw0KGgo{}", "A".repeat(3_300_000));
        let (s, _) = sink("enorme");
        let mut st = StreamState::new(None);
        st.evidence = Some(s);
        let mut evs = map_item_started(&item(None, &enorme, Value::Null));
        evs.extend(map_item_completed(&item(None, &enorme, Value::Null), &mut st));
        let serializado = serde_json::to_string(&evs).unwrap();
        assert!(serializado.len() < 10_000, "evento com {} bytes", serializado.len());
    }

    #[test]
    fn limite_de_geracao_falha_com_o_motivo_e_sem_imagem() {
        let mut st = StreamState::new(None);
        let volta = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 2 * 3600
            + 600;
        let failure = json!({ "type": "usageLimitExceeded", "limitId": "images", "resetsAt": volta });
        let evs = map_item_completed(&item(None, "", failure), &mut st);
        let AgentEvent::ToolResult { ok, text, images, .. } = &evs[1] else { panic!("sem ToolResult") };
        assert!(!ok);
        assert!(images.is_empty());
        assert!(text.starts_with("Limite de geração de imagem atingido."), "{text}");
        assert!(text.contains("Volta em 2h 10min") || text.contains("Volta em 2h 9min"), "{text}");
    }

    #[test]
    fn falha_de_tipo_desconhecido_diz_o_nome_do_tipo() {
        let mut st = StreamState::new(None);
        let evs = map_item_completed(&item(None, "", json!({ "type": "moderation" })), &mut st);
        let AgentEvent::ToolResult { ok, text, .. } = &evs[1] else { panic!("sem ToolResult") };
        assert!(!ok);
        assert_eq!(text, "A geração falhou (moderation).");
    }

    #[test]
    fn imagem_vista_e_leitura_do_arquivo() {
        let it = json!({ "type": "imageView", "id": "v1", "path": "/tmp/dashboard.png" });
        let evs = map_item_started(&it);
        let [AgentEvent::Tool { name, input, .. }] = &evs[..] else { panic!("sem Tool") };
        assert_eq!(name, "Read");
        assert_eq!(input["file_path"], "/tmp/dashboard.png");
    }
}
