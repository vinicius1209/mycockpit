//! Materialização segura de MCPs contribuídos por plugins.
//!
//! O provider nunca recebe o executável contribuído diretamente. Para stdio,
//! ele inicia este mesmo binário no subcomando `plugin-mcp-server`; o launcher
//! revalida pacote, fingerprint e grant capturado antes de supervisionar o
//! processo. Endpoints HTTP são aceitos apenas sem credenciais literais.

use serde::{Deserialize, Serialize};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::process::Command;

use crate::mcp_control::{McpLaunchConfig, McpRuntimeServer};
use crate::plugin_manifest::{FileContribution, PluginCapability, PluginPackage, PluginScan};

pub const SUBCOMMAND: &str = "plugin-mcp-server";
const DEFINITION_VERSION: u8 = 1;
const DESCRIPTOR_VERSION: u8 = 1;
const MAX_DEFINITION_BYTES: u64 = 128 * 1024;
const MAX_DESCRIPTOR_BYTES: u64 = 64 * 1024;
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PluginMcpCwd {
    #[default]
    Plugin,
    Project,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum PluginMcpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: PluginMcpCwd,
    },
    Http {
        url: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginMcpDefinition {
    #[serde(rename = "$schema", default)]
    _schema: Option<String>,
    schema_version: u8,
    name: String,
    transport: PluginMcpTransport,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LaunchDescriptor {
    version: u8,
    plugin_root: String,
    plugin_key: String,
    fingerprint: String,
    contribution_id: String,
    project_path: String,
    db_path: String,
}

#[derive(Debug)]
pub struct PluginMcpLaunchLease {
    descriptor: PathBuf,
}

impl Drop for PluginMcpLaunchLease {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.descriptor);
    }
}

#[derive(Default)]
pub(crate) struct PluginMcpSnapshot {
    pub(crate) servers: Vec<McpRuntimeServer>,
    pub(crate) leases: Vec<Arc<PluginMcpLaunchLease>>,
    pub(crate) notices: Vec<String>,
}

fn has_capability(package: &PluginPackage, wanted: PluginCapability) -> bool {
    package.manifest.capabilities.contains(&wanted)
}

fn parse_definition(
    package: &PluginPackage,
    contribution: &FileContribution,
) -> Result<PluginMcpDefinition, String> {
    let path = crate::plugin_manifest::contained_file(&package.root, &contribution.path)?;
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err(format!(
            "MCP {} de {} precisa apontar para um JSON",
            contribution.id,
            package.key()
        ));
    }
    let bytes = crate::plugin_manifest::read_capped(&path, MAX_DEFINITION_BYTES)?;
    let definition: PluginMcpDefinition = serde_json::from_slice(&bytes)
        .map_err(|error| format!("definição MCP inválida: {error}"))?;
    if definition
        ._schema
        .as_ref()
        .is_some_and(|schema| schema.is_empty() || schema.len() > 512)
    {
        return Err("$schema do MCP precisa ter entre 1 e 512 bytes".into());
    }
    if definition.schema_version != DEFINITION_VERSION {
        return Err(format!(
            "schemaVersion {} do MCP não é suportada",
            definition.schema_version
        ));
    }
    if definition.name.trim().is_empty() || definition.name.chars().count() > 128 {
        return Err("name do MCP precisa ter entre 1 e 128 caracteres".into());
    }
    match &definition.transport {
        PluginMcpTransport::Stdio { command, args, cwd } => {
            if !has_capability(package, PluginCapability::ProcessSpawn) {
                return Err("MCP stdio exige capability process:spawn".into());
            }
            let executable = crate::plugin_manifest::contained_file(&package.root, command)?;
            if !crate::plugin_runtime::executable(&executable) {
                return Err("command do MCP stdio não é executável".into());
            }
            if args.len() > 64
                || args
                    .iter()
                    .any(|arg| arg.contains('\0') || arg.len() > 4096)
                || args.iter().map(String::len).sum::<usize>() > 32 * 1024
            {
                return Err("args do MCP stdio excedem o limite".into());
            }
            if matches!(cwd, PluginMcpCwd::Project)
                && !has_capability(package, PluginCapability::WorkspaceRead)
                && !has_capability(package, PluginCapability::WorkspaceWrite)
            {
                return Err("cwd project exige workspace:read ou workspace:write".into());
            }
        }
        PluginMcpTransport::Http { url } => {
            if !has_capability(package, PluginCapability::NetworkConnect) {
                return Err("MCP HTTP exige capability network:connect".into());
            }
            validate_http_url(url)?;
        }
    }
    Ok(definition)
}

/// Conformance estática. Health continua sendo verificado por run, mas formato,
/// capability, path e executabilidade precisam estar corretos antes do grant.
pub(crate) fn validate_package(package: &PluginPackage) -> Result<(), String> {
    for contribution in &package.manifest.contributes.mcp_servers {
        parse_definition(package, contribution)?;
    }
    Ok(())
}

fn validate_http_url(value: &str) -> Result<(), String> {
    let parsed = url::Url::parse(value).map_err(|_| "URL do MCP é inválida".to_string())?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("MCP HTTP exige HTTPS; HTTP só é aceito em loopback".into());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("URL de MCP contribuído não pode conter credencial, query ou fragmento".into());
    }
    Ok(())
}

fn runtime_name(plugin_key: &str, contribution_id: &str) -> String {
    let segment = |value: &str| {
        value
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect::<String>()
    };
    format!(
        "plugin__{}__{}",
        segment(plugin_key),
        segment(contribution_id)
    )
}

fn write_descriptor(descriptor: &LaunchDescriptor) -> Result<PluginMcpLaunchLease, String> {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let bytes = serde_json::to_vec(descriptor).map_err(|error| error.to_string())?;
    for _ in 0..4 {
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "frota-plugin-mcp-{}-{sequence}.json",
            std::process::id()
        ));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                file.write_all(&bytes).map_err(|error| error.to_string())?;
                file.sync_all().map_err(|error| error.to_string())?;
                return Ok(PluginMcpLaunchLease { descriptor: path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("não consegui preparar o launcher MCP: {error}")),
        }
    }
    Err("não consegui reservar o descriptor do launcher MCP".into())
}

fn launch_for(
    app: &tauri::AppHandle,
    package: &PluginPackage,
    contribution: &FileContribution,
    definition: &PluginMcpDefinition,
    project_path: &str,
) -> Result<(McpLaunchConfig, Option<Arc<PluginMcpLaunchLease>>), String> {
    match &definition.transport {
        PluginMcpTransport::Http { url } => Ok((
            McpLaunchConfig {
                transport: "http".into(),
                url: Some(url.clone()),
                ..Default::default()
            },
            None,
        )),
        PluginMcpTransport::Stdio { .. } => {
            let server_bin = std::env::current_exe()
                .map_err(|error| format!("binário da Frota indisponível: {error}"))?;
            let project_path = std::fs::canonicalize(project_path)
                .map_err(|error| format!("projeto do run indisponível: {error}"))?;
            if !project_path.is_dir() {
                return Err("project_path do launcher MCP não é uma pasta".into());
            }
            let lease = Arc::new(write_descriptor(&LaunchDescriptor {
                version: DESCRIPTOR_VERSION,
                plugin_root: package.root.to_string_lossy().to_string(),
                plugin_key: package.key(),
                fingerprint: package.fingerprint.clone(),
                contribution_id: contribution.id.clone(),
                project_path: project_path.to_string_lossy().to_string(),
                db_path: app
                    .path()
                    .app_data_dir()
                    .map_err(|error| format!("banco de grants indisponível: {error}"))?
                    .join(crate::BANCO)
                    .to_string_lossy()
                    .to_string(),
            })?);
            Ok((
                McpLaunchConfig {
                    transport: "stdio".into(),
                    command: Some(server_bin.to_string_lossy().to_string()),
                    args: vec![
                        SUBCOMMAND.into(),
                        lease.descriptor.to_string_lossy().to_string(),
                    ],
                    ..Default::default()
                },
                Some(lease),
            ))
        }
    }
}

pub(crate) async fn materialize_for_run(
    app: &tauri::AppHandle,
    project_path: &str,
) -> Result<PluginMcpSnapshot, String> {
    let mut snapshot = PluginMcpSnapshot::default();
    for package in crate::plugin_contributions::enabled_packages(app)? {
        for contribution in &package.manifest.contributes.mcp_servers {
            let result = async {
                let definition = parse_definition(&package, contribution)?;
                let (launch, lease) =
                    launch_for(app, &package, contribution, &definition, project_path)?;
                let probe = crate::mcp_control::probe_launch(&launch, project_path).await;
                if probe.status != "healthy" {
                    return Err(probe
                        .detail
                        .unwrap_or_else(|| "health check não confirmou o MCP".into()));
                }
                Ok::<_, String>((definition, launch, lease, probe.tool_names))
            }
            .await;
            match result {
                Ok((definition, launch, lease, tool_names)) => {
                    snapshot.servers.push(McpRuntimeServer {
                        runtime_name: runtime_name(&package.key(), &contribution.id),
                        display_name: format!("{} · {}", package.manifest.name, definition.name),
                        launch,
                        tool_names,
                    });
                    if let Some(lease) = lease {
                        snapshot.leases.push(lease);
                    }
                }
                Err(error) => snapshot.notices.push(format!(
                    "MCP {} de {} não entrou neste run: {error}",
                    contribution.id, package.manifest.name
                )),
            }
        }
    }
    snapshot
        .servers
        .sort_by(|left, right| left.runtime_name.cmp(&right.runtime_name));
    Ok(snapshot)
}

fn load_stdio_descriptor(
    path: &Path,
) -> Result<(PluginPackage, PluginMcpDefinition, String), String> {
    let bytes = crate::plugin_manifest::read_capped(path, MAX_DESCRIPTOR_BYTES)?;
    let descriptor: LaunchDescriptor = serde_json::from_slice(&bytes)
        .map_err(|error| format!("descriptor MCP inválido: {error}"))?;
    if descriptor.version != DESCRIPTOR_VERSION {
        return Err("versão do descriptor MCP não suportada".into());
    }
    let package =
        match crate::plugin_manifest::inspect_plugin_dir(Path::new(&descriptor.plugin_root)) {
            PluginScan::Valid(package) => package,
            PluginScan::Invalid(package) => return Err(package.detail),
        };
    if package.key() != descriptor.plugin_key || package.fingerprint != descriptor.fingerprint {
        return Err("o pacote MCP mudou depois da materialização".into());
    }
    let conn = rusqlite::Connection::open(&descriptor.db_path)
        .map_err(|error| format!("grant do plugin indisponível: {error}"))?;
    if !crate::plugin_grants::is_enabled(&conn, &package)? {
        return Err("o grant do plugin foi revogado antes do launch".into());
    }
    let contribution = package
        .manifest
        .contributes
        .mcp_servers
        .iter()
        .find(|item| item.id == descriptor.contribution_id)
        .ok_or_else(|| "contribuição MCP não existe mais no manifesto".to_string())?;
    let definition = parse_definition(&package, contribution)?;
    if !matches!(&definition.transport, PluginMcpTransport::Stdio { .. }) {
        return Err("o launcher stdio recebeu uma definição de outro transporte".into());
    }
    Ok((package, definition, descriptor.project_path))
}

async fn relay_capped<R, W>(mut reader: R, mut writer: W) -> Result<(), String>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut frame_bytes = 0_usize;
    loop {
        let available = reader.fill_buf().await.map_err(|error| error.to_string())?;
        if available.is_empty() {
            writer.shutdown().await.map_err(|error| error.to_string())?;
            return Ok(());
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        frame_bytes = frame_bytes.saturating_add(take);
        if frame_bytes > MAX_FRAME_BYTES {
            return Err("frame MCP excedeu 4 MiB".into());
        }
        writer
            .write_all(&available[..take])
            .await
            .map_err(|error| error.to_string())?;
        let ended = available[take - 1] == b'\n';
        reader.consume(take);
        if ended {
            writer.flush().await.map_err(|error| error.to_string())?;
            frame_bytes = 0;
        }
    }
}

async fn serve_stdio(descriptor_path: PathBuf) -> Result<(), String> {
    let (package, definition, project_path) = load_stdio_descriptor(&descriptor_path)?;
    let PluginMcpTransport::Stdio { command, args, cwd } = definition.transport else {
        return Err("transporte MCP não é stdio".into());
    };
    let executable = crate::plugin_manifest::contained_file(&package.root, &command)?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    crate::plugin_runtime::configure_base_environment(&mut command, &package, &project_path);
    command.env("FROTA_PLUGIN_MCP_ID", definition.name);
    command.current_dir(match cwd {
        PluginMcpCwd::Plugin => package.root.clone(),
        PluginMcpCwd::Project => PathBuf::from(&project_path),
    });
    let mut child = command
        .spawn()
        .map_err(|error| format!("não consegui iniciar MCP contribuído: {error}"))?;
    let child_stdin = child.stdin.take().ok_or("stdin do MCP indisponível")?;
    let child_stdout = child.stdout.take().ok_or("stdout do MCP indisponível")?;
    let mut child_stderr = child.stderr.take().ok_or("stderr do MCP indisponível")?;
    let stderr_task = tokio::spawn(async move {
        let mut retained = Vec::new();
        let mut chunk = [0_u8; 8192];
        while let Ok(read) = child_stderr.read(&mut chunk).await {
            if read == 0 {
                break;
            }
            retained.extend_from_slice(&chunk[..read]);
            if retained.len() > MAX_STDERR_BYTES as usize {
                let excess = retained.len() - MAX_STDERR_BYTES as usize;
                retained.drain(..excess);
            }
        }
        String::from_utf8_lossy(&retained).to_string()
    });
    let upstream = relay_capped(BufReader::new(tokio::io::stdin()), child_stdin);
    let downstream = relay_capped(BufReader::new(child_stdout), tokio::io::stdout());
    tokio::pin!(upstream);
    tokio::pin!(downstream);
    let relay_result = tokio::select! {
        result = &mut upstream => result,
        result = &mut downstream => result,
    };
    let pid = child.id();
    if let Some(pid) = pid {
        #[cfg(unix)]
        crate::plugin_runtime::signal_process_group(pid, "-TERM");
        #[cfg(not(unix))]
        let _ = child.start_kill();
    }
    if tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .is_err()
    {
        if let Some(pid) = pid {
            #[cfg(unix)]
            crate::plugin_runtime::signal_process_group(pid, "-KILL");
        }
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    let stderr = stderr_task.await.unwrap_or_default();
    relay_result.map_err(|error| {
        if stderr.trim().is_empty() {
            error
        } else {
            format!("{error}: {}", stderr.lines().last().unwrap_or_default())
        }
    })
}

pub fn run_mcp_server() {
    let descriptor = std::env::args().nth(2).map(PathBuf::from);
    let result = descriptor
        .ok_or_else(|| "plugin-mcp-server sem descriptor".to_string())
        .and_then(|path| {
            let runtime = tokio::runtime::Runtime::new()
                .map_err(|error| format!("runtime MCP indisponível: {error}"))?;
            runtime.block_on(serve_stdio(path))
        });
    if let Err(error) = result {
        eprintln!("plugin-mcp-server: {error}");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn sdk_mcp_stdio_responde_ao_probe_real_com_inventario() {
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugin-sdk/examples/quality-kit");
        let launch = McpLaunchConfig {
            transport: "stdio".into(),
            command: Some(root.join("bin/server.mjs").to_string_lossy().to_string()),
            cwd: Some(root.to_string_lossy().to_string()),
            ..Default::default()
        };
        let outcome = crate::mcp_control::probe_launch(&launch, root.to_str().unwrap()).await;
        assert_eq!(outcome.status, "healthy", "{:?}", outcome.detail);
        assert_eq!(outcome.tool_names, vec!["quality_echo"]);
    }

    #[test]
    fn url_contribuida_recusa_segredo_e_http_externo() {
        assert!(validate_http_url("https://mcp.example.com/api").is_ok());
        assert!(validate_http_url("http://127.0.0.1:8080/mcp").is_ok());
        assert!(validate_http_url("http://mcp.example.com/api").is_err());
        assert!(validate_http_url("https://token@mcp.example.com/api").is_err());
        assert!(validate_http_url("https://mcp.example.com/api?token=x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_tem_permissao_somente_do_usuario_e_some_no_drop() {
        use std::os::unix::fs::PermissionsExt;
        let lease = write_descriptor(&LaunchDescriptor {
            version: 1,
            plugin_root: "/plugin".into(),
            plugin_key: "acme.quality".into(),
            fingerprint: "hash".into(),
            contribution_id: "docs".into(),
            project_path: "/project".into(),
            db_path: "/data/mycockpit.db".into(),
        })
        .unwrap();
        let path = lease.descriptor.clone();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(lease);
        assert!(!path.exists());
    }
}
