// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Subcomando `approval-server`: ESTE mesmo binário roda como MCP server stdio
    // quando o `claude -p` o spawna (aprovação granular inline, ver approval.rs).
    // Intercepta ANTES do Tauri subir — o processo do MCP server não é o app.
    if std::env::args().nth(1).as_deref() == Some("approval-server") {
        app_lib::run_approval_server();
        return;
    }
    // MCP read-only de memória/contexto, compartilhável entre providers. Ele lê
    // apenas a conversa e a raiz passadas pelo runner via env.
    if std::env::args().nth(1).as_deref() == Some("context-server") {
        app_lib::run_context_server();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("work-server") {
        app_lib::run_work_server();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("browser-server") {
        app_lib::run_browser_server();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("desktop-server") {
        app_lib::run_desktop_server();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("tool-server") {
        app_lib::run_tool_server();
        return;
    }
    // Proxy MCP autenticado (A2): repassa JSON-RPC pro endpoint remoto pelo
    // socket do app, que é quem tem o token. Este processo nunca vê credencial.
    if std::env::args().nth(1).as_deref() == Some("mcp-proxy-server") {
        app_lib::run_mcp_proxy_server();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("plugin-mcp-server") {
        app_lib::run_plugin_mcp_server();
        return;
    }
    app_lib::run();
}
