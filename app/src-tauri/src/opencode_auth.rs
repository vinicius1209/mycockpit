//! Credenciais de provedores do OpenCode, conduzidas pelo MyCockpit.
//!
//! O app é dono da UX, mas não duplica o segredo: quem persiste continua sendo
//! o `opencode providers login`, no cofre/formato oficial dele. Chaves entram
//! exclusivamente pelo stdin do filho (nunca argv, env, banco ou log).

use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

const LIST_TIMEOUT: Duration = Duration::from_secs(12);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeCredential {
    pub provider: String,
    pub provider_id: String,
    pub auth_kind: String,
}

pub(crate) fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for c2 in chars.by_ref() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn provider_id(name: &str) -> String {
    name.trim()
        .chars()
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

pub(crate) fn parse_credentials(text: &str) -> Vec<OpenCodeCredential> {
    text.lines()
        .filter_map(|line| {
            let clean = strip_ansi(line);
            let body = clean.trim().strip_prefix('\u{25cf}')?.trim();
            let (provider, auth_kind) = body.rsplit_once(char::is_whitespace)?;
            let provider = provider.trim();
            (!provider.is_empty() && !auth_kind.is_empty()).then(|| OpenCodeCredential {
                provider: provider.to_string(),
                provider_id: provider_id(provider),
                auth_kind: auth_kind.to_string(),
            })
        })
        .collect()
}

pub(crate) async fn list() -> Result<Vec<OpenCodeCredential>, String> {
    let output = timeout(
        LIST_TIMEOUT,
        Command::new("opencode")
            .args(["providers", "list"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "O OpenCode demorou demais para listar os provedores.".to_string())?
    .map_err(|e| format!("Não consegui iniciar o OpenCode: {e}"))?;
    if !output.status.success() {
        let message = strip_ansi(&String::from_utf8_lossy(&output.stderr));
        return Err(if message.trim().is_empty() {
            "O OpenCode não conseguiu listar os provedores.".into()
        } else {
            message.trim().to_string()
        });
    }
    Ok(parse_credentials(&String::from_utf8_lossy(&output.stdout)))
}

#[tauri::command]
pub async fn opencode_credentials() -> Result<Vec<OpenCodeCredential>, String> {
    list().await
}

fn safe_provider(provider: &str) -> Result<&str, String> {
    let p = provider.trim();
    if p.is_empty()
        || p.len() > 80
        || !p
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
    {
        return Err("Provedor inválido.".into());
    }
    Ok(p)
}

fn clean_failure(bytes: &[u8], fallback: &str) -> String {
    let text = strip_ansi(&String::from_utf8_lossy(bytes));
    let useful = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.contains("Enter your API key"))
        .collect::<Vec<_>>()
        .join(" ");
    if useful.is_empty() {
        fallback.to_string()
    } else {
        useful
    }
}

#[tauri::command]
pub async fn opencode_login_api_key(provider: String, api_key: String) -> Result<(), String> {
    let provider = safe_provider(&provider)?.to_string();
    let secret = api_key.trim();
    if secret.is_empty() {
        return Err("Informe a chave de API.".into());
    }
    if secret.len() > 16 * 1024 || secret.contains(['\n', '\r']) {
        return Err("A chave de API tem um formato inválido.".into());
    }
    let mut child = Command::new("opencode")
        .args(["providers", "login", "--provider", &provider])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Não consegui iniciar o OpenCode: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("O OpenCode abriu sem entrada de dados.")?;
    stdin
        .write_all(format!("{secret}\n").as_bytes())
        .await
        .map_err(|_| "Não consegui entregar a chave ao OpenCode.".to_string())?;
    stdin.shutdown().await.ok();
    drop(stdin);
    let output = timeout(LOGIN_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "O login do OpenCode demorou mais de cinco minutos.".to_string())?
        .map_err(|e| format!("O login do OpenCode foi interrompido: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(clean_failure(
            &output.stderr,
            "O OpenCode recusou a credencial.",
        ))
    }
}

#[tauri::command]
pub async fn opencode_login_oauth(provider: String, method: String) -> Result<(), String> {
    let provider = safe_provider(&provider)?.to_string();
    let method = method.trim();
    if method.is_empty() || method.len() > 160 || method.contains(['\n', '\r']) {
        return Err("Método de login inválido.".into());
    }
    let output = timeout(
        LOGIN_TIMEOUT,
        Command::new("opencode")
            .args([
                "providers",
                "login",
                "--provider",
                &provider,
                "--method",
                method,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "O login não foi concluído em cinco minutos.".to_string())?
    .map_err(|e| format!("Não consegui iniciar o login: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(clean_failure(&output.stderr, "O login não foi concluído."))
    }
}

#[tauri::command]
pub async fn opencode_logout(provider: String) -> Result<(), String> {
    let provider = safe_provider(&provider)?.to_string();
    let output = timeout(
        LIST_TIMEOUT,
        Command::new("opencode")
            .args(["providers", "logout", &provider])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "O OpenCode demorou demais para remover o provedor.".to_string())?
    .map_err(|e| format!("Não consegui iniciar o OpenCode: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(clean_failure(
            &output.stderr,
            "Não consegui remover o provedor.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const REAL: &str = "\u{1b}[0m\n\u{250c}  Credentials \u{1b}[90m~/.local/share/opencode/auth.json\n\u{2502}\n\u{25cf}  OpenAI \u{1b}[90moauth\n\u{2502}\n\u{25cf}  Google \u{1b}[90moauth\n\u{2502}\n\u{25cf}  OpenCode Go \u{1b}[90mapi\n\u{2502}\n\u{25cf}  Nvidia \u{1b}[90mapi\n\u{2514}  4 credentials\n";

    #[test]
    fn le_nome_composto_tipo_e_id_estavel() {
        let got = parse_credentials(REAL);
        assert_eq!(got.len(), 4);
        assert_eq!(got[2].provider, "OpenCode Go");
        assert_eq!(got[2].provider_id, "opencode-go");
        assert_eq!(got[2].auth_kind, "api");
        assert_eq!(got[3].provider_id, "nvidia");
    }

    #[test]
    fn validacao_nao_aceita_argumento_injetado() {
        assert!(safe_provider("Nvidia").is_ok());
        assert!(safe_provider("--help\nOpenAI").is_err());
    }
}
