//! O `init` do Claude Code anuncia o inventário do motor, e a resposta de um
//! builtin auditado chega ao fio como texto normal (ADR-189).
//!
//! Fixture real: `testdata/claude-2.1.270/builtin-usage.jsonl`, colhida com
//! `claude -p "/usage" --output-format stream-json --verbose
//! --include-partial-messages` em 14/09/2026. Linhas `hook_*` removidas e nomes
//! de MCP externos anonimizados; o resto é o payload como veio. O builtin não
//! gera `stream_event`: o texto vem só no `assistant` com modelo `<synthetic>`
//! e o `result` fecha com `num_turns: 0` e custo zero.
use super::*;

const USAGE: &str = include_str!("../testdata/claude-2.1.270/builtin-usage.jsonl");

fn replay(fixture: &str) -> Vec<AgentEvent> {
    let mut adapter = ClaudeAdapter::default();
    let mut events = Vec::new();
    for linha in fixture.lines() {
        events.extend(adapter.on_stdout_line(linha));
    }
    events.extend(adapter.on_close());
    events
}

#[test]
fn init_real_emite_sessao_e_inventario_do_motor() {
    let events = replay(USAGE.lines().next().unwrap());
    assert!(matches!(&events[0], AgentEvent::Session { .. }));
    let inventario = events.iter().find_map(|e| match e {
        AgentEvent::EngineInventory { inventory } => Some(inventory),
        _ => None,
    });
    let inventario = inventario.expect("init do 2.1.270 traz slash_commands");
    assert!(inventario.slash_commands.iter().any(|c| c == "usage"));
    assert!(inventario.plugins.iter().any(|p| p.name == "vercel"));
}

#[test]
fn resposta_de_builtin_sem_deltas_chega_inteira_como_texto() {
    let events = replay(USAGE);
    let esperado: String = USAGE
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find(|v| v.get("type").and_then(|t| t.as_str()) == Some("assistant"))
        .and_then(|v| {
            v.pointer("/message/content/0/text")
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })
        .unwrap();
    assert!(esperado.contains("subscription"), "fixture é a do /usage");
    let texto: String = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Text { text } | AgentEvent::TextDelta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(texto, esperado);
    assert!(
        !events.iter().any(|e| matches!(e, AgentEvent::Error { .. })),
        "builtin com num_turns 0 não é erro"
    );
}
