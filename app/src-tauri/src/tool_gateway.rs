//! Tool Catalog da Frota materializado como MCP por run.
//!
//! O catálogo é a entidade; MCP é só o transporte que adapters capazes recebem.
//! O snapshot contém apenas plugins com grant atual, habilitados e com recursos
//! prontos. Uma chamada volta ao processo do app, que revalida tudo antes do
//! spawn efêmero do worker.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::BufReader;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Semaphore;

use crate::plugin_manifest::ToolContribution;
use crate::plugin_protocol::{read_value, write_value};
use crate::plugin_runtime::PluginRuntimeRegistry;
use crate::resource_broker::{EffectiveResourceAccess, ResourceLeaseRegistry};

pub const MCP_SERVER_NAME: &str = "frota-tools";
pub const SOCK_ENV: &str = "FROTA_TOOL_SOCK";
const SUBCOMMAND: &str = "tool-server";
const MCP_PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginToolSpec {
    pub name: String,
    pub title: String,
    pub description: String,
    pub input_schema: Value,
    pub plugin_key: String,
    pub fingerprint: String,
    pub tool_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum CatalogRequest {
    Catalog,
    Call { name: String, input: Value },
}

#[derive(Clone, Debug, Default)]
pub struct ToolCatalogSnapshot {
    pub tools: Vec<PluginToolSpec>,
    pub resources: Vec<EffectiveResourceAccess>,
    pub notices: Vec<String>,
}

impl ToolCatalogSnapshot {
    pub fn tool_names(&self) -> Vec<String> {
        self.tools.iter().map(|tool| tool.name.clone()).collect()
    }

    pub(crate) fn mark_unmaterialized(&mut self, reason: &str) {
        if self.tools.is_empty() {
            return;
        }
        self.notices
            .push(format!("Tool Catalog descoberto, mas {reason}"));
        self.tools.clear();
        for resource in &mut self.resources {
            resource.state = crate::resource_broker::ResourceState::Blocked;
        }
    }
}

fn runtime_name(plugin_key: &str, tool_id: &str) -> String {
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
    format!("plugin__{}__{}", segment(plugin_key), segment(tool_id))
}

fn spec(
    plugin_key: &str,
    fingerprint: &str,
    plugin_name: &str,
    tool: &ToolContribution,
) -> PluginToolSpec {
    PluginToolSpec {
        name: runtime_name(plugin_key, &tool.id),
        title: format!("{plugin_name}: {}", tool.title),
        description: tool.description.clone(),
        input_schema: tool.input_schema.clone(),
        plugin_key: plugin_key.into(),
        fingerprint: fingerprint.into(),
        tool_id: tool.id.clone(),
    }
}

pub(crate) async fn catalog_for_run(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<ToolCatalogSnapshot, String> {
    let packages = crate::plugin_contributions::enabled_packages(app)?;

    let mut snapshot = ToolCatalogSnapshot::default();
    let mut resource_ids = HashSet::new();
    let mut tool_names = HashSet::new();
    for package in packages {
        for tool in &package.manifest.contributes.tools {
            let (claims, blocked) = crate::resource_broker::preflight_plugin_resources(
                app,
                project_id,
                &package.key(),
                &tool.resources,
            )
            .await;
            for claim in claims {
                if resource_ids.insert(claim.id.clone()) {
                    snapshot.resources.push(claim);
                }
            }
            if let Some(reason) = blocked {
                snapshot.notices.push(format!(
                    "Tool {} de {} indisponível: {reason}",
                    tool.title, package.manifest.name
                ));
                continue;
            }
            let tool_spec = spec(
                &package.key(),
                &package.fingerprint,
                &package.manifest.name,
                tool,
            );
            if !tool_names.insert(tool_spec.name.clone()) {
                return Err(format!(
                    "colisão no nome materializado da tool {}",
                    tool_spec.name
                ));
            }
            snapshot.tools.push(tool_spec);
        }
    }
    snapshot
        .tools
        .sort_by(|left, right| left.name.cmp(&right.name));
    snapshot
        .resources
        .sort_by(|left, right| left.id.cmp(&right.id));
    snapshot.notices.sort();
    snapshot.notices.dedup();
    Ok(snapshot)
}

#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub server_bin: String,
    pub socket: String,
}

impl GatewayConfig {
    pub fn claude_server_json(&self) -> Value {
        json!({
            "type": "stdio",
            "command": self.server_bin,
            "args": [SUBCOMMAND],
            "env": { SOCK_ENV: self.socket }
        })
    }

    pub fn configure_codex(&self, command: &mut tokio::process::Command) {
        let key = format!("mcp_servers.{MCP_SERVER_NAME}");
        command
            .arg("-c")
            .arg(format!("{key}.enabled=true"))
            .arg("-c")
            .arg(format!(
                "{key}.command={}",
                serde_json::to_string(&self.server_bin).unwrap_or_else(|_| "\"\"".into())
            ))
            .arg("-c")
            .arg(format!("{key}.args=[\"{SUBCOMMAND}\"]"))
            .arg("-c")
            .arg(format!(
                "{key}.env.{SOCK_ENV}={}",
                serde_json::to_string(&self.socket).unwrap_or_else(|_| "\"\"".into())
            ));
    }
}

fn socket_candidates(run_id: &str) -> [PathBuf; 3] {
    let short: String = run_id.chars().take(8).collect();
    let root = std::env::temp_dir();
    [
        root.join(format!("frota-tools-{short}.sock")),
        root.join(format!("frota-tools-{short}-1.sock")),
        root.join(format!("frota-tools-{short}-2.sock")),
    ]
}

fn bind_socket(run_id: &str) -> Option<(PathBuf, UnixListener)> {
    for path in socket_candidates(run_id) {
        if path.exists() {
            if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                continue;
            }
            let _ = std::fs::remove_file(&path);
        }
        if let Ok(listener) = UnixListener::bind(&path) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).is_err()
                {
                    drop(listener);
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            }
            return Some((path, listener));
        }
    }
    None
}

pub struct ToolListener {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}

impl ToolListener {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        app: tauri::AppHandle,
        run_id: String,
        project_id: String,
        project_path: String,
        catalog: ToolCatalogSnapshot,
        runtime: Arc<PluginRuntimeRegistry>,
        leases: Arc<ResourceLeaseRegistry>,
    ) -> Option<Self> {
        let (path, listener) = bind_socket(&run_id)?;
        let tools = Arc::new(
            catalog
                .tools
                .into_iter()
                .map(|tool| (tool.name.clone(), tool))
                .collect::<BTreeMap<_, _>>(),
        );
        let slots = Arc::new(Semaphore::new(32));
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let Ok(slot) = slots.clone().try_acquire_owned() else {
                    continue;
                };
                let app = app.clone();
                let tools = tools.clone();
                let project_id = project_id.clone();
                let project_path = project_path.clone();
                let runtime = runtime.clone();
                let leases = leases.clone();
                tokio::spawn(async move {
                    let _slot = slot;
                    handle_parent_request(
                        stream,
                        app,
                        tools,
                        project_id,
                        project_path,
                        runtime,
                        leases,
                    )
                    .await;
                });
            }
        });
        Some(Self { path, task })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ToolListener {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.path);
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_parent_request(
    stream: UnixStream,
    app: tauri::AppHandle,
    tools: Arc<BTreeMap<String, PluginToolSpec>>,
    project_id: String,
    project_path: String,
    runtime: Arc<PluginRuntimeRegistry>,
    leases: Arc<ResourceLeaseRegistry>,
) {
    let (read, mut write) = stream.into_split();
    let request = match read_value(&mut BufReader::new(read)).await {
        Ok(request) => request,
        Err(_) => return,
    };
    let answer = match serde_json::from_value::<CatalogRequest>(request) {
        Ok(CatalogRequest::Catalog) => Ok(json!({
            "tools": tools.values().cloned().collect::<Vec<_>>()
        })),
        Ok(CatalogRequest::Call { name, input }) => match tools.get(&name).cloned() {
            Some(tool) => {
                crate::plugin_runtime::invoke(
                    app,
                    runtime,
                    leases,
                    project_id,
                    project_path,
                    tool.plugin_key,
                    tool.fingerprint,
                    tool.tool_id,
                    input,
                )
                .await
            }
            None => Err("tool não existe no catálogo deste run".into()),
        },
        Err(error) => Err(format!("pedido inválido ao Tool Catalog: {error}")),
    };
    let response = match answer {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    if let Err(error) = write_value(&mut write, &response).await {
        log::warn!("não consegui responder ao processo frota-tools: {error}");
    }
}

pub fn run_mcp_server() {
    let runtime = tokio::runtime::Runtime::new().expect("tool-server: runtime tokio");
    runtime.block_on(mcp_loop());
}

async fn request_parent(action: &str, payload: Value) -> Result<Value, String> {
    let socket = std::env::var(SOCK_ENV).map_err(|_| "socket do catálogo ausente")?;
    let mut stream = UnixStream::connect(socket)
        .await
        .map_err(|error| format!("catálogo indisponível: {error}"))?;
    let mut request = payload;
    request["action"] = Value::String(action.into());
    write_value(&mut stream, &request).await?;
    read_value(&mut BufReader::new(stream)).await
}

fn tool_result(output: Value) -> Value {
    let text = match &output {
        Value::String(value) => value.clone(),
        Value::Object(_) => "Resultado estruturado disponível.".into(),
        _ => serde_json::to_string(&output).unwrap_or_else(|_| "resultado indisponível".into()),
    };
    let mut result = json!({ "content": [{ "type": "text", "text": text }] });
    if output.is_object() {
        result["structuredContent"] = output;
    }
    result
}

async fn mcp_loop() {
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    loop {
        // O lado stdio obedece ao mesmo teto do worker e do socket pai. Um
        // provider não pode fazer o gateway acumular uma linha sem fim antes
        // da desserialização.
        let Ok(message) = read_value(&mut stdin).await else {
            break;
        };
        let id = message.get("id").cloned().filter(|value| !value.is_null());
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let result = match method {
            "initialize" => Some(json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": MCP_SERVER_NAME, "version": "1.0.0" }
            })),
            "ping" => Some(json!({})),
            "notifications/initialized" | "initialized" => None,
            "tools/list" => Some(match request_parent("catalog", json!({})).await {
                Ok(response) if response.get("ok").and_then(Value::as_bool) == Some(true) => {
                    let tools = response
                        .pointer("/result/tools")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|tool| {
                            json!({
                                "name": tool.get("name"),
                                "title": tool.get("title"),
                                "description": tool.get("description"),
                                "inputSchema": tool.get("inputSchema"),
                            })
                        })
                        .collect::<Vec<_>>();
                    json!({ "tools": tools })
                }
                Ok(response) => json!({
                    "tools": [],
                    "_meta": { "frotaError": response.get("error") }
                }),
                Err(error) => json!({ "tools": [], "_meta": { "frotaError": error } }),
            }),
            "tools/call" => {
                let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let input = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                Some(
                    match request_parent("call", json!({ "name": name, "input": input })).await {
                        Ok(response)
                            if response.get("ok").and_then(Value::as_bool) == Some(true) =>
                        {
                            tool_result(response.get("result").cloned().unwrap_or(Value::Null))
                        }
                        Ok(response) => json!({
                            "content": [{ "type": "text", "text": response.get("error").and_then(Value::as_str).unwrap_or("falha na tool") }],
                            "isError": true
                        }),
                        Err(error) => json!({
                            "content": [{ "type": "text", "text": error }],
                            "isError": true
                        }),
                    },
                )
            }
            _ => {
                if let Some(id) = id.clone() {
                    let error = json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": "method not found" }
                    });
                    if write_value(&mut stdout, &error).await.is_err() {
                        break;
                    }
                }
                None
            }
        };
        if let (Some(id), Some(result)) = (id, result) {
            let response = json!({ "jsonrpc": "2.0", "id": id, "result": result });
            if write_value(&mut stdout, &response).await.is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_da_tool_e_namespaced_e_estavel() {
        assert_eq!(
            runtime_name("acme.quality-kit", "review-pr"),
            "plugin__acme_quality_kit__review_pr"
        );
    }

    #[test]
    fn resultado_objeto_vira_texto_e_structured_content() {
        let result = tool_result(json!({ "score": 9 }));
        assert_eq!(result["structuredContent"]["score"], 9);
        assert_eq!(
            result["content"][0]["text"],
            "Resultado estruturado disponível."
        );
    }

    #[tokio::test]
    async fn socket_do_catalogo_e_privado_para_o_usuario_atual() {
        let run_id = format!("{:08x}-permissao", std::process::id());
        let (path, listener) = bind_socket(&run_id).expect("socket local");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        drop(listener);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn pedido_interno_recusa_campos_que_nao_estao_no_protocolo() {
        assert!(serde_json::from_value::<CatalogRequest>(json!({
            "action": "call",
            "name": "tool",
            "input": {},
            "surpresa": true
        }))
        .is_err());
    }

    #[test]
    fn catalogo_sem_materializador_nao_some_em_silencio() {
        let mut snapshot = ToolCatalogSnapshot {
            tools: vec![PluginToolSpec {
                name: "plugin__acme_quality__review".into(),
                title: "Review".into(),
                description: "Review".into(),
                input_schema: json!({ "type": "object" }),
                plugin_key: "acme.quality".into(),
                fingerprint: "hash".into(),
                tool_id: "review".into(),
            }],
            resources: vec![crate::resource_broker::EffectiveResourceAccess {
                id: "plugin:acme.quality:project-browser".into(),
                label: "Navegador do projeto".into(),
                kind: crate::resource_broker::ResourceKind::ProjectBrowser,
                owner: crate::resource_broker::ResourceOwner::Frota,
                scope: crate::adapters::CapabilityScope::Project,
                enforceability: crate::adapters::PolicyEnforceability::Hard,
                evidence: crate::resource_broker::ResourceEvidence::PluginManifest,
                state: crate::resource_broker::ResourceState::Ready,
                via: "acme.quality".into(),
            }],
            notices: Vec::new(),
        };
        snapshot.mark_unmaterialized("o adapter não materializa tools por run");
        assert!(snapshot.tools.is_empty());
        assert_eq!(
            snapshot.resources[0].state,
            crate::resource_broker::ResourceState::Blocked
        );
        assert!(snapshot.notices[0].contains("adapter"));
    }
}
