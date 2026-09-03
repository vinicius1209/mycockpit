// Diff da working tree (v1: não-commitado vs HEAD + arquivos novos). Espelha o
// modelo do code_review do Warp (files → hunks → lines), mas o parse do unified
// diff vive no TS (lib/git.ts); aqui o Rust só roda o git e entrega o patch cru.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;

/// git -C <cwd> <args>, stdout no sucesso (None se falhar/git ausente).
fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let mut full: Vec<&str> = vec!["-C", cwd];
    full.extend_from_slice(args);
    crate::proc::run_ok("git", &full, None)
}

/// Máx. de linhas emitidas no diff sintético de um arquivo novo.
const UNTRACKED_MAX_LINES: usize = 400;
/// Arquivo novo maior que isso não vira diff de texto (evita ler blob gigante).
const UNTRACKED_MAX_BYTES: u64 = 1_000_000;

/// Patch unified sintético de um arquivo untracked (equivale ao `--no-index` vs
/// /dev/null, SEM spawnar um git por arquivo, era N+1 e congelava a UI).
fn untracked_patch(cwd: &str, rel: &str) -> String {
    let full = Path::new(cwd).join(rel);
    let mut out =
        format!("diff --git a/{rel} b/{rel}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel}\n");
    let too_big = fs::metadata(&full)
        .map(|m| m.len() > UNTRACKED_MAX_BYTES)
        .unwrap_or(true);
    let bytes = if too_big { None } else { fs::read(&full).ok() };
    let Some(bytes) = bytes else {
        out.push_str("Binary files /dev/null and b/ differ\n");
        return out;
    };
    if bytes.contains(&0) {
        out.push_str("Binary files /dev/null and b/ differ\n");
        return out;
    }
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let shown = lines.len().min(UNTRACKED_MAX_LINES);
    out.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len().max(1)));
    for l in &lines[..shown] {
        out.push('+');
        out.push_str(l);
        out.push('\n');
    }
    if lines.len() > shown {
        out.push_str(&format!("+… +{} linhas\n", lines.len() - shown));
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub is_repo: bool,
    pub branch: Option<String>,
    /// Unified diff completo: rastreados (`git diff HEAD`) + novos (`--no-index`).
    pub patch: String,
}

/// Alterações não-commitadas de um diretório (o cwd da conversa). Rastreados via
/// `git diff HEAD`; arquivos novos viram diff sintético (1 processo no total).
fn diff_sync(cwd: &str) -> GitDiff {
    let is_repo = git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return GitDiff {
            is_repo: false,
            branch: None,
            patch: String::new(),
        };
    }
    let branch = git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    // rastreados (modificados + deletados) vs HEAD.
    let mut patch = git(cwd, &["diff", "HEAD", "--no-color"]).unwrap_or_default();
    // novos (untracked, não-ignorados): patch sintético, sem git por arquivo.
    if let Some(list) = git(cwd, &["ls-files", "--others", "--exclude-standard", "-z"]) {
        for f in list.split('\0').filter(|s| !s.is_empty()) {
            patch.push_str(&untracked_patch(cwd, f));
        }
    }
    GitDiff {
        is_repo: true,
        branch,
        patch,
    }
}

/// Async (spawn_blocking): git síncrono na main thread congelava a UI.
#[tauri::command]
pub async fn git_diff(cwd: String) -> GitDiff {
    tauri::async_runtime::spawn_blocking(move || diff_sync(&cwd))
        .await
        .unwrap_or(GitDiff {
            is_repo: false,
            branch: None,
            patch: String::new(),
        })
}

// ---------------- Worktree isolado por conversa (v2.5) ----------------
//
// O cockpit dirige, então CRIA o worktree determinístico (não delega pro agent).
// Cada conversa isolada roda num `git worktree` próprio sob `.mycockpit/worktrees/`
// (gitignored → não suja a main tree), num branch `mycockpit/<slug>`.

/// git -C <cwd> <args> com a MENSAGEM de erro (stderr) no Err (p/ o front mostrar).
fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut full: Vec<&str> = vec!["-C", cwd];
    full.extend_from_slice(args);
    crate::proc::run("git", &full, None)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
}

/// Cria (ou reusa) um worktree isolado pra uma conversa. Branch a partir do HEAD.
fn create_worktree_sync(project_path: String, conv_id: String) -> Result<WorktreeInfo, String> {
    let is_repo = git(&project_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return Err("este projeto não é um repositório git".into());
    }
    if git(&project_path, &["rev-parse", "HEAD"]).is_none() {
        return Err("o repositório ainda não tem commit (HEAD) pra ramificar".into());
    }
    let slug: String = conv_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let slug = if slug.is_empty() {
        "conv".to_string()
    } else {
        slug
    };
    let branch = format!("mycockpit/{slug}");
    let path = Path::new(&project_path)
        .join(".mycockpit")
        .join("worktrees")
        .join(&slug);
    let path_str = path.to_string_lossy().to_string();

    // garante que .mycockpit/ é ignorado (senão o worktree apareceria na main tree).
    let mc = Path::new(&project_path).join(".mycockpit");
    let _ = std::fs::create_dir_all(&mc);
    let ignore = mc.join(".gitignore");
    if !ignore.exists() {
        let _ = std::fs::write(&ignore, "*\n");
    }

    if path.exists() {
        return Ok(WorktreeInfo {
            path: path_str,
            branch,
        }); // reusa (re-toggle)
    }
    let branch_exists = git(
        &project_path,
        &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
    )
    .is_some();
    let args: Vec<&str> = if branch_exists {
        vec!["worktree", "add", &path_str, &branch]
    } else {
        vec!["worktree", "add", &path_str, "-b", &branch]
    };
    run_git(&project_path, &args)?;
    Ok(WorktreeInfo {
        path: path_str,
        branch,
    })
}

#[tauri::command]
pub async fn create_worktree(
    project_path: String,
    conv_id: String,
) -> Result<WorktreeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || create_worktree_sync(project_path, conv_id))
        .await
        .map_err(|e| e.to_string())?
}

/// Um branch `mycockpit/*` do projeto e o que ele carrega.
///
/// Só o que o COCKPIT criou entra aqui: branch de fora do prefixo é do usuário
/// e não é da nossa conta listar, muito menos oferecer pra apagar.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub branch: String,
    /// Pasta do worktree, se ainda existir uma checada nesse branch. `None` =
    /// só o branch sobrou (a pasta já foi, na mão ou por remoção parcial).
    pub path: Option<String>,
    /// Commits que este branch tem e o HEAD não. `0` = recolher não perde nada,
    /// e é exatamente a condição que o `branch -d` verifica sozinho.
    pub own_commits: u32,
}

/// Enumera os branches `mycockpit/*` do projeto e o worktree de cada um.
///
/// Fonte ÚNICA do número que a faixa mostra. A faixa recusou "branch/alterações"
/// justamente por não ter dono único (dois efeitos lendo git dariam dois donos
/// pro mesmo número, ver o cabeçalho de StatusBar.tsx); este comando existe pra
/// que o dono seja um só.
/// branch -> pasta, a partir do `worktree list --porcelain`.
///
/// Separado do comando porque é a única lógica daqui que dá pra testar sem
/// repo: o resto é git falando. O porcelain vem em blocos separados por linha
/// em branco (`worktree <path>`, `HEAD <sha>`, `branch refs/heads/<nome>`), e
/// um worktree em HEAD solto não traz linha `branch` nenhuma.
fn parse_worktree_paths(porcelain: &str) -> std::collections::HashMap<String, String> {
    let mut pasta = std::collections::HashMap::new();
    let mut atual: Option<String> = None;
    for linha in porcelain.lines() {
        if let Some(p) = linha.strip_prefix("worktree ") {
            atual = Some(p.to_string());
        } else if let Some(r) = linha.strip_prefix("branch refs/heads/") {
            // `take` de propósito: o path pertence a UM bloco. Sem isso, um
            // worktree em HEAD solto herdaria o caminho do bloco anterior.
            if let Some(p) = atual.take() {
                pasta.insert(r.to_string(), p);
            }
        }
    }
    pasta
}

#[tauri::command]
pub async fn list_worktrees(project_path: String) -> Vec<WorktreeEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        let pasta = parse_worktree_paths(
            &git(&project_path, &["worktree", "list", "--porcelain"]).unwrap_or_default(),
        );
        let refs = git(
            &project_path,
            &[
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads/mycockpit/",
            ],
        )
        .unwrap_or_default();
        refs.lines()
            .map(str::trim)
            .filter(|b| !b.is_empty())
            .map(|branch| {
                let own_commits = git(
                    &project_path,
                    &["rev-list", "--count", &format!("HEAD..{branch}")],
                )
                .and_then(|s| s.trim().parse::<u32>().ok())
                .unwrap_or(0);
                WorktreeEntry {
                    branch: branch.to_string(),
                    path: pasta.get(branch).cloned(),
                    own_commits,
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Apaga um branch `mycockpit/*` que não tem worktree. Serve o caso em que a
/// pasta já foi e só o branch sobrou — aí `worktree remove` não tem o que
/// remover, mas o lixo continua no repositório.
///
/// `-d`, nunca `-D`: o git recusa branch com commit que o HEAD não tem. O front
/// não precisa confiar na própria contagem — a última palavra é do git.
#[tauri::command]
pub async fn delete_worktree_branch(project_path: String, branch: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !branch.starts_with("mycockpit/") {
            return Err("só dá pra apagar branch criado pelo cockpit".into());
        }
        run_git(&project_path, &["branch", "-d", &branch]).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Desfecho de uma remoção: o front precisa disso pra CONTAR o que aconteceu.
/// Tirar a pasta e deixar o branch em silêncio foi o vazamento real — a main
/// tree acumulava `mycockpit/*` que ninguém sabia que existia.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoval {
    /// Branch que o worktree ocupava (None = não deu pra ler, ex.: HEAD solto).
    pub branch: Option<String>,
    /// Apagado? `false` com `branch` preenchido = tinha commit que o HEAD não
    /// tem, e o git segurou (trabalho preservado, não é falha).
    pub branch_removed: bool,
}

/// Remove o worktree de uma conversa E o branch que ele ocupava.
///
/// Duas recusas do git são features aqui, não obstáculos:
/// - `worktree remove` SEM `--force`: mudança não-commitada aborta tudo e o
///   trabalho fica onde está (o Err sobe pro front dizer isso).
/// - `branch -d` (nunca `-D`): commit que o HEAD não tem segura o branch. Como
///   o fork nasce no HEAD, o caso comum (nada commitado) apaga limpo, e o caso
///   que importa (o agente commitou) nunca some por descuido.
///
/// O nome do branch é LIDO do worktree antes de remover, não reconstruído a
/// partir do caminho: adivinhar nome de branch pra apagar é o tipo de erro que
/// não tem desfazer. E só apagamos o prefixo que nós criamos.
#[tauri::command]
pub async fn remove_worktree(
    project_path: String,
    path: String,
) -> Result<WorktreeRemoval, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let branch = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "HEAD");
        run_git(&project_path, &["worktree", "remove", &path])?;
        // Depois da remoção, sempre: o git recusa apagar branch que está
        // checado num worktree vivo.
        let branch_removed = match branch.as_deref() {
            Some(b) if b.starts_with("mycockpit/") => {
                run_git(&project_path, &["branch", "-d", b]).is_ok()
            }
            _ => false,
        };
        Ok(WorktreeRemoval {
            branch,
            branch_removed,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------- Shippar: commit + PR (v2.6) ----------------

/// Stage tudo + commit no cwd (worktree da conversa ou pasta do projeto). Devolve
/// o SHA curto. Ação LOCAL (reversível via git).
#[tauri::command]
pub async fn git_commit(cwd: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if message.trim().is_empty() {
            return Err("mensagem de commit vazia".into());
        }
        run_git(&cwd, &["add", "-A"])?;
        run_git(&cwd, &["commit", "-m", &message])?;
        Ok(git(&cwd, &["rev-parse", "--short", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrResult {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrTemplate {
    pub name: String,
    pub body: String,
}

/// Tudo que o PR composer precisa DETECTAR do projeto (base, contas, template…).
/// O cockpit PROPÕE; o usuário ajusta na UI. Nada fixo.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrContext {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub base_candidates: Vec<String>,
    pub base_default: String,
    pub accounts: Vec<String>,
    pub account_current: Option<String>,
    pub templates: Vec<PrTemplate>,
    pub title_default: String,
    pub has_pr_skill: bool,
}

/// Contas gh autenticadas + a ativa (parse best-effort do `gh auth status`).
fn gh_accounts() -> (Vec<String>, Option<String>) {
    let out = match Command::new("gh").args(["auth", "status"]).output() {
        Ok(o) => o,
        Err(_) => return (vec![], None),
    };
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let mut accounts: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    let mut last: Option<String> = None;
    for line in text.lines() {
        if let Some(idx) = line.find("account ") {
            let name = line[idx + "account ".len()..]
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            if !name.is_empty() {
                if !accounts.contains(&name) {
                    accounts.push(name.clone());
                }
                last = Some(name);
            }
        }
        if line.contains("Active account: true") {
            current = last.clone();
        }
    }
    if current.is_none() {
        current = accounts.first().cloned();
    }
    (accounts, current)
}

/// Templates de PR do projeto: locais padrão + a pasta PULL_REQUEST_TEMPLATE/ +
/// (fallback) `.md` soltos no `.github/` (prime usa default.md / release.md).
fn read_tpl(name: String, path: &Path) -> Option<PrTemplate> {
    let body = fs::read_to_string(path).ok()?;
    if body.trim().is_empty() {
        None
    } else {
        Some(PrTemplate { name, body })
    }
}

fn read_templates(cwd: &str) -> Vec<PrTemplate> {
    let gh = Path::new(cwd).join(".github");
    let mut out: Vec<PrTemplate> = Vec::new();
    for f in ["PULL_REQUEST_TEMPLATE.md", "pull_request_template.md"] {
        if let Some(t) = read_tpl(f.to_string(), &gh.join(f)) {
            if !out.iter().any(|x| x.name == t.name) {
                out.push(t);
            }
        }
    }
    let dir = gh.join("PULL_REQUEST_TEMPLATE");
    if dir.is_dir() {
        if let Ok(rd) = fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().map(|x| x == "md").unwrap_or(false) {
                    let n = p
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("template")
                        .to_string();
                    if let Some(t) = read_tpl(n, &p) {
                        if !out.iter().any(|x| x.name == t.name) {
                            out.push(t);
                        }
                    }
                }
            }
        }
    }
    if out.is_empty() {
        if let Ok(rd) = fs::read_dir(&gh) {
            for e in rd.flatten() {
                let p = e.path();
                if !p.extension().map(|x| x == "md").unwrap_or(false) {
                    continue;
                }
                let n = p
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let low = n.to_lowercase();
                if low.contains("readme")
                    || low.contains("contributing")
                    || low.contains("code_of_conduct")
                    || low.contains("security")
                {
                    continue;
                }
                if let Some(t) = read_tpl(n, &p) {
                    out.push(t);
                }
            }
        }
    }
    out
}

/// Detecta o contexto de PR do cwd (worktree ou projeto). Alimenta o composer.
fn pr_context_sync(cwd: String) -> PrContext {
    let is_repo = git(&cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return PrContext {
            is_repo: false,
            branch: None,
            base_candidates: vec![],
            base_default: String::new(),
            accounts: vec![],
            account_current: None,
            templates: vec![],
            title_default: String::new(),
            has_pr_skill: false,
        };
    }
    let branch = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD");
    let mut base_candidates: Vec<String> = git(&cwd, &["branch", "--format=%(refname:short)"])
        .map(|s| {
            s.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if let Some(b) = &branch {
        base_candidates.retain(|c| c != b);
    }
    base_candidates.sort_by_key(|b| match b.as_str() {
        "develop" => 0,
        "main" => 1,
        "master" => 2,
        _ => 3,
    });
    let repo_default = git(&cwd, &["symbolic-ref", "refs/remotes/origin/HEAD"])
        .map(|s| s.trim().rsplit('/').next().unwrap_or("main").to_string())
        .unwrap_or_else(|| "main".into());
    let base_default = if base_candidates.iter().any(|b| b == "develop") {
        "develop".to_string()
    } else if base_candidates.iter().any(|b| b == &repo_default) {
        repo_default.clone()
    } else {
        base_candidates.first().cloned().unwrap_or(repo_default)
    };
    let (accounts, account_current) = gh_accounts();
    let templates = read_templates(&cwd);
    let title_default = git(&cwd, &["log", "-1", "--format=%s"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let has_pr_skill = Path::new(&cwd).join(".claude/skills/pr/SKILL.md").exists()
        || Path::new(&cwd).join(".claude/commands/pr.md").exists();
    PrContext {
        is_repo: true,
        branch,
        base_candidates,
        base_default,
        accounts,
        account_current,
        templates,
        title_default,
        has_pr_skill,
    }
}

#[tauri::command]
pub async fn pr_context(cwd: String) -> PrContext {
    tauri::async_runtime::spawn_blocking(move || pr_context_sync(cwd))
        .await
        .unwrap_or(PrContext {
            is_repo: false,
            branch: None,
            base_candidates: vec![],
            base_default: String::new(),
            accounts: vec![],
            account_current: None,
            templates: vec![],
            title_default: String::new(),
            has_pr_skill: false,
        })
}

/// Push + abre o PR com base/conta/título/corpo ESCOLHIDOS no composer. Outward
/// (a UI confirma). Troca a conta gh se pedido (o `/pr` do projeto faz igual).
fn create_pr_sync(
    cwd: String,
    base: String,
    account: String,
    title: String,
    body: String,
) -> Result<PrResult, String> {
    let branch = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
        .ok_or("não consegui detectar a branch atual")?;
    // troca de conta CHECADA: falhar em silêncio abriria o PR com a conta errada
    // (o motivo exato de existir o parâmetro, contas pessoal vs trabalho).
    if !account.trim().is_empty() {
        crate::proc::run("gh", &["auth", "switch", "--user", account.trim()], None)
            .map_err(|e| format!("não consegui trocar pra conta gh '{}': {e}", account.trim()))?;
    }
    run_git(&cwd, &["push", "-u", "origin", &branch])?;
    let base_t = base.trim();
    let mut args: Vec<&str> = vec![
        "pr", "create", "--head", &branch, "--title", &title, "--body", &body,
    ];
    if !base_t.is_empty() {
        args.push("--base");
        args.push(base_t);
    }
    // gh pr create imprime a URL do PR no stdout.
    let url = crate::proc::run("gh", &args, Some(&cwd))?
        .trim()
        .to_string();
    Ok(PrResult { url })
}

#[tauri::command]
pub async fn git_create_pr(
    cwd: String,
    base: String,
    account: String,
    title: String,
    body: String,
) -> Result<PrResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_pr_sync(cwd, base, account, title, body))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------- Pulso do worktree (R11 do docs/mocks/missao-README.md) ----
//
// O aviso de REPETIÇÃO da missão precisa de dois fatores, e nunca de um só:
// "o mesmo comando ≥ 4 vezes seguidas" (o fio já guarda) E "nenhum arquivo
// alterado no worktree desde a primeira" (ninguém media). Este comando entrega
// o segundo, e ele é deliberadamente BARATO: nada de patch, só o formato
// numérico do diff + a lista de arquivos novos com tamanho. Serve pra responder
// "mudou alguma coisa desde a última vez que eu perguntei?", que é a única
// pergunta que o R11 faz.
//
// Não é polling de fundo: quem chama só chama DEPOIS que o primeiro fator já
// disparou (ver lib/missionRepeat.ts). Read-only, e falha vira string vazia —
// sem impressão digital, o aviso NÃO aparece (fail-closed: alarme com um fator
// só é alarme falso, e o README já tinha nomeado esse risco).

/// Hash estável e curto de um blob de texto (FNV-1a 64). Não é criptográfico:
/// serve pra comparar "igual ao de 30s atrás?", nada além disso.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    h
}

/// Impressão digital do estado da working tree. String vazia = não é repo, git
/// ausente ou leitura falhou — o chamador trata como "não sei", nunca como
/// "não mudou".
fn worktree_pulse_sync(cwd: &str) -> String {
    let is_repo = git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return String::new();
    }
    // rastreados: `--numstat` muda quando o CONTEÚDO muda (o `--porcelain`
    // sozinho não: um arquivo já modificado continua " M path" na 2ª edição).
    let Some(numstat) = git(cwd, &["diff", "HEAD", "--numstat"]) else {
        return String::new();
    };
    let mut blob = numstat;
    // novos (untracked, não-ignorados): nome + tamanho, sem ler o conteúdo.
    if let Some(list) = git(cwd, &["ls-files", "--others", "--exclude-standard", "-z"]) {
        for rel in list.split('\0').filter(|s| !s.is_empty()) {
            let len = fs::metadata(Path::new(cwd).join(rel))
                .map(|m| m.len())
                .unwrap_or(0);
            blob.push_str(&format!("\n?{rel}\t{len}"));
        }
    }
    format!("{:016x}", fnv1a(&blob))
}

/// Async (spawn_blocking): dois `git` síncronos na main thread congelariam a UI,
/// mesma regra do git_diff.
#[tauri::command]
pub async fn git_worktree_pulse(cwd: String) -> String {
    tauri::async_runtime::spawn_blocking(move || worktree_pulse_sync(&cwd))
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod pulse_tests {
    use super::*;

    #[test]
    fn pulso_muda_quando_o_blob_muda_e_repete_quando_nao_muda() {
        // O contrato do R11 depende disto e de nada mais: pulso igual = nada
        // escrito desde a última pergunta.
        assert_eq!(fnv1a("a\tb\tsrc/x.ts"), fnv1a("a\tb\tsrc/x.ts"));
        assert_ne!(fnv1a("1\t0\tsrc/x.ts"), fnv1a("2\t0\tsrc/x.ts"));
    }

    #[test]
    fn fora_de_repo_o_pulso_e_vazio_em_vez_de_mentir_estabilidade() {
        // "não sei" NUNCA pode ser lido como "não mudou": string vazia é o
        // sinal de ignorância, e o TS não liga o aviso sem impressão digital.
        assert_eq!(worktree_pulse_sync("/caminho/que/nao/existe/mycockpit"), "");
    }
}

#[cfg(test)]
mod worktree_tests {
    use super::*;

    /// Formato real, copiado de `git worktree list --porcelain` no repo do
    /// próprio projeto (main + dois worktrees de ferramentas de fora).
    const PORCELAIN: &str = "\
worktree /Users/v/projetos/mycockpit
HEAD 12c802a3188cb1b0c4aeef02c9942525e5fcd5e4
branch refs/heads/main

worktree /Users/v/projetos/mycockpit/.mycockpit/worktrees/aaa11111
HEAD daa89e4d3bcbc9e7b037f2257bbe7264d59871db
branch refs/heads/mycockpit/aaa11111
";

    #[test]
    fn liga_cada_branch_a_pasta_do_proprio_bloco() {
        let m = parse_worktree_paths(PORCELAIN);
        assert_eq!(
            m.get("main").map(String::as_str),
            Some("/Users/v/projetos/mycockpit")
        );
        assert_eq!(
            m.get("mycockpit/aaa11111").map(String::as_str),
            Some("/Users/v/projetos/mycockpit/.mycockpit/worktrees/aaa11111")
        );
    }

    #[test]
    fn head_solto_nao_herda_o_caminho_do_bloco_anterior() {
        // O erro caro: sem o `take`, o worktree detached emprestaria o path do
        // bloco de cima e um worktree VIVO seria listado como solto.
        let entrada = "\
worktree /repo/wt-detached
HEAD abc123

worktree /repo/wt-com-branch
HEAD def456
branch refs/heads/mycockpit/bbb22222
";
        let m = parse_worktree_paths(entrada);
        assert_eq!(m.len(), 1);
        assert_eq!(
            m.get("mycockpit/bbb22222").map(String::as_str),
            Some("/repo/wt-com-branch")
        );
    }

    #[test]
    fn saida_vazia_nao_quebra() {
        assert!(parse_worktree_paths("").is_empty());
    }
}
