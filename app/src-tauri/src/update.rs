//! Atualização in-app dos CLIs de agent como JOB EM BACKGROUND ("Atualizar" no
//! painel "CLIs instaladas"). Detecta o MÉTODO de instalação pelo PATH REAL do
//! binário (canonizado, segue symlinks do npm/brew) e roda o comando certo num
//! `tokio::spawn` desacoplado do request: o modal PODE fechar com o job vivo.
//!
//! Por que job com registry, e não request-response (incidente 2026-07):
//! o usuário clicou "Atualizar" no Codex várias vezes; cada clique disparou um
//! `update_agent` novo (sem trava), cada um rodou `brew upgrade codex`
//! CONCORRENTE (lock do brew → falhas), e o timeout de 240s com kill_on_drop
//! (SIGKILL) matou o brew NO MEIO da troca de arquivos: a fórmula ficou com
//! Cellar vazio e o CLI sumiu da máquina (recuperado à mão com
//! `brew reinstall codex`). Daí as três regras deste módulo:
//! 1. dedupe no BACKEND: um job `running` por agent, segundo start devolve o
//!    job vivo (a trava real, não só na UI);
//! 2. NUNCA SIGKILL direto em package manager: teto de 15 min, SIGTERM no
//!    process group, grace de 10s, só então SIGKILL, e a mensagem avisa que o
//!    gerenciador pode ter ficado inconsistente;
//! 3. estado observável: evento `update://event` (started/finished) + snapshot
//!    via `update_jobs` pra UI re-hidratar ao reabrir o modal.
//!
//! Roda no PATH hidratado do app (path::hydrate_path no startup), o mesmo que a
//! detecção usa. Honestidade sobre instalações duplicadas: o job carrega o path
//! REAL gerenciado + os DEMAIS paths do binário no PATH (`which -a`), porque
//! "atualizei e não mudou nada" quase sempre é o app atualizando uma cópia
//! diferente da que o shell do usuário resolve.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Update baixa/compila — teto generoso (npm/brew lentos numa rede ruim passam
/// fácil de 4 min; era 240s e estourava em uso legítimo).
const UPDATE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Grace entre SIGTERM e SIGKILL: tempo pro package manager abortar limpo.
const TERM_GRACE: Duration = Duration::from_secs(10);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(6);
/// Depois do kill os pipes fecham sozinhos; teto só pra nunca pendurar o job.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// Snapshot serializável de um job de update (o que a UI enxerga, via retorno
/// do comando, via `update_jobs` e via `update://event`).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJob {
    pub agent: String,
    /// "running" | "ok" | "unchanged" | "failed". `unchanged` = o comando saiu
    /// 0 mas a versão NÃO mudou (ex.: brew com o tap já satisfeito dizendo
    /// "already installed") — não é sucesso, é "já está na última do canal".
    pub status: String,
    /// "npm" | "homebrew" | "self-update" | "none" | "" (ainda resolvendo)
    pub method: String,
    /// comando efetivo (pra logar/mostrar e pro fallback "copiar").
    pub command: String,
    pub started_at: i64,
    /// tail da saída (stdout+stderr) — o que interessa pro painel/toast.
    pub output_tail: String,
    /// versão do binário DEPOIS do job (probe `--version` re-rodado no fim);
    /// "" = não deu pra ler. É ela que prova o "atualizado" de verdade.
    pub version: String,
    /// path REAL (canonizado) do binário que o app gerencia; "" = não achado.
    pub managed_path: String,
    /// DEMAIS paths do binário no PATH do app (`which -a`, sem o gerenciado):
    /// não-vazio = instalações duplicadas, a UI avisa na cara.
    pub other_paths: Vec<String>,
}

/// Registry dos jobs de update, um por agent. Gerenciado pelo Tauri
/// (`.manage(Arc<UpdateJobs>)` no lib.rs, padrão do ProcessRegistry do
/// work_gateway). O Mutex é síncrono e as seções críticas são curtas.
#[derive(Default)]
pub struct UpdateJobs {
    jobs: Mutex<HashMap<String, UpdateJob>>,
}

/// Resultado do check-and-insert atômico do início de job.
enum Begin {
    /// Já havia job `running` pro agent: devolve ele (dedupe, a trava real).
    AlreadyRunning(UpdateJob),
    /// Job novo inserido como `running`.
    Started(UpdateJob),
}

impl UpdateJobs {
    /// Início de job ATÔMICO: sob o mesmo lock, checa se há `running` e, se
    /// não, insere o placeholder `running`. Dois cliques seguidos nunca geram
    /// dois `brew upgrade` concorrentes (o incidente do lock do brew).
    fn begin(&self, agent: &str, now: i64) -> Begin {
        let mut map = match self.jobs.lock() {
            Ok(map) => map,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(existing) = map.get(agent) {
            if existing.status == "running" {
                return Begin::AlreadyRunning(existing.clone());
            }
        }
        let job = UpdateJob {
            agent: agent.to_string(),
            status: "running".into(),
            method: String::new(),
            command: String::new(),
            started_at: now,
            output_tail: String::new(),
            version: String::new(),
            managed_path: String::new(),
            other_paths: Vec::new(),
        };
        map.insert(agent.to_string(), job.clone());
        Begin::Started(job)
    }

    /// Aplica um patch no job do agent e devolve o snapshot atualizado.
    fn patch(&self, agent: &str, f: impl FnOnce(&mut UpdateJob)) -> Option<UpdateJob> {
        let mut map = match self.jobs.lock() {
            Ok(map) => map,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.get_mut(agent).map(|job| {
            f(job);
            job.clone()
        })
    }

    fn snapshot(&self) -> Vec<UpdateJob> {
        match self.jobs.lock() {
            Ok(map) => map.values().cloned().collect(),
            Err(poisoned) => poisoned.into_inner().values().cloned().collect(),
        }
    }
}

/// Método de instalação inferido do path real do binário. pub(crate): o
/// detect.rs usa o MESMO classificador pra decidir de qual canal vem a
/// "última versão" (o teto do npm não vale pra um binário do brew).
#[derive(PartialEq, Eq, Debug)]
pub(crate) enum Method {
    Npm,
    Homebrew,
    /// instalador nativo (o próprio CLI se atualiza: `claude update`).
    Native,
    Unknown,
}

/// Classifica o método pelo path REAL (já canonizado). Ordem importa e o sinal
/// FORTE de npm vem PRIMEIRO: `node_modules` (e os version-managers) é
/// inequívoco de npm e NUNCA aparece no path de uma fórmula brew (o node do brew
/// mora em `/Cellar/node/.../bin/node`, sem `node_modules`). Sem isso, um
/// `npm i -g` usando o node do Homebrew (path com `/opt/homebrew` E
/// `node_modules`) era classificado Homebrew → `brew upgrade claude` falhava.
pub(crate) fn classify(path: &str) -> Method {
    let p = path.to_lowercase();
    if p.contains("node_modules")
        || p.contains("/.nvm/")
        || p.contains("/fnm/")
        || p.contains("/.volta/")
    {
        Method::Npm
    } else if p.contains("/homebrew/") || p.contains("/cellar/") || p.contains("/opt/homebrew") {
        Method::Homebrew
    } else if p.contains("/node/") {
        // node genérico (fora de version-manager/homebrew) → npm.
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
            // o CASK do brew chama-se `claude-code`, NÃO `claude` (o binário) —
            // `brew upgrade claude` dava "Cask 'claude' is not installed".
            Method::Homebrew => ("homebrew", "brew", vec!["upgrade", "claude-code"]),
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

/// Desfecho VERIFICADO do update: exit 0 NÃO basta. Incidente real: o probe
/// dizia "última v2.1.220" (npm), o binário era do brew (teto v2.1.212),
/// `brew upgrade` respondia "latest version is already installed" com exit 0 e
/// o toast mentia "atualizado" sem nada mudar. A prova de avanço é a VERSÃO do
/// binário antes × depois:
/// - exit != 0 → "failed";
/// - versões legíveis e iguais → "unchanged" (já está na última do canal);
/// - versões legíveis e diferentes → "ok" (avançou de verdade);
/// - alguma versão ilegível → "ok" degradado (não dá pra verificar; confiar no
///   exit 0 é o melhor honesto possível — dizer "já está na última" sem prova
///   seria mentir pro outro lado).
fn classify_outcome(exit_ok: bool, before: Option<&str>, after: Option<&str>) -> &'static str {
    if !exit_ok {
        return "failed";
    }
    match (before, after) {
        (Some(b), Some(a)) if a == b => "unchanged",
        _ => "ok",
    }
}

/// Versão corrente do binário (`<bin> --version`, parse do detect.rs).
/// None = binário ausente/travado/saída sem versão.
async fn bin_version(bin: &str) -> Option<String> {
    let out = timeout(
        RESOLVE_TIMEOUT,
        Command::new(bin)
            .arg("--version")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() {
        return None;
    }
    crate::detect::extract_version(&String::from_utf8_lossy(&out.stdout))
}

/// Erro clássico de lock do Homebrew (outro brew rodando na máquina). Função
/// pura pra ser testável; casa as duas frases que o brew imprime.
fn is_brew_lock_error(output: &str) -> bool {
    let o = output.to_lowercase();
    o.contains("another active homebrew process") || o.contains("waiting for lock")
}

/// Mensagem do timeout: honesta sobre o risco (o SIGTERM/SIGKILL pode ter
/// deixado o gerenciador no meio de uma troca de arquivos — foi EXATAMENTE
/// assim que o codex sumiu da máquina) + o caminho de recuperação.
fn timeout_message(program: &str, args: &[&str], command: &str) -> String {
    let recover = if program == "brew" {
        // a fórmula/cask é o último arg do `brew upgrade <nome>`.
        let formula = args.last().copied().unwrap_or("<fórmula>");
        format!("`brew reinstall {formula}`")
    } else {
        format!("re-rodar `{command}` à mão")
    };
    format!(
        "A atualização passou de {} min e foi interrompida (SIGTERM, depois SIGKILL). \
         O gerenciador de pacotes pode ter ficado inconsistente; confira com {recover} num terminal.",
        UPDATE_TIMEOUT.as_secs() / 60
    )
}

/// Resolve o path REAL do binário (segue symlinks) usando o PATH do app. `sh -c`
/// (não `-lc`) de propósito: herda o PATH JÁ HIDRATADO do processo, sem re-sourcing
/// de profile (que sob nvm/zsh nem sempre carrega o node certo).
pub(crate) async fn resolve_bin(bin: &str) -> Option<String> {
    let out = timeout(
        RESOLVE_TIMEOUT,
        Command::new("sh")
            .args(["-c", &format!("command -v {bin}")])
            .kill_on_drop(true)
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

/// TODOS os paths do binário no PATH do app (`which -a`), na ordem do PATH.
/// Vazio em qualquer falha (honestidade best-effort, nunca trava o job).
async fn which_all(bin: &str) -> Vec<String> {
    let Ok(Ok(out)) = timeout(
        RESOLVE_TIMEOUT,
        Command::new("sh")
            .args(["-c", &format!("which -a {bin}")])
            .kill_on_drop(true)
            .output(),
    )
    .await
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// Paths ALÉM do gerenciado: remove do `which -a` toda entrada que canoniza pro
/// mesmo arquivo do managed (symlink brew → Caskroom conta como o mesmo).
fn other_paths_of(all: Vec<String>, managed_canonical: &str) -> Vec<String> {
    all.into_iter()
        .filter(|p| {
            let canon = std::fs::canonicalize(p)
                .map(|c| c.to_string_lossy().to_string())
                .unwrap_or_else(|_| p.clone());
            canon != managed_canonical
        })
        .collect()
}

fn tail_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Sinaliza o PROCESS GROUP (kill -SIG -pid), padrão do work_gateway: pega o
/// package manager E os filhos que ele tenha criado (curl, tar, node…).
fn signal_process_group(pid: u32, signal: &str) {
    if pid <= 1 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args([signal, &format!("-{pid}")])
            .output();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateEvent {
    agent: String,
    /// "started" | "finished"
    phase: String,
    /// só no finished (true também pro `unchanged` — o comando não FALHOU).
    ok: Option<bool>,
    /// status do job ("running" | "ok" | "unchanged" | "failed") — a fonte que
    /// o front espelha; `ok` fica pra compat/log.
    status: String,
    method: String,
    command: String,
    started_at: i64,
    output_tail: String,
    version: String,
    managed_path: String,
    other_paths: Vec<String>,
}

/// Emite `update://event` (padrão do emit_work do work_gateway). Best-effort:
/// se o emit falhar a UI ainda re-hidrata via `update_jobs`.
fn emit_update(app: &tauri::AppHandle, phase: &str, ok: Option<bool>, job: &UpdateJob) {
    let _ = app.emit(
        "update://event",
        UpdateEvent {
            agent: job.agent.clone(),
            phase: phase.into(),
            ok,
            status: job.status.clone(),
            method: job.method.clone(),
            command: job.command.clone(),
            started_at: job.started_at,
            output_tail: job.output_tail.clone(),
            version: job.version.clone(),
            managed_path: job.managed_path.clone(),
            other_paths: job.other_paths.clone(),
        },
    );
}

/// Corpo do job (roda num tokio::spawn desacoplado do request): resolve método
/// e paths, roda o comando com timeout gentil, fecha o job e emite eventos.
async fn run_update_job(app: tauri::AppHandle, jobs: Arc<UpdateJobs>, agent: String, bin: &str) {
    // 1) método + honestidade de paths (managed × demais cópias no PATH).
    let managed = resolve_bin(bin).await;
    let method = managed.as_deref().map(classify).unwrap_or(Method::Unknown);
    let managed_path = managed.unwrap_or_default();
    let other_paths = if managed_path.is_empty() {
        Vec::new()
    } else {
        other_paths_of(which_all(bin).await, &managed_path)
    };

    let Some((label, program, args)) = plan(&agent, &method) else {
        let job = jobs.patch(&agent, |j| {
            j.status = "failed".into();
            j.method = "none".into();
            j.managed_path = managed_path.clone();
            j.other_paths = other_paths.clone();
            j.output_tail = "Este agent não tem canal de atualização conhecido.".into();
        });
        if let Some(job) = job {
            emit_update(&app, "finished", Some(false), &job);
        }
        return;
    };
    let command = format!("{program} {}", args.join(" "));

    // Versão ANTES do comando: é o lado esquerdo da prova de avanço do
    // classify_outcome (exit 0 sem a versão mudar = "unchanged", não sucesso).
    let before_version = bin_version(bin).await;

    let job = jobs.patch(&agent, |j| {
        j.method = label.into();
        j.command = command.clone();
        j.version = before_version.clone().unwrap_or_default();
        j.managed_path = managed_path.clone();
        j.other_paths = other_paths.clone();
    });
    if let Some(job) = &job {
        emit_update(&app, "started", None, job);
    }

    // 2) roda o comando. kill_on_drop(false) + process_group(0): quem decide
    // matar é o timeout gentil abaixo, nunca um drop (o SIGKILL do drop foi o
    // que corrompeu o Cellar do codex).
    let mut cmd = Command::new(program);
    cmd.args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(false);
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        // ENOENT: npm/brew fora do PATH do app → devolve o comando pra rodar à mão.
        Err(e) => {
            let job = jobs.patch(&agent, |j| {
                j.status = "failed".into();
                j.output_tail =
                    format!("Não consegui rodar automaticamente ({e}). Rode à mão:\n{command}");
            });
            if let Some(job) = job {
                emit_update(&app, "finished", Some(false), &job);
            }
            return;
        }
    };

    // Drena stdout/stderr em paralelo ao wait (senão o pipe cheio trava o filho).
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_task = tokio::spawn(async move {
        let mut s = String::new();
        if let Some(ref mut r) = stdout {
            let _ = r.read_to_string(&mut s).await;
        }
        s
    });
    let err_task = tokio::spawn(async move {
        let mut s = String::new();
        if let Some(ref mut r) = stderr {
            let _ = r.read_to_string(&mut s).await;
        }
        s
    });

    let pid = child.id();
    let mut timed_out = false;
    let ok = match timeout(UPDATE_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status.success(),
        Ok(Err(_)) => false,
        Err(_) => {
            // Timeout GENTIL: SIGTERM no grupo, grace, só então SIGKILL. Nunca
            // mais SIGKILL direto em package manager (incidente do Cellar vazio).
            timed_out = true;
            if let Some(pid) = pid {
                signal_process_group(pid, "-TERM");
            }
            if timeout(TERM_GRACE, child.wait()).await.is_err() {
                if let Some(pid) = pid {
                    signal_process_group(pid, "-KILL");
                }
                let _ = child.wait().await;
            }
            false
        }
    };

    let stdout_s = timeout(DRAIN_TIMEOUT, out_task)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
    let stderr_s = timeout(DRAIN_TIMEOUT, err_task)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
    let mut combined = stdout_s;
    if !stderr_s.trim().is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&stderr_s);
    }

    // 3) desfecho VERIFICADO: re-probe da versão do binário gerenciado. O exit
    // 0 do gerenciador não prova nada (o "already installed" do brew sai 0).
    let after_version = bin_version(bin).await;
    let status = classify_outcome(ok, before_version.as_deref(), after_version.as_deref());

    let mut output_tail = tail_lines(&combined, 40);
    if timed_out {
        let msg = timeout_message(program, &args, &command);
        if output_tail.is_empty() {
            output_tail = msg;
        } else {
            output_tail = format!("{msg}\n\n{output_tail}");
        }
    } else if !ok && is_brew_lock_error(&combined) {
        output_tail = format!(
            "Outra atualização do Homebrew está em andamento nesta máquina. \
             Aguarde ela terminar e tente de novo.\n\n{output_tail}"
        );
    }

    let job = jobs.patch(&agent, |j| {
        j.status = status.into();
        j.output_tail = output_tail.clone();
        if let Some(v) = &after_version {
            j.version = v.clone();
        }
    });
    if let Some(job) = job {
        emit_update(&app, "finished", Some(status != "failed"), &job);
    }
}

/// Início de job de update. Devolve o snapshot IMEDIATAMENTE (status
/// `running`); o trabalho segue em background e o desfecho chega por
/// `update://event` (ou pelo snapshot de `update_jobs`, se os eventos
/// falharem). Se já há job `running` pro agent, devolve ELE (dedupe).
#[tauri::command]
pub async fn update_agent(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, Arc<UpdateJobs>>,
    agent: String,
) -> Result<UpdateJob, String> {
    let bin = match agent.as_str() {
        "claude-code" => "claude",
        "codex" => "codex",
        "agy" => "agy",
        other => return Err(format!("agent desconhecido: {other}")),
    };

    match jobs.begin(&agent, now_ms()) {
        Begin::AlreadyRunning(job) => Ok(job),
        Begin::Started(job) => {
            let jobs = Arc::clone(&jobs);
            tokio::spawn(run_update_job(app, jobs, agent, bin));
            Ok(job)
        }
    }
}

/// Snapshot de todos os jobs (pra UI re-hidratar ao reabrir o modal e pro
/// polling de segurança quando os eventos falham).
#[tauri::command]
pub fn update_jobs(jobs: tauri::State<'_, Arc<UpdateJobs>>) -> Vec<UpdateJob> {
    jobs.snapshot()
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
        // npm-global usando o NODE do Homebrew: tem /opt/homebrew E node_modules
        // → npm (não brew). Era o bug: casava homebrew primeiro e falhava.
        assert_eq!(
            classify("/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js"),
            Method::Npm
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
        // claude homebrew → cask `claude-code`, NÃO `claude`
        let (_, prog_h, args_h) = plan("claude-code", &Method::Homebrew).unwrap();
        assert_eq!(prog_h, "brew");
        assert_eq!(args_h, vec!["upgrade", "claude-code"]);
        // codex homebrew default
        assert_eq!(plan("codex", &Method::Unknown).unwrap().1, "brew");
        assert_eq!(plan("codex", &Method::Npm).unwrap().1, "npm");
        // agy sem canal
        assert!(plan("agy", &Method::Npm).is_none());
    }

    #[test]
    fn dedupe_segundo_start_devolve_o_job_vivo() {
        // O incidente: N cliques → N `brew upgrade` concorrentes. Com o registry,
        // o segundo begin() do MESMO agent devolve o job existente, não cria outro.
        let jobs = UpdateJobs::default();
        let first = match jobs.begin("codex", 1_000) {
            Begin::Started(j) => j,
            Begin::AlreadyRunning(_) => panic!("primeiro begin devia iniciar job novo"),
        };
        assert_eq!(first.status, "running");
        match jobs.begin("codex", 2_000) {
            Begin::AlreadyRunning(j) => {
                // é o MESMO job (started_at original), não um novo.
                assert_eq!(j.started_at, 1_000);
            }
            Begin::Started(_) => panic!("segundo begin devia devolver o job vivo"),
        }
        // agent DIFERENTE não é bloqueado pelo job do codex.
        assert!(matches!(jobs.begin("claude-code", 3_000), Begin::Started(_)));
    }

    #[test]
    fn job_terminado_libera_novo_start() {
        let jobs = UpdateJobs::default();
        assert!(matches!(jobs.begin("codex", 1_000), Begin::Started(_)));
        jobs.patch("codex", |j| j.status = "failed".into());
        // terminou (ok OU failed) → próximo begin inicia job novo.
        let again = match jobs.begin("codex", 5_000) {
            Begin::Started(j) => j,
            Begin::AlreadyRunning(_) => panic!("job terminado não deve travar novo start"),
        };
        assert_eq!(again.started_at, 5_000);
        assert_eq!(again.status, "running");
    }

    #[test]
    fn transicao_de_status_via_patch() {
        let jobs = UpdateJobs::default();
        assert!(matches!(jobs.begin("claude-code", 1), Begin::Started(_)));
        let patched = jobs
            .patch("claude-code", |j| {
                j.status = "ok".into();
                j.method = "npm".into();
                j.output_tail = "atualizado".into();
            })
            .expect("job existe");
        assert_eq!(patched.status, "ok");
        assert_eq!(patched.method, "npm");
        let snap = jobs.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].status, "ok");
        // patch de agent inexistente é no-op honesto.
        assert!(jobs.patch("agy", |j| j.status = "ok".into()).is_none());
    }

    #[test]
    fn desfecho_verificado_por_versao() {
        // O incidente do sucesso falso: brew "already installed" sai 0 sem
        // mudar nada → exit ok + versão igual = unchanged, NUNCA "ok".
        assert_eq!(
            classify_outcome(true, Some("2.1.212"), Some("2.1.212")),
            "unchanged"
        );
        // versão avançou de verdade → ok.
        assert_eq!(
            classify_outcome(true, Some("2.1.212"), Some("2.1.220")),
            "ok"
        );
        // exit != 0 manda em tudo.
        assert_eq!(
            classify_outcome(false, Some("2.1.212"), Some("2.1.212")),
            "failed"
        );
        assert_eq!(classify_outcome(false, None, None), "failed");
        // versão ilegível (antes ou depois): não dá pra verificar → confia no
        // exit 0 (degradação documentada, não teatro pro outro lado).
        assert_eq!(classify_outcome(true, None, Some("2.1.220")), "ok");
        assert_eq!(classify_outcome(true, Some("2.1.212"), None), "ok");
    }

    #[test]
    fn detecta_erro_de_lock_do_brew() {
        assert!(is_brew_lock_error(
            "Error: Another active Homebrew process is already in progress."
        ));
        assert!(is_brew_lock_error(
            "Waiting for lock on /opt/homebrew/var/homebrew/locks/codex.formula.lock"
        ));
        // case-insensitive.
        assert!(is_brew_lock_error("error: another active homebrew process"));
        // saída normal não dispara.
        assert!(!is_brew_lock_error("==> Upgrading codex 0.144.6 -> 0.146.0"));
        assert!(!is_brew_lock_error(""));
    }

    #[test]
    fn mensagem_de_timeout_sugere_recuperacao() {
        let brew = timeout_message("brew", &["upgrade", "codex"], "brew upgrade codex");
        assert!(brew.contains("brew reinstall codex"));
        assert!(brew.contains("inconsistente"));
        let npm = timeout_message(
            "npm",
            &["i", "-g", "@openai/codex@latest"],
            "npm i -g @openai/codex@latest",
        );
        assert!(npm.contains("npm i -g @openai/codex@latest"));
    }

    #[test]
    fn other_paths_exclui_o_gerenciado() {
        // paths inexistentes não canonizam → comparação textual direta.
        let all = vec![
            "/tmp/mc-teste-inexistente/a/claude".to_string(),
            "/tmp/mc-teste-inexistente/b/claude".to_string(),
        ];
        let others = other_paths_of(all, "/tmp/mc-teste-inexistente/a/claude");
        assert_eq!(others, vec!["/tmp/mc-teste-inexistente/b/claude".to_string()]);
    }
}
