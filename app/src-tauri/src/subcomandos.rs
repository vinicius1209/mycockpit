//! Os subcomandos do binário (movido de `lib.rs`, ADR-263): ESTE binário
//! também roda como os servidores MCP stdio que os motores spawnam. Aqui mora
//! a lista inteira: o despacho, que o `main.rs` chama antes do Tauri subir, e
//! o nome que cada um tem para a pessoa, que o painel da máquina mostra
//! quando encontra o processo (`app approval-server` é "aprovações").

use crate::{
    approval, browser_gateway, context_gateway, desktop_gateway, mcp_proxy, plugin_mcp, tool_gateway,
    work_gateway,
};

/// Os subcomandos: ESTE binário também roda como os servidores MCP stdio que
/// os motores spawnam. Chamado pelo `main.rs` ANTES do Tauri subir; `true`
/// quer dizer que era um subcomando e o processo não é o app.
pub fn run_subcomando(nome: &str) -> bool {
    match nome {
        // aprovação granular inline quando o `claude -p` o spawna
        "approval-server" => approval::run_mcp_server(),
        // memória/contexto só leitura, o mesmo contrato para qualquer motor
        "context-server" => context_gateway::run_mcp_server(),
        // plano, etapas e processos gerenciados
        "work-server" => work_gateway::run_mcp_server(),
        // o navegador da Frota (ADR-224) e o controle do desktop (ADR-225)
        "browser-server" => browser_gateway::run_mcp_server(),
        "desktop-server" => desktop_gateway::run_mcp_server(),
        // materializador do Tool Catalog: grants e workers ficam no app
        "tool-server" => tool_gateway::run_mcp_server(),
        // proxy autenticado (A2): o token fica no app, nunca neste processo
        "mcp-proxy-server" => mcp_proxy::run_mcp_server(),
        // MCP contribuído, com o descriptor revalidado antes de executar
        "plugin-mcp-server" => plugin_mcp::run_mcp_server(),
        _ => return false,
    }
    true
}

/// O nome de um subcomando para a pessoa. Subcomando que não está na lista
/// (versão mais nova do app rodando ao lado) vira ele mesmo, sem o
/// `-server`: nunca some da tela.
pub fn rotulo(nome: &str) -> String {
    match nome {
        "approval-server" => "aprovações".into(),
        "context-server" => "contexto".into(),
        "work-server" => "trabalho".into(),
        "browser-server" => "navegador".into(),
        "desktop-server" => "computador".into(),
        "tool-server" => "ferramentas".into(),
        "mcp-proxy-server" => "proxy de MCP".into(),
        "plugin-mcp-server" => "plugin".into(),
        outro => outro.trim_end_matches("-server").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todo_subcomando_tem_nome_e_o_desconhecido_nao_some() {
        assert_eq!(rotulo("approval-server"), "aprovações");
        assert_eq!(rotulo("mcp-proxy-server"), "proxy de MCP");
        assert_eq!(rotulo("novo-server"), "novo");
    }
}
