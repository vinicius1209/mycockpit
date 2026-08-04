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
    app_lib::run();
}
