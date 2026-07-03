// Watcher do SDD: lê `.claude/plans/*/manifest.json` do projeto e devolve o JSON
// CRU + o tail do LOG.md. O parse/normalização (drift de stage, campos extras,
// tri-state) vive no TS (lib/sdd.ts), Rust só entrega os bytes, defensivo.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct SddPlanRaw {
    /// Nome da pasta = slug do plano.
    pub slug: String,
    /// manifest.json cru (None se a pasta não tem manifest, pastas operacionais).
    pub manifest: Option<String>,
    /// Últimas ~25 linhas do LOG.md (trecho cru), se existir.
    pub log_tail: Option<String>,
    /// Títulos dos passos `- [x] **...**` do LOG (timeline de atividade limpa).
    pub log_events: Vec<String>,
}

/// Extrai os títulos dos passos concluídos do LOG (`- [x] **Título**, …`).
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
    /// OPEN | MERGED | CLOSED (do gh), None se não enriqueceu.
    pub state: Option<String>,
    pub merged_by: Option<String>,
    pub merged_at: Option<String>,
    pub created_at: Option<String>,
    /// Proveniência HONESTA do dado: "gh" | "git" | "none".
    pub source: String,
}

/// "https://github.com/org/repo/pull/476" → ("org/repo", "476").
fn parse_pr_url(url: &str) -> Option<(String, String)> {
    // a URL vem do manifest (escrito por agents): só aceita GitHub de verdade.
    if !url.contains("github.com/") {
        return None;
    }
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

/// Sha hex plausível (7-40 chars). O merge_commit vem do manifest (escrito por
/// LLM): um valor arbitrário viraria argv do git (`--output=…` escreve arquivo).
fn is_sha(s: &str) -> bool {
    (7..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Autor de um commit (fallback local). No merge do GitHub, `%an` é quem clicou Merge.
fn git_author(project_path: &str, sha: &str) -> Option<String> {
    if !is_sha(sha) {
        return None;
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(project_path)
        .args(["show", "-s", "--format=%an", "--end-of-options"])
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
/// mergeou, datas precisas, autoritativo); se não tiver gh/auth, cai no git local
/// (autor do merge commit); senão, nada. `source` reporta de onde veio (honesto).
fn pr_info_sync(
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

/// Async (spawn_blocking): `gh pr view` é rede, congelava a UI na main thread.
#[tauri::command]
pub async fn pr_info(
    project_path: String,
    pr_url: Option<String>,
    merge_commit: Option<String>,
) -> PrInfo {
    tauri::async_runtime::spawn_blocking(move || pr_info_sync(project_path, pr_url, merge_commit))
        .await
        .unwrap_or(PrInfo {
            source: "none".into(),
            ..Default::default()
        })
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
/// (non-destructive, nunca sobrescreve arquivo existente). Nível 1 (mecânico); o
/// nível 2 (domínio inteligente) é um agent separado.
fn seed_sdd_sync(project_path: String) -> Result<SeedSummary, String> {
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
    // settings.json (wiring dos hooks), só se não existir (não clobberar config).
    let src_set = seeds.join("settings.json");
    let dst_set = claude.join("settings.json");
    if src_set.exists() && !dst_set.exists() {
        fs::create_dir_all(&claude).ok();
        fs::copy(&src_set, &dst_set).map_err(|e| e.to_string())?;
        copied.push("settings.json".into());
    } else if dst_set.exists() {
        skipped.push("settings.json (já existe, wiring de hooks pode precisar de merge)".into());
    }
    let _ = fs::remove_dir_all(&tmp);
    Ok(SeedSummary { copied, skipped })
}

/// Async (spawn_blocking): `git clone` do seed é rede, congelava a UI.
#[tauri::command]
pub async fn seed_sdd(project_path: String) -> Result<SeedSummary, String> {
    tauri::async_runtime::spawn_blocking(move || seed_sdd_sync(project_path))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------- Gate do PRD (v2.2) ----------------

/// O cockpit ESCREVE a aprovação do PRD no manifest (único gate humano). `approved_at`
/// vem do front (ISO) p/ evitar dep de chrono no Rust. Anexa ao LOG (best-effort).
#[tauri::command]
pub fn approve_prd(
    project_path: String,
    slug: String,
    approved_at: String,
) -> Result<(), String> {
    let dir = Path::new(&project_path)
        .join(".claude")
        .join("plans")
        .join(&slug);
    let mf = dir.join("manifest.json");
    let raw = fs::read_to_string(&mf).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if !v.get("artifacts").map(|a| a.is_object()).unwrap_or(false) {
        v["artifacts"] = serde_json::json!({});
    }
    if !v["artifacts"]
        .get("prd")
        .map(|p| p.is_object())
        .unwrap_or(false)
    {
        v["artifacts"]["prd"] = serde_json::json!({ "path": "PRD.md" });
    }
    v["artifacts"]["prd"]["approved"] = serde_json::Value::Bool(true);
    v["artifacts"]["prd"]["approved_at"] = serde_json::Value::String(approved_at);
    let pretty = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(&mf, format!("{pretty}\n")).map_err(|e| e.to_string())?;
    let log = dir.join("LOG.md");
    if let Ok(mut c) = fs::read_to_string(&log) {
        c.push_str("\n- [x] **PRD aprovado** (via cockpit)\n");
        let _ = fs::write(&log, c);
    }
    Ok(())
}

// ---------------- Stage 0 + bumps determinísticos (v2.4) ----------------
//
// O cockpit dirige etapa-a-etapa (com gate), então VIRA o orquestrador. O repo
// põe o bookkeeping do manifest na camada do agent (architect) + no `/feature`
// (jq), confiável o bastante no terminal, mas é LLM. Aqui o cockpit faz as
// operações DETERMINÍSTICAS que o `/feature` faz (Stage 0 `cp template`, bumps
// de stage), deixando só o criativo (PRD/SPEC/código) pros agents.

/// Transliteração mínima pt-BR → ASCII pro slug (histórico → historico).
fn deaccent(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        other => other,
    }
}

/// Slug estilo `/feature`: minúsculas, sem acento, só alnum+hífen, ~6 palavras.
fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in s.chars() {
        for lc in ch.to_lowercase() {
            let a = deaccent(lc);
            if a.is_ascii_alphanumeric() {
                out.push(a);
                prev_dash = false;
            } else if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        }
    }
    out.trim_matches('-')
        .split('-')
        .filter(|w| !w.is_empty())
        .take(6)
        .collect::<Vec<_>>()
        .join("-")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPlan {
    pub slug: String,
}

/// Stage 0 determinístico (espelha o `/feature`): cria `.claude/plans/{slug}/` com
/// o manifest do template (slug/title/branch/created_at) + LOG. NÃO chama agent,
/// o conteúdo (PRD) vem depois, quando você roda `/prd`.
#[tauri::command]
pub fn create_plan(
    project_path: String,
    description: String,
    created_at: String,
) -> Result<CreatedPlan, String> {
    let desc = description.trim();
    if desc.is_empty() {
        return Err("descrição vazia".into());
    }
    let slug = slugify(desc);
    if slug.is_empty() {
        return Err("não consegui derivar um slug da descrição".into());
    }
    let plans = Path::new(&project_path).join(".claude").join("plans");
    let dir = plans.join(&slug);
    if dir.join("manifest.json").exists() {
        return Err(format!("já existe um plano '{slug}'"));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let title: String = desc.lines().next().unwrap_or(desc).chars().take(80).collect();
    let branch = format!("feature/{slug}");

    // manifest do template (fallback p/ um mínimo se o template sumir do repo).
    let mut m: serde_json::Value = fs::read_to_string(plans.join("_manifest.template.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "stage": "discovery",
                "stages_completed": [],
                "artifacts": {
                    "prd": { "path": "PRD.md", "approved": false, "approved_at": null },
                    "spec": { "path": "SPEC.md", "approved_at": null },
                    "migrations": [], "source_files": [], "tests": []
                },
                "promised_in_spec": {
                    "scenario_matrix": [], "navigation_surfaces": [], "consistency_anchors": []
                },
                "verification": {},
                "links": { "pr_url": null, "issue_url": null }
            })
        });
    m["slug"] = serde_json::Value::String(slug.clone());
    m["title"] = serde_json::Value::String(title);
    m["branch"] = serde_json::Value::String(branch.clone());
    m["created_at"] = serde_json::Value::String(created_at.clone());
    // limpa o sponsor placeholder do template ("<sponsor name>"), vira null.
    if m.get("sponsor")
        .and_then(|v| v.as_str())
        .map(|s| s.starts_with('<'))
        .unwrap_or(false)
    {
        m["sponsor"] = serde_json::Value::Null;
    }
    let pretty = serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?;
    fs::write(dir.join("manifest.json"), format!("{pretty}\n")).map_err(|e| e.to_string())?;

    // LOG espelhando o Stage 0 do `/feature`.
    let log = format!(
        "# Log: {slug}\n> Feature: {desc}\n> Started: {created_at}\n> Branch: {branch}\n> Manifest: .claude/plans/{slug}/manifest.json\n\n## Stages\n\n- [x] **Stage 0: Plano criado** (via cockpit)\n"
    );
    let _ = fs::write(dir.join("LOG.md"), log);
    Ok(CreatedPlan { slug })
}

/// Ordem canônica das stages (espelha SDD_STAGES no TS), guard de "só avança".
const STAGE_ORDER: [&str; 8] = [
    "discovery",
    "prd",
    "spec",
    "implementation",
    "test",
    "review",
    "pr",
    "done",
];
fn stage_idx(s: &str) -> i32 {
    STAGE_ORDER
        .iter()
        .position(|&x| x == s)
        .map(|i| i as i32)
        .unwrap_or(-1)
}

/// O cockpit AFIRMA o stage após dirigir uma etapa. Só AVANÇA (nunca regride, se
/// o architect já moveu além, respeita) e preserva os demais campos (read-modify-write).
#[tauri::command]
pub fn set_plan_stage(project_path: String, slug: String, stage: String) -> Result<(), String> {
    let dir = Path::new(&project_path)
        .join(".claude")
        .join("plans")
        .join(&slug);
    let mf = dir.join("manifest.json");
    let raw = fs::read_to_string(&mf).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let cur = v
        .get("stage")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if stage_idx(&stage) <= stage_idx(&cur) {
        return Ok(()); // não regride / já está lá
    }
    if !cur.is_empty() && cur != stage {
        match v.get_mut("stages_completed").and_then(|x| x.as_array_mut()) {
            Some(a) => {
                if !a.iter().any(|x| x.as_str() == Some(cur.as_str())) {
                    a.push(serde_json::Value::String(cur.clone()));
                }
            }
            None => v["stages_completed"] = serde_json::json!([cur.clone()]),
        }
    }
    v["stage"] = serde_json::Value::String(stage.clone());
    let pretty = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(&mf, format!("{pretty}\n")).map_err(|e| e.to_string())?;
    let log = dir.join("LOG.md");
    if let Ok(mut c) = fs::read_to_string(&log) {
        c.push_str(&format!("- [x] **Etapa {stage}** dirigida (via cockpit)\n"));
        let _ = fs::write(&log, c);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha_guard() {
        assert!(is_sha("be8acf85"));
        assert!(is_sha("0123456789abcdef0123456789abcdef01234567"));
        assert!(!is_sha("--output=/tmp/x")); // manifest malicioso não vira argv
        assert!(!is_sha("abc")); // curto demais
        assert!(!is_sha("gg8acf85")); // não-hex
    }

    #[test]
    fn slugify_pt_br() {
        assert_eq!(
            slugify("Histórico de transporte no pedido"),
            "historico-de-transporte-no-pedido"
        );
        // limita a 6 palavras
        assert_eq!(
            slugify("Lembrete de jejum X horas antes do treino"),
            "lembrete-de-jejum-x-horas-antes"
        );
        // pontuação/espaços viram um único hífen + trim
        assert_eq!(slugify("  já!!  foi  "), "ja-foi");
    }

    #[test]
    fn create_plan_then_advance_no_regress() {
        let tmp = std::env::temp_dir().join(format!("mycockpit-sdd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let plans = tmp.join(".claude").join("plans");
        fs::create_dir_all(&plans).unwrap();
        fs::write(
            plans.join("_manifest.template.json"),
            r#"{"slug":"X","title":"X","sponsor":"<sponsor name>","branch":"feature/X","created_at":"x","stage":"discovery","stages_completed":[],"artifacts":{"prd":{"path":"PRD.md","approved":false,"approved_at":null}},"verification":{},"links":{"pr_url":null}}"#,
        )
        .unwrap();
        let pp = tmp.to_string_lossy().to_string();

        // Stage 0, cria o plano do template, preenche e limpa o placeholder.
        let r = create_plan(pp.clone(), "Recurso de teste".into(), "2026-06-30T00:00:00Z".into())
            .unwrap();
        assert_eq!(r.slug, "recurso-de-teste");
        let mf = plans.join(&r.slug).join("manifest.json");
        let m: serde_json::Value = serde_json::from_str(&fs::read_to_string(&mf).unwrap()).unwrap();
        assert_eq!(m["slug"], "recurso-de-teste");
        assert_eq!(m["stage"], "discovery");
        assert_eq!(m["branch"], "feature/recurso-de-teste");
        assert_eq!(m["created_at"], "2026-06-30T00:00:00Z");
        assert!(m["sponsor"].is_null(), "placeholder do sponsor deve virar null");

        // bump discovery → prd (completa stages_completed).
        set_plan_stage(pp.clone(), r.slug.clone(), "prd".into()).unwrap();
        let m: serde_json::Value = serde_json::from_str(&fs::read_to_string(&mf).unwrap()).unwrap();
        assert_eq!(m["stage"], "prd");
        assert_eq!(m["stages_completed"], serde_json::json!(["discovery"]));

        // guard: NÃO regride (tentar voltar pra discovery não muda nada).
        set_plan_stage(pp.clone(), r.slug.clone(), "discovery".into()).unwrap();
        let m: serde_json::Value = serde_json::from_str(&fs::read_to_string(&mf).unwrap()).unwrap();
        assert_eq!(m["stage"], "prd");

        // não clobbera: criar o mesmo de novo falha.
        assert!(create_plan(pp, "Recurso de teste".into(), "x".into()).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
