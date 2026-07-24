//! Atualização in-app dos CLIs de agent ("Atualizar agora" no painel de Agents).
//! Detecta o MÉTODO de instalação pelo PATH REAL do binário (canonizado, segue
//! symlinks do npm/brew) e roda o comando certo. Fallbacks em camadas: método
//! desconhecido → self-update do próprio CLI; programa não achado no PATH →
//! devolve o comando pra UI mostrar "rode à mão". Roda no PATH hidratado do app
//! (path::hydrate_path no startup), o mesmo que a detecção usa pra achar os CLIs.

use serde::Serialize;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Update baixa/compila — teto generoso. Estourou = a UI mostra o comando.
const UPDATE_TIMEOUT: Duration = Duration::from_secs(240);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Serialize)]
pub struct UpdateOutcome {
    pub agent: String,
    /// "npm" | "homebrew" | "self-update" | "none"
    pub method: String,
    /// comando efetivo (pra logar/mostrar e pro fallback "copiar").
    pub command: String,
    /// tentou rodar? (false = sem canal conhecido OU programa fora do PATH)
    pub ran: bool,
    /// saiu com sucesso? (só faz sentido com ran=true)
    pub ok: bool,
    /// tail da saída (stdout+stderr) — o que interessa pro painel/toast.
    pub output: String,
}

/// Método de instalação inferido do path real do binário.
#[derive(PartialEq, Eq, Debug)]
enum Method {
    Npm,
    Homebrew,
    /// instalador nativo (o próprio CLI se atualiza: `claude update`).
    Native,
    Unknown,
}

/// Classifica o método pelo path REAL (já canonizado). Ordem importa: homebrew
/// antes de npm (um binário sob Cellar pode ter "node" no nome do formula).
fn classify(path: &str) -> Method {
    let p = path.to_lowercase();
    if p.contains("/homebrew/") || p.contains("/cellar/") || p.contains("/opt/homebrew") {
        Method::Homebrew
    } else if p.contains("node_modules")
        || p.contains("/.nvm/")
        || p.contains("/fnm/")
        || p.contains("/.volta/")
        || p.contains("/node/")
    {
        Method::Npm
    } else if p.contains("/.local/") || p.contains("/.claude/") {
        Method::Native
    } else {
        Method::Unknown
    }
}

/// Plano de atualização por agent × método: (rótulo, programa, args). None = sem
/// canal de update conhecido (ex.: agy, binário fechado do Google).
fn plan(agent: &str, m: &Method) -> Option<(&'static str, &'static str, Vec<&'static str>)> {
    match agent {
        "claude-code" => Some(match m {
            Method::Homebrew => ("homebrew", "brew", vec!["upgrade", "claude"]),
            Method::Npm => ("npm", "npm", vec!["i", "-g", "@anthropic-ai/claude-code@latest"]),
            // nativo/desconhecido: o CLI tem auto-update embutido.
            _ => ("self-update", "claude", vec!["update"]),
        }),
        "codex" => Some(match m {
            Method::Npm => ("npm", "npm", vec!["i", "-g", "@openai/codex@latest"]),
            // codex-cli é distribuído por brew — default e fallback.
            _ => ("homebrew", "brew", vec!["upgrade", "codex"]),
        }),
        _ => None,
    }
}

/// Resolve o path REAL do binário (segue symlinks) usando o PATH do app. `sh -c`
/// (não `-lc`) de propósito: herda o PATH JÁ HIDRATADO do processo, sem re-sourcing
/// de profile (que sob nvm/zsh nem sempre carrega o node certo).
async fn resolve_bin(bin: &str) -> Option<String> {
    let out = timeout(
        RESOLVE_TIMEOUT,
        Command::new("sh")
            .args(["-c", &format!("command -v {bin}")])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() {
        return None;
    }
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if p.is_empty() {
        return None;
    }
    Some(
        std::fs::canonicalize(&p)
            .map(|c| c.to_string_lossy().to_string())
            .unwrap_or(p),
    )
}

fn tail_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

#[tauri::command]
pub async fn update_agent(agent: String) -> Result<UpdateOutcome, String> {
    let bin = match agent.as_str() {
        "claude-code" => "claude",
        "codex" => "codex",
        "agy" => "agy",
        other => return Err(format!("agent desconhecido: {other}")),
    };

    let method = match resolve_bin(bin).await {
        Some(path) => classify(&path),
        None => Method::Unknown,
    };

    let Some((label, program, args)) = plan(&agent, &method) else {
        return Ok(UpdateOutcome {
            agent,
            method: "none".into(),
            command: String::new(),
            ran: false,
            ok: false,
            output: "Este agent não tem canal de atualização conhecido.".into(),
        });
    };

    let command = format!("{program} {}", args.join(" "));

    match timeout(UPDATE_TIMEOUT, Command::new(program).args(&args).output()).await {
        Ok(Ok(out)) => {
            let mut combined = String::from_utf8_lossy(&out.stdout).to_string();
            let err = String::from_utf8_lossy(&out.stderr);
            if !err.trim().is_empty() {
                if !combined.is_empty() {
                    combined.push('\n');
                }
                combined.push_str(&err);
            }
            Ok(UpdateOutcome {
                agent,
                method: label.into(),
                command,
                ran: true,
                ok: out.status.success(),
                output: tail_lines(&combined, 40),
            })
        }
        // ENOENT: npm/brew fora do PATH do app → devolve o comando pra rodar à mão.
        Ok(Err(e)) => Ok(UpdateOutcome {
            agent,
            method: label.into(),
            command: command.clone(),
            ran: false,
            ok: false,
            output: format!("Não consegui rodar automaticamente ({e}). Rode à mão:\n{command}"),
        }),
        Err(_) => Ok(UpdateOutcome {
            agent,
            method: label.into(),
            command: command.clone(),
            ran: false,
            ok: false,
            output: format!(
                "A atualização passou de {}s e foi interrompida. Rode à mão:\n{command}",
                UPDATE_TIMEOUT.as_secs()
            ),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifica_por_path_real() {
        assert_eq!(
            classify("/Users/x/.nvm/versions/node/v24/bin/claude"),
            Method::Npm
        );
        assert_eq!(
            classify("/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"),
            Method::Npm
        );
        assert_eq!(classify("/opt/homebrew/bin/codex"), Method::Homebrew);
        assert_eq!(
            classify("/opt/homebrew/Cellar/codex/0.144.6/bin/codex"),
            Method::Homebrew
        );
        assert_eq!(classify("/Users/x/.local/bin/claude"), Method::Native);
        assert_eq!(classify("/usr/bin/claude"), Method::Unknown);
    }

    #[test]
    fn plano_por_agent_e_metodo() {
        // claude npm → npm i -g @latest
        let (m, prog, args) = plan("claude-code", &Method::Npm).unwrap();
        assert_eq!((m, prog), ("npm", "npm"));
        assert!(args.contains(&"@anthropic-ai/claude-code@latest"));
        // claude nativo/desconhecido → self-update
        assert_eq!(plan("claude-code", &Method::Native).unwrap().0, "self-update");
        assert_eq!(plan("claude-code", &Method::Unknown).unwrap().0, "self-update");
        // claude homebrew
        assert_eq!(plan("claude-code", &Method::Homebrew).unwrap().0, "homebrew");
        // codex homebrew default
        assert_eq!(plan("codex", &Method::Unknown).unwrap().1, "brew");
        assert_eq!(plan("codex", &Method::Npm).unwrap().1, "npm");
        // agy sem canal
        assert!(plan("agy", &Method::Npm).is_none());
    }
}
