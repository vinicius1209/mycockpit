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
/// latest: última versão oficial publicada (npm/GitHub); None = fonte
/// indisponível, offline ou não aplicável. Comparação de versão é do FRONTEND.
#[derive(Serialize, Clone)]
pub struct DetectedTool {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub auth: String,
    pub detail: Option<String>,
    pub latest: Option<String>,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
/// Timeout dos lookups de `latest` (rede): mais curto que o probe local pra
/// nunca virar o gargalo do `tokio::join!` da detecção.
const LATEST_TIMEOUT: Duration = Duration::from_secs(4);

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
        latest: None,
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

/// Busca a última versão oficial via `curl` subprocess (o app já orquestra
/// CLIs; zero dependência de HTTP client). Best-effort: qualquer falha (sem
/// curl, offline, timeout, JSON inesperado) devolve None em silêncio.
/// `json_path` é o campo top-level do JSON (ex.: "version", "tag_name").
async fn fetch_latest(url: &str, json_path: &str) -> Option<String> {
    let out = timeout(
        LATEST_TIMEOUT,
        Command::new("curl")
            .args(["-s", "--max-time", "3", url])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    v.get(json_path)
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// Normaliza tag de release do GitHub p/ versão pura: "rust-v0.144.4" →
/// "0.144.4"; "v1.2.3" → "1.2.3"; "1.2.3" fica como está.
fn normalize_tag(tag: &str) -> String {
    let t = tag.trim();
    let t = t.strip_prefix("rust-v").unwrap_or(t);
    let t = t.strip_prefix('v').unwrap_or(t);
    t.to_string()
}

/// Última do Claude Code: npm registry (`.version`).
async fn latest_claude() -> Option<String> {
    fetch_latest(
        "https://registry.npmjs.org/@anthropic-ai/claude-code/latest",
        "version",
    )
    .await
}

/// Última do Codex: GitHub releases (`.tag_name` = "rust-v0.144.4" → "0.144.4").
async fn latest_codex() -> Option<String> {
    fetch_latest(
        "https://api.github.com/repos/openai/codex/releases/latest",
        "tag_name",
    )
    .await
    .map(|t| normalize_tag(&t))
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
/// Os lookups de `latest` (rede, best-effort) rodam no MESMO join dos probes
/// locais — nunca atrasam a detecção além do próprio timeout curto (4s < 6s).
/// agy/git/swiftc: sem fonte pública conhecida → latest = None (honesto).
#[tauri::command]
pub async fn detect_agents() -> Vec<DetectedTool> {
    let (mut claude, mut codex, agy, git, swiftc, latest_claude, latest_codex) = tokio::join!(
        probe_claude(),
        probe_codex(),
        probe_agy(),
        probe_simple("git", "git"),
        probe_simple("swiftc", "swiftc"),
        latest_claude(),
        latest_codex(),
    );
    claude.latest = latest_claude;
    codex.latest = latest_codex;
    vec![claude, codex, agy, git, swiftc]
}

/// Parseia o stdout de `agy models` em nomes de modelo: linhas não-vazias,
/// trimadas. Separado do subprocess p/ ser testável em unit.
fn parse_model_lines(out: &str) -> Vec<String> {
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// Lista os modelos disponíveis no Antigravity (`agy models`). Erro, timeout ou
/// saída vazia → Vec vazio (o frontend cai na lista estática).
#[tauri::command]
pub async fn list_agy_models() -> Vec<String> {
    match run("agy", &["models"]).await {
        Some((true, out)) => parse_model_lines(&out),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_tag_strips_rust_v_prefix() {
        assert_eq!(normalize_tag("rust-v0.144.4"), "0.144.4");
    }

    #[test]
    fn normalize_tag_strips_v_prefix() {
        assert_eq!(normalize_tag("v1.2.3"), "1.2.3");
    }

    #[test]
    fn normalize_tag_keeps_bare_version() {
        assert_eq!(normalize_tag("1.2.3"), "1.2.3");
    }

    #[test]
    fn parse_model_lines_trims_and_drops_empty() {
        let out = "  gemini-3-pro  \n\n gemini-3-flash\n   \n";
        assert_eq!(
            parse_model_lines(out),
            vec!["gemini-3-pro".to_string(), "gemini-3-flash".to_string()]
        );
    }

    #[test]
    fn parse_model_lines_empty_output() {
        assert!(parse_model_lines("").is_empty());
        assert!(parse_model_lines("   \n  \n").is_empty());
    }
}
