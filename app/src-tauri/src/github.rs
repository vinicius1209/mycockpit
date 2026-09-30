//! Ponte segura pro `gh` CLI: o estado das contas logadas (tela de Conexões) e
//! a troca da conta ativa. Argumento vai como arg posicional (nunca shell), e
//! entrada do usuário é validada antes de tocar em subprocess, como defesa em
//! profundidade.
//! Padrão de subprocess com timeout: mesmo do detect.rs (run/fetch_latest).
//!
//! `gh_pr_view` e `gh_pr_merge` saíram com a aba Features
//! (docs/remocao-features-prd.md D1): o card de PR do Painel só nascia de
//! manifest SDD, e sem ele os dois comandos não tinham chamador.

use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Roda `gh` com args + timeout; devolve stdout em sucesso, Err curto em
/// falha/timeout/gh ausente. Argumento vindo do usuário já foi validado.
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

/// Só os nomes, na ordem do output (a trava do `gh_switch_account`).
fn parse_gh_accounts(status: &str) -> Vec<String> {
    parse_gh_status(status)
        .into_iter()
        .map(|a| a.user)
        .collect()
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
        Ok(Ok(o)) if o.status.success() => parse_gh_version(&String::from_utf8_lossy(&o.stdout)),
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
/// arg posicional (nunca shell), então isto não é a única barreira.
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

/// Detalhes de um Pull Request consultado via `gh pr view`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusInfo {
    pub number: u64,
    pub title: String,
    /// "OPEN" | "MERGED" | "CLOSED"
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub review_decision: Option<String>,
    pub checks_passing: u32,
    pub checks_failing: u32,
    pub checks_pending: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckRunRaw {
    #[serde(default)]
    status: String,
    #[serde(default)]
    conclusion: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrViewRaw {
    number: u64,
    title: String,
    state: String,
    #[serde(default)]
    is_draft: bool,
    url: String,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    review_decision: String,
    #[serde(default)]
    status_check_rollup: Vec<CheckRunRaw>,
}

pub(crate) fn parse_pr_view(json_str: &str) -> Option<PrStatusInfo> {
    let raw: PrViewRaw = serde_json::from_str(json_str).ok()?;
    let mut checks_passing = 0;
    let mut checks_failing = 0;
    let mut checks_pending = 0;

    for check in raw.status_check_rollup {
        let conc = check.conclusion.to_uppercase();
        let stat = check.status.to_uppercase();
        if conc == "SUCCESS" {
            checks_passing += 1;
        } else if conc == "FAILURE" || conc == "TIMED_OUT" || conc == "ACTION_REQUIRED" {
            checks_failing += 1;
        } else if stat != "COMPLETED" || conc.is_empty() {
            checks_pending += 1;
        }
    }

    let review_decision = if raw.review_decision.trim().is_empty() {
        None
    } else {
        Some(raw.review_decision.trim().to_string())
    };

    Some(PrStatusInfo {
        number: raw.number,
        title: raw.title,
        state: raw.state.to_uppercase(),
        is_draft: raw.is_draft,
        url: raw.url,
        base_ref_name: raw.base_ref_name,
        head_ref_name: raw.head_ref_name,
        review_decision,
        checks_passing,
        checks_failing,
        checks_pending,
    })
}

/// Consulta o PR associado à branch especificada no `cwd`.
/// Fail-open: se não houver PR, se a máquina estiver offline ou gh não estiver
/// instalado, devolve `Ok(None)` para que a aba de alterações não quebre.
#[tauri::command]
pub async fn gh_pr_status(cwd: String, branch: String) -> Result<Option<PrStatusInfo>, String> {
    let branch = branch.trim();
    if branch.is_empty() || branch == "HEAD" {
        return Ok(None);
    }
    let cwd_path = match crate::git::validated_git_cwd(&cwd) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };

    let mut cmd = Command::new("gh");
    cmd.current_dir(cwd_path);
    cmd.args([
        "pr",
        "view",
        branch,
        "--json",
        "number,title,state,isDraft,url,reviewDecision,statusCheckRollup,mergedAt,baseRefName,headRefName",
    ]);

    let out = match timeout(Duration::from_secs(5), cmd.output()).await {
        Ok(Ok(o)) => o,
        _ => return Ok(None),
    };

    if !out.status.success() {
        return Ok(None);
    }

    let stdout_str = String::from_utf8_lossy(&out.stdout);
    Ok(parse_pr_view(&stdout_str))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    const PR_VIEW_REAL: &str = r#"{
      "baseRefName": "main",
      "headRefName": "composer-inventario-e-fio-integro",
      "isDraft": false,
      "mergedAt": "2026-09-15T18:38:40Z",
      "number": 1,
      "reviewDecision": "",
      "state": "MERGED",
      "statusCheckRollup": [
        {
          "conclusion": "SUCCESS",
          "status": "COMPLETED"
        },
        {
          "conclusion": "SUCCESS",
          "status": "COMPLETED"
        },
        {
          "conclusion": "SUCCESS",
          "status": "COMPLETED"
        }
      ],
      "title": "Composer por motor, fio íntegro, notas com anexos e helper no prazo",
      "url": "https://github.com/vinicius1209/frota/pull/1"
    }"#;

    #[test]
    fn parse_pr_view_com_fixture_real_de_pr_mergeado() {
        let pr = parse_pr_view(PR_VIEW_REAL).expect("deveria parsear JSON real de PR");
        assert_eq!(pr.number, 1);
        assert_eq!(pr.state, "MERGED");
        assert_eq!(pr.title, "Composer por motor, fio íntegro, notas com anexos e helper no prazo");
        assert_eq!(pr.base_ref_name, "main");
        assert_eq!(pr.head_ref_name, "composer-inventario-e-fio-integro");
        assert_eq!(pr.checks_passing, 3);
        assert_eq!(pr.checks_failing, 0);
        assert_eq!(pr.checks_pending, 0);
        assert_eq!(pr.review_decision, None);
        assert!(!pr.is_draft);
    }

    #[test]
    fn parse_pr_view_com_checks_falhando_e_review_approved() {
        let json = r#"{
          "number": 470,
          "title": "fix: taxa",
          "state": "OPEN",
          "isDraft": true,
          "url": "https://github.com/org/repo/pull/470",
          "baseRefName": "develop",
          "headRefName": "fix/taxa",
          "reviewDecision": "APPROVED",
          "statusCheckRollup": [
            { "status": "COMPLETED", "conclusion": "FAILURE" },
            { "status": "COMPLETED", "conclusion": "SUCCESS" },
            { "status": "IN_PROGRESS", "conclusion": "" }
          ]
        }"#;
        let pr = parse_pr_view(json).expect("deveria parsear");
        assert_eq!(pr.number, 470);
        assert_eq!(pr.state, "OPEN");
        assert!(pr.is_draft);
        assert_eq!(pr.checks_failing, 1);
        assert_eq!(pr.checks_passing, 1);
        assert_eq!(pr.checks_pending, 1);
        assert_eq!(pr.review_decision, Some("APPROVED".to_string()));
    }

    #[test]
    fn parse_pr_view_invalido_devolve_none() {
        assert!(parse_pr_view("não é json").is_none());
        assert!(parse_pr_view("{}").is_none());
    }
}
