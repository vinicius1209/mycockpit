//! M2 — leitura do contexto do projeto (lê do disco).

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct ContextFile {
    pub name: String,
    pub exists: bool,
    pub content: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectContext {
    pub files: Vec<ContextFile>,
    pub has_claude_dir: bool,
}

#[tauri::command]
pub fn read_project_context(path: String) -> ProjectContext {
    let base = Path::new(&path);
    let read = |name: &str| {
        let p = base.join(name);
        match std::fs::read_to_string(&p) {
            Ok(c) => ContextFile {
                name: name.to_string(),
                exists: true,
                content: Some(truncate(&c, 8000)),
            },
            Err(_) => ContextFile {
                name: name.to_string(),
                exists: false,
                content: None,
            },
        }
    };

    ProjectContext {
        files: vec![read("CLAUDE.md"), read("AGENTS.md")],
        has_claude_dir: base.join(".claude").is_dir(),
    }
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
