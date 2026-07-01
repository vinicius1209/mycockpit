// Diff da working tree (v1: não-commitado vs HEAD + arquivos novos). Espelha o
// modelo do code_review do Warp (files → hunks → lines), mas o parse do unified
// diff vive no TS (lib/git.ts); aqui o Rust só roda o git e entrega o patch cru.

use serde::Serialize;
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
