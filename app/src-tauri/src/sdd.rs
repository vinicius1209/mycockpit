// Watcher do SDD: lê `.claude/plans/*/manifest.json` do projeto e devolve o JSON
// CRU + o tail do LOG.md. O parse/normalização (drift de stage, campos extras,
// tri-state) vive no TS (lib/sdd.ts) — Rust só entrega os bytes, defensivo.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct SddPlanRaw {
    /// Nome da pasta = slug do plano.
    pub slug: String,
    /// manifest.json cru (None se a pasta não tem manifest — pastas operacionais).
    pub manifest: Option<String>,
    /// Últimas ~25 linhas do LOG.md (feed de atividade), se existir.
    pub log_tail: Option<String>,
}

/// Enumera os planos SDD de um projeto. Nunca falha por plano individual ruim:
/// pasta sem manifest entra com `manifest: None` (o TS decide o que mostrar).
#[tauri::command]
pub fn read_sdd_plans(project_path: String) -> Result<Vec<SddPlanRaw>, String> {
    let plans_dir = Path::new(&project_path).join(".claude").join("plans");
    if !plans_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&plans_dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        let manifest = fs::read_to_string(path.join("manifest.json")).ok();
        let log_tail = fs::read_to_string(path.join("LOG.md")).ok().map(|s| {
            let lines: Vec<&str> = s.lines().collect();
            let start = lines.len().saturating_sub(25);
            lines[start..].join("\n")
        });
        out.push(SddPlanRaw {
            slug,
            manifest,
            log_tail,
        });
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    /// OPEN | MERGED | CLOSED (do gh) — None se não enriqueceu.
    pub state: Option<String>,
    pub merged_by: Option<String>,
    pub merged_at: Option<String>,
    pub created_at: Option<String>,
    /// Proveniência HONESTA do dado: "gh" | "git" | "none".
    pub source: String,
}

/// "https://github.com/org/repo/pull/476" → ("org/repo", "476").
fn parse_pr_url(url: &str) -> Option<(String, String)> {
    let (prefix, rest) = url.split_once("/pull/")?;
    let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if num.is_empty() {
        return None;
    }
    let repo = prefix.rsplit("github.com/").next()?.trim_matches('/').to_string();
    if repo.matches('/').count() != 1 || repo.is_empty() {
        return None;
    }
    Some((repo, num))
}

/// Dado autoritativo via gh (None se gh ausente / sem auth / PR não encontrado).
fn gh_pr_view(repo: &str, num: &str) -> Option<PrInfo> {
    let out = std::process::Command::new("gh")
        .args([
            "pr",
            "view",
            num,
            "--repo",
            repo,
            "--json",
            "state,mergedBy,mergedAt,createdAt",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let s = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    Some(PrInfo {
        state: s("state"),
        merged_by: v
            .get("mergedBy")
            .and_then(|x| x.get("login"))
            .and_then(|x| x.as_str())
            .map(String::from),
        merged_at: s("mergedAt"),
        created_at: s("createdAt"),
        source: "gh".into(),
    })
}

/// Autor de um commit (fallback local). No merge do GitHub, `%an` é quem clicou Merge.
fn git_author(project_path: &str, sha: &str) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(project_path)
        .args(["show", "-s", "--format=%an"])
        .arg(sha)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let a = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if a.is_empty() {
        None
    } else {
        Some(a)
    }
}

/// Enriquece a info do PR de forma INTELIGENTE + graciosa: tenta `gh` (estado, quem
/// mergeou, datas precisas — autoritativo); se não tiver gh/auth, cai no git local
/// (autor do merge commit); senão, nada. `source` reporta de onde veio (honesto).
#[tauri::command]
pub fn pr_info(
    project_path: String,
    pr_url: Option<String>,
    merge_commit: Option<String>,
) -> PrInfo {
    if let Some(url) = &pr_url {
        if let Some((repo, num)) = parse_pr_url(url) {
            if let Some(info) = gh_pr_view(&repo, &num) {
                return info;
            }
        }
    }
    if let Some(sha) = &merge_commit {
        if let Some(author) = git_author(&project_path, sha) {
            return PrInfo {
                state: Some("MERGED".into()),
                merged_by: Some(author),
                source: "git".into(),
                ..Default::default()
            };
        }
    }
    PrInfo {
        source: "none".into(),
        ..Default::default()
    }
}
