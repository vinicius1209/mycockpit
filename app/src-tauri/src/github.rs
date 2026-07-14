//! Ponte segura pro `gh` CLI: enriquece cards de PR no Painel (checks, diff,
//! mergeable) e executa merge. TODA entrada passa por `validate_pr_url` antes
//! de tocar em subprocess — o argumento vai como arg posicional (nunca shell),
//! então a validação é defesa em profundidade, não a única barreira.
//! Padrão de subprocess com timeout: mesmo do detect.rs (run/fetch_latest).

use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// `gh pr view` é leitura pura: timeout curto, o front degrada pro card simples.
const VIEW_TIMEOUT: Duration = Duration::from_secs(8);
/// Merge fala com a API do GitHub e pode demorar (checks, rede): mais folga.
const MERGE_TIMEOUT: Duration = Duration::from_secs(20);

/// Aceita SOMENTE `https://github.com/<owner>/<repo>/pull/<n>` — owner/repo em
/// [A-Za-z0-9._-]+ e n numérico. Qualquer outra coisa (outro host, path extra,
/// query string, tentativa de injeção) é recusada com mensagem curta.
pub fn validate_pr_url(url: &str) -> Result<(), String> {
    let err = || "URL de PR inválida (esperado https://github.com/owner/repo/pull/123)".to_string();
    let rest = url.strip_prefix("https://github.com/").ok_or_else(err)?;
    let parts: Vec<&str> = rest.split('/').collect();
    let [owner, repo, pull, number] = parts.as_slice() else {
        return Err(err());
    };
    let seg_ok = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    };
    if !seg_ok(owner) || !seg_ok(repo) || *pull != "pull" {
        return Err(err());
    }
    if number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
        return Err(err());
    }
    Ok(())
}

/// Roda `gh` com args + timeout; devolve stdout em sucesso, Err curto em
/// falha/timeout/gh ausente. O arg de URL já foi validado pelo chamador.
async fn run_gh(args: &[&str], dur: Duration) -> Result<String, String> {
    let out = timeout(dur, Command::new("gh").args(args).output())
        .await
        .map_err(|_| "gh demorou demais (timeout)".to_string())?
        .map_err(|_| "gh não encontrado na máquina".to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "gh falhou sem detalhes".to_string()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Estado rico do PR pro card do Painel. Devolve o JSON CRU do `gh pr view`
/// (state, checks, diffstat, mergeable, review, título…) — quem interpreta é o
/// frontend. Qualquer erro → Err com mensagem curta e o front degrada pro card
/// simples.
#[tauri::command]
pub async fn gh_pr_view(url: String) -> Result<serde_json::Value, String> {
    validate_pr_url(&url)?;
    let out = run_gh(
        &[
            "pr",
            "view",
            &url,
            "--json",
            "state,statusCheckRollup,additions,deletions,mergeable,reviewDecision,title,updatedAt,isDraft",
        ],
        VIEW_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out).map_err(|_| "resposta do gh não é JSON válido".to_string())
}

/// Merge por squash, preservando a branch. SEM --admin e SEM force de
/// propósito: se o GitHub recusar (checks vermelhos, review pendente, proteção
/// de branch), a recusa volta como Err e o usuário decide o que fazer.
#[tauri::command]
pub async fn gh_pr_merge(url: String) -> Result<String, String> {
    validate_pr_url(&url)?;
    run_gh(
        &["pr", "merge", &url, "--squash", "--delete-branch=false"],
        MERGE_TIMEOUT,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aceita_url_canonica() {
        assert!(validate_pr_url("https://github.com/rust-lang/rust/pull/12345").is_ok());
        assert!(validate_pr_url("https://github.com/user.name/my_repo-2/pull/1").is_ok());
    }

    #[test]
    fn recusa_outro_host() {
        assert!(validate_pr_url("https://gitlab.com/owner/repo/pull/1").is_err());
        assert!(validate_pr_url("http://github.com/owner/repo/pull/1").is_err());
        assert!(validate_pr_url("https://github.com.evil.com/owner/repo/pull/1").is_err());
    }

    #[test]
    fn recusa_path_sem_pull() {
        assert!(validate_pr_url("https://github.com/owner/repo/issues/1").is_err());
        assert!(validate_pr_url("https://github.com/owner/repo").is_err());
        assert!(validate_pr_url("https://github.com/owner/repo/pull/1/files").is_err());
    }

    #[test]
    fn recusa_injecao_shell() {
        assert!(validate_pr_url("https://github.com/owner/repo/pull/1; rm -rf /").is_err());
        assert!(validate_pr_url("https://github.com/owner/repo/pull/$(id)").is_err());
        assert!(validate_pr_url("https://github.com/owner;rm/repo/pull/1").is_err());
    }

    #[test]
    fn recusa_owner_com_espaco() {
        assert!(validate_pr_url("https://github.com/ow ner/repo/pull/1").is_err());
        assert!(validate_pr_url("https://github.com//repo/pull/1").is_err());
    }

    #[test]
    fn recusa_numero_nao_numerico() {
        assert!(validate_pr_url("https://github.com/owner/repo/pull/abc").is_err());
        assert!(validate_pr_url("https://github.com/owner/repo/pull/12a").is_err());
        assert!(validate_pr_url("https://github.com/owner/repo/pull/").is_err());
    }
}
