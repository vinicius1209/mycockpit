//! Camada ÚNICA de subprocess síncrono. Antes cada módulo (git.rs, sdd.rs,
//! sources.rs) re-decidia semântica de erro/encoding do seu jeito (5 estilos);
//! aqui um lugar só decide. Rodar DENTRO de spawn_blocking nos comandos async.

use std::process::Command;

/// Roda `bin args…` (cwd opcional) e devolve o stdout. Err carrega o STDERR
/// real (aparável na UI), nunca um erro genérico.
pub fn run(bin: &str, args: &[&str], cwd: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("{bin} não encontrado: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Variante probe: None em qualquer falha (quando falha = "não tem", não erro).
pub fn run_ok(bin: &str, args: &[&str], cwd: Option<&str>) -> Option<String> {
    run(bin, args, cwd).ok()
}
