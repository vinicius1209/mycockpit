//! O `assistant` consolidado completa a cauda que os deltas não trouxeram, e
//! NUNCA repete o que já está na tela.
//!
//! Fixture real: `testdata/claude-2.1.266/texto-tool-texto.jsonl` (ver o
//! cabeçalho de `agent_stream_tail_tests.rs`). Nela a ordem de cada bloco é
//! `text_delta`… → `assistant` com o texto inteiro do bloco → `content_block_stop`.
use super::*;

const FIXTURE: &str = include_str!("../testdata/claude-2.1.266/texto-tool-texto.jsonl");

fn eh_text_delta(linha: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(linha)
        .ok()
        .and_then(|v| {
            v.pointer("/event/delta/type")
                .and_then(|t| t.as_str())
                .map(|t| t == "text_delta")
        })
        .unwrap_or(false)
}

fn texto_da_captura() -> String {
    FIXTURE
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| {
            (v.pointer("/event/delta/type").and_then(|t| t.as_str()) == Some("text_delta"))
                .then(|| {
                    v.pointer("/event/delta/text")
                        .and_then(|t| t.as_str())
                        .map(str::to_string)
                })
                .flatten()
        })
        .collect()
}

fn replay<'a>(linhas: impl Iterator<Item = &'a str>) -> Vec<AgentEvent> {
    let mut adapter = ClaudeAdapter::default();
    let mut events = Vec::new();
    for linha in linhas {
        events.extend(adapter.on_stdout_line(linha));
    }
    events.extend(adapter.on_close());
    events
}

fn texto(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::TextDelta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn stream_integro_nao_ganha_nenhum_caractere_a_mais() {
    let events = replay(FIXTURE.lines());
    assert_eq!(texto(&events), texto_da_captura());
}

#[test]
fn deltas_finais_perdidos_voltam_pelo_consolidado_na_mesma_bolha() {
    // Some a metade final dos deltas do ÚLTIMO bloco de texto, como no
    // incidente: o começo chegou, o fim não.
    let indices: Vec<usize> = FIXTURE
        .lines()
        .enumerate()
        .filter(|(_, l)| eh_text_delta(l))
        .map(|(i, _)| i)
        .collect();
    let perdidos: std::collections::HashSet<usize> =
        indices[indices.len() - 6..].iter().copied().collect();
    let events = replay(
        FIXTURE
            .lines()
            .enumerate()
            .filter(|(i, _)| !perdidos.contains(i))
            .map(|(_, l)| l),
    );
    assert_eq!(texto(&events), texto_da_captura());

    // A cauda entra ANTES do TextStop do bloco: é continuação da bolha, não
    // uma bolha nova começando no meio da palavra.
    let ultima_cauda = events
        .iter()
        .rposition(|e| matches!(e, AgentEvent::TextDelta { .. }))
        .unwrap();
    assert!(
        events[ultima_cauda + 1..]
            .iter()
            .any(|e| matches!(e, AgentEvent::TextStop)),
        "a cauda precisa vir antes do fechamento do bloco"
    );
}

#[test]
fn consolidado_depois_do_bloco_fechado_nao_repete_texto() {
    // Mensagem cumulativa (ou atrasada) que chega com o bloco já fechado: nada
    // a completar, e repetir seria a bolha duplicada que o arm evita desde o H2.
    let assistant = FIXTURE
        .lines()
        .rev()
        .find(|l| l.contains("\"type\":\"assistant\"") && l.contains("\"type\":\"text\""))
        .unwrap();
    let mut linhas: Vec<&str> = FIXTURE.lines().collect();
    linhas.push(assistant);
    let events = replay(linhas.into_iter());
    assert_eq!(texto(&events), texto_da_captura());
}

#[test]
fn deltas_divergentes_do_consolidado_nao_sao_reescritos() {
    let mut adapter = ClaudeAdapter::default();
    let mut events = Vec::new();
    // Deriva a divergência da captura real, alterando apenas o texto recebido.
    let mut esperado = String::new();
    for linha in FIXTURE.lines() {
        let mut value: serde_json::Value = serde_json::from_str(linha).unwrap();
        if eh_text_delta(linha) {
            value["event"]["delta"]["text"] = serde_json::json!("Outra coisa");
            esperado.push_str("Outra coisa");
        }
        events.extend(adapter.on_stdout_line(&value.to_string()));
    }
    assert_eq!(texto(&events), esperado);
}

#[test]
fn consolidado_repetido_antes_do_stop_nao_duplica_a_cauda() {
    let linhas: Vec<&str> = FIXTURE.lines().filter(|l| !eh_text_delta(l)).collect();
    let events = replay(linhas.into_iter().flat_map(|linha| {
        // Repete cada consolidado ainda com o bloco aberto e sem deltas.
        let repetir = linha.contains("\"type\":\"assistant\"");
        std::iter::once(linha).chain(repetir.then_some(linha))
    }));
    assert_eq!(texto(&events), texto_da_captura());
}
