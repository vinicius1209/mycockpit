// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Subcomando (`approval-server`, `browser-server`…): ESTE binário rodando
    // como o MCP stdio que o motor spawnou. Intercepta ANTES do Tauri subir,
    // porque esse processo não é o app. A lista mora em `subcomandos.rs`.
    if let Some(nome) = std::env::args().nth(1) {
        if app_lib::run_subcomando(&nome) {
            return;
        }
    }
    app_lib::run();
}
