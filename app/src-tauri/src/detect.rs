//! Detecção de ferramentas na máquina (onboarding, docs/onboarding.md §1). Roda
//! TODOS os probes em paralelo, cada um com timeout curto (probe pendurado vira
//! `unknown`, nunca trava o wizard). Nenhum probe dispara run pago — só metadata.
//! Depende do PATH já hidratado no startup (path.rs) p/ achar os binários.

use serde::Serialize;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// auth: "ok" (logado) | "missing" (instalado, deslogado) | "unknown"
/// (instalado, auth indeterminada) | "na" (não se aplica: git/swiftc).
#[derive(Serialize, Clone)]
pub struct DetectedTool {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub auth: String,
    pub detail: Option<String>,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

fn tool(
    id: &str,
    installed: bool,
    version: Option<String>,
    auth: &str,
    detail: Option<String>,
) -> DetectedTool {
    DetectedTool {
        id: id.to_string(),
        installed,
        version,
        auth: auth.to_string(),
        detail,
    }
}

/// Roda um comando; devolve (exit_ok, stdout_trimmado) ou None se o binário não
/// existe (ENOENT) ou estourou o timeout. stderr é ignorado (só metadata).
async fn run(bin: &str, args: &[&str]) -> Option<(bool, String)> {
    match timeout(PROBE_TIMEOUT, Command::new(bin).args(args).output()).await {
        Ok(Ok(out)) => Some((
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        )),
        _ => None,
    }
}

/// Extrai o número de versão (1º token que começa com dígito e tem "."). Ex.:
/// "2.1.145 (Claude Code)" → "2.1.145"; "codex-cli 0.141.0" → "0.141.0".
fn extract_version(s: &str) -> Option<String> {
    s.lines().next().and_then(|line| {
        line.split_whitespace()
            .map(|t| t.trim_start_matches('v'))
            .find(|t| {
                t.contains('.') && t.chars().next().is_some_and(|c| c.is_ascii_digit())
            })
            .map(str::to_string)
    })
}

async fn probe_claude() -> DetectedTool {
    let Some((ok, out)) = run("claude", &["--version"]).await else {
        return tool("claude-code", false, None, "missing", None);
    };
    if !ok {
        return tool("claude-code", false, None, "missing", None);
    }
    let version = extract_version(&out);
    // auth: `claude auth status` → JSON {"loggedIn": bool, "email"|"authMethod"…}
    let (auth, detail) = match run("claude", &["auth", "status"]).await {
        Some((_, json)) => match serde_json::from_str::<serde_json::Value>(&json) {
            Ok(v) => {
                let logged = v.get("loggedIn").and_then(|x| x.as_bool()).unwrap_or(false);
                let detail = v
                    .get("email")
                    .and_then(|x| x.as_str())
                    .or_else(|| v.get("authMethod").and_then(|x| x.as_str()))
                    .map(str::to_string);
                (if logged { "ok" } else { "missing" }.to_string(), detail)
            }
            Err(_) => ("unknown".to_string(), None),
        },
        None => ("unknown".to_string(), None),
    };
    tool("claude-code", true, version, &auth, detail)
}

async fn probe_codex() -> DetectedTool {
    let Some((ok, out)) = run("codex", &["--version"]).await else {
        return tool("codex", false, None, "missing", None);
    };
    if !ok {
        return tool("codex", false, None, "missing", None);
    }
    let version = extract_version(&out);
    // auth: `codex login status` → exit 0 + "Logged in using ChatGPT"; sem JSON,
    // decide pelo exit code.
    let (auth, detail) = match run("codex", &["login", "status"]).await {
        Some((true, line)) => (
            "ok".to_string(),
            line.lines().next().map(str::to_string),
        ),
        Some((false, _)) => ("missing".to_string(), None),
        None => ("unknown".to_string(), None),
    };
    tool("codex", true, version, &auth, detail)
}

async fn probe_agy() -> DetectedTool {
    let Some((ok, out)) = run("agy", &["--version"]).await else {
        return tool("agy", false, None, "missing", None);
    };
    if !ok {
        return tool("agy", false, None, "missing", None);
    }
    let version = extract_version(&out);
    // agy NÃO tem subcomando de auth (1.1.1). Degradação: `agy models` — lista
    // não-vazia → provavelmente logado; erro/vazio/timeout → unknown (honesto).
    let auth = match run("agy", &["models"]).await {
        Some((true, list)) if !list.is_empty() => "ok",
        _ => "unknown",
    };
    tool("agy", true, version, auth, None)
}

async fn probe_simple(id: &str, bin: &str) -> DetectedTool {
    match run(bin, &["--version"]).await {
        Some((true, out)) => tool(id, true, extract_version(&out), "na", None),
        _ => tool(id, false, None, "na", None),
    }
}

/// Detecta todas as ferramentas em PARALELO. Chamado pelo wizard e pela
/// re-detecção nas Configurações. Nunca falha (cada probe degrada p/ missing/unknown).
#[tauri::command]
pub async fn detect_agents() -> Vec<DetectedTool> {
    let (claude, codex, agy, git, swiftc) = tokio::join!(
        probe_claude(),
        probe_codex(),
        probe_agy(),
        probe_simple("git", "git"),
        probe_simple("swiftc", "swiftc"),
    );
    vec![claude, codex, agy, git, swiftc]
}
