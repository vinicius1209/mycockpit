//! Inventário MCP que já vive nos providers.
//!
//! Isto NÃO importa configurações para o control plane. O objetivo é tornar o
//! estado persistente externo visível, com evidência e escopo, sem reconstruir
//! argv/credenciais a partir de formatos que não são portáveis.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::adapters::{CapabilityScope, PolicyEnforceability};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderMcpInventoryEvidence {
    Structured,
    Summary,
    Opaque,
    Unavailable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMcpServer {
    pub name: String,
    pub enabled: bool,
    pub transport: Option<String>,
    pub scope: CapabilityScope,
    /// Allowlist de recursos associada à identidade da integração. Vazio é
    /// "não classificado", nunca prova de que a integração não acessa nada.
    pub resource_kinds: Vec<crate::resource_broker::ResourceKind>,
    pub resource_owner: crate::resource_broker::ResourceOwner,
    pub resource_evidence: crate::resource_broker::ResourceEvidence,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMcpInventory {
    pub agent: String,
    pub evidence: ProviderMcpInventoryEvidence,
    pub enforceability: PolicyEnforceability,
    pub default_scope: CapabilityScope,
    pub servers: Vec<ProviderMcpServer>,
    pub detail: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Probe {
    Canonical,
    AgyCliSummary,
    OpenCodeProjectFile,
    Opaque,
}

/// Diferença de dialeto confinada à fronteira por-provider. O consumidor
/// genérico itera o registry e recebe sempre o mesmo snapshot.
fn probe_for(agent: &str) -> (Probe, CapabilityScope) {
    match agent {
        "claude-code" | "codex" => (Probe::Canonical, CapabilityScope::User),
        "agy" => (Probe::AgyCliSummary, CapabilityScope::Global),
        "opencode" => (Probe::OpenCodeProjectFile, CapabilityScope::Project),
        _ => (Probe::Opaque, CapabilityScope::Run),
    }
}

fn inventory(
    agent: &str,
    evidence: ProviderMcpInventoryEvidence,
    default_scope: CapabilityScope,
    mut servers: Vec<ProviderMcpServer>,
    detail: Option<String>,
) -> ProviderMcpInventory {
    servers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    ProviderMcpInventory {
        agent: agent.to_string(),
        evidence,
        // Config que já vive no provider nunca é policy forte deste run.
        enforceability: PolicyEnforceability::Advisory,
        default_scope,
        servers,
        detail,
    }
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for code in chars.by_ref() {
                if code.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    out
}

fn parse_agy_table(output: &str) -> Vec<ProviderMcpServer> {
    strip_ansi(output)
        .lines()
        .filter_map(|line| {
            let columns: Vec<&str> = line.split_whitespace().collect();
            if columns.len() < 3 || columns[0].eq_ignore_ascii_case("name") {
                return None;
            }
            let status = columns[2].to_ascii_lowercase();
            if status != "enabled" && status != "disabled" {
                return None;
            }
            let name = columns[0].to_string();
            Some(ProviderMcpServer {
                resource_kinds: crate::resource_broker::integration_resources(&name),
                resource_owner: crate::resource_broker::ResourceOwner::Provider,
                resource_evidence: crate::resource_broker::ResourceEvidence::IntegrationRegistry,
                name,
                enabled: status == "enabled",
                transport: Some(columns[1].to_ascii_lowercase()),
                scope: CapabilityScope::Global,
            })
        })
        .collect()
}

fn strip_json_comments(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(input.len());
    let mut index = 0;
    let mut quoted = false;
    let mut escaped = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if quoted {
            out.push(byte);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            quoted = true;
            out.push(b'"');
            index += 1;
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                if bytes[index] == b'\n' {
                    out.push(b'\n');
                }
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            continue;
        }
        out.push(byte);
        index += 1;
    }
    String::from_utf8(out).unwrap_or_default()
}

fn parse_opencode_project(text: &str) -> Result<Vec<ProviderMcpServer>, String> {
    let root: serde_json::Value = serde_json::from_str(&strip_json_comments(text))
        .map_err(|error| format!("opencode.json inválido: {error}"))?;
    let Some(map) = root.get("mcp").and_then(serde_json::Value::as_object) else {
        return Ok(Vec::new());
    };
    Ok(map
        .iter()
        .map(|(name, value)| {
            let transport = match value.get("type").and_then(serde_json::Value::as_str) {
                Some("local") => Some("stdio".to_string()),
                Some("remote") => Some("http".to_string()),
                Some(other) => Some(other.to_string()),
                None => None,
            };
            ProviderMcpServer {
                resource_kinds: crate::resource_broker::integration_resources(name),
                resource_owner: crate::resource_broker::ResourceOwner::Provider,
                resource_evidence: crate::resource_broker::ResourceEvidence::IntegrationRegistry,
                name: name.clone(),
                enabled: value
                    .get("enabled")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true),
                transport,
                scope: CapabilityScope::Project,
            }
        })
        .collect())
}

fn opencode_path(project_path: &str) -> Result<Option<PathBuf>, String> {
    let json = Path::new(project_path).join("opencode.json");
    let jsonc = Path::new(project_path).join("opencode.jsonc");
    match (json.exists(), jsonc.exists()) {
        (true, true) => Err(
            "opencode.json e opencode.jsonc coexistem; não dá para afirmar qual inventário vence"
                .to_string(),
        ),
        (true, false) => Ok(Some(json)),
        (false, true) => Ok(Some(jsonc)),
        (false, false) => Ok(None),
    }
}

async fn inspect_agy(project_path: &str) -> Result<Vec<ProviderMcpServer>, String> {
    let cwd = project_path.to_string();
    let output =
        tokio::task::spawn_blocking(move || crate::proc::run("agy", &["mcp", "list"], Some(&cwd)))
            .await
            .map_err(|error| format!("falha na task de inventário do Agy: {error}"))?
            .map_err(|error| format!("`agy mcp list` falhou: {error}"))?;
    Ok(parse_agy_table(&output))
}

fn inspect_opencode(project_path: &str) -> Result<Vec<ProviderMcpServer>, String> {
    let Some(path) = opencode_path(project_path)? else {
        return Ok(Vec::new());
    };
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("não consegui ler {}: {error}", path.display()))?;
    parse_opencode_project(&text)
}

pub async fn inspect(
    project_path: &str,
    mut canonical: HashMap<String, Vec<ProviderMcpServer>>,
    canonical_errors: &HashMap<String, String>,
) -> Vec<ProviderMcpInventory> {
    let mut inventories = Vec::new();
    for agent in crate::adapters::registered_agents() {
        let (probe, default_scope) = probe_for(agent);
        let snapshot = match probe {
            Probe::Canonical => match canonical_errors.get(agent) {
                Some(error) => inventory(
                    agent,
                    ProviderMcpInventoryEvidence::Unavailable,
                    default_scope,
                    Vec::new(),
                    Some(error.clone()),
                ),
                None => inventory(
                    agent,
                    ProviderMcpInventoryEvidence::Structured,
                    default_scope,
                    canonical.remove(agent).unwrap_or_default(),
                    None,
                ),
            },
            Probe::AgyCliSummary => match inspect_agy(project_path).await {
                Ok(servers) => inventory(
                    agent,
                    ProviderMcpInventoryEvidence::Summary,
                    default_scope,
                    servers,
                    Some(
                        "Resumo do CLI; comandos e credenciais não são importados como bindings"
                            .to_string(),
                    ),
                ),
                Err(error) => inventory(
                    agent,
                    ProviderMcpInventoryEvidence::Unavailable,
                    default_scope,
                    Vec::new(),
                    Some(error),
                ),
            },
            Probe::OpenCodeProjectFile => match inspect_opencode(project_path) {
                Ok(servers) => inventory(
                    agent,
                    ProviderMcpInventoryEvidence::Structured,
                    default_scope,
                    servers,
                    None,
                ),
                Err(error) => inventory(
                    agent,
                    ProviderMcpInventoryEvidence::Unavailable,
                    default_scope,
                    Vec::new(),
                    Some(error),
                ),
            },
            Probe::Opaque => inventory(
                agent,
                ProviderMcpInventoryEvidence::Opaque,
                default_scope,
                Vec::new(),
                Some("este adapter ainda não publica inventário MCP nativo".to_string()),
            ),
        };
        inventories.push(snapshot);
    }
    inventories
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabela_do_agy_vira_resumo_sem_reconstruir_command_com_espacos() {
        let servers = parse_agy_table(
            "NAME TYPE STATUS COMMAND/URL\ncomputer-use stdio enabled /App Com Espaços mcp\nplaywright stdio disabled npx pacote\n\u{1b}[0m",
        );
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "computer-use");
        assert!(servers[0].enabled);
        assert_eq!(
            servers[0].resource_kinds,
            vec![crate::resource_broker::ResourceKind::DesktopControl]
        );
        assert_eq!(servers[1].name, "playwright");
        assert!(!servers[1].enabled);
        assert_eq!(
            servers[1].resource_kinds,
            vec![crate::resource_broker::ResourceKind::ExternalBrowser]
        );
    }

    #[test]
    fn opencode_jsonc_enumera_nome_escopo_e_transporte_sem_expor_url() {
        let servers = parse_opencode_project(
            r#"{
              // comentário aceito pelo provider
              "mcp": {
                "local": { "type": "local", "command": ["bin"], "enabled": false },
                "remote": { "type": "remote", "url": "https://secret.example/mcp" }
              }
            }"#,
        )
        .unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].scope, CapabilityScope::Project);
        assert!(servers.iter().all(|server| server.transport.is_some()));
        assert!(!format!("{servers:?}").contains("secret.example"));
    }

    #[test]
    fn todo_adapter_registrado_recebe_receita_ou_degradacao_opaca() {
        for agent in crate::adapters::registered_agents() {
            let (probe, _) = probe_for(agent);
            assert_ne!(probe, Probe::Opaque, "{agent}");
        }
    }
}
