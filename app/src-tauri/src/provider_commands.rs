//! Descoberta em DISCO das convenções de plugin e skill dos providers (ADR-189).
//!
//! É o fallback do inventário que o próprio motor publica
//! (`command_inventory.rs`): vale antes do primeiro run de um projeto, ou
//! quando a consulta lateral falha. Só lê; nunca escreve em `~/.claude` ou
//! `~/.codex` (ADR-130).

use crate::sources::{collect_commands, frontmatter, SlashCommand};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MAX_SKILL_BYTES: u64 = 256 * 1024;

/// Plugin de provider que publica comandos e skills a partir de uma pasta.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProviderPlugin {
    pub(crate) name: String,
    pub(crate) path: PathBuf,
    /// "project" quando a instalação é do projeto, "global" quando é do usuário.
    pub(crate) origin: &'static str,
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// `enabledPlugins` efetivo: usuário, depois projeto, depois local. O último
/// que declara uma chave vence, na mesma ordem de precedência do Claude Code.
fn claude_enabled_map(project: &Path, home: &Path) -> HashMap<String, bool> {
    let mut enabled = HashMap::new();
    for file in [
        home.join(".claude/settings.json"),
        project.join(".claude/settings.json"),
        project.join(".claude/settings.local.json"),
    ] {
        let Some(map) = read_json(&file)
            .and_then(|v| v.get("enabledPlugins").cloned())
            .and_then(|v| v.as_object().cloned())
        else {
            continue;
        };
        for (key, value) in map {
            if let Some(on) = value.as_bool() {
                enabled.insert(key, on);
            }
        }
    }
    enabled
}

/// Plugins HABILITADOS do Claude Code segundo o disco: `installed_plugins.json`
/// (v2, chave `nome@marketplace` → instalações) cruzado com `enabledPlugins`.
/// Instalação de escopo de projeto só vale para o próprio projeto.
pub(crate) fn claude_enabled_plugins(project: &Path, home: &Path) -> Vec<ProviderPlugin> {
    let Some(installed) = read_json(&home.join(".claude/plugins/installed_plugins.json")) else {
        return Vec::new();
    };
    let Some(plugins) = installed.get("plugins").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let enabled = claude_enabled_map(project, home);
    let mut out = Vec::new();
    for (key, installs) in plugins {
        if enabled.get(key) != Some(&true) {
            continue;
        }
        let name = key.split('@').next().unwrap_or(key).to_string();
        for install in installs.as_array().into_iter().flatten() {
            let Some(path) = install.get("installPath").and_then(|v| v.as_str()) else {
                continue;
            };
            let scope = install.get("scope").and_then(|v| v.as_str()).unwrap_or("user");
            let origin = if scope == "user" {
                "global"
            } else {
                let dono = install.get("projectPath").and_then(|v| v.as_str());
                if dono.map(Path::new) != Some(project) {
                    continue;
                }
                "project"
            };
            out.push(ProviderPlugin {
                name: name.clone(),
                path: PathBuf::from(path),
                origin,
            });
            break;
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Comandos (`commands/**.md`) e skills (`skills/<nome>/SKILL.md`) de um
/// plugin, com o namespace `plugin:nome` que o CLI usa para invocá-los.
pub(crate) fn collect_plugin_dir(
    plugin: &ProviderPlugin,
    source: &str,
    out: &mut Vec<SlashCommand>,
) {
    let start = out.len();
    collect_commands(
        &plugin.path.join("commands"),
        &plugin.name,
        plugin.origin,
        source,
        out,
    );
    collect_skill_dirs(
        &plugin.path.join("skills"),
        Some(&plugin.name),
        plugin.origin,
        source,
        out,
    );
    for command in &mut out[start..] {
        command.provider_plugin = Some(plugin.name.clone());
    }
}

/// `<dir>/<nome>/SKILL.md` → skill invocável. `prefix` vira `prefix:nome`.
/// Pasta sem SKILL.md não é skill e não aparece.
pub(crate) fn collect_skill_dirs(
    dir: &Path,
    prefix: Option<&str>,
    origin: &str,
    source: &str,
    out: &mut Vec<SlashCommand>,
) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let file = path.join("SKILL.md");
        if !path.is_dir() || !file.is_file() {
            continue;
        }
        let Some(dir_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let body = crate::plugin_manifest::read_capped(&file, MAX_SKILL_BYTES)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok());
        let name = match prefix {
            Some(p) => format!("{p}:{dir_name}"),
            None => dir_name.to_string(),
        };
        out.push(SlashCommand {
            name,
            description: body.as_deref().and_then(|t| frontmatter(t, "description")),
            kind: "skill".into(),
            origin: origin.into(),
            source: source.into(),
            body,
            ..SlashCommand::default()
        });
    }
}

/// Links de skill que apontam para lugar nenhum. O diretório some da
/// descoberta (não há SKILL.md para ler), mas a pessoa precisa saber por quê.
pub(crate) fn broken_skill_links(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_symlink() && !p.exists())
        .filter_map(|p| p.file_name().and_then(|s| s.to_str()).map(str::to_string))
        .collect();
    out.sort();
    out
}

/// Skills do Codex em disco: `~/.codex/skills/<nome>` e as de sistema em
/// `~/.codex/skills/.system/<nome>` (codex 0.154.0 lista as duas no
/// `skills/list`, escopos `user` e `system`).
pub(crate) fn codex_disk_skills(home: &Path, out: &mut Vec<SlashCommand>) {
    let base = home.join(".codex/skills");
    collect_skill_dirs(&base, None, "global", "codex", out);
    collect_skill_dirs(&base.join(".system"), None, "global", "codex", out);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mc-provcmd-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn escrever(path: &Path, texto: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, texto).unwrap();
    }

    /// Forma do `installed_plugins.json` v2 colhida do claude 2.1.270.
    fn instalar(home: &Path, chave: &str, install_path: &Path, extra: &str) {
        let arquivo = home.join(".claude/plugins/installed_plugins.json");
        let mut atual = read_json(&arquivo)
            .unwrap_or_else(|| serde_json::json!({"version": 2, "plugins": {}}));
        let entrada: Value = serde_json::from_str(&format!(
            r#"[{{"scope":"user","installPath":"{}","version":"1.0.0"{extra}}}]"#,
            install_path.display()
        ))
        .unwrap();
        atual["plugins"][chave] = entrada;
        escrever(&arquivo, &atual.to_string());
    }

    #[test]
    fn plugin_habilitado_publica_comandos_e_skills_com_namespace() {
        let dir = base("habilitado");
        let (home, proj) = (dir.join("home"), dir.join("proj"));
        let vercel = dir.join("cache/vercel/1.0.0");
        escrever(&vercel.join("commands/deploy.md"), "---\ndescription: Deploy\n---\ncorpo\n");
        escrever(&vercel.join("skills/logs/SKILL.md"), "---\ndescription: Logs\n---\npassos\n");
        escrever(&vercel.join("skills/sem-skill/README.md"), "não é skill\n");
        instalar(&home, "vercel@claude-plugins-official", &vercel, "");
        escrever(
            &home.join(".claude/settings.json"),
            r#"{"enabledPlugins":{"vercel@claude-plugins-official":true}}"#,
        );

        let plugins = claude_enabled_plugins(&proj, &home);
        assert_eq!(plugins.len(), 1);
        let mut out = Vec::new();
        collect_plugin_dir(&plugins[0], "claude", &mut out);
        let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(nomes, vec!["vercel:deploy", "vercel:logs"]);
        assert!(out.iter().all(|c| c.provider_plugin.as_deref() == Some("vercel")));
        assert_eq!(out[1].kind, "skill");
        assert_eq!(out[1].description.as_deref(), Some("Logs"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn plugin_instalado_mas_desligado_no_projeto_nao_aparece() {
        let dir = base("desligado");
        let (home, proj) = (dir.join("home"), dir.join("proj"));
        let paper = dir.join("cache/paper");
        escrever(&paper.join("skills/code-to-design/SKILL.md"), "x\n");
        instalar(&home, "paper-desktop@paper", &paper, "");
        escrever(
            &home.join(".claude/settings.json"),
            r#"{"enabledPlugins":{"paper-desktop@paper":true}}"#,
        );
        escrever(
            &proj.join(".claude/settings.local.json"),
            r#"{"enabledPlugins":{"paper-desktop@paper":false}}"#,
        );
        assert!(claude_enabled_plugins(&proj, &home).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn instalacao_de_projeto_so_vale_no_proprio_projeto() {
        let dir = base("escopo");
        let (home, proj) = (dir.join("home"), dir.join("proj"));
        let lsp = dir.join("cache/lsp");
        escrever(&lsp.join("skills/tipos/SKILL.md"), "x\n");
        escrever(
            &home.join(".claude/plugins/installed_plugins.json"),
            &serde_json::json!({"version": 2, "plugins": {"lsp@mkt": [{
                "scope": "project",
                "installPath": lsp,
                "projectPath": dir.join("outro"),
            }]}})
            .to_string(),
        );
        escrever(&home.join(".claude/settings.json"), r#"{"enabledPlugins":{"lsp@mkt":true}}"#);
        assert!(claude_enabled_plugins(&proj, &home).is_empty());
        assert_eq!(claude_enabled_plugins(&dir.join("outro"), &home)[0].origin, "project");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn link_quebrado_de_skill_vira_diagnostico() {
        let dir = base("link");
        let skills = dir.join(".claude/skills");
        std::fs::create_dir_all(&skills).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("nao-existe"), skills.join("cinematic-landing"))
            .unwrap();
        escrever(&skills.join("viva/SKILL.md"), "ok\n");
        assert_eq!(broken_skill_links(&skills), vec!["cinematic-landing".to_string()]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skills_do_codex_em_disco_incluem_as_de_sistema() {
        let dir = base("codex");
        escrever(
            &dir.join(".codex/skills/.system/skill-creator/SKILL.md"),
            "---\nname: skill-creator\ndescription: Create or update a Codex skill\n---\n",
        );
        escrever(&dir.join(".codex/skills/minha/SKILL.md"), "passos\n");
        let mut out = Vec::new();
        codex_disk_skills(&dir, &mut out);
        let nomes: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(nomes, vec!["minha", "skill-creator"]);
        assert!(out.iter().all(|c| c.source == "codex" && c.kind == "skill"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
