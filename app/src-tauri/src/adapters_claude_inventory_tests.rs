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

/// Fixture real: `testdata/claude-2.1.270/resume-apos-tarefa-parada.jsonl`,
/// segundo turno de uma sessão haiku cujo primeiro turno deixou `sleep 90` em
/// segundo plano (16/09/2026). O stream abre com `task_notification` (stopped),
/// um `result` de bastidor (`num_turns` 0, custo 0, texto vazio) e só então o
/// turno pedido.
const RESUME_TAREFA_PARADA: &str =
    include_str!("../testdata/claude-2.1.270/resume-apos-tarefa-parada.jsonl");

#[test]
fn result_de_bastidor_no_resume_nao_vira_recibo_vazio() {
    let results: Vec<(Option<String>, Option<f64>)> = replay(RESUME_TAREFA_PARADA)
        .into_iter()
        .filter_map(|e| match e {
            AgentEvent::Result { text, cost_usd, .. } => Some((text, cost_usd)),
            _ => None,
        })
        .collect();
    assert_eq!(results.len(), 1, "só o turno pedido fecha recibo: {results:?}");
    assert_eq!(results[0].0.as_deref(), Some("oi"));
    assert!(results[0].1.unwrap_or(0.0) > 0.0);
}

#[test]
fn builtin_com_zero_turnos_continua_fechando_o_turno() {
    // O /usage também fecha com `num_turns: 0` e custo zero, mas traz texto.
    let n = replay(USAGE)
        .iter()
        .filter(|e| matches!(e, AgentEvent::Result { .. }))
        .count();
    assert_eq!(n, 1);
}

/// Fixture real: `testdata/claude-2.1.270/background-bash.jsonl` (16/09/2026,
/// com o teto de espera da Frota no ambiente). O shell em segundo plano nasce com
/// o arquivo de saída já conhecido e morre ~5 s depois do `result` como `killed`.
const BACKGROUND_BASH: &str =
    include_str!("../testdata/claude-2.1.270/background-bash.jsonl");

#[test]
fn shell_em_segundo_plano_nasce_com_arquivo_e_morre_como_interrompido() {
    let trabalhos: Vec<(DeferredStatus, Option<String>)> = replay(BACKGROUND_BASH)
        .into_iter()
        .filter_map(|e| match e {
            AgentEvent::DeferredWork { status, output_file, .. } => Some((status, output_file)),
            _ => None,
        })
        .collect();
    let primeiro_com_arquivo = trabalhos
        .iter()
        .position(|(_, f)| f.as_deref().is_some_and(|p| p.ends_with("/tasks/btirvhvcs.output")))
        .expect("o arquivo de saída chega enquanto roda");
    assert!(matches!(trabalhos[primeiro_com_arquivo].0, DeferredStatus::Running));
    assert!(
        trabalhos.iter().filter(|(s, _)| matches!(s, DeferredStatus::Stopped)).count() >= 2,
        "task_updated killed e task_notification stopped encerram: {:?}",
        trabalhos.iter().map(|t| format!("{:?}", t.0)).collect::<Vec<_>>()
    );
}


/// Fixture real: `testdata/claude-2.1.270/comando-em-primeiro-plano.jsonl`
/// (16/09/2026, haiku, Bash de ~12 s SEM `run_in_background`). O CLI abre task
/// com `is_backgrounded: false` e `output_file: ""`; a Frota contava isso como
/// "trabalho em background" e listava nos Bastidores (visto no build #386).
const COMANDO_EM_PRIMEIRO_PLANO: &str =
    include_str!("../testdata/claude-2.1.270/comando-em-primeiro-plano.jsonl");

#[test]
fn comando_em_primeiro_plano_nao_vira_trabalho_em_segundo_plano() {
    let eventos = replay(COMANDO_EM_PRIMEIRO_PLANO);
    assert!(
        !eventos.iter().any(|e| matches!(e, AgentEvent::DeferredWork { .. })),
        "Bash comum que demora não é trabalho em segundo plano"
    );
    assert!(eventos.iter().any(|e| matches!(e, AgentEvent::ToolResult { .. })));
}

/// Fixture real: `testdata/claude-2.1.270/background-agent.jsonl` (ADR-200): o
/// subagente em segundo plano roda um Bash comum (`is_backgrounded: false`).
const BACKGROUND_AGENT: &str =
    include_str!("../testdata/claude-2.1.270/background-agent.jsonl");

#[test]
fn subagente_da_fixture_segue_em_segundo_plano_e_o_bash_dele_nao() {
    let ids: Vec<String> = replay(BACKGROUND_AGENT)
        .into_iter()
        .filter_map(|e| match e {
            AgentEvent::DeferredWork { id, kind: Some(k), .. } => Some(format!("{id}:{k}")),
            _ => None,
        })
        .collect();
    assert!(ids.iter().any(|i| i.ends_with(":local_agent")), "{ids:?}");
    assert!(!ids.iter().any(|i| i.ends_with(":local_bash")), "{ids:?}");
}

#[test]
fn task_em_primeiro_plano_promovida_ao_segundo_plano_nasce_na_promocao() {
    let mut a = ClaudeAdapter::default();
    let nasce = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_started", "task_id": "b1",
        "tool_use_id": "toolu_1", "description": "Build longo",
        "is_backgrounded": false, "task_type": "local_bash"
    }));
    assert!(nasce.is_empty());
    let promovida = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_updated", "task_id": "b1",
        "patch": { "is_backgrounded": true }
    }));
    match promovida.as_slice() {
        [AgentEvent::DeferredWork { id, tool_use_id, name, status: DeferredStatus::Running, .. }] => {
            assert_eq!(id, "b1");
            assert_eq!(tool_use_id.as_deref(), Some("toolu_1"));
            assert_eq!(name.as_deref(), Some("Build longo"));
        }
        outro => panic!("esperava o nascimento na promoção, vieram {} eventos", outro.len()),
    }
    let fim = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_notification", "task_id": "b1",
        "status": "completed", "output_file": "/tmp/claude-501/x/tasks/b1.output"
    }));
    assert!(matches!(fim.as_slice(), [AgentEvent::DeferredWork { status: DeferredStatus::Completed, .. }]));
}
