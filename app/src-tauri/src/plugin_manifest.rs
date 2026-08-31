//! Contrato e inventário seguro de plugins.
//!
//! Esta fase só lê e valida pacotes em `app_data/plugins`. Nenhum `main` é
//! executado: ativação depende de host supervisionado, consentimento pelo
//! fingerprint e gates por capability.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

use crate::resource_broker::ResourceKind;

const MANIFEST_FILE: &str = "frota-plugin.json";
pub(crate) const MANIFEST_VERSION: u8 = 1;
const PLUGIN_API: u8 = 1;
const MAX_MANIFEST_BYTES: u64 = 128 * 1024;
const MAX_PACKAGE_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PACKAGE_ENTRIES: usize = 4096;
const MAX_PACKAGE_FILES: usize = 2048;
const MAX_PLUGINS: usize = 128;
const MAX_CONTRIBUTIONS: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
pub enum PluginCapability {
    #[serde(rename = "workspace:read")]
    WorkspaceRead,
    #[serde(rename = "workspace:write")]
    WorkspaceWrite,
    #[serde(rename = "process:spawn")]
    ProcessSpawn,
    #[serde(rename = "network:connect")]
    NetworkConnect,
    #[serde(rename = "mcp:provide")]
    McpProvide,
    #[serde(rename = "tools:provide")]
    ToolsProvide,
    #[serde(rename = "browser:control")]
    BrowserControl,
    #[serde(rename = "desktop:control")]
    DesktopControl,
    #[serde(rename = "secrets:read")]
    SecretsRead,
    #[serde(rename = "notifications:show")]
    NotificationsShow,
}

impl PluginCapability {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceRead => "workspace:read",
            Self::WorkspaceWrite => "workspace:write",
            Self::ProcessSpawn => "process:spawn",
            Self::NetworkConnect => "network:connect",
            Self::McpProvide => "mcp:provide",
            Self::ToolsProvide => "tools:provide",
            Self::BrowserControl => "browser:control",
            Self::DesktopControl => "desktop:control",
            Self::SecretsRead => "secrets:read",
            Self::NotificationsShow => "notifications:show",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PluginEngines {
    pub(crate) frota: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FileContribution {
    pub(crate) id: String,
    pub(crate) path: String,
}

fn object_schema() -> Value {
    json!({ "type": "object", "additionalProperties": false })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ToolContribution {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) description: String,
    #[serde(default = "object_schema")]
    pub(crate) input_schema: Value,
    #[serde(default)]
    pub(crate) resources: Vec<ResourceKind>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginContributions {
    #[serde(default)]
    pub(crate) skills: Vec<FileContribution>,
    #[serde(default)]
    pub(crate) mcp_servers: Vec<FileContribution>,
    #[serde(default)]
    pub(crate) tools: Vec<ToolContribution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PluginManifest {
    #[serde(rename = "$schema", default)]
    pub(crate) schema: Option<String>,
    pub(crate) manifest_version: u8,
    pub(crate) plugin_api: u8,
    pub(crate) publisher: String,
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) description: Option<String>,
    pub(crate) engines: PluginEngines,
    #[serde(default)]
    pub(crate) main: Option<String>,
    #[serde(default)]
    pub(crate) capabilities: Vec<PluginCapability>,
    #[serde(default)]
    pub(crate) contributes: PluginContributions,
}

impl PluginManifest {
    pub(crate) fn key(&self) -> String {
        format!("{}.{}", self.publisher, self.id)
    }

    pub(crate) fn capability_names(&self) -> Vec<String> {
        let mut capabilities: Vec<String> = self
            .capabilities
            .iter()
            .map(|capability| capability.as_str().to_string())
            .collect();
        capabilities.sort();
        capabilities
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PluginPackage {
    pub(crate) root: PathBuf,
    pub(crate) manifest: PluginManifest,
    pub(crate) fingerprint: String,
}

impl PluginPackage {
    pub(crate) fn key(&self) -> String {
        self.manifest.key()
    }

    pub(crate) fn main_path(&self) -> Result<PathBuf, String> {
        let relative = self
            .manifest
            .main
            .as_deref()
            .ok_or_else(|| "plugin não declara main".to_string())?;
        contained_file(&self.root, relative)
    }
}

#[derive(Clone, Debug)]
pub(crate) enum PluginScan {
    Valid(PluginPackage),
    Invalid(InvalidPluginPackage),
}

#[derive(Clone, Debug)]
pub(crate) struct InvalidPluginPackage {
    pub(crate) key: String,
    pub(crate) name: String,
    pub(crate) detail: String,
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

fn safe_relative(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn valid_semver(value: &str) -> bool {
    Version::parse(value).is_ok()
}

fn engine_supported(host: &str, range: &str) -> bool {
    let Some(minimum) = range.strip_prefix(">=") else {
        return false;
    };
    match (Version::parse(host), Version::parse(minimum)) {
        (Ok(host), Ok(minimum)) => host >= minimum,
        _ => false,
    }
}

fn validate_contributions(items: &[FileContribution], label: &str) -> Result<(), String> {
    if items.len() > MAX_CONTRIBUTIONS {
        return Err(format!("{label} excede o limite de {MAX_CONTRIBUTIONS}"));
    }
    let mut ids = HashSet::new();
    for item in items {
        if !safe_id(&item.id) {
            return Err(format!("{label}.id inválido: {}", item.id));
        }
        if !ids.insert(&item.id) {
            return Err(format!("{label}.id duplicado: {}", item.id));
        }
        if !safe_relative(&item.path) {
            return Err(format!("{label}.path precisa ser relativo e contido"));
        }
    }
    Ok(())
}

fn validate_tool_contributions(items: &[ToolContribution]) -> Result<(), String> {
    if items.len() > MAX_CONTRIBUTIONS {
        return Err(format!(
            "contributes.tools excede o limite de {MAX_CONTRIBUTIONS}"
        ));
    }
    let mut ids = HashSet::new();
    for item in items {
        if !safe_id(&item.id) {
            return Err(format!("contributes.tools.id inválido: {}", item.id));
        }
        if !ids.insert(&item.id) {
            return Err(format!("contributes.tools.id duplicado: {}", item.id));
        }
        if item.title.trim().is_empty() || item.title.chars().count() > 128 {
            return Err(format!(
                "contributes.tools.{}.title precisa ter entre 1 e 128 caracteres",
                item.id
            ));
        }
        if item.description.trim().is_empty() || item.description.chars().count() > 4096 {
            return Err(format!(
                "contributes.tools.{}.description precisa ter entre 1 e 4096 caracteres",
                item.id
            ));
        }
        let Some(schema) = item.input_schema.as_object() else {
            return Err(format!(
                "contributes.tools.{}.inputSchema precisa ser um objeto JSON Schema",
                item.id
            ));
        };
        if schema.get("type").and_then(Value::as_str) != Some("object") {
            return Err(format!(
                "contributes.tools.{}.inputSchema precisa declarar type object",
                item.id
            ));
        }
        let mut resources = HashSet::new();
        if item
            .resources
            .iter()
            .any(|resource| !resources.insert(*resource))
        {
            return Err(format!(
                "contributes.tools.{}.resources contém item duplicado",
                item.id
            ));
        }
    }
    Ok(())
}

fn parse_manifest(bytes: &[u8], host_version: &str) -> Result<PluginManifest, String> {
    let manifest: PluginManifest =
        serde_json::from_slice(bytes).map_err(|error| format!("JSON inválido: {error}"))?;
    if manifest.manifest_version != MANIFEST_VERSION {
        return Err(format!(
            "manifestVersion {} não é suportada",
            manifest.manifest_version
        ));
    }
    if manifest
        .schema
        .as_ref()
        .is_some_and(|schema| schema.is_empty() || schema.len() > 512)
    {
        return Err("$schema precisa ter entre 1 e 512 bytes".into());
    }
    if manifest.plugin_api != PLUGIN_API {
        return Err(format!("pluginApi {} não é suportada", manifest.plugin_api));
    }
    if !safe_id(&manifest.publisher) || !safe_id(&manifest.id) {
        return Err("publisher e id usam apenas minúsculas, números e hífen".into());
    }
    if manifest.name.trim().is_empty() || manifest.name.chars().count() > 128 {
        return Err("name precisa ter entre 1 e 128 caracteres".into());
    }
    if !valid_semver(&manifest.version) {
        return Err("version precisa ser semver".into());
    }
    if !engine_supported(host_version, &manifest.engines.frota) {
        return Err(format!(
            "engines.frota exige {} e este host é {}",
            manifest.engines.frota, host_version
        ));
    }
    if manifest
        .description
        .as_ref()
        .is_some_and(|text| text.len() > 4096)
    {
        return Err("description excede 4096 bytes".into());
    }
    if manifest.capabilities.len() > 32 {
        return Err("capabilities excede o limite de 32".into());
    }
    let mut capabilities = HashSet::new();
    if manifest
        .capabilities
        .iter()
        .any(|capability| !capabilities.insert(*capability))
    {
        return Err("capability duplicada".into());
    }
    if manifest
        .main
        .as_ref()
        .is_some_and(|path| !safe_relative(path))
    {
        return Err("main precisa ser relativo e contido".into());
    }
    validate_contributions(&manifest.contributes.skills, "contributes.skills")?;
    validate_contributions(&manifest.contributes.mcp_servers, "contributes.mcpServers")?;
    validate_tool_contributions(&manifest.contributes.tools)?;
    if !manifest.contributes.mcp_servers.is_empty()
        && !capabilities.contains(&PluginCapability::McpProvide)
    {
        return Err("contributes.mcpServers exige capability mcp:provide".into());
    }
    if !manifest.contributes.tools.is_empty() {
        if manifest.main.is_none() {
            return Err("contributes.tools exige main".into());
        }
        if !capabilities.contains(&PluginCapability::ToolsProvide) {
            return Err("contributes.tools exige capability tools:provide".into());
        }
    }
    for tool in &manifest.contributes.tools {
        for resource in &tool.resources {
            let granted = match resource {
                ResourceKind::ProjectBrowser | ResourceKind::ExternalBrowser => {
                    capabilities.contains(&PluginCapability::BrowserControl)
                }
                ResourceKind::DesktopControl => {
                    capabilities.contains(&PluginCapability::DesktopControl)
                }
            };
            if !granted {
                return Err(format!(
                    "contributes.tools.{} pede recurso sem a capability correspondente",
                    tool.id
                ));
            }
        }
    }
    Ok(manifest)
}

pub(crate) fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > max {
        return Err(format!("{} excede {} KiB", path.display(), max / 1024));
    }
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len().min(max) as usize);
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max {
        return Err(format!("{} excede {} KiB", path.display(), max / 1024));
    }
    Ok(bytes)
}

pub(crate) fn contained_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !safe_relative(relative) {
        return Err("caminho relativo inválido".into());
    }
    let path = std::fs::canonicalize(root.join(relative))
        .map_err(|_| format!("arquivo declarado não existe: {relative}"))?;
    if !path.starts_with(root) || !path.is_file() {
        return Err(format!("arquivo declarado escaparia do plugin: {relative}"));
    }
    Ok(path)
}

fn fingerprint(root: &Path, manifest: &PluginManifest) -> Result<String, String> {
    let root = std::fs::canonicalize(root)
        .map_err(|error| format!("raiz do plugin não pôde ser resolvida: {error}"))?;

    // Paths declarados continuam sendo contrato: mesmo que a árvore inteira
    // entre no hash, um manifesto apontando para arquivo ausente não pode ser
    // considerado válido.
    let declared: Vec<&str> = manifest
        .main
        .iter()
        .map(String::as_str)
        .chain(
            manifest
                .contributes
                .skills
                .iter()
                .map(|item| item.path.as_str()),
        )
        .chain(
            manifest
                .contributes
                .mcp_servers
                .iter()
                .map(|item| item.path.as_str()),
        )
        .collect();
    for relative in declared {
        contained_file(&root, relative)?;
    }

    // O `main` pode importar módulos auxiliares. Hash só dos paths declarados
    // permitiria trocar esse código sem renovar o grant. A unidade de
    // consentimento é o pacote inteiro, com limites para discovery não virar
    // varredura sem teto. Symlink é recusado porque tornaria o fingerprint
    // dependente de bytes mutáveis fora da raiz revisada.
    let mut stack = vec![root.clone()];
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    let mut entries = 0_usize;
    while let Some(directory) = stack.pop() {
        let children = std::fs::read_dir(&directory)
            .map_err(|error| format!("não consegui ler o pacote: {error}"))?;
        for child in children {
            let child = child.map_err(|error| format!("entrada inválida no pacote: {error}"))?;
            entries += 1;
            if entries > MAX_PACKAGE_ENTRIES {
                return Err(format!(
                    "pacote excede o limite de {MAX_PACKAGE_ENTRIES} entradas"
                ));
            }
            let file_type = child
                .file_type()
                .map_err(|error| format!("tipo de arquivo indisponível: {error}"))?;
            if file_type.is_symlink() {
                return Err(format!(
                    "plugin contém symlink não permitido: {}",
                    child.path().display()
                ));
            }
            if file_type.is_dir() {
                stack.push(child.path());
                continue;
            }
            if !file_type.is_file() {
                return Err(format!(
                    "plugin contém entrada que não é arquivo regular: {}",
                    child.path().display()
                ));
            }
            let relative = child
                .path()
                .strip_prefix(&root)
                .ok()
                .and_then(Path::to_str)
                .ok_or_else(|| "plugin contém path que não pode ser fingerprintado".to_string())?
                .to_string();
            files.push((relative, child.path()));
            if files.len() > MAX_PACKAGE_FILES {
                return Err(format!(
                    "pacote excede o limite de {MAX_PACKAGE_FILES} arquivos"
                ));
            }
        }
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));

    let mut hasher = blake3::Hasher::new();
    hasher.update(&serde_json::to_vec(manifest).map_err(|error| error.to_string())?);
    let mut total = 0_u64;
    for (relative, path) in files {
        let bytes = read_capped(&path, MAX_PACKAGE_FILE_BYTES)?;
        total = total
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "tamanho do pacote excedeu o limite".to_string())?;
        if total > MAX_PACKAGE_BYTES {
            return Err(format!(
                "pacote excede o limite de {} MiB",
                MAX_PACKAGE_BYTES / 1024 / 1024
            ));
        }
        hasher.update(&(relative.len() as u64).to_le_bytes());
        hasher.update(relative.as_bytes());
        hasher.update(&(bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn invalid_package(folder: &str, detail: String) -> InvalidPluginPackage {
    InvalidPluginPackage {
        key: folder.to_string(),
        name: folder.to_string(),
        detail,
    }
}

pub(crate) fn inspect_plugin_dir(path: &Path) -> PluginScan {
    let folder = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("plugin");
    let Ok(root) = std::fs::canonicalize(path) else {
        return PluginScan::Invalid(invalid_package(
            folder,
            "pasta do plugin não pôde ser resolvida".into(),
        ));
    };
    let bytes = match read_capped(&root.join(MANIFEST_FILE), MAX_MANIFEST_BYTES) {
        Ok(bytes) => bytes,
        Err(error) => return PluginScan::Invalid(invalid_package(folder, error)),
    };
    let manifest = match parse_manifest(&bytes, env!("CARGO_PKG_VERSION")) {
        Ok(manifest) => manifest,
        Err(error) => return PluginScan::Invalid(invalid_package(folder, error)),
    };
    let digest = match fingerprint(&root, &manifest) {
        Ok(digest) => digest,
        Err(error) => return PluginScan::Invalid(invalid_package(folder, error)),
    };
    let package = PluginPackage {
        root,
        manifest,
        fingerprint: digest,
    };
    let conformance = crate::plugin_contributions::validate_package(&package)
        .and_then(|_| crate::plugin_mcp::validate_package(&package));
    if let Err(detail) = conformance {
        return PluginScan::Invalid(InvalidPluginPackage {
            key: package.key(),
            name: package.manifest.name.clone(),
            detail: format!("contribuição inválida: {detail}"),
        });
    }
    PluginScan::Valid(package)
}

fn ensure_unique_plugin_keys(plugins: &[PluginScan]) -> Result<(), String> {
    let mut valid_keys = HashSet::new();
    for plugin in plugins {
        if let PluginScan::Valid(package) = plugin {
            let key = package.key();
            if !valid_keys.insert(key.clone()) {
                return Err(format!(
                    "mais de um pacote declara a identidade {key}; remova a duplicata"
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn scan_plugins(app: &tauri::AppHandle) -> Result<Vec<PluginScan>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("plugins");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("não consegui ler a pasta de plugins: {error}")),
    };
    let mut plugins = Vec::new();
    let mut candidates = 0_usize;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("entrada inválida na pasta de plugins: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("tipo de plugin indisponível: {error}"))?;
        if !file_type.is_dir() && !file_type.is_symlink() {
            continue;
        }
        candidates += 1;
        if candidates > MAX_PLUGINS {
            return Err(format!(
                "a pasta de plugins excede o limite de {MAX_PLUGINS} pacotes"
            ));
        }
        if file_type.is_symlink() {
            let folder = entry.file_name().to_str().unwrap_or("plugin").to_string();
            plugins.push(PluginScan::Invalid(invalid_package(
                &folder,
                "a pasta do plugin não pode ser um symlink".into(),
            )));
        } else {
            plugins.push(inspect_plugin_dir(&entry.path()));
        }
    }
    plugins.sort_by(|a, b| {
        let key = |plugin: &PluginScan| match plugin {
            PluginScan::Valid(package) => package.key(),
            PluginScan::Invalid(package) => package.key.clone(),
        };
        key(a).cmp(&key(b))
    });
    ensure_unique_plugin_keys(&plugins)?;
    Ok(plugins)
}

pub(crate) fn find_plugin(
    app: &tauri::AppHandle,
    plugin_key: &str,
) -> Result<PluginPackage, String> {
    scan_plugins(app)?
        .into_iter()
        .find_map(|plugin| match plugin {
            PluginScan::Valid(package) if package.key() == plugin_key => Some(package),
            _ => None,
        })
        .ok_or_else(|| "plugin válido não encontrado na descoberta atual".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sdk_schemas_sao_json_e_exemplo_passa_no_parser_real() {
        let sdk = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugin-sdk");
        for schema in [
            "schemas/frota-plugin.schema.json",
            "schemas/frota-mcp.schema.json",
        ] {
            let bytes = std::fs::read(sdk.join(schema)).unwrap();
            serde_json::from_slice::<Value>(&bytes).unwrap();
        }

        let example = sdk.join("examples/quality-kit");
        let PluginScan::Valid(package) = inspect_plugin_dir(&example) else {
            panic!("o exemplo canônico do SDK precisa ser um plugin válido");
        };
        assert_eq!(package.key(), "acme.quality-kit");
        assert_eq!(package.manifest.contributes.skills.len(), 1);
        assert_eq!(package.manifest.contributes.mcp_servers.len(), 1);
    }

    #[test]
    fn conjunto_de_capabilities_e_fechado_e_espelhado_no_frontend() {
        let names = [
            PluginCapability::WorkspaceRead,
            PluginCapability::WorkspaceWrite,
            PluginCapability::ProcessSpawn,
            PluginCapability::NetworkConnect,
            PluginCapability::McpProvide,
            PluginCapability::ToolsProvide,
            PluginCapability::BrowserControl,
            PluginCapability::DesktopControl,
            PluginCapability::SecretsRead,
            PluginCapability::NotificationsShow,
        ]
        .map(PluginCapability::as_str);
        assert_eq!(
            names,
            [
                "workspace:read",
                "workspace:write",
                "process:spawn",
                "network:connect",
                "mcp:provide",
                "tools:provide",
                "browser:control",
                "desktop:control",
                "secrets:read",
                "notifications:show",
            ]
        );
    }

    fn manifest(extra: &str) -> Vec<u8> {
        format!(
            r#"{{
              "manifestVersion": 1,
              "pluginApi": 1,
              "publisher": "acme",
              "id": "quality",
              "name": "Quality",
              "version": "1.2.3",
              "engines": {{ "frota": ">=0.1.0" }},
              "capabilities": ["workspace:read"]{extra}
            }}"#
        )
        .into_bytes()
    }

    #[test]
    fn manifesto_fechado_valida_identidade_versao_e_capabilities() {
        let parsed = parse_manifest(&manifest(""), "0.1.0").unwrap();
        assert_eq!(parsed.publisher, "acme");
        assert_eq!(parsed.capabilities, vec![PluginCapability::WorkspaceRead]);

        let version_invalida = String::from_utf8(manifest(""))
            .unwrap()
            .replace("1.2.3", "1.2.3-");
        assert!(parse_manifest(version_invalida.as_bytes(), "0.1.0").is_err());
    }

    #[test]
    fn campo_desconhecido_e_capability_desconhecida_falham_fechado() {
        assert!(parse_manifest(&manifest(", \"surpresa\": true"), "0.1.0").is_err());
        let raw = String::from_utf8(manifest(""))
            .unwrap()
            .replace("workspace:read", "filesystem:tudo");
        assert!(parse_manifest(raw.as_bytes(), "0.1.0").is_err());
    }

    #[test]
    fn identidade_duplicada_falha_em_vez_de_escolher_pacote_por_ordem_de_disco() {
        let manifest = parse_manifest(&manifest(""), "0.1.0").unwrap();
        let package = |root: &str| {
            PluginScan::Valid(PluginPackage {
                root: PathBuf::from(root),
                manifest: manifest.clone(),
                fingerprint: root.into(),
            })
        };
        let error = ensure_unique_plugin_keys(&[package("/a"), package("/b")]).unwrap_err();
        assert!(error.contains("acme.quality"));
    }

    #[test]
    fn mcp_contribuido_exige_capability_explicita() {
        let raw = manifest(
            r#", "contributes": { "mcpServers": [{ "id": "docs", "path": "mcp/docs.json" }] }"#,
        );
        let error = parse_manifest(&raw, "0.1.0").unwrap_err();
        assert!(error.contains("mcp:provide"));
    }

    #[test]
    fn tool_exige_worker_capability_e_recurso_declarado() {
        let raw = String::from_utf8(manifest(
            r#", "main": "main", "contributes": { "tools": [{ "id": "auditar", "title": "Auditar", "description": "Audita a página ativa", "inputSchema": { "type": "object" }, "resources": ["project-browser"] }] }"#,
        ))
        .unwrap()
        .replace(
            "[\"workspace:read\"]",
            "[\"workspace:read\", \"tools:provide\", \"browser:control\"]",
        );
        let parsed = parse_manifest(raw.as_bytes(), "0.1.0").unwrap();
        assert_eq!(parsed.contributes.tools.len(), 1);

        let sem_capability = raw.replace(", \"browser:control\"", "");
        assert!(parse_manifest(sem_capability.as_bytes(), "0.1.0").is_err());
    }

    #[test]
    fn fingerprint_muda_quando_conteudo_executavel_muda() {
        let root = std::env::temp_dir().join(format!("frota-plugin-main-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.js"), "primeiro").unwrap();
        let mut parsed = parse_manifest(&manifest(""), "0.1.0").unwrap();
        parsed.main = Some("main.js".into());
        let first = fingerprint(&root, &parsed).unwrap();
        std::fs::write(root.join("main.js"), "segundo").unwrap();
        let second = fingerprint(&root, &parsed).unwrap();
        assert_ne!(first, second);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn fingerprint_inclui_modulo_auxiliar_nao_declarado() {
        let root =
            std::env::temp_dir().join(format!("frota-plugin-auxiliar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.js"), "import './helper.js'").unwrap();
        std::fs::write(root.join("helper.js"), "primeiro").unwrap();
        let mut parsed = parse_manifest(&manifest(""), "0.1.0").unwrap();
        parsed.main = Some("main.js".into());
        let first = fingerprint(&root, &parsed).unwrap();
        std::fs::write(root.join("helper.js"), "segundo").unwrap();
        let second = fingerprint(&root, &parsed).unwrap();
        assert_ne!(first, second);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn pacote_com_symlink_falha_fechado() {
        use std::os::unix::fs::symlink;

        let root =
            std::env::temp_dir().join(format!("frota-plugin-symlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.js"), "main").unwrap();
        symlink("main.js", root.join("alias.js")).unwrap();
        let mut parsed = parse_manifest(&manifest(""), "0.1.0").unwrap();
        parsed.main = Some("main.js".into());
        assert!(fingerprint(&root, &parsed)
            .unwrap_err()
            .contains("symlink não permitido"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn caminho_de_contribuicao_nao_escapa_do_pacote() {
        let raw = manifest(
            r#", "contributes": { "skills": [{ "id": "review", "path": "../SKILL.md" }] }"#,
        );
        assert!(parse_manifest(&raw, "0.1.0").is_err());
    }
}
