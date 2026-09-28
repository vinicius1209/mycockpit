//! As ações de git da aba Alterações que falam com o remoto ou mexem em branch,
//! stash e histórico (docs/explorador-de-arquivos-prd.md, Parte B). Mora fora
//! de `git.rs`, que está congelado acima do teto (ADR-232).
//!
//! Regras: nada de `--force`; trazer só avança (`--ff-only`), e rebase é gesto
//! explícito; e nenhum comando de rede pode ficar esperando uma senha que
//! ninguém vai digitar (`GIT_TERMINAL_PROMPT=0`, SSH em `BatchMode`, prazo).

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::git::{gh_accounts, git, run_git, validated_git_cwd};

/// Prazo de uma operação de rede. Push de repositório grande cabe folgado.
const PRAZO_DE_REDE: Duration = Duration::from_secs(120);
const MAX_BRANCHES: usize = 50;
const SEP: char = '\u{1f}';

// ---------------- Erros de remoto ----------------

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErroDeGit {
    /// "acesso" | "recusado" | "divergiu" | "conflito" | "alteracoes-locais" |
    /// "sem-rede" | "prazo" | "outro"
    pub tipo: String,
    pub detalhe: String,
    /// Só em "acesso" num remoto do GitHub: o dono do repositório pela URL, a
    /// conta ativa e as logadas no gh.
    pub dono: Option<String>,
    pub conta_ativa: Option<String>,
    pub contas: Vec<String>,
}

impl ErroDeGit {
    fn de(tipo: &str, detalhe: impl Into<String>) -> Self {
        ErroDeGit { tipo: tipo.into(), detalhe: detalhe.into(), dono: None, conta_ativa: None, contas: vec![] }
    }
}

/// Classifica a saída de erro do git. Puro; as frases são as do git em inglês,
/// que é como ele fala com `LC_ALL=C` (o executor de rede fixa isso).
pub(crate) fn classificar(stderr: &str) -> &'static str {
    let e = stderr.to_lowercase();
    let tem = |s: &str| e.contains(s);
    if tem("conflict") {
        "conflito"
    } else if tem("would be overwritten") || tem("commit your changes or stash them") {
        "alteracoes-locais"
    } else if tem("not possible to fast-forward") || tem("diverging branches") || tem("have diverged") {
        "divergiu"
    } else if tem("[rejected]") || tem("non-fast-forward") || tem("fetch first") || tem("updates were rejected") {
        "recusado"
    } else if tem("repository not found")
        || (tem("permission to") && tem("denied"))
        || tem("error: 403")
        || tem("authentication failed")
        || tem("could not read username")
        || tem("permission denied (publickey)")
    {
        "acesso"
    } else if tem("could not resolve host")
        || tem("unable to access")
        || tem("network is unreachable")
        || tem("connection timed out")
        || tem("could not read from remote")
    {
        "sem-rede"
    } else {
        "outro"
    }
}

/// O dono de um remoto do GitHub, em https ou ssh. Puro.
pub(crate) fn dono_no_github(url: &str) -> Option<String> {
    let resto = url.trim().split("github.com").nth(1)?;
    let dono = resto.trim_start_matches([':', '/']).split('/').next()?.trim();
    (!dono.is_empty()).then(|| dono.to_string())
}

fn erro_de(cwd: &str, stderr: String) -> ErroDeGit {
    let tipo = classificar(&stderr);
    let mut erro = ErroDeGit::de(tipo, stderr);
    let url = git(cwd, &["config", "--get", "remote.origin.url"]).unwrap_or_default();
    if tipo == "acesso" && url.contains("github.com") {
        let (contas, ativa) = gh_accounts();
        erro.dono = dono_no_github(&url);
        erro.contas = contas;
        erro.conta_ativa = ativa;
    }
    erro
}

/// git sem prompt e com prazo: credencial que faltar vira erro, nunca espera.
fn git_de_rede(cwd: &str, args: &[&str]) -> Result<String, ErroDeGit> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut filho = cmd
        .spawn()
        .map_err(|e| ErroDeGit::de("outro", format!("não consegui executar o git: {e}")))?;
    // Os pipes se esvaziam enquanto o git roda: um `pull` com diffstat grande
    // enche os 64 KB do pipe e travaria o git até o prazo.
    let ler = |fonte: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut texto = String::new();
            if let Some(mut f) = fonte {
                let _ = f.read_to_string(&mut texto);
            }
            texto
        })
    };
    let saida = ler(filho.stdout.take().map(|o| Box::new(o) as Box<dyn Read + Send>));
    let erro = ler(filho.stderr.take().map(|e| Box::new(e) as Box<dyn Read + Send>));
    let inicio = Instant::now();
    let status = loop {
        match filho.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if inicio.elapsed() > PRAZO_DE_REDE => {
                let _ = filho.kill();
                let _ = filho.wait();
                return Err(ErroDeGit::de("prazo", "o git não respondeu em 2 minutos"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(80)),
            Err(e) => return Err(ErroDeGit::de("outro", e.to_string())),
        }
    };
    let saida = saida.join().unwrap_or_default();
    let erro = erro.join().unwrap_or_default();
    if status.success() {
        return Ok(saida);
    }
    let texto = if saida.trim().is_empty() {
        erro.trim().to_string()
    } else {
        format!("{}\n{}", erro.trim(), saida.trim())
    };
    Err(erro_de(cwd, texto))
}

fn local(cwd: &str) -> Result<String, ErroDeGit> {
    validated_git_cwd(cwd).map_err(|e| ErroDeGit::de("outro", e))
}

fn local_git(cwd: &str, args: &[&str]) -> Result<String, ErroDeGit> {
    run_git(cwd, args).map_err(|e| erro_de(cwd, e))
}

// ---------------- Estado do repositório ----------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operacao {
    /// "rebase" | "merge"
    pub tipo: String,
    pub atual: Option<u32>,
    pub total: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoDoRepo {
    /// Quando o remoto foi buscado pela última vez (ms), pelo `FETCH_HEAD`.
    pub ultima_busca: Option<i64>,
    pub remoto_github: bool,
    pub tem_remoto: bool,
    pub operacao: Option<Operacao>,
    pub conflitos: Vec<String>,
    pub guardadas: u32,
}

fn ms(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

fn ler_numero(p: &Path) -> Option<u32> {
    std::fs::read_to_string(p).ok()?.trim().parse().ok()
}

fn pastas_do_git(cwd: &str) -> Option<(PathBuf, PathBuf)> {
    let out = git(cwd, &["rev-parse", "--absolute-git-dir", "--git-common-dir"])?;
    let mut linhas = out.lines();
    let dir = PathBuf::from(linhas.next()?.trim());
    let comum = linhas.next().map(|l| l.trim()).unwrap_or("");
    let comum = if Path::new(comum).is_absolute() { PathBuf::from(comum) } else { Path::new(cwd).join(comum) };
    Some((dir, comum))
}

fn operacao_em(dir: &Path) -> Option<Operacao> {
    let rm = dir.join("rebase-merge");
    if rm.is_dir() {
        return Some(Operacao { tipo: "rebase".into(), atual: ler_numero(&rm.join("msgnum")), total: ler_numero(&rm.join("end")) });
    }
    let ra = dir.join("rebase-apply");
    if ra.is_dir() {
        return Some(Operacao { tipo: "rebase".into(), atual: ler_numero(&ra.join("next")), total: ler_numero(&ra.join("last")) });
    }
    if dir.join("MERGE_HEAD").is_file() {
        return Some(Operacao { tipo: "merge".into(), atual: None, total: None });
    }
    None
}

fn estado_sync(cwd: &str) -> Result<EstadoDoRepo, ErroDeGit> {
    let cwd = local(cwd)?;
    let (dir, comum) = pastas_do_git(&cwd).ok_or_else(|| ErroDeGit::de("outro", "não achei a pasta do git"))?;
    let busca = std::fs::metadata(dir.join("FETCH_HEAD"))
        .or_else(|_| std::fs::metadata(comum.join("FETCH_HEAD")))
        .and_then(|m| m.modified())
        .ok()
        .and_then(ms);
    let url = git(&cwd, &["config", "--get", "remote.origin.url"]).unwrap_or_default();
    let conflitos = git(&cwd, &["diff", "--name-only", "--diff-filter=U"])
        .map(|s| s.lines().map(str::to_string).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default();
    // Contar o stash pelo reflog evita um processo a mais.
    let guardadas = std::fs::read_to_string(comum.join("logs/refs/stash"))
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);
    Ok(EstadoDoRepo {
        ultima_busca: busca,
        remoto_github: url.contains("github.com"),
        tem_remoto: !url.trim().is_empty(),
        operacao: operacao_em(&dir),
        conflitos,
        guardadas,
    })
}

// ---------------- Enviar, trazer, buscar ----------------

fn enviar_sync(cwd: &str, publicar: bool) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    if publicar {
        git_de_rede(&cwd, &["push", "-u", "origin", "HEAD"])?;
    } else {
        git_de_rede(&cwd, &["push"])?;
    }
    Ok(())
}

fn trazer_sync(cwd: &str, rebase: bool) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    let modo = if rebase { "--rebase" } else { "--ff-only" };
    match git_de_rede(&cwd, &["pull", modo]) {
        Ok(_) => Ok(()),
        // Rebase que parou em conflito: o git sai com erro, mas o estado é o
        // de conflito, e quem mostra os arquivos é o `estado_sync`.
        Err(e) if rebase && operacao_em(&pastas_do_git(&cwd).map(|p| p.0).unwrap_or_default()).is_some() => {
            Err(ErroDeGit { tipo: "conflito".into(), ..e })
        }
        Err(e) => Err(e),
    }
}

fn buscar_sync(cwd: &str) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    git_de_rede(&cwd, &["fetch", "--prune"]).map(|_| ())
}

// ---------------- Branches ----------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub nome: String,
    /// Último commit, em ms.
    pub quando: i64,
    pub atual: bool,
}

pub(crate) fn parse_branches(saida: &str, atual: &str) -> Vec<Branch> {
    saida
        .lines()
        .filter_map(|l| {
            let mut p = l.split(SEP);
            let nome = p.next()?.trim().to_string();
            let quando = p.next()?.trim().parse::<i64>().ok()? * 1000;
            (!nome.is_empty()).then(|| Branch { atual: nome == atual, nome, quando })
        })
        .take(MAX_BRANCHES)
        .collect()
}

fn branches_sync(cwd: &str) -> Result<Vec<Branch>, ErroDeGit> {
    let cwd = local(cwd)?;
    let atual = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let saida = local_git(
        &cwd,
        &["for-each-ref", "--sort=-committerdate", "refs/heads", "--format=%(refname:short)\u{1f}%(committerdate:unix)"],
    )?;
    Ok(parse_branches(&saida, atual.trim()))
}

fn nome_de_branch_valido(nome: &str) -> bool {
    !nome.is_empty()
        && !nome.starts_with('-')
        && git(".", &["check-ref-format", "--branch", nome]).is_some()
}

/// Troca (ou cria) a branch. `guardar`: faz stash antes, com a mensagem que diz
/// para onde se foi. Sem guardar, o git leva as alterações se não houver
/// conflito, e recusa se houver ("alteracoes-locais").
fn trocar_sync(cwd: &str, branch: &str, criar: bool, guardar: bool) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    if !nome_de_branch_valido(branch) {
        return Err(ErroDeGit::de("outro", format!("\"{branch}\" não é um nome de branch válido")));
    }
    if guardar {
        let de = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
        let msg = format!("Frota: alterações de {} ao trocar para {branch}", de.trim());
        local_git(&cwd, &["stash", "push", "--include-untracked", "-m", &msg])?;
    }
    if criar {
        local_git(&cwd, &["switch", "-c", branch])?;
    } else {
        local_git(&cwd, &["switch", branch])?;
    }
    Ok(())
}

// ---------------- Stash ----------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guardada {
    /// `stash@{0}`
    pub referencia: String,
    pub mensagem: String,
    pub quando: i64,
}

pub(crate) fn parse_guardadas(saida: &str) -> Vec<Guardada> {
    saida
        .lines()
        .filter_map(|l| {
            let mut p = l.split(SEP);
            let referencia = p.next()?.trim().to_string();
            let mensagem = p.next()?.trim().to_string();
            let quando = p.next()?.trim().parse::<i64>().ok()? * 1000;
            referencia.starts_with("stash@{").then_some(Guardada { referencia, mensagem, quando })
        })
        .collect()
}

fn referencia_valida(r: &str) -> bool {
    let Some(n) = r.strip_prefix("stash@{").and_then(|r| r.strip_suffix('}')) else { return false };
    !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())
}

fn guardadas_sync(cwd: &str) -> Result<Vec<Guardada>, ErroDeGit> {
    let cwd = local(cwd)?;
    let saida = local_git(&cwd, &["stash", "list", "--format=%gd\u{1f}%s\u{1f}%ct"])?;
    Ok(parse_guardadas(&saida))
}

fn guardar_sync(cwd: &str, mensagem: &str) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    let msg = if mensagem.trim().is_empty() { "Frota: alterações guardadas" } else { mensagem.trim() };
    local_git(&cwd, &["stash", "push", "--include-untracked", "-m", msg]).map(|_| ())
}

fn recuperar_sync(cwd: &str, referencia: &str, apagar: bool) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    if !referencia_valida(referencia) {
        return Err(ErroDeGit::de("outro", "referência de stash inválida"));
    }
    let verbo = if apagar { "drop" } else { "pop" };
    local_git(&cwd, &["stash", verbo, referencia]).map(|_| ())
}

// ---------------- Histórico e desfazer ----------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub curto: String,
    pub mensagem: String,
    pub autor: String,
    pub quando: i64,
    /// Ainda não está em nenhum remoto.
    pub nao_enviado: bool,
}

pub(crate) fn parse_historico(saida: &str, nao_enviados: &std::collections::HashSet<String>) -> Vec<Commit> {
    saida
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split(SEP).collect();
            if p.len() < 5 {
                return None;
            }
            let hash = p[0].trim().to_string();
            Some(Commit {
                nao_enviado: nao_enviados.contains(&hash),
                curto: p[1].trim().to_string(),
                mensagem: p[2].trim().to_string(),
                autor: p[3].trim().to_string(),
                quando: p[4].trim().parse::<i64>().unwrap_or(0) * 1000,
                hash,
            })
        })
        .collect()
}

fn historico_sync(cwd: &str, quantos: u32) -> Result<Vec<Commit>, ErroDeGit> {
    let cwd = local(cwd)?;
    let n = format!("-n{}", quantos.clamp(1, 200));
    let saida = match run_git(&cwd, &["log", &n, "--format=%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ct"]) {
        Ok(s) => s,
        // Repositório sem commit ainda: histórico vazio, não erro.
        Err(_) if git(&cwd, &["rev-parse", "HEAD"]).is_none() => return Ok(vec![]),
        Err(e) => return Err(erro_de(&cwd, e)),
    };
    let nao_enviados = git(&cwd, &["rev-list", "HEAD", "--not", "--remotes", &n])
        .map(|s| s.lines().map(|l| l.trim().to_string()).collect())
        .unwrap_or_default();
    Ok(parse_historico(&saida, &nao_enviados))
}

/// Desfaz o último commit devolvendo as alterações à área de trabalho
/// (`reset --soft HEAD~1`). Só enquanto ele não está em nenhum remoto:
/// reescrever o que já foi enviado não é este gesto.
fn desfazer_sync(cwd: &str) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    let enviado = git(&cwd, &["branch", "-r", "--contains", "HEAD"]).map(|s| !s.trim().is_empty()).unwrap_or(false);
    if enviado {
        return Err(ErroDeGit::de("outro", "o último commit já foi enviado; desfazê-lo reescreveria o remoto"));
    }
    if git(&cwd, &["rev-parse", "--verify", "HEAD~1"]).is_none() {
        return Err(ErroDeGit::de("outro", "é o primeiro commit do repositório"));
    }
    local_git(&cwd, &["reset", "--soft", "HEAD~1"]).map(|_| ())
}

// ---------------- Rebase ou merge em andamento ----------------

fn operacao_sync(cwd: &str, continuar: bool) -> Result<(), ErroDeGit> {
    let cwd = local(cwd)?;
    let dir = pastas_do_git(&cwd).map(|p| p.0).unwrap_or_default();
    let Some(op) = operacao_em(&dir) else {
        return Err(ErroDeGit::de("outro", "não há rebase nem merge em andamento"));
    };
    let passo = if continuar { "--continue" } else { "--abort" };
    // `core.editor=true`: a mensagem do commit fica como o git a propôs.
    local_git(&cwd, &["-c", "core.editor=true", &op.tipo, passo]).map(|_| ())
}

// ---------------- Comandos ----------------

async fn bloqueante<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, ErroDeGit> + Send + 'static,
) -> Result<T, ErroDeGit> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| ErroDeGit::de("outro", e.to_string()))?
}

#[tauri::command]
pub async fn git_estado_do_repo(cwd: String) -> Result<EstadoDoRepo, ErroDeGit> {
    bloqueante(move || estado_sync(&cwd)).await
}

#[tauri::command]
pub async fn git_enviar(cwd: String, publicar: bool) -> Result<(), ErroDeGit> {
    bloqueante(move || enviar_sync(&cwd, publicar)).await
}

#[tauri::command]
pub async fn git_trazer(cwd: String, rebase: bool) -> Result<(), ErroDeGit> {
    bloqueante(move || trazer_sync(&cwd, rebase)).await
}

#[tauri::command]
pub async fn git_buscar(cwd: String) -> Result<(), ErroDeGit> {
    bloqueante(move || buscar_sync(&cwd)).await
}

#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<Vec<Branch>, ErroDeGit> {
    bloqueante(move || branches_sync(&cwd)).await
}

#[tauri::command]
pub async fn git_trocar_branch(cwd: String, branch: String, criar: bool, guardar: bool) -> Result<(), ErroDeGit> {
    bloqueante(move || trocar_sync(&cwd, &branch, criar, guardar)).await
}

#[tauri::command]
pub async fn git_guardadas(cwd: String) -> Result<Vec<Guardada>, ErroDeGit> {
    bloqueante(move || guardadas_sync(&cwd)).await
}

#[tauri::command]
pub async fn git_guardar(cwd: String, mensagem: String) -> Result<(), ErroDeGit> {
    bloqueante(move || guardar_sync(&cwd, &mensagem)).await
}

#[tauri::command]
pub async fn git_recuperar_guardada(cwd: String, referencia: String, apagar: bool) -> Result<(), ErroDeGit> {
    bloqueante(move || recuperar_sync(&cwd, &referencia, apagar)).await
}

#[tauri::command]
pub async fn git_historico(cwd: String, quantos: u32) -> Result<Vec<Commit>, ErroDeGit> {
    bloqueante(move || historico_sync(&cwd, quantos)).await
}

#[tauri::command]
pub async fn git_desfazer_ultimo_commit(cwd: String) -> Result<(), ErroDeGit> {
    bloqueante(move || desfazer_sync(&cwd)).await
}

#[tauri::command]
pub async fn git_operacao(cwd: String, continuar: bool) -> Result<(), ErroDeGit> {
    bloqueante(move || operacao_sync(&cwd, continuar)).await
}

#[cfg(test)]
#[path = "git_sync_tests.rs"]
mod tests;
