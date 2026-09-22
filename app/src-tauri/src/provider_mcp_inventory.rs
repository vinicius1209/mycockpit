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

/// Evidência de configuração, nunca de conexão nem equivalência de comandos.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CliInstallation {
    Enabled,
    Disabled,
    Absent,
    Unknown,
}

pub fn cli_installation(
    inventories: &[ProviderMcpInventory],
    agent: &str,
    name: &str,
    transport: &str,
) -> CliInstallation {
    let Some(snapshot) = inventories.iter().find(|item| item.agent == agent) else {
        return CliInstallation::Unknown;
    };
    if !matches!(
        snapshot.evidence,
        ProviderMcpInventoryEvidence::Structured | ProviderMcpInventoryEvidence::Summary
    ) {
        return CliInstallation::Unknown;
    }
    let named: Vec<_> = snapshot
        .servers
        .iter()
        .filter(|server| server.name == name)
        .collect();
    match named.as_slice() {
        [] => CliInstallation::Absent,
        [server]
            if server.scope == CapabilityScope::Global
                && server.transport.as_deref() == Some(transport) =>
        {
            if server.enabled {
                CliInstallation::Enabled
            } else {
                CliInstallation::Disabled
            }
        }
        _ => CliInstallation::Unknown,
    }
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

async fn agy_cli_output(project_path: &str) -> Result<String, String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        tokio::process::Command::new("agy")
            .args(["mcp", "list"])
            .current_dir(project_path)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "timeout no inventário MCP do CLI".to_string())?
    .map_err(|error| format!("`agy mcp list` falhou: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "`agy mcp list` falhou: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

async fn inspect_agy(project_path: &str) -> Result<Vec<ProviderMcpServer>, String> {
    checked_agy_table(&agy_cli_output(project_path).await?)
}

/// Identidade pública de uma entrada global. O resto do app não reconstrói
/// argv deste resumo; compara apenas com a receita fixa que ele próprio instala.
pub struct GlobalCliEntry {
    pub enabled: bool,
    pub transport: String,
    pub command_line: String,
}

fn global_entry(output: &str, name: &str) -> Result<Option<GlobalCliEntry>, String> {
    checked_agy_table(output)?;
    let clean = strip_ansi(output);
    let mut found = None;
    for line in clean.lines() {
        let columns: Vec<_> = line.split_whitespace().take(3).collect();
        if columns.len() != 3 || columns[0] != name {
            continue;
        }
        if found.is_some() {
            return Err("nome duplicado no inventário global".into());
        }
        let mut tail = line.trim_start();
        for _ in 0..3 {
            tail = tail
                .find(char::is_whitespace)
                .map(|index| tail[index..].trim_start())
                .unwrap_or("");
        }
        found = Some(GlobalCliEntry {
            enabled: columns[2] == "enabled",
            transport: columns[1].into(),
            command_line: tail.trim_end().into(),
        });
    }
    Ok(found)
}

pub fn global_work_min_version(agent: &str) -> Option<&'static str> {
    match probe_for(agent).0 {
        Probe::AgyCliSummary => Some("1.1.27"),
        _ => None,
    }
}

pub async fn inspect_global_entry(
    agent: &str,
    name: &str,
) -> Result<Option<GlobalCliEntry>, String> {
    if probe_for(agent).0 != Probe::AgyCliSummary {
        return Err("inventário global sem dialeto conhecido".into());
    }
    let output = agy_cli_output(&std::env::temp_dir().to_string_lossy()).await?;
    lembrar_navegadores_externos(agent, &parse_agy_table(&output));
    global_entry(&output, name)
}

/// Navegadores de terceiro habilitados no cadastro GLOBAL de um motor, como
/// vistos na última leitura do CLI (boot, Configurações, toggles). Cache de
/// vida do processo: o manifesto do run LÊ daqui e nunca sobe subprocesso
/// (`AGENTS.md` do backend). Vazio também quando nunca se leu.
fn navegadores_externos_cache() -> &'static std::sync::Mutex<HashMap<String, Vec<String>>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Vec<String>>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub(crate) fn lembrar_navegadores_externos(agent: &str, servers: &[ProviderMcpServer]) {
    let mut nomes: Vec<String> = servers
        .iter()
        .filter(|s| s.enabled && s.resource_kinds.contains(&crate::resource_broker::ResourceKind::ExternalBrowser))
        .map(|s| s.name.clone())
        .collect();
    nomes.sort();
    nomes.dedup();
    if let Ok(mut cache) = navegadores_externos_cache().lock() {
        cache.insert(agent.to_string(), nomes);
    }
}

pub(crate) fn navegadores_externos_em_cache(agent: &str) -> Vec<String> {
    navegadores_externos_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(agent).cloned())
        .unwrap_or_default()
}

fn checked_agy_table(output: &str) -> Result<Vec<ProviderMcpServer>, String> {
    let servers = parse_agy_table(output);
    // Uma saída nova/incompleta não prova ausência e não libera sobrescrita.
    let clean = strip_ansi(output);
    let lines: Vec<_> = clean
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let header = lines.first().is_some_and(|line| {
        line.split_whitespace()
            .take(3)
            .eq(["NAME", "TYPE", "STATUS"])
    });
    if header && servers.len() + 1 == lines.len() {
        return Ok(servers);
    }
    if clean.trim() == "No MCP servers configured." {
        return Ok(Vec::new());
    }
    Err("formato do inventário MCP do CLI não reconhecido".into())
}

/// Usado pelo gesto de escrita para validar de novo só o CLI de destino.
pub async fn inspect_cli(agent: &str, project_path: &str) -> Result<ProviderMcpInventory, String> {
    let (probe, scope) = probe_for(agent);
    if probe != Probe::AgyCliSummary {
        return Err("este motor não publica inventário MCP global pelo CLI".into());
    }
    Ok(inventory(
        agent,
        ProviderMcpInventoryEvidence::Summary,
        scope,
        inspect_agy(project_path).await?,
        None,
    ))
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
    fn entrada_global_preserva_caminho_com_espacos_e_nao_inventa_comando() {
        // Mesma captura do parser de resumo, com caminhos e argumentos intactos.
        let output = "NAME TYPE STATUS COMMAND/URL\ncomputer-use stdio enabled /App Com Espaços mcp\nplaywright stdio disabled npx pacote\n";
        let entry = global_entry(output, "computer-use").unwrap().unwrap();
        assert_eq!(entry.command_line, "/App Com Espaços mcp");
        assert!(entry.enabled);
        assert!(global_entry(output, "frota-work").unwrap().is_none());
        assert_eq!(
            global_entry(AGY_CAPTURE, "computer-use")
                .unwrap()
                .unwrap()
                .command_line,
            ""
        );
    }

    // Captura de `agy mcp list` em 08/09/2026. Coluna COMMAND/URL omitida:
    // identidade, transporte e status intactos; comando não participa do match.
    const AGY_CAPTURE: &str =
        "NAME TYPE STATUS\ncomputer-use stdio enabled\nplaywright stdio enabled\n";

    #[test]
    fn linha_global_reconhece_instalacao_sem_inventar_binding_ou_health() {
        let mut snapshot = inventory(
            "agy",
            ProviderMcpInventoryEvidence::Summary,
            CapabilityScope::Global,
            checked_agy_table(AGY_CAPTURE).unwrap(),
            None,
        );
        assert_eq!(
            cli_installation(&[snapshot.clone()], "agy", "computer-use", "stdio"),
            CliInstallation::Enabled
        );
        snapshot.servers[0].enabled = false;
        assert_eq!(
            cli_installation(&[snapshot.clone()], "agy", "computer-use", "stdio"),
            CliInstallation::Disabled
        );
        assert_eq!(
            cli_installation(&[snapshot.clone()], "agy", "ausente", "stdio"),
            CliInstallation::Absent
        );
        assert_eq!(
            cli_installation(&[snapshot.clone()], "codex", "computer-use", "stdio"),
            CliInstallation::Unknown
        );
        assert_eq!(
            cli_installation(&[snapshot.clone()], "agy", "computer-use", "http"),
            CliInstallation::Unknown
        );
        snapshot.evidence = ProviderMcpInventoryEvidence::Unavailable;
        assert_eq!(
            cli_installation(&[snapshot], "agy", "ausente", "stdio"),
            CliInstallation::Unknown
        );
    }

    #[test]
    fn inventario_parcial_ou_dialeto_desconhecido_nao_afirma_ausencia() {
        assert!(checked_agy_table(" ").is_err());
        assert!(checked_agy_table("Usage: agy mcp list").is_err());
        assert!(checked_agy_table(
            &AGY_CAPTURE.replace("playwright stdio enabled", "playwright stdio unknown")
        )
        .is_err());
        assert!(checked_agy_table("NAME TYPE STATUS\n").unwrap().is_empty());
    }

    #[test]
    fn homonimos_ambiguos_nao_liberam_efeito() {
        let mut snapshot = inventory(
            "agy",
            ProviderMcpInventoryEvidence::Summary,
            CapabilityScope::Global,
            checked_agy_table(AGY_CAPTURE).unwrap(),
            None,
        );
        snapshot.servers.push(snapshot.servers[0].clone());
        assert_eq!(
            cli_installation(&[snapshot], "agy", "computer-use", "stdio"),
            CliInstallation::Unknown
        );
    }

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
