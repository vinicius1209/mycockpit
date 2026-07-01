// Diff da working tree (v1: não-commitado vs HEAD + arquivos novos). Espelha o
// modelo do code_review do Warp (files → hunks → lines), mas o parse do unified
// diff vive no TS (lib/git.ts); aqui o Rust só roda o git e entrega o patch cru.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

/// git -C <cwd> <args>, stdout no sucesso (None se falhar/git ausente).
fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `git diff --no-index` sai com código 1 quando HÁ diferença (esperado) — então
/// aceita a saída independente do status; None só se vazia.
fn git_allow_fail(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).into_owned();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
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
/// `git diff HEAD`; arquivos novos (untracked) viram diff sintético via `--no-index`.
#[tauri::command]
pub fn git_diff(cwd: String) -> GitDiff {
    let is_repo = git(&cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return GitDiff {
            is_repo: false,
            branch: None,
            patch: String::new(),
        };
    }
    let branch = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    // rastreados (modificados + deletados) vs HEAD.
    let mut patch = git(&cwd, &["diff", "HEAD", "--no-color"]).unwrap_or_default();
    // novos (untracked, não-ignorados): diff sintético contra /dev/null.
    if let Some(list) = git(&cwd, &["ls-files", "--others", "--exclude-standard"]) {
        for f in list.lines().filter(|l| !l.is_empty()) {
            if let Some(d) =
                git_allow_fail(&cwd, &["diff", "--no-index", "--no-color", "--", "/dev/null", f])
            {
                patch.push_str(&d);
            }
        }
    }
    GitDiff {
        is_repo: true,
        branch,
        patch,
    }
}

// ---------------- Worktree isolado por conversa (v2.5) ----------------
//
// O cockpit dirige, então CRIA o worktree determinístico (não delega pro agent).
// Cada conversa isolada roda num `git worktree` próprio sob `.mycockpit/worktrees/`
// (gitignored → não suja a main tree), num branch `mycockpit/<slug>`.

/// git -C <cwd> <args> com a MENSAGEM de erro (stderr) no Err (p/ o front mostrar).
fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("git não encontrado: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
}

/// Cria (ou reusa) um worktree isolado pra uma conversa. Branch a partir do HEAD.
#[tauri::command]
pub fn create_worktree(project_path: String, conv_id: String) -> Result<WorktreeInfo, String> {
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
    let slug = if slug.is_empty() { "conv".to_string() } else { slug };
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
        return Ok(WorktreeInfo { path: path_str, branch }); // reusa (re-toggle)
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
    Ok(WorktreeInfo { path: path_str, branch })
}

/// Remove o worktree de uma conversa. SEM --force: se houver mudança não-commitada,
/// o git recusa e a gente preserva o trabalho (o branch continua no repo).
#[tauri::command]
pub fn remove_worktree(project_path: String, path: String) -> Result<(), String> {
    run_git(&project_path, &["worktree", "remove", &path]).map(|_| ())
}
