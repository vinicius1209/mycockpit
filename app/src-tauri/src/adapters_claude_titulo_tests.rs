//! O Claude também nomeia a conversa no primeiro turno (ADR-255).
//!
//! A ADR-246 pôs o pedido de título só no texto dos motores sem canal de
//! sistema; o Claude recebe as instruções pelo canal de sistema, montadas no
//! adaptador, e nenhuma conversa dele foi nomeada (24/09/2026).
use super::tests::{argv, req};
use super::*;

fn com_frota_work(resume: Option<&str>) -> Vec<String> {
    let mut r = req(Permission::Padrao, false);
    r.resume = resume.map(str::to_string);
    r.work_gateway = Some(crate::work_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        socket: "/tmp/frota-work.sock".into(),
    });
    let mut a = ClaudeAdapter::default();
    argv(&a.build_command(&r).unwrap())
}

const TITULO: &str = "mcp__frota-work__conversation_title";

#[test]
fn primeiro_turno_pede_o_titulo_e_libera_a_tool() {
    let args = com_frota_work(None);
    assert!(
        args.iter().any(|a| a.contains(TITULO) && a.contains("primeira mensagem da conversa")),
        "o canal de sistema do 1º turno pede o título"
    );
    let liberadas = args
        .windows(2)
        .find(|w| w[0] == "--allowedTools")
        .map(|w| w[1].clone())
        .expect("allowlist interna");
    assert!(liberadas.split(',').any(|t| t == TITULO), "tool de conteúdo, sem card de aprovação");
}

#[test]
fn turno_retomado_nao_pede_de_novo() {
    let args = com_frota_work(Some("sessao-anterior"));
    assert!(
        !args.iter().any(|a| a.contains("primeira mensagem da conversa")),
        "o pedido só vale no 1º turno"
    );
    assert!(args.iter().any(|a| a.contains("mcp__frota-work__work_plan")), "a telemetria de trabalho segue");
}
