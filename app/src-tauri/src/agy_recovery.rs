//! Recuperação autoritativa do Agy quando a ponte `stream-json` para de avançar.
//! O transcript pertence ao próprio provider; nada aqui fabrica conteúdo.

use std::path::PathBuf;

fn safe_session_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn transcript_path(session_id: &str) -> Option<PathBuf> {
    if !safe_session_id(session_id) {
        return None;
    }
    Some(
        PathBuf::from(std::env::var("HOME").ok()?)
            .join(".gemini/antigravity-cli/brain")
            .join(session_id)
            .join(".system_generated/logs/transcript.jsonl"),
    )
}

/// Arquivos que o próprio agy registrou para um passo no transcript dele: a
/// imagem do `generate_image` mora no `media` do step de MESMO índice que o
/// stream mandou (o stream não diz onde salvou).
pub(crate) fn midias_do_passo(session_id: &str, step: u64) -> Vec<String> {
    std::fs::read_to_string(transcript_path(session_id).unwrap_or_default())
        .map(|t| midias_do_passo_em(&t, step))
        .unwrap_or_default()
}

/// Núcleo puro: `file://` do `media` do step → caminho local.
pub(crate) fn midias_do_passo_em(transcript: &str, step: u64) -> Vec<String> {
    transcript
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|item| item.get("step_index").and_then(|v| v.as_u64()) == Some(step))
        .flat_map(|item| item.get("media").and_then(|m| m.as_array()).cloned().unwrap_or_default())
        .filter_map(|m| m.get("uri").and_then(|u| u.as_str()).map(str::to_string))
        .filter_map(|uri| url::Url::parse(&uri).ok()?.to_file_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Mesma busca, devolvendo também o `step_index` da resposta: quem mostra a
/// resposta antes da ponte precisa reconhecer o mesmo step quando ele chegar.
pub(crate) fn completed_answer_step(session_id: &str, after_step: u64) -> Option<(u64, String)> {
    let transcript = std::fs::read_to_string(transcript_path(session_id)?).ok()?;
    completed_answer_step_in(&transcript, after_step)
}

#[cfg(test)]
fn completed_answer_in(transcript: &str, after_step: u64) -> Option<String> {
    completed_answer_step_in(transcript, after_step).map(|(_, content)| content)
}

pub(crate) fn completed_answer_step_in(transcript: &str, after_step: u64) -> Option<(u64, String)> {
    transcript
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|item| {
            let step = item.get("step_index")?.as_u64()?;
            let content = item.get("content")?.as_str()?.trim();
            let no_tool_call = item
                .get("tool_calls")
                .is_none_or(|calls| calls.is_null() || calls.as_array().is_some_and(Vec::is_empty));
            (step > after_step
                && item.get("source").and_then(|v| v.as_str()) == Some("MODEL")
                && item.get("type").and_then(|v| v.as_str()) == Some("PLANNER_RESPONSE")
                && item.get("status").and_then(|v| v.as_str()) == Some("DONE")
                && no_tool_call
                && !content.is_empty())
            .then(|| (step, content.to_string()))
        })
        .max_by_key(|(step, _)| *step)
}

#[cfg(test)]
mod tests {
    use super::{completed_answer_in, completed_answer_step_in, safe_session_id};

    // Fragmentos reais dos steps 204 e 210 do incidente de 29/08/2026. O
    // primeiro ainda pede ferramenta; o segundo é a resposta final do provider.
    const INCIDENTE: &str = r#"{"step_index":204,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":null,"tool_calls":[{"name":"view_file"}]}
{"step_index":210,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"Ajustamos e refinamos completamente o protótipo.","tool_calls":null}"#;

    #[test]
    fn recupera_apenas_a_resposta_final_posterior_ao_stream() {
        assert_eq!(
            completed_answer_in(INCIDENTE, 94).as_deref(),
            Some("Ajustamos e refinamos completamente o protótipo.")
        );
        assert_eq!(completed_answer_in(INCIDENTE, 210), None);
    }

    #[test]
    fn na_espera_por_tarefa_em_background_a_resposta_ja_esta_no_historico() {
        // Captura real (agy 1.2.5): o step 3 "PRONTO." foi gravado antes do
        // aviso de espera no stderr, enquanto a ponte seguia muda no step 2.
        let transcript = include_str!("../testdata/agy-1.2.5/bg-sleep.transcript.jsonl");
        let ate_a_espera: String = transcript.lines().take(4).collect::<Vec<_>>().join("\n");
        assert_eq!(
            completed_answer_step_in(&ate_a_espera, 2),
            Some((3, "PRONTO.".to_string()))
        );
        // a notificação de sistema do step 4 nunca vira resposta
        assert_eq!(
            completed_answer_step_in(transcript, 3).map(|(step, _)| step),
            Some(5)
        );
    }

    #[test]
    fn recusa_id_que_poderia_escapar_da_pasta_do_provider() {
        assert!(safe_session_id("6ae5842f-5cc6-4dda-96ba-099a9d54698e"));
        assert!(!safe_session_id("../../outra-pasta"));
    }
}
