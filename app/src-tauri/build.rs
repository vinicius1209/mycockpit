use std::path::Path;
use std::process::Command;

/// Compila o sidecar de ditado (Swift, on-device) quando a fonte muda.
/// O binário fica em bin/ (gitignored); quem clona só precisa do swiftc.
fn build_stt_sidecar() {
    if !cfg!(target_os = "macos") {
        return;
    }
    println!("cargo:rerun-if-changed=stt/main.swift");
    println!("cargo:rerun-if-changed=stt/Info.plist");
    let src = Path::new("stt/main.swift");
    let out = Path::new("bin/mycockpit-stt-aarch64-apple-darwin");
    let needs = match (
        src.metadata().and_then(|m| m.modified()),
        out.metadata().and_then(|m| m.modified()),
    ) {
        (Ok(s), Ok(o)) => s > o,
        _ => true,
    };
    if !needs {
        return;
    }
    let _ = std::fs::create_dir_all("bin");
    // Info.plist embutido via sectcreate: sem ele o TCC nega mic/fala pra CLI.
    let status = Command::new("swiftc")
        .args([
            "-O",
            "stt/main.swift",
            "-o",
            "bin/mycockpit-stt-aarch64-apple-darwin",
            "-Xlinker",
            "-sectcreate",
            "-Xlinker",
            "__TEXT",
            "-Xlinker",
            "__info_plist",
            "-Xlinker",
            "stt/Info.plist",
        ])
        .status();
    match status {
        Ok(s) if s.success() => {}
        _ => println!("cargo:warning=swiftc indisponível/falhou: o ditado fica desabilitado"),
    }
}

fn main() {
    build_stt_sidecar();
    tauri_build::build()
}
