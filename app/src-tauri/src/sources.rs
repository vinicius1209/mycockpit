//! Fase 2 — "source resolver": indexa as fontes REAIS do projeto (NÃO copia).
//! Personas ← .claude/agents · Specs ← .claude/plans/{slug}/manifest.json ·
//! Memórias ← dir path-encoded do Claude CLI. Sempre lê do disco; zero store paralelo.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Persona {
    pub name: String,
    pub description: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize)]
pub struct Spec {
    pub slug: String,
    pub stage: Option<String>,
    pub title: Option<String>,
}

#[derive(Serialize)]
pub struct MemoryInfo {
    pub exists: bool,
    pub count: usize,
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectSources {
    pub personas: Vec<Persona>,
    pub specs: Vec<Spec>,
    pub memory: MemoryInfo,
}

/// Lê um campo do frontmatter YAML (bloco entre as 2 primeiras linhas `---`).
/// Parser mínimo `key: value` — evita dep de YAML; tolera aspas.
fn frontmatter(text: &str, key: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let prefix = format!("{key}:");
    for line in lines {
        let t = line.trim();
        if t == "---" {
            break;
        }
        if let Some(rest) = t.strip_prefix(&prefix) {
            let v = rest.trim().trim_matches('"').trim_matches('\'').trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn read_personas(claude_dir: &Path) -> Vec<Persona> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(claude_dir.join("agents")) {
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if !p.extension().is_some_and(|x| x == "md") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&p) {
                let stem = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                out.push(Persona {
                    name: frontmatter(&text, "name").unwrap_or(stem),
                    description: frontmatter(&text, "description"),
                    model: frontmatter(&text, "model"),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn read_specs(claude_dir: &Path) -> Vec<Spec> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(claude_dir.join("plans")) {
        for e in rd.filter_map(|e| e.ok()) {
            let dir = e.path();
            let manifest = dir.join("manifest.json");
            if !dir.is_dir() || !manifest.is_file() {
                continue;
            }
            let slug = dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let (stage, title) = std::fs::read_to_string(&manifest)
                .ok()
                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                .map(|v| {
                    let get = |k: &str| {
                        v.get(k).and_then(|x| x.as_str()).map(str::to_string)
                    };
                    (
                        get("stage"),
                        get("title").or_else(|| get("name")).or_else(|| get("description")),
                    )
                })
                .unwrap_or((None, None));
            out.push(Spec { slug, stage, title });
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Dir de memória per-projeto do Claude CLI: ~/.claude/projects/<path-encoded>/memory
/// onde <path-encoded> = caminho absoluto com `/` → `-`.
fn read_memory(project_path: &str) -> MemoryInfo {
    let Ok(home) = std::env::var("HOME") else {
        return MemoryInfo {
            exists: false,
            count: 0,
            path: None,
        };
    };
    let encoded = project_path.replace('/', "-");
    let dir = Path::new(&home)
        .join(".claude")
        .join("projects")
        .join(&encoded)
        .join("memory");
    let exists = dir.is_dir();
    let count = if exists {
        std::fs::read_dir(&dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path().extension().is_some_and(|x| x == "md")
                            && e.file_name() != "MEMORY.md"
                    })
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };
    MemoryInfo {
        exists,
        count,
        path: exists.then(|| dir.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn read_project_sources(path: String) -> ProjectSources {
    let cd = Path::new(&path).join(".claude");
    ProjectSources {
        personas: read_personas(&cd),
        specs: read_specs(&cd),
        memory: read_memory(&path),
    }
}
