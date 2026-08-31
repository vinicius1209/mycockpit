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

pub(crate) fn completed_answer(session_id: &str, after_step: u64) -> Option<String> {
    let transcript = std::fs::read_to_string(transcript_path(session_id)?).ok()?;
    completed_answer_in(&transcript, after_step)
}

fn completed_answer_in(transcript: &str, after_step: u64) -> Option<String> {
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
        .map(|(_, content)| content)
}

#[cfg(test)]
mod tests {
    use super::{completed_answer_in, safe_session_id};

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
    fn recusa_id_que_poderia_escapar_da_pasta_do_provider() {
        assert!(safe_session_id("6ae5842f-5cc6-4dda-96ba-099a9d54698e"));
        assert!(!safe_session_id("../../outra-pasta"));
    }
}
