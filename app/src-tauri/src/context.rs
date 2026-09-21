//! M2, leitura do contexto do projeto (lê do disco).
//! Fase 0: inventário HONESTO do que o `claude` enxerga no cwd, arquivos de
//! instrução (com tamanho), o .claude/ enumerado por categoria, e .mcp.json.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct ContextFile {
    pub name: String,
    pub exists: bool,
    pub content: Option<String>,
    /// Tamanho do arquivo em bytes (0 se ausente), vira o chip de metadado.
    pub bytes: u64,
}

/// Conteúdo enumerado do .claude/, contagens por categoria.
#[derive(Serialize)]
pub struct ClaudeDir {
    pub exists: bool,
    pub agents: usize,
    pub commands: usize,
    pub skills: usize,
    pub plans: usize,
    pub hooks: usize,
    pub settings: bool,
}

#[derive(Serialize)]
pub struct ProjectContext {
    pub files: Vec<ContextFile>,
    pub claude_dir: ClaudeDir,
    /// Nº de comandos "/" da CASA (.frota/commands/*.md) — onde a skill
    /// promovida (write_skill) mora desde a virada agnóstica.
    pub mycockpit_commands: usize,
    /// Nº de servidores MCP em .mcp.json (None = arquivo ausente).
    pub mcp_servers: Option<usize>,
}

/// Conta arquivos .md recursivamente (agents/, commands/ podem ser aninhados).
fn count_md(p: &Path) -> usize {
    let mut n = 0;
    if let Ok(rd) = std::fs::read_dir(p) {
        for e in rd.filter_map(|e| e.ok()) {
            let path = e.path();
            if path.is_dir() {
                n += count_md(&path);
            } else if path.extension().is_some_and(|x| x == "md") {
                n += 1;
            }
        }
    }
    n
}

/// Conta subdiretórios diretos (skills/, plans/ = uma pasta por item).
fn count_dirs(p: &Path) -> usize {
    std::fs::read_dir(p)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .count()
        })
        .unwrap_or(0)
}

/// Conta entradas diretas (hooks/).
fn count_entries(p: &Path) -> usize {
    std::fs::read_dir(p)
        .map(|rd| rd.filter_map(|e| e.ok()).count())
        .unwrap_or(0)
}

fn read_project_context_sync(path: &str) -> ProjectContext {
    let base = Path::new(&path);
    let read = |name: &str| {
        let p = base.join(name);
        match std::fs::read_to_string(&p) {
            Ok(c) => ContextFile {
                name: name.to_string(),
                exists: true,
                bytes: c.len() as u64,
                content: Some(truncate(&c, 8000)),
            },
            Err(_) => ContextFile {
                name: name.to_string(),
                exists: false,
                content: None,
                bytes: 0,
            },
        }
    };

    let cd = base.join(".claude");
    let claude_dir = ClaudeDir {
        exists: cd.is_dir(),
        agents: count_md(&cd.join("agents")),
        commands: count_md(&cd.join("commands")),
        skills: count_dirs(&cd.join("skills")),
        plans: count_dirs(&cd.join("plans")),
        hooks: count_entries(&cd.join("hooks")),
        settings: cd.join("settings.json").is_file(),
    };

    let mcp_servers = std::fs::read_to_string(base.join(".mcp.json"))
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|v| {
            v.get("mcpServers")
                .and_then(|m| m.as_object())
                .map(|o| o.len())
        });

    ProjectContext {
        files: vec![read("CLAUDE.md"), read("AGENTS.md")],
        claude_dir,
        mycockpit_commands: count_md(&crate::frota_dir::pasta_da_frota(base).join("commands")),
        mcp_servers,
    }
}

#[tauri::command]
pub async fn read_project_context(path: String) -> Result<ProjectContext, String> {
    tauri::async_runtime::spawn_blocking(move || read_project_context_sync(&path))
        .await
        .map_err(|error| error.to_string())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push_str("\n…");
        out
    }
}
