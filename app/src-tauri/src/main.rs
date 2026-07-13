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
  app_lib::run();
}
