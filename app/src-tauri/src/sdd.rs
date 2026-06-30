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
    /// Últimas ~25 linhas do LOG.md (trecho cru), se existir.
    pub log_tail: Option<String>,
    /// Títulos dos passos `- [x] **...**` do LOG (timeline de atividade limpa).
    pub log_events: Vec<String>,
}

/// Extrai os títulos dos passos concluídos do LOG (`- [x] **Título** — …`).
fn extract_events(log: &str) -> Vec<String> {
    log.lines()
        .filter_map(|line| {
            let t = line.trim_start();
            if !t.starts_with("- [x]") {
                return None;
            }
            let rest = t.trim_start_matches("- [x]").trim();
            // título em negrito **...**, senão o texto antes do travessão.
            if let Some(after) = rest.strip_prefix("**").and_then(|r| r.split("**").next())
            {
                Some(after.trim().to_string())
            } else {
                let s = rest.split('—').next().unwrap_or(rest).trim();
                (!s.is_empty()).then(|| s.chars().take(70).collect())
            }
        })
        .collect()
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
        let log = fs::read_to_string(path.join("LOG.md")).ok();
        let log_events = log.as_deref().map(extract_events).unwrap_or_default();
        let log_tail = log.map(|s| {
            let lines: Vec<&str> = s.lines().collect();
            let start = lines.len().saturating_sub(25);
            lines[start..].join("\n")
        });
        out.push(SddPlanRaw {
            slug,
            manifest,
            log_tail,
            log_events,
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

// ---------------- Seed / Bootstrap SDD (v2.0) ----------------

/// Repo de seeds do fluxo SDD (pipeline skills, agents, hooks, schema, template).
/// Pessoal-primeiro: default no repo do usuário; trocável depois por config.
const SEED_REPO: &str = "https://github.com/vinicius1209/skills";

#[derive(Serialize)]
pub struct SeedSummary {
    pub copied: Vec<String>,
    pub skipped: Vec<String>,
}

/// O projeto já tem o fluxo SDD instalado? (architect stages presentes.)
#[tauri::command]
pub fn sdd_ready(project_path: String) -> bool {
    let skills = Path::new(&project_path).join(".claude").join("skills");
    skills.join("prd").join("SKILL.md").exists()
        || skills.join("spec").join("SKILL.md").exists()
}

/// Copia uma árvore NON-DESTRUCTIVE (pula o que já existe), coletando rel paths.
fn copy_tree(
    src: &Path,
    dst: &Path,
    base: &Path,
    copied: &mut Vec<String>,
    skipped: &mut Vec<String>,
) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let s = entry.path();
        let d = dst.join(entry.file_name());
        if s.is_dir() {
            copy_tree(&s, &d, base, copied, skipped)?;
            continue;
        }
        let rel = d.strip_prefix(base).unwrap_or(&d).to_string_lossy().to_string();
        if d.exists() {
            skipped.push(rel);
            continue;
        }
        fs::copy(&s, &d).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if d.extension().map(|e| e == "sh").unwrap_or(false) {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&d, fs::Permissions::from_mode(0o755));
        }
        copied.push(rel);
    }
    Ok(())
}

/// Instala o scaffold do fluxo SDD: clona o seed e copia pro `.claude/` do projeto
/// (non-destructive — nunca sobrescreve arquivo existente). Nível 1 (mecânico); o
/// nível 2 (domínio inteligente) é um agent separado.
#[tauri::command]
pub fn seed_sdd(project_path: String) -> Result<SeedSummary, String> {
    let tmp = std::env::temp_dir().join("mycockpit-sdd-seed");
    let _ = fs::remove_dir_all(&tmp);
    let out = std::process::Command::new("git")
        .args(["clone", "--depth", "1", "--quiet", SEED_REPO])
        .arg(&tmp)
        .output()
        .map_err(|e| format!("git não encontrado: {e}"))?;
    if !out.status.success() {
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!(
            "clone do seed falhou: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let seeds = tmp.join("seeds");
    if !seeds.is_dir() {
        let _ = fs::remove_dir_all(&tmp);
        return Err("o repo de seed não tem a pasta seeds/".into());
    }
    let claude = Path::new(&project_path).join(".claude");
    let mut copied = Vec::new();
    let mut skipped = Vec::new();
    for sub in ["skills", "agents", "hooks", "references", "schemas", "plans"] {
        copy_tree(&seeds.join(sub), &claude.join(sub), &claude, &mut copied, &mut skipped)?;
    }
    // settings.json (wiring dos hooks) — só se não existir (não clobberar config).
    let src_set = seeds.join("settings.json");
    let dst_set = claude.join("settings.json");
    if src_set.exists() && !dst_set.exists() {
        fs::create_dir_all(&claude).ok();
        fs::copy(&src_set, &dst_set).map_err(|e| e.to_string())?;
        copied.push("settings.json".into());
    } else if dst_set.exists() {
        skipped.push("settings.json (já existe — wiring de hooks pode precisar de merge)".into());
    }
    let _ = fs::remove_dir_all(&tmp);
    Ok(SeedSummary { copied, skipped })
}
