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
/// `token`: quando presente, vai como GH_TOKEN (vence o keyring) — é como o
/// fallback multi-conta tenta outra identidade SEM trocar a conta ativa global.
async fn run_gh(args: &[&str], dur: Duration, token: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("gh");
    cmd.args(args);
    if let Some(t) = token {
        cmd.env("GH_TOKEN", t);
    }
    let out = timeout(dur, cmd.output())
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

/// Uma identidade logada no `gh`, e se ela é a ATIVA.
///
/// `active` é o campo que resolve o incidente mais comum de conta múltipla:
/// "repository not found" num repo que existe, porque a conta ativa não o
/// enxerga. Com uma conta só, saber o nome basta; com duas, saber QUAL está
/// ativa é a informação inteira.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct GhAccount {
    pub user: String,
    pub active: bool,
}

/// Parser ÚNICO do `gh auth status`. O formato real (gh 2.x):
///
/// ```text
///   ✓ Logged in to github.com account vinicius1209 (keyring)
///   - Active account: true
/// ```
///
/// A flag vem na linha SEGUINTE ao nome, então cada "Active account:" pertence
/// à última conta vista. Separado do subprocess p/ ser testável com o output
/// real, e é o único parser deste formato de propósito — dois leitores da mesma
/// saída foi como o seletor de modelos do agy apodreceu (ver detect.rs).
fn parse_gh_status(status: &str) -> Vec<GhAccount> {
    let mut out: Vec<GhAccount> = Vec::new();
    for l in status.lines() {
        if let Some((_, rest)) = l.split_once(" account ") {
            if let Some(name) = rest.split_whitespace().next() {
                if !name.is_empty() {
                    out.push(GhAccount {
                        user: name.to_string(),
                        active: false,
                    });
                }
            }
        } else if let Some((_, rest)) = l.split_once("Active account:") {
            if rest.trim() == "true" {
                if let Some(last) = out.last_mut() {
                    last.active = true;
                }
            }
        }
    }
    out
}

/// Só os nomes, na ordem do output — é o que `run_gh_any_account` consome.
fn parse_gh_accounts(status: &str) -> Vec<String> {
    parse_gh_status(status).into_iter().map(|a| a.user).collect()
}

/// Output do `gh auth status` como TEXTO, tolerando exit code != 0.
///
/// `gh auth status` sai com código != 0 quando NENHUMA conta está logada — e
/// esse é justamente um dos estados que a tela precisa exibir. Exigir sucesso
/// aqui transformaria "não logado" em "não sei".
async fn gh_auth_status_raw() -> Option<String> {
    let out = timeout(
        Duration::from_secs(4),
        Command::new("gh").args(["auth", "status"]).output(),
    )
    .await
    .ok()?
    .ok()?;
    Some(format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ))
}

/// Extrai "2.62.0" de "gh version 2.62.0 (2024-...)". None se não reconhecer —
/// nunca devolve a linha crua como se fosse versão.
fn parse_gh_version(out: &str) -> Option<String> {
    let (_, rest) = out.split_once("gh version ")?;
    let v = rest.split_whitespace().next()?;
    (!v.is_empty()).then(|| v.to_string())
}

/// O que a MÁQUINA diz sobre o `gh`, para a tela de Conexões.
///
/// Três estados distintos porque cada um tem um remédio diferente: sem CLI
/// (instalar), com CLI e sem conta (logar), com conta (dizer quais e qual é a
/// ativa). Colapsar isso num booleano "conectado" é o que faz a tela do
/// concorrente não conseguir explicar o "repository not found".
#[derive(serde::Serialize)]
pub struct GhStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub accounts: Vec<GhAccount>,
}

/// Leitura pura, sem efeito colateral. O único comando com efeito neste módulo
/// é o `gh_switch_account`, e ele é gesto EXPLÍCITO do usuário — nunca algo que
/// aconteça por abrir uma tela.
#[tauri::command]
pub async fn gh_status() -> GhStatus {
    let version = match timeout(
        Duration::from_secs(4),
        Command::new("gh").arg("--version").output(),
    )
    .await
    {
        Ok(Ok(o)) if o.status.success() => {
            parse_gh_version(&String::from_utf8_lossy(&o.stdout))
        }
        // ENOENT (não instalado) e timeout caem aqui igual; a distinção vem do
        // `installed` abaixo, que só é true quando houve versão reconhecida.
        _ => None,
    };
    if version.is_none() {
        return GhStatus {
            installed: false,
            version: None,
            accounts: Vec::new(),
        };
    }
    let accounts = gh_auth_status_raw()
        .await
        .map(|s| parse_gh_status(&s))
        .unwrap_or_default();
    GhStatus {
        installed: true,
        version,
        accounts,
    }
}

/// Aceita SOMENTE o formato de login do GitHub: alfanumérico e hífen, até 39
/// caracteres, sem hífen nas pontas. Defesa em profundidade — o nome vai como
/// arg posicional (nunca shell), então isto não é a única barreira; é a mesma
/// disciplina do `validate_pr_url`.
fn login_valido(u: &str) -> bool {
    !u.is_empty()
        && u.len() <= 39
        && !u.starts_with('-')
        && !u.ends_with('-')
        && u.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Troca a conta ATIVA do `gh`.
///
/// Este é o único comando deste módulo com efeito colateral fora do app, e ele
/// existe porque o usuário pediu: *"poder alterar isso durante o uso do projeto,
/// em vez de usar linha de comando"*.
///
/// O argumento que me fez recusar isto antes ("mexer no ambiente global é fora
/// do nosso quintal") não se sustentava: em *Agentes na máquina* o app já roda
/// `npm i -g` e `brew upgrade` no clique do usuário, que é bem mais invasivo
/// que trocar de conta. O cuidado real não é recusar — é DIZER a consequência,
/// e ela está na tela ao lado do botão.
///
/// Duas travas: o login precisa ter forma válida E precisa ser uma conta que
/// JÁ ESTÁ logada. Trocar para um nome que o `gh` não conhece deixaria você sem
/// conta ativa nenhuma, no seu terminal, por causa de um clique aqui.
#[tauri::command]
pub async fn gh_switch_account(user: String) -> Result<(), String> {
    if !login_valido(&user) {
        return Err("nome de conta inválido".to_string());
    }
    let status = gh_auth_status_raw()
        .await
        .ok_or_else(|| "não consegui ler as contas do gh".to_string())?;
    if !parse_gh_accounts(&status).iter().any(|u| u == &user) {
        return Err(format!("a conta {user} não está logada no gh"));
    }
    run_gh(
        &["auth", "switch", "--user", &user],
        Duration::from_secs(10),
        None,
    )
    .await
    .map(|_| ())
}

/// Roda `gh` tentando TODAS as identidades logadas: 1º a conta ativa (keyring);
/// se falhar, cada outra conta via `gh auth token --user X` + GH_TOKEN. Caso
/// real: usuário com conta pessoal + de trabalho — a PR pode ser visível só pra
/// conta que NÃO está ativa. Nunca troca a conta ativa global (sem `auth switch`).
async fn run_gh_any_account(args: &[&str], dur: Duration) -> Result<String, String> {
    let first_err = match run_gh(args, dur, None).await {
        Ok(out) => return Ok(out),
        Err(e) => e,
    };
    // `gh auth status` sai com código != 0 em cenários parciais → lê o output
    // mesmo em "falha" rodando via output() direto (run_gh exigiria sucesso).
    let Some(status) = gh_auth_status_raw().await else {
        return Err(first_err);
    };
    for user in parse_gh_accounts(&status) {
        let Ok(token) =
            run_gh(&["auth", "token", "--user", &user], Duration::from_secs(4), None).await
        else {
            continue;
        };
        if let Ok(out) = run_gh(args, dur, Some(&token)).await {
            return Ok(out);
        }
    }
    Err(first_err)
}

/// Estado rico do PR pro card do Painel. Devolve o JSON CRU do `gh pr view`
/// (state, checks, diffstat, mergeable, review, título…) — quem interpreta é o
/// frontend. Qualquer erro → Err com mensagem curta e o front degrada pro card
/// simples.
#[tauri::command]
pub async fn gh_pr_view(url: String) -> Result<serde_json::Value, String> {
    validate_pr_url(&url)?;
    let out = run_gh_any_account(
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
    run_gh_any_account(
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

    #[test]
    fn parse_accounts_do_auth_status() {
        let s = "github.com\n  ✓ Logged in to github.com account alice (keyring)\n  - Active account: true\n  ✓ Logged in to github.com account bob-work (keyring)\n";
        assert_eq!(parse_gh_accounts(s), vec!["alice", "bob-work"]);
        assert!(parse_gh_accounts("nada logado").is_empty());
    }

    /// Output REAL do `gh` 2.x nesta máquina (duas contas, a 1ª ativa). Fixture
    /// copiada da saída de verdade, não inventada: parser de formato de outro
    /// programa que só vê exemplo sintético passa no teste e falha na máquina.
    const AUTH_STATUS_REAL: &str = "github.com\n  \u{2713} Logged in to github.com account vinicius1209 (keyring)\n  - Active account: true\n  - Git operations protocol: ssh\n  - Token: gho_************************************\n  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo', 'workflow'\n\n  \u{2713} Logged in to github.com account viniimachadoprime (keyring)\n  - Active account: false\n  - Git operations protocol: ssh\n  - Token: gho_************************************\n  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'\n";

    #[test]
    fn parse_status_marca_a_conta_ativa() {
        let contas = parse_gh_status(AUTH_STATUS_REAL);
        assert_eq!(contas.len(), 2);
        assert_eq!(contas[0].user, "vinicius1209");
        assert!(contas[0].active);
        assert_eq!(contas[1].user, "viniimachadoprime");
        // A que NÃO está ativa é o ponto: é a que causa "repository not found"
        // num repo que existe. Marcá-la como ativa seria pior que não marcar.
        assert!(!contas[1].active);
    }

    #[test]
    fn active_account_nunca_vaza_pra_conta_anterior() {
        // "Active account: false" da 2ª conta não pode desmarcar a 1ª, e um
        // "true" órfão (sem conta antes) não pode explodir nem inventar conta.
        let s = "  - Active account: true\n  \u{2713} Logged in to github.com account solo (keyring)\n  - Active account: false\n";
        let contas = parse_gh_status(s);
        assert_eq!(contas.len(), 1);
        assert_eq!(contas[0].user, "solo");
        assert!(!contas[0].active);
    }

    #[test]
    fn sem_conta_logada_nao_e_o_mesmo_que_sem_gh() {
        // `gh auth status` deslogado sai com código != 0 e texto de erro: a
        // lista fica vazia, e quem distingue "sem CLI" é o `installed`.
        assert!(parse_gh_status("You are not logged into any GitHub hosts.").is_empty());
    }

    #[test]
    fn login_valido_recusa_o_que_nao_e_login() {
        assert!(login_valido("vinicius1209"));
        assert!(login_valido("vini-machado"));
        // Vazio, hífen na ponta e comprimento acima do limite do GitHub.
        assert!(!login_valido(""));
        assert!(!login_valido("-vini"));
        assert!(!login_valido("vini-"));
        assert!(!login_valido(&"a".repeat(40)));
        // Tentativas de injeção: o nome vai como arg posicional, então isto é
        // defesa em profundidade — mas defesa em profundidade que passa não é
        // defesa nenhuma.
        assert!(!login_valido("vini; rm -rf /"));
        assert!(!login_valido("vini --user outro"));
        assert!(!login_valido("../../etc/passwd"));
        assert!(!login_valido("vini$(whoami)"));
    }

    #[test]
    fn parse_version_reconhece_ou_desiste() {
        assert_eq!(
            parse_gh_version("gh version 2.62.0 (2024-11-14)\nhttps://github.com/cli/cli"),
            Some("2.62.0".to_string())
        );
        // Formato irreconhecível NUNCA vira "versão" com a linha crua dentro.
        assert_eq!(parse_gh_version("alguma outra coisa"), None);
        assert_eq!(parse_gh_version(""), None);
    }
}
