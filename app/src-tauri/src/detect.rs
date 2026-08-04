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
///
/// latest é POR CANAL do binário gerenciado (incidente do sucesso falso: a
/// "última" vinha do npm, o binário era do brew cujo tap topava numa versão
/// menor — botão "Atualizar" eterno prometendo o impossível). O canal vem do
/// MESMO classify do update.rs; a fonte é a daquele canal (npm registry ×
/// formulae.brew.sh). alt_latest/alt_channel: a última do OUTRO canal, pra UI
/// dizer na cara quando outro canal tem versão maior (trocar de canal é gesto
/// do usuário, não botão). None = fonte indisponível/offline/não aplicável.
/// Comparação de versão é do FRONTEND.
#[derive(Serialize, Clone)]
pub struct DetectedTool {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub auth: String,
    pub detail: Option<String>,
    pub latest: Option<String>,
    /// canal da fonte do `latest` ("npm" | "homebrew").
    #[serde(rename = "latestChannel")]
    pub latest_channel: Option<String>,
    #[serde(rename = "altLatest")]
    pub alt_latest: Option<String>,
    #[serde(rename = "altChannel")]
    pub alt_channel: Option<String>,
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
        latest_channel: None,
        alt_latest: None,
        alt_channel: None,
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
/// pub(crate): o update.rs usa no probe antes×depois do desfecho verificado.
pub(crate) fn extract_version(s: &str) -> Option<String> {
    s.lines().next().and_then(|line| {
        line.split_whitespace()
            .map(|t| t.trim_start_matches('v'))
            .find(|t| {
                t.contains('.') && t.chars().next().is_some_and(|c| c.is_ascii_digit())
            })
            .map(str::to_string)
    })
}

/// Busca um JSON via `curl` subprocess (o app já orquestra CLIs; zero
/// dependência de HTTP client). Best-effort: qualquer falha (sem curl,
/// offline, timeout, JSON inesperado) devolve None em silêncio.
async fn fetch_json(url: &str) -> Option<serde_json::Value> {
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
    serde_json::from_slice(&out.stdout).ok()
}

// ---- última versão POR CANAL (parse puro + decisão pura, testáveis) --------

/// npm registry `/latest` → `.version`.
fn parse_npm_version(v: &serde_json::Value) -> Option<String> {
    v.get("version")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// formulae.brew.sh `/api/cask/<nome>.json` → `.version`. Casks às vezes
/// carregam build depois da vírgula ("1.2.3,4567") — fica só a versão.
fn parse_cask_version(v: &serde_json::Value) -> Option<String> {
    v.get("version")
        .and_then(|x| x.as_str())
        .and_then(|s| s.split(',').next())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// formulae.brew.sh `/api/formula/<nome>.json` → `.versions.stable`.
fn parse_formula_stable(v: &serde_json::Value) -> Option<String> {
    v.get("versions")
        .and_then(|x| x.get("stable"))
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// Fontes de "última" por agent: (pacote npm, nome no brew). None = sem canal
/// conhecido (agy). Espelha o plan() do update.rs.
fn channel_sources(agent: &str) -> Option<(&'static str, &'static str)> {
    match agent {
        "claude-code" => Some(("@anthropic-ai/claude-code", "claude-code")),
        "codex" => Some(("@openai/codex", "codex")),
        _ => None,
    }
}

/// Decisão PURA de canais pelo método do binário gerenciado: (canal do
/// `latest`, canal alternativo a informar). Homebrew/Npm têm alternativo (é a
/// linha "o canal X tem vY" da UI); nativo/desconhecido usa npm como
/// best-effort e não promete teto de canal nenhum.
fn channels_for(method: &crate::update::Method) -> (&'static str, Option<&'static str>) {
    use crate::update::Method;
    match method {
        Method::Homebrew => ("homebrew", Some("npm")),
        Method::Npm => ("npm", Some("homebrew")),
        Method::Native | Method::Unknown => ("npm", None),
    }
}

/// Última do npm pro pacote.
async fn latest_npm(package: &str) -> Option<String> {
    parse_npm_version(&fetch_json(&format!("https://registry.npmjs.org/{package}/latest")).await?)
}

/// Última do brew: tenta CASK primeiro (claude-code e codex são casks hoje) e
/// cai pra formula — resolve dinamicamente sem hardcodar o tipo.
async fn latest_brew(name: &str) -> Option<String> {
    if let Some(v) = fetch_json(&format!("https://formulae.brew.sh/api/cask/{name}.json"))
        .await
        .and_then(|j| parse_cask_version(&j))
    {
        return Some(v);
    }
    parse_formula_stable(&fetch_json(&format!("https://formulae.brew.sh/api/formula/{name}.json")).await?)
}

/// `latest` honesto pro agent: canal do BINÁRIO GERENCIADO (classify do
/// update.rs sobre o path real) manda; o outro canal vira alt_latest — só
/// informação, nunca botão. Preenche direto no DetectedTool.
async fn fill_latest(t: &mut DetectedTool, bin: &str) {
    let Some((npm_pkg, brew_name)) = channel_sources(&t.id) else {
        return;
    };
    let method = crate::update::resolve_bin(bin)
        .await
        .as_deref()
        .map(crate::update::classify)
        .unwrap_or(crate::update::Method::Unknown);
    let (primary, alt) = channels_for(&method);
    let fetch = |channel: &'static str| async move {
        match channel {
            "homebrew" => latest_brew(brew_name).await,
            _ => latest_npm(npm_pkg).await,
        }
    };
    match alt {
        Some(alt_channel) => {
            let (latest, alt_latest) = tokio::join!(fetch(primary), fetch(alt_channel));
            t.latest = latest;
            t.latest_channel = Some(primary.to_string());
            t.alt_latest = alt_latest;
            t.alt_channel = Some(alt_channel.to_string());
        }
        None => {
            t.latest = fetch(primary).await;
            t.latest_channel = Some(primary.to_string());
        }
    }
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
/// re-detecção nas Configurações. Nunca falha (cada probe degrada p/
/// missing/unknown). Os probes rodam num join; os lookups de `latest`
/// (resolve do canal + rede best-effort) rodam num segundo join em cima dos
/// resultados. agy/git/swiftc: sem fonte pública conhecida → latest = None.
#[tauri::command]
pub async fn detect_agents() -> Vec<DetectedTool> {
    let (mut claude, mut codex, agy, git, swiftc) = tokio::join!(
        probe_claude(),
        probe_codex(),
        probe_agy(),
        probe_simple("git", "git"),
        probe_simple("swiftc", "swiftc"),
    );
    tokio::join!(fill_latest(&mut claude, "claude"), fill_latest(&mut codex, "codex"));
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

    // ---- última por canal: parses com fixtures REAIS das APIs ----------------

    #[test]
    fn parse_npm_registry_latest() {
        // registry.npmjs.org/@anthropic-ai/claude-code/latest (recortado).
        let fixture = serde_json::json!({
            "name": "@anthropic-ai/claude-code",
            "version": "2.1.220",
            "description": "Use Claude, Anthropic's AI assistant, right from your terminal.",
            "bin": { "claude": "cli.js" }
        });
        assert_eq!(parse_npm_version(&fixture), Some("2.1.220".to_string()));
        assert_eq!(parse_npm_version(&serde_json::json!({})), None);
        assert_eq!(parse_npm_version(&serde_json::json!({ "version": "" })), None);
    }

    #[test]
    fn parse_cask_do_brew() {
        // formulae.brew.sh/api/cask/claude-code.json (recortado): o tap do
        // cask topava em 2.1.212 enquanto o npm já tinha 2.1.220 — a raiz do
        // botão "Atualizar" eterno.
        let fixture = serde_json::json!({
            "token": "claude-code",
            "full_token": "claude-code",
            "tap": "homebrew/cask",
            "name": ["Claude Code"],
            "version": "2.1.212",
            "url": "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.212/darwin-arm64/claude-2.1.212.tar.gz"
        });
        assert_eq!(parse_cask_version(&fixture), Some("2.1.212".to_string()));
        // cask com build depois da vírgula → fica só a versão.
        let with_build = serde_json::json!({ "version": "1.2.3,45678" });
        assert_eq!(parse_cask_version(&with_build), Some("1.2.3".to_string()));
        assert_eq!(parse_cask_version(&serde_json::json!({})), None);
    }

    #[test]
    fn parse_formula_do_brew() {
        // formulae.brew.sh/api/formula/<nome>.json (recortado).
        let fixture = serde_json::json!({
            "name": "codex",
            "full_name": "codex",
            "versions": { "stable": "0.146.0", "head": "HEAD", "bottle": true }
        });
        assert_eq!(parse_formula_stable(&fixture), Some("0.146.0".to_string()));
        assert_eq!(parse_formula_stable(&serde_json::json!({})), None);
        assert_eq!(
            parse_formula_stable(&serde_json::json!({ "versions": {} })),
            None
        );
    }

    #[test]
    fn decisao_de_canal_pelo_metodo_do_binario() {
        use crate::update::Method;
        // binário do brew → latest do brew, npm vira o canal informativo.
        assert_eq!(channels_for(&Method::Homebrew), ("homebrew", Some("npm")));
        // binário do npm → latest do npm, brew vira o informativo.
        assert_eq!(channels_for(&Method::Npm), ("npm", Some("homebrew")));
        // nativo/desconhecido: npm best-effort, sem promessa de outro canal.
        assert_eq!(channels_for(&Method::Native), ("npm", None));
        assert_eq!(channels_for(&Method::Unknown), ("npm", None));
    }

    #[test]
    fn fontes_por_agent() {
        assert_eq!(
            channel_sources("claude-code"),
            Some(("@anthropic-ai/claude-code", "claude-code"))
        );
        assert_eq!(channel_sources("codex"), Some(("@openai/codex", "codex")));
        // agy: sem canal conhecido → sem latest (honesto).
        assert_eq!(channel_sources("agy"), None);
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
