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
    pub path: String,
}

#[derive(Serialize)]
pub struct Spec {
    pub slug: String,
    pub stage: Option<String>,
    pub title: Option<String>,
    pub path: String,
}

#[derive(Serialize)]
pub struct MemoryInfo {
    pub exists: bool,
    pub count: usize,
    /// Caminho do MEMORY.md (índice) p/ o detalhe. None se ausente.
    pub path: Option<String>,
}

/// Aviso de drift: uma cópia legada está mais velha que a fonte real.
#[derive(Serialize)]
pub struct Drift {
    pub copy: String,
    pub source: String,
    pub days_stale: i64,
}

#[derive(Serialize)]
pub struct ProjectSources {
    pub personas: Vec<Persona>,
    pub specs: Vec<Spec>,
    pub memory: MemoryInfo,
    pub drift: Vec<Drift>,
}

/// Lê um campo do frontmatter YAML. Entende valor inline (`key: foo`) E block
/// scalar (`key: |` / `>`), devolvendo o 1º parágrafo do bloco. Parser mínimo
/// (sem dep de YAML) — suficiente p/ name/description/model dos agents.
fn frontmatter(text: &str, key: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.first()?.trim() != "---" {
        return None;
    }
    let prefix = format!("{key}:");
    let mut i = 1;
    while i < lines.len() {
        let line = lines[i];
        if line.trim() == "---" {
            return None;
        }
        if let Some(rest) = line.trim_start().strip_prefix(&prefix) {
            let v = rest.trim();
            // valor inline
            if !v.is_empty() && v != "|" && v != ">" && v != "|-" && v != ">-" {
                return Some(v.trim_matches('"').trim_matches('\'').to_string());
            }
            // block scalar → junta só o 1º parágrafo das linhas indentadas
            let mut para: Vec<String> = Vec::new();
            i += 1;
            while i < lines.len() {
                let bl = lines[i];
                if bl.trim() == "---" {
                    break;
                }
                if bl.trim().is_empty() {
                    if !para.is_empty() {
                        break;
                    }
                    i += 1;
                    continue;
                }
                if !bl.starts_with(' ') && !bl.starts_with('\t') {
                    break; // próxima chave não-indentada
                }
                para.push(bl.trim().to_string());
                i += 1;
            }
            return (!para.is_empty()).then(|| para.join(" "));
        }
        i += 1;
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
                    path: p.to_string_lossy().to_string(),
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
            // detalhe: prefere SPEC.md → PRD.md → manifest.json
            let detail = ["SPEC.md", "PRD.md", "manifest.json"]
                .iter()
                .map(|f| dir.join(f))
                .find(|p| p.is_file())
                .unwrap_or_else(|| manifest.clone());
            out.push(Spec {
                slug,
                stage,
                title,
                path: detail.to_string_lossy().to_string(),
            });
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
    let index = dir.join("MEMORY.md");
    MemoryInfo {
        exists,
        count,
        path: index
            .is_file()
            .then(|| index.to_string_lossy().to_string()),
    }
}

/// Pares conhecidos cópia-legada → fonte. Sinaliza se a cópia ficou pra trás.
fn read_drift(base: &Path) -> Vec<Drift> {
    let mut out = Vec::new();
    let pairs = [(".cockpit/profile.md", "AGENTS.md")];
    for (copy_rel, src_rel) in pairs {
        let (Ok(cm), Ok(sm)) = (
            std::fs::metadata(base.join(copy_rel)),
            std::fs::metadata(base.join(src_rel)),
        ) else {
            continue;
        };
        let (Ok(ct), Ok(st)) = (cm.modified(), sm.modified()) else {
            continue;
        };
        if let Ok(d) = st.duration_since(ct) {
            out.push(Drift {
                copy: copy_rel.to_string(),
                source: src_rel.to_string(),
                days_stale: (d.as_secs() / 86400) as i64,
            });
        }
    }
    out
}

#[tauri::command]
pub fn read_project_sources(path: String) -> ProjectSources {
    let base = Path::new(&path);
    let cd = base.join(".claude");
    ProjectSources {
        personas: read_personas(&cd),
        specs: read_specs(&cd),
        memory: read_memory(&path),
        drift: read_drift(base),
    }
}

/// Lê um arquivo de texto (p/ o detalhe de persona/spec/memória). Trunca p/ a UI.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let c = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(if c.chars().count() > 24000 {
        let mut out: String = c.chars().take(24000).collect();
        out.push_str("\n…");
        out
    } else {
        c
    })
}

/// Opção invocável por "/" — comando (.claude/commands) OU skill (.claude/skills).
#[derive(Serialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
    pub kind: String, // "command" | "skill"
}

fn collect_commands(dir: &Path, prefix: &str, out: &mut Vec<SlashCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_dir() {
            let ns = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let next = if prefix.is_empty() {
                ns.to_string()
            } else {
                format!("{prefix}:{ns}")
            };
            collect_commands(&p, &next, out);
        } else if p.extension().is_some_and(|x| x == "md") {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let name = if prefix.is_empty() {
                stem.to_string()
            } else {
                format!("{prefix}:{stem}")
            };
            let description = std::fs::read_to_string(&p)
                .ok()
                .and_then(|t| frontmatter(&t, "description"));
            out.push(SlashCommand {
                name,
                description,
                kind: "command".to_string(),
            });
        }
    }
}

/// Skills do projeto (.claude/skills/<name>/SKILL.md) — invocáveis por /<name>.
fn collect_skills(dir: &Path, out: &mut Vec<SlashCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let description = std::fs::read_to_string(p.join("SKILL.md"))
            .ok()
            .and_then(|t| frontmatter(&t, "description"));
        out.push(SlashCommand {
            name: name.to_string(),
            description,
            kind: "skill".to_string(),
        });
    }
}

#[tauri::command]
pub fn read_project_commands(path: String) -> Vec<SlashCommand> {
    let cd = Path::new(&path).join(".claude");
    let mut out = Vec::new();
    collect_commands(&cd.join("commands"), "", &mut out);
    collect_skills(&cd.join("skills"), &mut out);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
