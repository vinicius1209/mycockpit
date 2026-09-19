//! Fase 2, "source resolver": indexa as fontes REAIS do projeto (NÃO copia).
//! Personas ← .claude/agents · Memórias ← dir path-encoded do Claude CLI. Sempre lê do disco; zero store paralelo.

use serde::Serialize;
use std::io::Read;
use std::path::Path;
use tauri::Manager;

const MAX_TEXT_BYTES: u64 = 400_000;
const MAX_TEXT_CHARS: usize = 100_000;
const MAX_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
pub struct Persona {
    pub name: String,
    pub description: Option<String>,
    pub model: Option<String>,
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
    pub memory: MemoryInfo,
    pub drift: Vec<Drift>,
}

/// Lê um campo do frontmatter YAML. Entende valor inline (`key: foo`) E block
/// scalar (`key: |` / `>`), devolvendo o 1º parágrafo do bloco. Parser mínimo
/// (sem dep de YAML), suficiente p/ name/description/model dos agents.
pub(crate) fn frontmatter(text: &str, key: &str) -> Option<String> {
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
            if p.extension().is_none_or(|x| x != "md") {
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
    out.sort_by_key(|p| p.name.to_lowercase());
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
        path: index.is_file().then(|| index.to_string_lossy().to_string()),
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

fn read_project_sources_sync(path: &str) -> ProjectSources {
    let base = Path::new(path);
    let cd = base.join(".claude");
    ProjectSources {
        personas: read_personas(&cd),
        memory: read_memory(path),
        drift: read_drift(base),
    }
}

#[tauri::command]
pub async fn read_project_sources(path: String) -> Result<ProjectSources, String> {
    tauri::async_runtime::spawn_blocking(move || read_project_sources_sync(&path))
        .await
        .map_err(|error| error.to_string())
}

/// Lê um arquivo de texto (p/ o detalhe de persona/memória e visualizador de markdown). Trunca p/ a UI.
/// ESCOPADO: só dentro da raiz dada (o projeto), extra_dirs autorizados, ~/.claude, artefatos do brain
/// ou anexos do app. Markdown renderizado na UI nunca deve virar primitiva de
/// leitura arbitrária do disco (~/.ssh, /etc etc).
#[tauri::command]
pub fn read_text_file(app: tauri::AppHandle, root: String, path: String) -> Result<String, String> {
    let attachments = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("attachments"));
    read_text_file_scoped(&root, &path, attachments.as_deref())
}

fn read_text_file_scoped(
    root: &str,
    path: &str,
    attachments: Option<&Path>,
) -> Result<String, String> {
    let canon = scoped_file_path(root, path, attachments)?;
    let mut bytes = Vec::new();
    std::fs::File::open(&canon)
        .map_err(|e| e.to_string())?
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;

    let truncated_by_bytes = bytes.len() as u64 > MAX_TEXT_BYTES;
    if truncated_by_bytes {
        bytes.truncate(MAX_TEXT_BYTES as usize);
    }
    let valid_len = match std::str::from_utf8(&bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(error) => return Err(format!("O arquivo não é texto UTF-8 válido: {error}")),
    };
    let text = std::str::from_utf8(&bytes[..valid_len]).map_err(|e| e.to_string())?;
    let truncated_by_chars = text.chars().count() > MAX_TEXT_CHARS;
    let mut output: String = text.chars().take(MAX_TEXT_CHARS).collect();
    if truncated_by_bytes || truncated_by_chars {
        output.push_str("\n\n… (arquivo truncado por tamanho)");
    }
    Ok(output)
}

/// `~` e `~/resto` viram caminho sob `home`. Qualquer outra forma (`~fulano`,
/// til no meio, `home` desconhecido) sai intacta e cai na resolução normal.
fn expandir_til(path: &str, home: Option<&Path>) -> std::path::PathBuf {
    match (home, path.strip_prefix('~')) {
        (Some(home), Some("")) => home.to_path_buf(),
        (Some(home), Some(resto)) if resto.starts_with('/') => {
            home.join(resto.trim_start_matches('/'))
        }
        _ => std::path::PathBuf::from(path),
    }
}

fn scoped_file_path(
    root: &str,
    path: &str,
    attachments: Option<&Path>,
) -> Result<std::path::PathBuf, String> {
    // Caminho RELATIVO se resolve contra a raiz do projeto, nunca contra o cwd
    // do processo. O agente cita `AGENTS.md` sem diretório o tempo todo; sem
    // esta junção o `canonicalize` procurava a partir do cwd da .app (`/`), não
    // achava, e o visualizador de markdown exibia "não foi possível carregar" —
    // enquanto o mesmo `AGENTS.md` abria no editor, porque `contained()` de
    // editor.rs sempre juntou a raiz. Duas portas para o mesmo alvo, e só uma
    // resolvia o caminho. A guarda de escopo abaixo segue valendo: `..` continua
    // barrado pelo `starts_with`.
    // `~/` é como alguns motores citam o que salvaram fora do projeto (a pasta
    // de artefatos, por exemplo). Expandir NÃO autoriza nada: o caminho já
    // expandido passa pela mesma guarda de escopo logo abaixo.
    let expandido = expandir_til(path, std::env::var_os("HOME").as_deref().map(Path::new));
    let alvo = expandido.as_path();
    let canon = if alvo.is_absolute() {
        std::fs::canonicalize(alvo).map_err(|e| e.to_string())?
    } else {
        std::fs::canonicalize(Path::new(root).join(alvo)).map_err(|e| e.to_string())?
    };
    let mut allowed: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(r) = std::fs::canonicalize(&root) {
        // Também autoriza as pastas extras vinculadas a este projeto (extra_dirs)
        for extra in crate::mycockpit::resolve_extra_dirs(&root) {
            if let Ok(e) = std::fs::canonicalize(extra) {
                allowed.push(e);
            }
        }
        allowed.push(r);
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home_path = Path::new(&home);
        if let Ok(c) = std::fs::canonicalize(home_path.join(".claude")) {
            allowed.push(c);
        }
        // Artefatos de agentes (.gemini/antigravity-cli/brain)
        if let Ok(b) = std::fs::canonicalize(
            home_path
                .join(".gemini")
                .join("antigravity-cli")
                .join("brain"),
        ) {
            allowed.push(b);
        }
    }
    // A raiz vem do runtime Tauri em vez de reconstruir um caminho específico
    // do macOS; assim a mesma fronteira vale no Linux.
    if let Some(attachments) = attachments {
        if let Ok(att) = std::fs::canonicalize(attachments) {
            allowed.push(att);
        }
    }
    if !allowed.iter().any(|a| canon.starts_with(a)) {
        return Err("caminho fora do projeto (e de locais autorizados): leitura bloqueada".into());
    }
    if !canon.is_file() {
        return Err("O caminho selecionado não é um arquivo.".into());
    }
    Ok(canon)
}

/// Lê imagens como bytes crus. O teto é aplicado antes e durante a leitura:
/// isso evita a inflação de um `Vec<u8>` serializado como JSON e também cobre
/// o arquivo que cresce entre `metadata` e `read`.
#[tauri::command]
pub fn read_project_file_bytes(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let attachments = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("attachments"));
    read_project_file_bytes_scoped(&root, &path, attachments.as_deref())
        .map(tauri::ipc::Response::new)
}

fn read_project_file_bytes_scoped(
    root: &str,
    path: &str,
    attachments: Option<&Path>,
) -> Result<Vec<u8>, String> {
    let canon = scoped_file_path(root, path, attachments)?;
    let size = std::fs::metadata(&canon).map_err(|e| e.to_string())?.len();
    if size > MAX_PREVIEW_BYTES {
        return Err("O arquivo é grande demais para a pré-visualização.".into());
    }
    let mut bytes = Vec::with_capacity(size as usize);
    std::fs::File::open(&canon)
        .map_err(|e| e.to_string())?
        .take(MAX_PREVIEW_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Err("O arquivo é grande demais para a pré-visualização.".into());
    }
    Ok(bytes)
}

/// Opção invocável por "/": comando da casa (.mycockpit/commands), comando
/// nativo do motor (.claude/commands, ~/.codex/prompts) ou skill
/// (.claude/skills). `body` é o markdown INTEIRO do arquivo (frontmatter
/// incluso) — o front expande app-side quando o motor da conversa não
/// interpreta `/comando` nativamente (codex/agy, ou comando da casa).
#[derive(Clone, Debug, Default, Serialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
    pub kind: String,   // "command" | "skill"
    pub origin: String, // "project" | "global"
    /// De onde o comando veio: "mycockpit" | "claude" | "codex".
    pub source: String,
    /// Conteúdo do .md (None se ilegível) p/ a expansão app-side.
    pub body: Option<String>,
    /// Metadados presentes somente em contribuição aprovada de plugin. A UI
    /// os devolve no run para o manifesto registrar o que foi invocado.
    #[serde(rename = "pluginKey", skip_serializing_if = "Option::is_none")]
    pub plugin_key: Option<String>,
    #[serde(rename = "pluginName", skip_serializing_if = "Option::is_none")]
    pub plugin_name: Option<String>,
    #[serde(rename = "pluginFingerprint", skip_serializing_if = "Option::is_none")]
    pub plugin_fingerprint: Option<String>,
    #[serde(rename = "contributionId", skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
    /// Plugin DO PROVIDER que publicou o item (ex. `vercel` no Claude Code,
    /// `documents` no Codex). Diferente de `pluginKey`: não há grant nem
    /// fingerprint da Frota; quem executa e responde pelo plugin é o motor.
    #[serde(rename = "providerPlugin", skip_serializing_if = "Option::is_none")]
    pub provider_plugin: Option<String>,
}

pub(crate) fn collect_commands(
    dir: &Path,
    prefix: &str,
    origin: &str,
    source: &str,
    out: &mut Vec<SlashCommand>,
) {
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
            collect_commands(&p, &next, origin, source, out);
        } else if p.extension().is_some_and(|x| x == "md") {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let name = if prefix.is_empty() {
                stem.to_string()
            } else {
                format!("{prefix}:{stem}")
            };
            let body = std::fs::read_to_string(&p).ok();
            let description = body.as_deref().and_then(|t| frontmatter(t, "description"));
            out.push(SlashCommand {
                name,
                description,
                kind: "command".to_string(),
                origin: origin.to_string(),
                source: source.to_string(),
                body,
                plugin_key: None,
                plugin_name: None,
                plugin_fingerprint: None,
                contribution_id: None,
                provider_plugin: None,
            });
        }
    }
}

/// Skills (.claude/skills/<name>/SKILL.md), invocáveis por /<name>.
fn collect_skills(dir: &Path, origin: &str, out: &mut Vec<SlashCommand>) {
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
        let body = std::fs::read_to_string(p.join("SKILL.md")).ok();
        let description = body.as_deref().and_then(|t| frontmatter(t, "description"));
        out.push(SlashCommand {
            name: name.to_string(),
            description,
            kind: "skill".to_string(),
            origin: origin.to_string(),
            source: "claude".to_string(),
            body,
            plugin_key: None,
            plugin_name: None,
            plugin_fingerprint: None,
            contribution_id: None,
            provider_plugin: None,
        });
    }
}

fn collect_plugin_skills(
    skills: &[crate::plugin_contributions::PluginSkillSpec],
    out: &mut Vec<SlashCommand>,
) {
    out.extend(skills.iter().map(|skill| SlashCommand {
        name: skill.name.clone(),
        description: Some(skill.description.clone()),
        kind: "skill".into(),
        origin: "global".into(),
        source: "plugin".into(),
        body: Some(skill.body.clone()),
        plugin_key: Some(skill.plugin_key.clone()),
        plugin_name: Some(skill.plugin_name.clone()),
        plugin_fingerprint: Some(skill.fingerprint.clone()),
        contribution_id: Some(skill.contribution_id.clone()),
        provider_plugin: None,
    }));
}

/// Descoberta POR AGENT da conversa. A casa (.mycockpit/commands, agnóstica)
/// vale pra qualquer motor; a convenção NATIVA de cada um vem da capability
/// `command_sources` do registry (adapters.rs) — este código não conhece nome
/// de agent, só o enum de convenções (G1.1 do capability-registry-plan).
/// Dedup por NOME: quem entra antes vence — mycockpit antes de provider (a
/// casa é canônica) e projeto antes de global. `home` injetável p/ teste.
#[cfg(test)]
fn collect_agent_commands(project: &Path, home: Option<&Path>, agent: &str) -> Vec<SlashCommand> {
    collect_agent_inventory(
        project,
        home,
        agent,
        &[],
        &crate::command_inventory::NativeEvidence::default(),
    )
    .0
}

/// Inventário de disco de um agent, mais o que o motor já anunciou sobre
/// pastas de plugin (`native`). Devolve também os diagnósticos de itens que
/// sumiriam em silêncio (link de skill quebrado). ADR-189.
pub(crate) fn collect_agent_inventory(
    project: &Path,
    home: Option<&Path>,
    agent: &str,
    plugin_skills: &[crate::plugin_contributions::PluginSkillSpec],
    native: &crate::command_inventory::NativeEvidence<'_>,
) -> (Vec<SlashCommand>, Vec<String>) {
    let mut out = Vec::new();
    let mut diagnostics = Vec::new();
    // casa agnóstica primeiro (projeto, depois global): vence o dedup.
    collect_commands(
        &project.join(".mycockpit").join("commands"),
        "",
        "project",
        "mycockpit",
        &mut out,
    );
    if let Some(h) = home {
        collect_commands(
            &h.join(".mycockpit").join("commands"),
            "",
            "global",
            "mycockpit",
            &mut out,
        );
    }
    // Plugins aprovados entram depois da casa e antes das convenções nativas.
    // Assim o namespace é igual em todo provider, sem gravar em ~/.claude ou
    // ~/.codex, e um comando canônico da casa continua tendo precedência.
    collect_plugin_skills(plugin_skills, &mut out);
    // Convenções nativas declaradas pelo adapter (agent desconhecido = nenhuma:
    // fail-closed, só a casa).
    let sources = crate::adapters::capabilities_of(agent)
        .map(|c| c.command_sources)
        .unwrap_or(&[]);
    for source in sources {
        match source {
            crate::adapters::CommandSource::ClaudeDirs => {
                let cd = project.join(".claude");
                collect_commands(&cd.join("commands"), "", "project", "claude", &mut out);
                collect_skills(&cd.join("skills"), "project", &mut out);
                let mut broken = crate::provider_commands::broken_skill_links(&cd.join("skills"));
                if let Some(h) = home {
                    let gd = h.join(".claude");
                    collect_commands(&gd.join("commands"), "", "global", "claude", &mut out);
                    collect_skills(&gd.join("skills"), "global", &mut out);
                    broken.extend(crate::provider_commands::broken_skill_links(&gd.join("skills")));
                }
                if !broken.is_empty() {
                    diagnostics.push(format!(
                        "{} skill(s) com link quebrado em .claude/skills: {}",
                        broken.len(),
                        broken.join(", ")
                    ));
                }
            }
            crate::adapters::CommandSource::CodexPrompts => {
                if let Some(h) = home {
                    collect_commands(
                        &h.join(".codex").join("prompts"),
                        "",
                        "global",
                        "codex",
                        &mut out,
                    );
                }
            }
            crate::adapters::CommandSource::ClaudePlugins => {
                // Com evidência do motor, as pastas vêm do `init` (a versão
                // realmente carregada); sem ela, do installed_plugins.json.
                let plugins = match native.observed {
                    Some(inv) => inv
                        .plugins
                        .iter()
                        .map(|p| crate::provider_commands::ProviderPlugin {
                            name: p.name.clone(),
                            path: std::path::PathBuf::from(&p.path),
                            origin: "global",
                        })
                        .collect(),
                    None => home
                        .map(|h| crate::provider_commands::claude_enabled_plugins(project, h))
                        .unwrap_or_default(),
                };
                for plugin in &plugins {
                    crate::provider_commands::collect_plugin_dir(plugin, "claude", &mut out);
                }
            }
            crate::adapters::CommandSource::CodexSkills => match native.queried_skills {
                Some(skills) => out.extend(skills.iter().cloned()),
                None => {
                    if let Some(h) = home {
                        crate::provider_commands::codex_disk_skills(h, &mut out);
                    }
                }
            },
        }
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert(c.name.clone()));
    out.sort_by(|a, b| a.name.cmp(&b.name));
    (out, diagnostics)
}

/// Inventário usado pelo ENVIO (expansão app-side). Nunca sobe consulta
/// lateral: usa o que o motor já anunciou e o disco. Fora da thread principal
/// (ADR-170).
#[tauri::command]
pub async fn read_project_commands(
    app: tauri::AppHandle,
    path: String,
    agent: String,
) -> Result<Vec<SlashCommand>, String> {
    Ok(crate::command_inventory::build(&app, &path, &agent, false)
        .await?
        .commands)
}

/// Walk de fallback (projeto sem git): pula pastas pesadas, cap embutido.
fn walk_files(base: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
    if out.len() >= 8000 || depth > 10 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        // pula SYMLINKS (defesa em profundidade): sem isto, um link dentro da
        // pasta apontando pra fora faria o walker ENUMERAR nomes de lá
        // (list_mission_files). `e.file_type()` NÃO segue o link. Só pula o que
        // é comprovadamente symlink (erro de tipo não esconde arquivo real).
        if e.file_type().map(|t| t.is_symlink()).unwrap_or(false) {
            continue;
        }
        let p = e.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if p.is_dir() {
            if matches!(
                name,
                "node_modules" | ".git" | "target" | "dist" | "build" | ".next"
            ) {
                continue;
            }
            walk_files(base, &p, out, depth + 1);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().to_string());
        }
    }
}

/// Persiste um arquivo de estado da missão no worktree (P1 confiabilidade:
/// missão sobrevive a restart). Agora recebe o `rel_path` (ex.:
/// `.mycockpit/missions/<slug>/run-state.json`) pra ISOLAR cada missão numa
/// pasta própria — antes o nome fixo `.mission/run-state.json` fazia missões no
/// mesmo cwd se SOBRESCREVEREM. ESCOPADO: `rel_path` tem que ser relativo e não
/// pode escapar do cwd (sem `..`, sem absoluto; o pai canônico tem que começar
/// no root). Escrita atômica (fsx) porque os agents leem/escrevem em paralelo.
#[tauri::command]
pub fn write_mission_state(cwd: String, rel_path: String, content: String) -> Result<(), String> {
    let root = std::fs::canonicalize(&cwd).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("cwd da missão não é um diretório".into());
    }
    let rel = std::path::Path::new(&rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("caminho de missão inválido (fora do cwd)".into());
    }
    let target = root.join(rel);
    let parent = target
        .parent()
        .ok_or_else(|| "caminho de missão sem pasta-pai".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("não criei a pasta da missão: {e}"))?;
    // defesa extra contra symlink/traversal: o pai REAL tem que estar no root.
    let cparent = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if !cparent.starts_with(&root) {
        return Err("caminho de missão escaparia do cwd".into());
    }
    crate::fsx::write_atomic(&target, &content)
}

/// Lista os arquivos de UMA pasta de missão (`.mycockpit/missions/<slug>/`).
/// As pastas de missão são gitignoradas, então a busca normal do projeto NÃO
/// as enxerga — daí este walker escopado. Devolve caminhos
/// RELATIVOS ao rel_dir (ex.: "plan.md", "reports/05.md", "2-reviewer.json").
/// Mesmo guard do write: rel_dir relativo, sem `..`, base real dentro do root.
#[tauri::command]
pub fn list_mission_files(cwd: String, rel_dir: String) -> Result<Vec<String>, String> {
    let root = std::fs::canonicalize(&cwd).map_err(|e| e.to_string())?;
    let rel = std::path::Path::new(&rel_dir);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("caminho de missão inválido".into());
    }
    let base = root.join(rel);
    if !base.is_dir() {
        return Ok(Vec::new()); // pasta ainda não criada = sem arquivos
    }
    let cbase = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
    if !cbase.starts_with(&root) {
        return Err("caminho de missão escaparia do cwd".into());
    }
    let mut out = Vec::new();
    walk_files(&cbase, &cbase, &mut out, 0);
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixture: projeto + "home" falso em tmpdir com as TRÊS convenções
    /// (.mycockpit/commands, .claude/commands+skills, ~/.codex/prompts).
    fn slash_fixture(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("mc-slash-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let proj = base.join("proj");
        let home = base.join("home");
        // casa (agnóstica): projeto e global
        std::fs::create_dir_all(proj.join(".mycockpit/commands")).unwrap();
        std::fs::write(
            proj.join(".mycockpit/commands/deploy.md"),
            "---\ndescription: deploy da casa\n---\n\nFaça o deploy com $ARGUMENTS.\n",
        )
        .unwrap();
        std::fs::create_dir_all(home.join(".mycockpit/commands")).unwrap();
        std::fs::write(
            home.join(".mycockpit/commands/casa-global.md"),
            "corpo global\n",
        )
        .unwrap();
        // claude: projeto (command + skill) e global
        std::fs::create_dir_all(proj.join(".claude/commands")).unwrap();
        std::fs::write(proj.join(".claude/commands/review.md"), "revise o diff\n").unwrap();
        // MESMO nome que a casa: a casa tem que vencer o dedup
        std::fs::write(
            proj.join(".claude/commands/deploy.md"),
            "deploy do claude\n",
        )
        .unwrap();
        std::fs::create_dir_all(proj.join(".claude/skills/minha-skill")).unwrap();
        std::fs::write(
            proj.join(".claude/skills/minha-skill/SKILL.md"),
            "---\ndescription: skill do projeto\n---\n\npassos\n",
        )
        .unwrap();
        std::fs::create_dir_all(home.join(".claude/commands")).unwrap();
        std::fs::write(home.join(".claude/commands/review.md"), "review global\n").unwrap();
        // codex: prompts globais
        std::fs::create_dir_all(home.join(".codex/prompts")).unwrap();
        std::fs::write(home.join(".codex/prompts/triage.md"), "faça a triagem\n").unwrap();
        (proj, home)
    }

    fn achar<'a>(v: &'a [SlashCommand], name: &str) -> &'a SlashCommand {
        v.iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("comando {name} ausente"))
    }

    #[test]
    fn descoberta_claude_ve_casa_e_claude_com_source_correto() {
        let (proj, home) = slash_fixture("claude");
        let out = collect_agent_commands(&proj, Some(&home), "claude-code");
        let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            nomes,
            vec!["casa-global", "deploy", "minha-skill", "review"]
        );
        // nada do codex numa conversa claude
        assert!(!nomes.contains(&"triage"));
        assert_eq!(achar(&out, "casa-global").source, "mycockpit");
        assert_eq!(achar(&out, "casa-global").origin, "global");
        assert_eq!(achar(&out, "review").source, "claude");
        // projeto vence global no mesmo nome
        assert_eq!(achar(&out, "review").origin, "project");
        assert_eq!(achar(&out, "minha-skill").kind, "skill");
        assert_eq!(
            achar(&out, "minha-skill").description.as_deref(),
            Some("skill do projeto")
        );
        let _ = std::fs::remove_dir_all(proj.parent().unwrap());
    }

    #[test]
    fn dedup_mycockpit_vence_provider_no_mesmo_nome() {
        let (proj, home) = slash_fixture("dedup");
        let out = collect_agent_commands(&proj, Some(&home), "claude-code");
        let deploy = achar(&out, "deploy");
        assert_eq!(deploy.source, "mycockpit");
        assert_eq!(deploy.description.as_deref(), Some("deploy da casa"));
        assert!(deploy.body.as_deref().unwrap().contains("$ARGUMENTS"));
        // só UMA entrada com o nome (dedup por nome)
        assert_eq!(out.iter().filter(|c| c.name == "deploy").count(), 1);
        let _ = std::fs::remove_dir_all(proj.parent().unwrap());
    }

    #[test]
    fn descoberta_codex_ve_casa_e_prompts_globais_apenas() {
        let (proj, home) = slash_fixture("codex");
        let out = collect_agent_commands(&proj, Some(&home), "codex");
        let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(nomes, vec!["casa-global", "deploy", "triage"]);
        // nada de .claude numa conversa codex (o motor não interpretaria)
        assert!(!nomes.contains(&"review"));
        assert!(!nomes.contains(&"minha-skill"));
        assert_eq!(achar(&out, "triage").source, "codex");
        assert_eq!(achar(&out, "triage").origin, "global");
        assert_eq!(
            achar(&out, "triage").body.as_deref(),
            Some("faça a triagem\n")
        );
        let _ = std::fs::remove_dir_all(proj.parent().unwrap());
    }

    /// G1.4 (capability-registry-plan) — CONTRATO command_sources ↔ descoberta,
    /// num loop sobre TODOS os agents registrados: a convenção declarada no
    /// registry tem que corresponder exatamente ao que a descoberta devolve.
    /// Agent novo sem declarar convenção vê só a casa (fail-closed).
    #[test]
    fn contrato_command_sources_por_agent_registrado() {
        use crate::adapters::{capabilities_of, registered_agents, CommandSource};
        let (proj, home) = slash_fixture("contrato");
        for agent in registered_agents() {
            let caps = capabilities_of(agent).unwrap();
            let out = collect_agent_commands(&proj, Some(&home), agent);
            let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
            // a casa é agnóstica: aparece pra todo agent, sempre.
            assert!(
                nomes.contains(&"casa-global"),
                "{agent}: casa global sempre"
            );
            assert!(nomes.contains(&"deploy"), "{agent}: casa do projeto sempre");
            let claude_dirs = caps.command_sources.contains(&CommandSource::ClaudeDirs);
            assert_eq!(
                nomes.contains(&"review"),
                claude_dirs,
                "{agent}: .claude/commands ↔ capability ClaudeDirs"
            );
            assert_eq!(
                nomes.contains(&"minha-skill"),
                claude_dirs,
                "{agent}: .claude/skills ↔ capability ClaudeDirs"
            );
            let codex_prompts = caps.command_sources.contains(&CommandSource::CodexPrompts);
            assert_eq!(
                nomes.contains(&"triage"),
                codex_prompts,
                "{agent}: ~/.codex/prompts ↔ capability CodexPrompts"
            );
        }
        let _ = std::fs::remove_dir_all(proj.parent().unwrap());
    }

    /// ADR-189 — CONTRATO das convenções de plugin/skill de provider, no mesmo
    /// loop sobre todos os agents: o plugin habilitado do Claude só aparece com
    /// `ClaudePlugins`, a skill em ~/.codex/skills só com `CodexSkills`.
    #[test]
    fn contrato_fontes_de_plugin_e_skill_por_agent_registrado() {
        use crate::adapters::{capabilities_of, registered_agents, CommandSource};
        let base = std::env::temp_dir().join(format!("mc-slash-plugins-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (proj, home) = (base.join("proj"), base.join("home"));
        let plugin = base.join("cache/vercel");
        std::fs::create_dir_all(plugin.join("commands")).unwrap();
        std::fs::write(plugin.join("commands/deploy.md"), "deploy\n").unwrap();
        std::fs::create_dir_all(home.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            serde_json::json!({"version": 2, "plugins": {"vercel@oficial": [
                {"scope": "user", "installPath": plugin}
            ]}})
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            home.join(".claude/settings.json"),
            r#"{"enabledPlugins":{"vercel@oficial":true}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(home.join(".codex/skills/triagem")).unwrap();
        std::fs::write(home.join(".codex/skills/triagem/SKILL.md"), "passos\n").unwrap();
        std::fs::create_dir_all(&proj).unwrap();
        for agent in registered_agents() {
            let caps = capabilities_of(agent).unwrap();
            let out = collect_agent_commands(&proj, Some(&home), agent);
            let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
            assert_eq!(
                nomes.contains(&"vercel:deploy"),
                caps.command_sources.contains(&CommandSource::ClaudePlugins),
                "{agent}: plugin do Claude ↔ capability ClaudePlugins"
            );
            assert_eq!(
                nomes.contains(&"triagem"),
                caps.command_sources.contains(&CommandSource::CodexSkills),
                "{agent}: ~/.codex/skills ↔ capability CodexSkills"
            );
        }
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn inventario_consultado_substitui_as_skills_de_disco_do_codex() {
        let (proj, home) = slash_fixture("consultado");
        std::fs::create_dir_all(home.join(".codex/skills/so-disco")).unwrap();
        std::fs::write(home.join(".codex/skills/so-disco/SKILL.md"), "x\n").unwrap();
        let consultadas = vec![SlashCommand {
            name: "documents:documents".into(),
            kind: "skill".into(),
            origin: "global".into(),
            source: "codex".into(),
            provider_plugin: Some("documents".into()),
            ..SlashCommand::default()
        }];
        let evidencia = crate::command_inventory::NativeEvidence {
            observed: None,
            queried_skills: Some(&consultadas),
        };
        let (out, _) = collect_agent_inventory(&proj, Some(&home), "codex", &[], &evidencia);
        let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        assert!(nomes.contains(&"documents:documents"));
        assert!(!nomes.contains(&"so-disco"), "a consulta é a verdade do motor");
        assert!(nomes.contains(&"triage"), "prompts continuam vindo do disco");
        let _ = std::fs::remove_dir_all(proj.parent().unwrap());
    }

    #[test]
    fn descoberta_agy_ve_so_a_casa() {
        let (proj, home) = slash_fixture("agy");
        let out = collect_agent_commands(&proj, Some(&home), "agy");
        let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(nomes, vec!["casa-global", "deploy"]);
        assert!(out.iter().all(|c| c.source == "mycockpit"));
        let _ = std::fs::remove_dir_all(proj.parent().unwrap());
    }

    #[test]
    fn write_mission_state_cria_pasta_e_grava() {
        let tmp = std::env::temp_dir().join(format!("mc-run-state-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let rel = ".mycockpit/missions/2026-07-24-abc123-tarefa/run-state.json";
        write_mission_state(
            tmp.to_string_lossy().into(),
            rel.into(),
            "{\"version\":1}".into(),
        )
        .unwrap();
        let out = std::fs::read_to_string(tmp.join(rel)).unwrap();
        assert_eq!(out, "{\"version\":1}");
        // regrava por cima (marcos seguintes) sem erro.
        write_mission_state(
            tmp.to_string_lossy().into(),
            rel.into(),
            "{\"version\":2}".into(),
        )
        .unwrap();
        let out = std::fs::read_to_string(tmp.join(rel)).unwrap();
        assert_eq!(out, "{\"version\":2}");
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn write_mission_state_rejeita_cwd_invalido() {
        assert!(write_mission_state(
            "/caminho/que/nao/existe".into(),
            "a/b.json".into(),
            "x".into()
        )
        .is_err());
    }

    #[test]
    fn write_mission_state_rejeita_traversal() {
        let tmp = std::env::temp_dir().join(format!("mc-trav-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cwd: String = tmp.to_string_lossy().into();
        // `..` no caminho é rejeitado (não escreve fora do cwd).
        assert!(write_mission_state(cwd.clone(), "../fora.json".into(), "x".into()).is_err());
        // caminho absoluto é rejeitado.
        assert!(write_mission_state(cwd, "/etc/evil".into(), "x".into()).is_err());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn list_mission_files_lista_relativo_e_recursivo() {
        let tmp = std::env::temp_dir().join(format!("mc-list-{}", std::process::id()));
        let dir = ".mycockpit/missions/2026-07-24-abc-tarefa";
        let base = tmp.join(dir);
        std::fs::create_dir_all(base.join("reports")).unwrap();
        std::fs::write(base.join("plan.md"), "# plano").unwrap();
        std::fs::write(base.join("2-reviewer.json"), "{}").unwrap();
        std::fs::write(base.join("reports/05.md"), "rel").unwrap();
        let mut files = list_mission_files(tmp.to_string_lossy().into(), dir.into()).unwrap();
        files.sort();
        assert_eq!(files, vec!["2-reviewer.json", "plan.md", "reports/05.md"]);
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn list_mission_files_nao_segue_symlink_pra_fora() {
        let tmp = std::env::temp_dir().join(format!("mc-sym-{}", std::process::id()));
        let dir = ".mycockpit/missions/2026-07-24-abc-tarefa";
        let base = tmp.join(dir);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("plan.md"), "# plano").unwrap();
        // "segredo" FORA da pasta da missão (mesmo cwd, mas fora do dir):
        let secret = tmp.join("segredo");
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(secret.join("chave.txt"), "sensível").unwrap();
        // symlink DENTRO da missão apontando pro segredo:
        std::os::unix::fs::symlink(&secret, base.join("link")).unwrap();
        let files = list_mission_files(tmp.to_string_lossy().into(), dir.into()).unwrap();
        // só o arquivo real; NADA de dentro do symlink (nem o nome chave.txt).
        assert_eq!(files, vec!["plan.md"]);
        assert!(!files.iter().any(|f| f.contains("chave")));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn list_mission_files_pasta_ausente_devolve_vazio() {
        let tmp = std::env::temp_dir().join(format!("mc-list2-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let out = list_mission_files(tmp.to_string_lossy().into(), ".mycockpit/missions/x".into())
            .unwrap();
        assert!(out.is_empty());
        // traversal rejeitado.
        assert!(list_mission_files(tmp.to_string_lossy().into(), "../x".into()).is_err());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn read_text_file_permite_dentro_do_projeto_e_bloqueia_fora() {
        let tmp = std::env::temp_dir().join(format!("mc-read-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let arq_projeto = tmp.join("doc.md");
        std::fs::write(&arq_projeto, "# Conteúdo permitido").unwrap();

        // Arquivo dentro do root: permitido
        let res =
            read_text_file_scoped(&tmp.to_string_lossy(), &arq_projeto.to_string_lossy(), None);
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), "# Conteúdo permitido");

        // Arquivo arbitrário fora do root e dos autorizados: bloqueado
        let fora = std::env::temp_dir().join(format!("mc-secret-{}", std::process::id()));
        std::fs::create_dir_all(&fora).unwrap();
        let arq_fora = fora.join("senha.txt");
        std::fs::write(&arq_fora, "segredo").unwrap();

        let res_bloqueado =
            read_text_file_scoped(&tmp.to_string_lossy(), &arq_fora.to_string_lossy(), None);
        assert!(res_bloqueado.is_err());

        std::fs::remove_dir_all(&tmp).unwrap();
        std::fs::remove_dir_all(&fora).unwrap();
    }

    #[test]
    fn read_text_file_resolve_caminho_relativo_contra_a_raiz() {
        // Incidente real (10/09/2026, conversa "[feat] cliente coleta"): o Codex
        // citou `AGENTS.md` sem diretório, o visualizador mandou a string crua e
        // o canonicalize procurou a partir do cwd da .app. O editor abria o
        // mesmo arquivo; só a leitura falhava.
        let tmp = std::env::temp_dir().join(format!("mc-rel-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("docs")).unwrap();
        std::fs::write(tmp.join("AGENTS.md"), "# raiz").unwrap();
        std::fs::write(tmp.join("docs").join("guia.md"), "# aninhado").unwrap();

        let raiz = tmp.to_string_lossy().to_string();
        assert_eq!(
            read_text_file_scoped(&raiz, "AGENTS.md", None).unwrap(),
            "# raiz"
        );
        assert_eq!(
            read_text_file_scoped(&raiz, "docs/guia.md", None).unwrap(),
            "# aninhado"
        );
        assert_eq!(
            read_text_file_scoped(&raiz, "./AGENTS.md", None).unwrap(),
            "# raiz"
        );

        // Relativo que ESCAPA da raiz continua barrado: o `..` é resolvido pelo
        // canonicalize e a fronteira o rejeita.
        let fora = std::env::temp_dir().join(format!("mc-rel-fora-{}", std::process::id()));
        std::fs::create_dir_all(&fora).unwrap();
        std::fs::write(fora.join("senha.txt"), "segredo").unwrap();
        let escape = format!(
            "../{}/senha.txt",
            fora.file_name().unwrap().to_string_lossy()
        );
        assert!(read_text_file_scoped(&raiz, &escape, None).is_err());

        // Relativo inexistente falha com erro, não com leitura fantasma.
        assert!(read_text_file_scoped(&raiz, "NAO-EXISTE.md", None).is_err());

        std::fs::remove_dir_all(&tmp).unwrap();
        std::fs::remove_dir_all(&fora).unwrap();
    }

    #[test]
    fn read_project_file_bytes_resolve_caminho_relativo_contra_a_raiz() {
        // Gêmeo do teste acima: os dois comandos compartilham scoped_file_path,
        // então a regra de resolução tem que valer igual nos dois.
        let tmp = std::env::temp_dir().join(format!("mc-rel-bytes-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        std::fs::write(tmp.join("pixel.png"), png).unwrap();

        let raiz = tmp.to_string_lossy().to_string();
        assert_eq!(
            read_project_file_bytes_scoped(&raiz, "pixel.png", None).unwrap(),
            png
        );
        assert!(read_project_file_bytes_scoped(&raiz, "../etc/hosts", None).is_err());

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn expandir_til_so_troca_o_til_inicial_seguido_de_barra() {
        let home = Path::new("/Users/v");
        assert_eq!(
            expandir_til("~/.gemini/antigravity-cli/brain/x/a.png", Some(home)),
            Path::new("/Users/v/.gemini/antigravity-cli/brain/x/a.png")
        );
        assert_eq!(expandir_til("~", Some(home)), Path::new("/Users/v"));
        // Nada disto é "a minha home": segue como veio, e a guarda decide.
        assert_eq!(expandir_til("~fulano/a.png", Some(home)), Path::new("~fulano/a.png"));
        assert_eq!(expandir_til("docs/~/a.png", Some(home)), Path::new("docs/~/a.png"));
        assert_eq!(expandir_til("~/a.png", None), Path::new("~/a.png"));
    }

    #[test]
    fn read_project_file_bytes_preserva_payload_e_aplica_teto() {
        let tmp = std::env::temp_dir().join(format!("mc-preview-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let image = tmp.join("pixel.png");
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        std::fs::write(&image, png).unwrap();

        let read =
            read_project_file_bytes_scoped(&tmp.to_string_lossy(), &image.to_string_lossy(), None)
                .unwrap();
        assert_eq!(read, png);

        let huge = tmp.join("grande.png");
        std::fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_PREVIEW_BYTES + 1)
            .unwrap();
        let rejected =
            read_project_file_bytes_scoped(&tmp.to_string_lossy(), &huge.to_string_lossy(), None);
        assert!(rejected.is_err());

        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
