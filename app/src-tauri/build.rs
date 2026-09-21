use std::path::Path;
use std::process::Command;

fn bind_embedded_identity(path: &Path) {
    let signed = Command::new("codesign")
        .args(["--force", "--sign", "-"])
        .arg(path)
        .status();
    if !matches!(signed, Ok(status) if status.success()) {
        println!(
            "cargo:warning=não foi possível selar a identidade do sidecar {:?}",
            path
        );
    }
}

/// Compila o sidecar de ditado (Swift, on-device) quando a fonte muda.
/// O binário fica em bin/ (gitignored); quem clona só precisa do swiftc.
fn build_stt_sidecar() {
    if !cfg!(target_os = "macos") {
        return;
    }
    println!("cargo:rerun-if-changed=stt/main.swift");
    println!("cargo:rerun-if-changed=stt/Info.plist");
    let src = Path::new("stt/main.swift");
    let plist = Path::new("stt/Info.plist");
    let out = Path::new("bin/frota-stt-aarch64-apple-darwin");
    let needs = match (
        src.metadata().and_then(|m| m.modified()),
        plist.metadata().and_then(|m| m.modified()),
        out.metadata().and_then(|m| m.modified()),
    ) {
        (Ok(s), Ok(p), Ok(o)) => s > o || p > o,
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
            "bin/frota-stt-aarch64-apple-darwin",
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
        // falhar aqui NÃO pode quebrar o build de quem não tem swiftc, mas o
        // aviso precisa dizer a verdade: com um binário velho em bin/, o app
        // segue ditando com a versão ANTERIOR do sidecar (mudança fora do build).
        _ if out.exists() => println!(
            "cargo:warning=swiftc falhou: o sidecar de ditado ficou no binário ANTIGO \
             (stt/main.swift mudou e NÃO entrou neste build)"
        ),
        _ => println!("cargo:warning=swiftc indisponível/falhou: o ditado fica desabilitado"),
    }
}

/// Compila o sidecar de inferência on-device. O source usa availability checks,
/// então o app continua suportando macOS anterior; somente a rota semântica fica
/// indisponível quando Foundation Models não existe.
fn build_intelligence_sidecar() {
    if !cfg!(target_os = "macos") {
        return;
    }
    println!("cargo:rerun-if-changed=intelligence/main.swift");
    println!("cargo:rerun-if-changed=intelligence/fallback.swift");
    println!("cargo:rerun-if-changed=intelligence/Info.plist");
    let src = Path::new("intelligence/main.swift");
    let plist = Path::new("intelligence/Info.plist");
    let target = std::env::var("TARGET").unwrap_or_else(|_| "aarch64-apple-darwin".into());
    let swift_target = if target.starts_with("x86_64") {
        "x86_64-apple-macos13.0"
    } else {
        "arm64-apple-macos13.0"
    };
    let out_name = format!("bin/frota-intelligence-{target}");
    let out = Path::new(&out_name);
    let needs = match (
        src.metadata().and_then(|m| m.modified()),
        plist.metadata().and_then(|m| m.modified()),
        out.metadata().and_then(|m| m.modified()),
    ) {
        (Ok(s), Ok(p), Ok(o)) => s > o || p > o,
        _ => true,
    };
    if !needs {
        return;
    }
    let _ = std::fs::create_dir_all("bin");
    let module_cache = std::env::var("OUT_DIR")
        .map(|dir| format!("{dir}/swift-module-cache"))
        .unwrap_or_else(|_| "/tmp/frota-swift-module-cache".into());
    let _ = std::fs::create_dir_all(&module_cache);
    let status = Command::new("swiftc")
        .args([
            "-parse-as-library",
            "-O",
            "-target",
            swift_target,
            "-module-cache-path",
            &module_cache,
            "intelligence/main.swift",
            "-o",
            &out_name,
            "-Xlinker",
            "-sectcreate",
            "-Xlinker",
            "__TEXT",
            "-Xlinker",
            "__info_plist",
            "-Xlinker",
            "intelligence/Info.plist",
        ])
        .status();
    if matches!(status, Ok(s) if s.success()) {
        bind_embedded_identity(out);
        return;
    }
    // CLT sem plugin de macros ou SDK/toolchain desencontrados não pode
    // impedir o app inteiro de compilar. O fallback é um Mach-O que responde
    // `framework_unavailable` no mesmo protocolo.
    let fallback = Command::new("swiftc")
        .args([
            "-parse-as-library",
            "-O",
            "-target",
            swift_target,
            "-module-cache-path",
            &module_cache,
            "intelligence/fallback.swift",
            "-o",
            &out_name,
            "-Xlinker",
            "-sectcreate",
            "-Xlinker",
            "__TEXT",
            "-Xlinker",
            "__info_plist",
            "-Xlinker",
            "intelligence/Info.plist",
        ])
        .status();
    match fallback {
        Ok(s) if s.success() => {
            bind_embedded_identity(out);
            println!(
                "cargo:warning=Foundation Models não compilou: sidecar marca a rota como indisponível"
            );
        }
        _ if out.exists() => {
            println!("cargo:warning=swiftc falhou: a inferência utilitária ficou no binário ANTIGO")
        }
        _ => println!(
            "cargo:warning=swiftc indisponível/falhou: Apple Intelligence fica indisponível"
        ),
    }
}

fn main() {
    build_stt_sidecar();
    build_intelligence_sidecar();
    tauri_build::build()
}
