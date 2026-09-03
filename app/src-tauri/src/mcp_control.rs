//! Control plane dos MCPs externos.
//!
//! Responsabilidades:
//! - descobrir configurações existentes sem persistir segredos;
//! - normalizar Claude, Codex e `.mcp.json` num registry canônico;
//! - testar saúde por initialize + tools/list (stdio) ou reachability (HTTP);
//! - guardar bindings por projeto/agent e montar um plano efêmero por run;
//! - manter política/fallback fora do prompt e do julgamento do modelo.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tokio::time::timeout;

const HEALTH_TTL_MS: i64 = 5 * 60 * 1_000;
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_TOOL_NAMES: usize = 80;
const MAX_DETAIL_CHARS: usize = 800;

/// Por que uma configuração só funciona dentro do CLI que a definiu.
///
/// Motivo TIPADO em vez de `bool` ou string livre: a UI precisa escolher a
/// copy certa. Um `native_only: true` sozinho virava a frase genérica de
/// "valor literal", que MENTE por imprecisão num servidor OAuth sem nenhum
/// segredo no arquivo (caso real: `prime-mcp` no `.mcp.json`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpNativeReason {
    /// Login próprio do CLI: o token fica no keychain de quem autenticou.
    Oauth,
    /// SSE/WebSocket: a sessão é mantida pelo CLI de origem.
    Stream,
    /// Header produzido por um helper que só existe dentro do CLI de origem.
    HeadersHelper,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLaunchConfig {
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub env_vars: Vec<String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub bearer_token_env_var: Option<String>,
    #[serde(default)]
    pub http_headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env_http_headers: BTreeMap<String, String>,
    /// Depende de extensão/autenticação privada do CLI de origem, e por qual
    /// motivo. `None` = não há dependência nativa.
    #[serde(default)]
    pub native_reason: Option<McpNativeReason>,
    /// Bloco `oauth` da entrada de origem, quando existe.
    ///
    /// NÃO é segredo: `clientId`, porta de callback e URL de metadata são
    /// públicos no arquivo do usuário. É o que permite o login do PRÓPRIO app
    /// (`mcp_auth.rs`) em vez de depender do keychain do CLI que autenticou.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth: Option<crate::mcp_auth::OauthConfig>,
}

impl McpLaunchConfig {
    fn locator(&self) -> String {
        self.command
            .clone()
            .or_else(|| self.url.as_deref().map(sanitize_url_for_display))
            .unwrap_or_else(|| "configuração incompleta".into())
    }

    /// Credencial literal nunca entra em argv/config efêmero de outro agent.
    /// Wrappers que consultam Keychain e nomes de env são portáveis; valores
    /// literais de env/header precisam ser migrados pelo usuário primeiro.
    ///
    /// Motivo INDEPENDENTE de `native_reason`: um servidor pode ter os dois,
    /// um, ou nenhum. A UI mostra cada um com a sua própria copy.
    fn has_literal_secret(&self) -> bool {
        !(self.env.is_empty()
            && self.http_headers.is_empty()
            && !args_look_sensitive(&self.args)
            && self
                .command
                .as_deref()
                .is_none_or(|value| !contains_env_template(value))
            && self.args.iter().all(|value| !contains_env_template(value))
            && self
                .cwd
                .as_deref()
                .is_none_or(|value| !contains_env_template(value))
            && self.url.as_deref().is_none_or(|value| {
                !contains_env_template(value) && sanitize_url_for_display(value) == value
            }))
    }

    /// Roteável para outro agent: nem dependência nativa do CLI de origem, nem
    /// credencial literal na configuração.
    fn portable(&self) -> bool {
        self.native_reason.is_none() && !self.has_literal_secret()
    }

    fn env_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.env.keys().cloned().collect();
        keys.extend(self.env_vars.iter().cloned());
        keys.extend(self.env_http_headers.values().cloned());
        if let Some(k) = &self.bearer_token_env_var {
            keys.push(k.clone());
        }
        keys.sort();
        keys.dedup();
        keys
    }

    fn sanitized_fingerprint(&self) -> String {
        let public = json!({
            "transport": self.transport,
            "command": self.command,
            "args": self.args,
            "envKeys": self.env_keys(),
            "cwd": self.cwd,
            // Query, fragment e userinfo podem carregar token. O registry só
            // precisa detectar mudança de endpoint, não hashear credenciais.
            "url": self.url.as_deref().map(sanitize_url_for_display),
            "bearerTokenEnvVar": self.bearer_token_env_var,
            "headerNames": self.http_headers.keys().collect::<Vec<_>>(),
            "envHeaderNames": self.env_http_headers.keys().collect::<Vec<_>>(),
            "nativeReason": self.native_reason,
        });
        blake3::hash(public.to_string().as_bytes())
            .to_hex()
            .to_string()
    }

    /// Cópia suficiente para o Codex validar uma tabela desabilitada, sem
    /// transportar valores literais de env/header, credenciais em URL ou argv.
    fn codex_public_transport(&self) -> Self {
        let mut public = self.clone();
        public.env.clear();
        public.http_headers.clear();
        if args_look_sensitive(&public.args) {
            public.args.clear();
        }
        if let Some(url) = &public.url {
            public.url = Some(sanitize_url_for_display(url));
        }
        public
    }

    pub fn claude_json(&self) -> Value {
        if self.transport == "stdio" {
            let mut out = serde_json::Map::new();
            out.insert("type".into(), json!("stdio"));
            out.insert("command".into(), json!(self.command));
            out.insert("args".into(), json!(self.args));
            let mut env = self.env.clone();
            for key in &self.env_vars {
                env.entry(key.clone())
                    .or_insert_with(|| format!("${{{key}}}"));
            }
            if !env.is_empty() {
                out.insert("env".into(), json!(env));
            }
            Value::Object(out)
        } else {
            let mut out = serde_json::Map::new();
            out.insert("type".into(), json!("http"));
            out.insert("url".into(), json!(self.url));
            let mut headers = self.http_headers.clone();
            for (header, env_var) in &self.env_http_headers {
                headers
                    .entry(header.clone())
                    .or_insert_with(|| format!("${{{env_var}}}"));
            }
            if let Some(env_var) = &self.bearer_token_env_var {
                headers
                    .entry("Authorization".into())
                    .or_insert_with(|| format!("Bearer ${{{env_var}}}"));
            }
            if !headers.is_empty() {
                out.insert("headers".into(), json!(headers));
            }
            Value::Object(out)
        }
    }

    pub fn configure_codex(&self, runtime_name: &str, cmd: &mut Command) {
        let key = format!("mcp_servers.{runtime_name}");
        cmd.arg("-c").arg(format!("{key}.enabled=true"));
        if self.transport == "stdio" {
            if let Some(program) = &self.command {
                cmd.arg("-c")
                    .arg(format!("{key}.command={}", json_string(program)));
            }
            cmd.arg("-c")
                .arg(format!("{key}.args={}", json_array(&self.args)));
            if let Some(cwd) = &self.cwd {
                cmd.arg("-c").arg(format!("{key}.cwd={}", json_string(cwd)));
            }
            if !self.env_vars.is_empty() {
                cmd.arg("-c")
                    .arg(format!("{key}.env_vars={}", json_array(&self.env_vars)));
            }
        } else if let Some(url) = &self.url {
            cmd.arg("-c").arg(format!("{key}.url={}", json_string(url)));
            if let Some(var) = &self.bearer_token_env_var {
                cmd.arg("-c")
                    .arg(format!("{key}.bearer_token_env_var={}", json_string(var)));
            }
            for (header, env_var) in &self.env_http_headers {
                cmd.arg("-c").arg(format!(
                    "{key}.env_http_headers.{}={}",
                    toml_key(header),
                    json_string(env_var)
                ));
            }
        }
    }

    /// Materializa o transporte público de um MCP nativo antes de desligá-lo.
    ///
    /// O Codex valida cada tabela `mcp_servers.<nome>` resultante dos overrides;
    /// portanto, injetar somente `enabled=false` para um MCP vindo de plugin
    /// cria uma tabela parcial e falha com `invalid transport`. Como o servidor
    /// ficará desabilitado, valores literais de autenticação não são necessários
    /// e nunca são copiados para a linha de comando efêmera.
    fn disable_in_codex(&self, runtime_name: &str, cmd: &mut Command) {
        let public = self.codex_public_transport();
        let key = format!("mcp_servers.{runtime_name}");
        if public.transport == "stdio" {
            if let Some(program) = &public.command {
                cmd.arg("-c")
                    .arg(format!("{key}.command={}", json_string(program)));
            }
            cmd.arg("-c")
                .arg(format!("{key}.args={}", json_array(&public.args)));
            if let Some(cwd) = &public.cwd {
                cmd.arg("-c").arg(format!("{key}.cwd={}", json_string(cwd)));
            }
            if !public.env_vars.is_empty() {
                cmd.arg("-c")
                    .arg(format!("{key}.env_vars={}", json_array(&public.env_vars)));
            }
        } else if let Some(url) = &public.url {
            cmd.arg("-c").arg(format!("{key}.url={}", json_string(url)));
            if let Some(var) = &public.bearer_token_env_var {
                cmd.arg("-c")
                    .arg(format!("{key}.bearer_token_env_var={}", json_string(var)));
            }
            for (header, env_var) in &public.env_http_headers {
                cmd.arg("-c").arg(format!(
                    "{key}.env_http_headers.{}={}",
                    toml_key(header),
                    json_string(env_var)
                ));
            }
        }
        // Deve vir depois do transporte: além de documentar a dependência,
        // mantém o argv válido para parsers que aplicam overrides em ordem.
        cmd.arg("-c").arg(format!("{key}.enabled=false"));
    }
}

#[derive(Clone, Debug)]
struct DiscoveredServer {
    id: String,
    name: String,
    source: String,
    scope: String,
    source_agent: Option<String>,
    enabled: bool,
    managed: bool,
    launch: Option<McpLaunchConfig>,
}

impl DiscoveredServer {
    fn portable(&self) -> bool {
        self.managed && self.launch.as_ref().is_some_and(McpLaunchConfig::portable)
    }

    fn compatible(&self, agent: &str) -> bool {
        // Decisão por capability (G1.1), nunca por nome: roteável só pra agent
        // com escopo POR RUN; e `cwd` no launch só pra quem documenta o campo
        // (`mcp_launch_cwd`, hoje só o Codex) — o schema JSON do Claude não tem
        // `cwd` e o campo sumiria em silêncio no handoff.
        let Some(caps) = crate::adapters::capabilities_of(agent) else {
            return false;
        };
        if !caps.mcp_escopo.por_run() || !self.portable() {
            return false;
        }
        caps.mcp_launch_cwd || self.launch.as_ref().is_some_and(|c| c.cwd.is_none())
    }

    fn runtime_name(&self) -> String {
        let source = slug(&self.source);
        let scope = slug(&self.scope);
        let name = slug(&self.name);
        let digest = short_hash(&format!("{}:{}:{}", self.source, self.scope, self.name));
        format!("mcx-{source}-{scope}-{name}-{digest}")
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAgentState {
    pub agent: String,
    /// Compatível NATIVAMENTE: portável + capability do agent. Continua
    /// significando só isso, e é por isso que não basta pra decidir a tela.
    pub compatible: bool,
    /// Roteável pelo proxy local porque QUEM autenticou foi o app (login do
    /// Frota num MCP OAuth/HTTP, sem segredo literal).
    ///
    /// Existe porque a tela mentia: o rótulo já dizia "roteado pelo Frota" e o
    /// interruptor seguia preso em `compatible`, que para OAuth é sempre
    /// `false`. O planejador do run JÁ raciocinava com `roteavel_por_proxy`;
    /// quem não sabia era o portão do binding e o estado que chega na UI.
    pub roteavel_pelo_app: bool,
    /// Este MOTOR aceita MCP gerenciado pelo app (escopo POR RUN)?
    ///
    /// `false` quer dizer "o Frota não roteia MCP para ele", e NUNCA "ele não
    /// fala MCP". O agy fala (tem até `agy mcp add`), só que a config dele é
    /// global e permanente, então não há como injetar por run. A tela precisa
    /// deste campo pra não chamar isso de "não suportado", que é falso.
    pub roteia_mcp_gerenciado: bool,
    /// Escopo de MCP deste motor, em minúsculas ("por-run", "por-projeto",
    /// "global", "nenhum"). A tela precisa dele pra oferecer o gesto certo:
    /// escopo global não tem interruptor, tem AÇÃO, porque o app não sabe o
    /// que já está instalado no CLI do usuário e fingir que sabe seria pior.
    pub escopo: String,
    pub enabled: bool,
    pub required: bool,
    /// Binding marcado para dirigir o navegador do projeto (B2.2).
    pub browser: bool,
    pub fallback: String,
    pub health: String,
    pub detail: Option<String>,
    pub checked_at: Option<i64>,
    /// Inventário real devolvido por `tools/list` no último probe válido.
    /// Vazio não significa "sem tools" quando o transporte não as enumera.
    pub tool_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    pub id: String,
    pub name: String,
    pub source: String,
    pub scope: String,
    pub transport: String,
    pub locator: String,
    pub env_keys: Vec<String>,
    pub source_agent: Option<String>,
    pub source_enabled: bool,
    pub managed: bool,
    pub portable: bool,
    /// Por que a config é nativa-apenas, quando for. `None` = não é.
    /// Vai separado de `literal_secret` porque as duas travas têm causas e
    /// saídas diferentes, e uma mensagem só descreveria a errada.
    pub native_reason: Option<McpNativeReason>,
    /// A config carrega valor literal de env/header/argv/URL ou expansão do
    /// CLI de origem. Independente de `native_reason`.
    pub literal_secret: bool,
    /// Nome que o servidor assume dentro de um run gerenciado deste projeto
    /// (o que o usuário cita no prompt). Só existe com binding ativo.
    pub runtime_name: Option<String>,
    pub agent_states: Vec<McpAgentState>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBindingsSummary {
    pub project_id: String,
    pub count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHealthView {
    pub server_id: String,
    pub agent: String,
    pub status: String,
    pub detail: Option<String>,
    pub checked_at: i64,
    pub tool_count: usize,
    pub tool_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveryView {
    pub servers: Vec<McpServerView>,
    pub provider_inventories: Vec<crate::provider_mcp_inventory::ProviderMcpInventory>,
}

#[derive(Clone, Debug, Default)]
pub struct McpRunPlan {
    pub managed: bool,
    pub selected: Vec<McpRuntimeServer>,
    /// MCPs contribuídos por plugins aprovados. São sempre materializados por
    /// run e não transformam a configuração legada do provider em gerenciada.
    pub contributed: Vec<McpRuntimeServer>,
    /// Recursos locais efetivamente resolvidos pelo broker. Separados dos
    /// servidores porque o MCP é só o caminho de entrega.
    pub resources: Vec<crate::resource_broker::EffectiveResourceAccess>,
    /// Proxies MCP autenticados vivos deste run (A2). Ficam AQUI porque o plano
    /// vive exatamente o tempo do run: quando ele cai, o `Drop` do listener
    /// remove o socket. `Arc` porque o plano é `Clone`.
    pub proxies: Vec<Arc<crate::mcp_proxy::ProxyListener>>,
    /// Mantém descriptors 0600 de launch vivos exatamente pelo tempo do run.
    pub plugin_leases: Vec<Arc<crate::plugin_mcp::PluginMcpLaunchLease>>,
    /// Posse exclusiva do navegador do projeto. O endpoint pode ser observado
    /// por várias superfícies, mas input pertence a um único piloto por vez.
    pub browser_pilot_leases: Vec<Arc<crate::experience_broker::BrowserPilotLease>>,
    /// MCPs já conhecidos pelo Codex que devem ficar fora deste run. Cada
    /// entrada inclui o transporte descoberto para evitar tabelas parciais.
    pub disabled_codex_servers: Vec<McpRuntimeServer>,
    /// Compatibilidade transitória com construtores antigos. O plano real usa
    /// `disabled_codex_servers`; nomes soltos não bastam para MCPs de plugin.
    pub disabled_codex_names: Vec<String>,
    /// Mudanças de transporte e limitações auditáveis do plano aceito. Não são
    /// incidentes de conversa: entram no manifesto efetivo, nunca no fio.
    pub notices: Vec<String>,
    /// Capabilities opcionais que não puderam ser materializadas neste envio.
    pub omissions: Vec<McpPlanIssue>,
    /// Exigência de policy ainda não satisfeita. Um plano com gate nunca chega
    /// ao manifesto nem ao spawn do provider.
    pub gate: Option<McpPreflightGate>,
    /// Consentimento efêmero para executar este envio em modo somente leitura.
    /// Nunca nasce da configuração sozinha, apenas de `RetryReadonly` válido.
    pub force_readonly: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpPlanDisposition {
    Omitted,
    NeedsDecision,
    BlockedByPolicy,
    NeedsReadonlyConsent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpPlanIssueCode {
    SourceMissing,
    Incompatible,
    HealthUnavailable,
    BrowserOffline,
    BrowserUnavailable,
    BrowserBusy,
    ProxyUnavailable,
    InventoryUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPlanIssue {
    pub source_id: String,
    pub source_label: String,
    pub code: McpPlanIssueCode,
    pub disposition: McpPlanDisposition,
    pub detail: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpRecoveryKind {
    StartProjectBrowser,
    OpenMcpSettings,
    OmitForThisRun,
    RetryReadonly,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRecovery {
    pub kind: McpRecoveryKind,
    pub source_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRunOverride {
    pub gate_fingerprint: String,
    pub source_id: String,
    pub kind: McpRecoveryKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPreflightGate {
    pub fingerprint: String,
    pub issues: Vec<McpPlanIssue>,
    pub allowed_recoveries: Vec<McpRecovery>,
}

impl McpPreflightGate {
    pub fn control_plane(detail: String) -> Self {
        Self::new(
            vec![McpPlanIssue {
                source_id: "mcp-control-plane".into(),
                source_label: "Integrações MCP".into(),
                code: McpPlanIssueCode::InventoryUnavailable,
                disposition: McpPlanDisposition::BlockedByPolicy,
                detail: Some(detail),
            }],
            vec![McpRecovery {
                kind: McpRecoveryKind::OpenMcpSettings,
                source_id: None,
            }],
        )
    }

    fn new(issues: Vec<McpPlanIssue>, allowed_recoveries: Vec<McpRecovery>) -> Self {
        let mut evidence: Vec<String> = issues
            .iter()
            .map(|issue| {
                format!(
                    "{}\t{:?}\t{:?}",
                    issue.source_id, issue.code, issue.disposition
                )
            })
            .collect();
        evidence.sort();
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in evidence.join("\n").bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        Self {
            fingerprint: format!("{hash:016x}"),
            issues,
            allowed_recoveries,
        }
    }
}

#[derive(Clone, Debug)]
pub struct McpRuntimeServer {
    pub runtime_name: String,
    pub display_name: String,
    pub launch: McpLaunchConfig,
    /// Snapshot do mesmo probe que autorizou este servidor no run.
    pub tool_names: Vec<String>,
}

impl McpRunPlan {
    pub fn announced_servers(&self) -> Vec<&McpRuntimeServer> {
        self.selected
            .iter()
            .filter(|_| self.managed)
            .chain(self.contributed.iter())
            .collect()
    }

    /// Fingerprint do CONJUNTO anunciável de MCPs deste plano (H2 do
    /// prompt-hygiene-plan): é o que decide o re-anúncio mid-conversa em motor
    /// 1º-turno-só quando o usuário liga/desliga um binding. Só nomes (runtime
    /// + display), NUNCA launch/env — nada sensível vaza pro front. Ordenado →
    /// estável a reordenação. None = plano NÃO gerenciado (legado intacto,
    /// nunca anuncia). Plano gerenciado VAZIO tem fingerprint próprio (hash da
    /// lista vazia): desligar TODOS os bindings também é mudança de plano —
    /// N→0 precisa re-anunciar, senão o modelo segue chamando tool morta.
    pub fn fingerprint(&self) -> Option<String> {
        if !self.managed && self.contributed.is_empty() {
            return None;
        }
        let mut lines: Vec<String> = self
            .announced_servers()
            .into_iter()
            .map(|s| format!("{}\t{}", s.runtime_name, s.display_name))
            .collect();
        lines.sort();
        // FNV-1a 64 (inline, sem dependência): determinístico entre builds.
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in lines.join("\n").bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        Some(format!("{hash:016x}"))
    }

    pub fn configure_codex(&self, cmd: &mut Command) {
        if self.managed {
            for server in &self.disabled_codex_servers {
                server.launch.disable_in_codex(&server.runtime_name, cmd);
            }
            for name in &self.disabled_codex_names {
                cmd.arg("-c")
                    .arg(format!("mcp_servers.{}.enabled=false", toml_key(name)));
            }
            for server in &self.selected {
                // Server local do proxy autenticado tem caminho próprio: o socket
                // vive no `env` do launch, que o configure_codex genérico (de
                // propósito) não copia.
                if crate::mcp_proxy::is_proxy_launch(&server.launch) {
                    crate::mcp_proxy::configure_codex_launch(
                        &server.runtime_name,
                        &server.launch,
                        cmd,
                    );
                } else {
                    server.launch.configure_codex(&server.runtime_name, cmd);
                }
            }
        }
        for server in &self.contributed {
            server.launch.configure_codex(&server.runtime_name, cmd);
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ProbeOutcome {
    pub(crate) status: String,
    pub(crate) detail: Option<String>,
    pub(crate) tool_names: Vec<String>,
}

#[derive(Clone, Debug)]
struct Binding {
    server_id: String,
    required: bool,
    fallback: String,
    /// Este MCP dirige o NAVEGADOR DO PROJETO (B2.2 do browser-plan): o plano
    /// efêmero injeta `--cdp-endpoint` apontando pro Chromium que o app possui.
    /// É propriedade do BINDING, nunca do nome do fornecedor: qualquer MCP que
    /// aceite a flag pode ser marcado, e nenhum é marcado por padrão.
    browser: bool,
}

const CDP_FLAG: &str = "--cdp-endpoint";

/// Flags de origem que pedem um navegador NOVO e, portanto, contradizem o
/// roteamento pro navegador do app. `bool` = a flag consome o argumento
/// seguinte (`--browser chrome`) além da forma `--browser=chrome`.
const CDP_CONFLICTS: [(&str, bool); 2] = [("--browser", true), ("--headless", false)];

/// Remove uma flag conflitante (nas duas formas) dos args do plano efêmero.
/// Devolve se removeu algo. Não toca a configuração de ORIGEM do usuário: o
/// plano é uma cópia por run.
fn strip_flag(args: &mut Vec<String>, flag: &str, takes_value: bool) -> bool {
    let mut out: Vec<String> = Vec::with_capacity(args.len());
    let mut removed = false;
    let mut skip_value = false;
    for arg in args.iter() {
        if skip_value {
            skip_value = false;
            continue;
        }
        if arg == flag {
            removed = true;
            skip_value = takes_value;
            continue;
        }
        if arg.starts_with(&format!("{flag}=")) {
            removed = true;
            continue;
        }
        out.push(arg.clone());
    }
    *args = out;
    removed
}

/// Roteia um MCP marcado como "navegador do projeto" para o Chromium do app.
/// Puro (recebe o endpoint já resolvido) e fail-closed no efeito:
///
/// - sem endpoint vivo: o binding não pode ser honrado, então o run bloqueia;
/// - com endpoint vivo: a decisão explícita do binding vence. Endpoint,
///   `--browser` e `--headless` da origem saem deste run para nenhum browser
///   alternativo aparecer silenciosamente.
fn apply_cdp_endpoint(
    launch: &mut McpLaunchConfig,
    endpoint: Option<&str>,
    display_name: &str,
) -> Result<Vec<String>, String> {
    let Some(endpoint) = endpoint else {
        return Err(format!(
            "MCP {display_name} exige o navegador deste projeto, mas ele não está ligado. Ligue o navegador ou desmarque o binding antes de iniciar o run."
        ));
    };
    let mut dropped: Vec<&str> = Vec::new();
    if strip_flag(&mut launch.args, CDP_FLAG, true) {
        dropped.push(CDP_FLAG);
    }
    for (flag, takes_value) in CDP_CONFLICTS {
        if strip_flag(&mut launch.args, flag, takes_value) {
            dropped.push(flag);
        }
    }
    launch.args.push(CDP_FLAG.to_string());
    launch.args.push(endpoint.to_string());
    if dropped.is_empty() {
        Ok(Vec::new())
    } else {
        Ok(vec![format!(
            "MCP {display_name}: {} da configuração de origem ficou fora deste run; o navegador do projeto manda via {CDP_FLAG}.",
            dropped.join(" e ")
        )])
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn cap_detail(s: impl Into<String>) -> String {
    s.into().chars().take(MAX_DETAIL_CHARS).collect()
}

fn contains_env_template(value: &str) -> bool {
    value.contains("${")
}

fn args_look_sensitive(args: &[String]) -> bool {
    const MARKERS: [&str; 8] = [
        "token",
        "api-key",
        "api_key",
        "apikey",
        "secret",
        "password",
        "credential",
        "authorization",
    ];
    args.iter().enumerate().any(|(index, arg)| {
        let lower = arg.to_ascii_lowercase();
        let sensitive_flag = (arg.starts_with('-') || arg.contains('='))
            && MARKERS.iter().any(|marker| lower.contains(marker))
            && (arg.contains('=') || args.get(index + 1).is_some());
        let credential_url = arg.contains("://")
            && (arg.contains('?')
                || arg
                    .split("://")
                    .nth(1)
                    .is_some_and(|rest| rest.contains('@')));
        sensitive_flag || lower.contains("bearer ") || credential_url
    })
}

fn pure_env_ref(value: &str) -> Option<&str> {
    let key = value.strip_prefix("${")?.strip_suffix('}')?;
    (!key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then_some(key)
}

fn bearer_env_ref(value: &str) -> Option<&str> {
    pure_env_ref(value.strip_prefix("Bearer ")?)
}

/// O endpoint mostrado/persistido não carrega userinfo, query ou fragment.
/// O URL completo continua somente no plano efêmero em memória.
fn sanitize_url_for_display(raw: &str) -> String {
    let (before_fragment, _) = raw.split_once('#').unwrap_or((raw, ""));
    let (before_query, _) = before_fragment
        .split_once('?')
        .unwrap_or((before_fragment, ""));
    let Some((scheme, rest)) = before_query.split_once("://") else {
        return before_query.to_string();
    };
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    if path.is_empty() {
        format!("{scheme}://{host}")
    } else {
        format!("{scheme}://{host}/{path}")
    }
}

fn json_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn json_array(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".into())
}

fn toml_key(raw: &str) -> String {
    if raw
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        raw.to_string()
    } else {
        json_string(raw)
    }
}

fn slug(raw: &str) -> String {
    let out: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "server".into()
    } else {
        out
    }
}

fn short_hash(raw: &str) -> String {
    blake3::hash(raw.as_bytes()).to_hex()[..8].to_string()
}

/// Nomes que um MCP externo nunca pode assumir no runtime: os MCPs internos do
/// app e os nomes extras do chamador (ex.: tabelas de origem do Codex que o
/// plano desabilita — reconfigurar a mesma tabela mesclaria campos velhos da
/// config de origem no run).
fn reserved_runtime_names(extra: impl Iterator<Item = String>) -> HashSet<String> {
    [
        crate::context_gateway::MCP_SERVER_NAME,
        crate::work_gateway::MCP_SERVER_NAME,
        crate::approval::MCP_SERVER_NAME,
    ]
    .into_iter()
    .map(str::to_string)
    .chain(extra)
    .collect()
}

/// Slug amigável do display name quando ele é único entre os candidatos e não
/// colide com nome reservado; `None` mantém o nome desambiguado `mcx-…`.
/// Motivo de produto: o modelo nunca mapeia "playwright" para
/// `mcx-claude-user-playwright-1a2b3c4d`; com um único candidato, o nome de
/// runtime pode (e deve) ser o que o usuário digita no prompt.
fn friendly_runtime_name(
    display_name: &str,
    counts: &HashMap<String, usize>,
    reserved: &HashSet<String>,
) -> Option<String> {
    let candidate = slug(display_name);
    (counts.get(&candidate).copied() == Some(1) && !reserved.contains(&candidate))
        .then_some(candidate)
}

/// Reescreve os `runtime_name` dos selecionados para o slug amigável quando
/// não há ambiguidade. Os nomes de ORIGEM em `disabled_codex_servers` /
/// `disabled_codex_names` ficam intocados (o disable referencia a config do
/// usuário) e entram como reservados para o par disable/configure nunca cair
/// na mesma tabela.
fn apply_friendly_runtime_names(plan: &mut McpRunPlan) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for server in &plan.selected {
        *counts.entry(slug(&server.display_name)).or_default() += 1;
    }
    let reserved = reserved_runtime_names(
        plan.disabled_codex_servers
            .iter()
            .map(|server| server.runtime_name.clone())
            .chain(plan.disabled_codex_names.iter().cloned()),
    );
    for server in &mut plan.selected {
        if let Some(name) = friendly_runtime_name(&server.display_name, &counts, &reserved) {
            server.runtime_name = name;
        }
    }
}

fn server_id(source: &str, scope: &str, name: &str) -> String {
    format!(
        "{}:{}:{}-{}",
        slug(source),
        slug(scope),
        slug(name),
        short_hash(&format!("{source}:{scope}:{name}"))
    )
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("mycockpit.db"))
        .map_err(|e| format!("sem app_data_dir: {e}"))
}

pub(crate) fn db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub(crate) fn project_id_for_path(conn: &Connection, project_path: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT id FROM projects WHERE path = ?1 AND deleted_at IS NULL",
        [project_path],
        |row| row.get(0),
    )
    .map_err(|_| "projeto não encontrado no registry da Frota".into())
}

fn project_for_conv(
    conn: &Connection,
    conv_id: &str,
    cwd: &str,
) -> Result<(String, String), String> {
    if let Ok(row) = conn.query_row(
        "SELECT p.id, p.path FROM conversations c JOIN projects p ON p.id = c.project_id WHERE c.id = ?1",
        [conv_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) {
        return Ok(row);
    }
    let mut stmt = conn
        .prepare("SELECT id, path FROM projects WHERE deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut best: Option<(String, String)> = None;
    for row in rows.flatten() {
        if Path::new(cwd).starts_with(&row.1)
            && best
                .as_ref()
                .is_none_or(|(_, path)| row.1.len() > path.len())
        {
            best = Some(row);
        }
    }
    best.ok_or_else(|| "não consegui resolver o projeto deste run".into())
}

/// Resolve o mesmo escopo de projeto usado pelo control plane para outros
/// gateways por-run. Mantém uma única regra para conversa, cwd e worktree.
pub(crate) fn project_scope(
    app: &tauri::AppHandle,
    conv_id: &str,
    cwd: &str,
) -> Result<(String, String), String> {
    let conn = db(app)?;
    project_for_conv(&conn, conv_id, cwd)
}

fn parse_launch(raw: &Value) -> Option<McpLaunchConfig> {
    let url = raw.get("url").and_then(Value::as_str).map(str::to_string);
    let command = raw
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_string);
    if url.is_none() && command.is_none() {
        return None;
    }
    let raw_type = raw.get("type").and_then(Value::as_str).unwrap_or("");
    let transport = if url.is_some() || matches!(raw_type, "http" | "sse" | "streamable_http") {
        "http"
    } else {
        "stdio"
    }
    .to_string();
    // Ordem por acionabilidade: OAuth é o caso que o usuário resolve
    // autenticando no outro CLI; helper de header vem antes do transporte
    // porque descreve a credencial, e stream é o resto.
    let native_reason = if raw.get("oauth").is_some() {
        Some(McpNativeReason::Oauth)
    } else if raw.get("headersHelper").is_some() || raw.get("headers_helper").is_some() {
        Some(McpNativeReason::HeadersHelper)
    } else if matches!(raw_type, "sse" | "ws" | "websocket") {
        Some(McpNativeReason::Stream)
    } else {
        None
    };
    let mut env = string_map(raw.get("env"));
    let mut env_vars = string_array(raw.get("env_vars"));
    // `.mcp.json` permite `KEY=${KEY}`. No modelo canônico isso vira apenas
    // uma referência herdada, que Codex e Claude sabem receber sem o valor.
    env.retain(|key, value| {
        if pure_env_ref(value) == Some(key.as_str()) {
            env_vars.push(key.clone());
            false
        } else {
            true
        }
    });
    env_vars.sort();
    env_vars.dedup();

    let mut http_headers = string_map(raw.get("http_headers").or_else(|| raw.get("headers")));
    let mut env_http_headers = string_map(raw.get("env_http_headers"));
    let mut bearer_token_env_var = raw
        .get("bearer_token_env_var")
        .and_then(Value::as_str)
        .map(str::to_string);
    http_headers.retain(|header, value| {
        if header.eq_ignore_ascii_case("authorization") {
            if let Some(env_var) = bearer_env_ref(value) {
                bearer_token_env_var.get_or_insert_with(|| env_var.to_string());
                return false;
            }
        }
        if let Some(env_var) = pure_env_ref(value) {
            env_http_headers
                .entry(header.clone())
                .or_insert_with(|| env_var.to_string());
            false
        } else {
            true
        }
    });

    // O bloco `oauth` só faz sentido com endpoint HTTP: é o endereço do MCP
    // que vira o `resource` (RFC 8707) do login.
    let oauth = url
        .as_deref()
        .and_then(|endpoint| crate::mcp_auth::parse_oauth_config(raw, endpoint));

    Some(McpLaunchConfig {
        transport,
        command,
        args: string_array(raw.get("args")),
        env,
        env_vars,
        cwd: raw.get("cwd").and_then(Value::as_str).map(str::to_string),
        url,
        bearer_token_env_var,
        http_headers,
        env_http_headers,
        native_reason,
        oauth,
    })
}

/// Sobe o proxy autenticado deste servidor e devolve o que entregar ao agent.
fn subir_proxy(
    launch: &McpLaunchConfig,
    server_id: &str,
) -> Option<(
    crate::mcp_proxy::ProxyConfig,
    crate::mcp_proxy::ProxyListener,
)> {
    let endpoint = launch.url.clone()?;
    let oauth = launch.oauth.clone()?;
    let server_bin = std::env::current_exe().ok()?;
    let listener = crate::mcp_proxy::ProxyListener::spawn(server_id.to_string(), endpoint, oauth)?;
    let config = crate::mcp_proxy::ProxyConfig {
        server_bin: server_bin.to_string_lossy().to_string(),
        socket: listener.path().to_string_lossy().to_string(),
    };
    Some((config, listener))
}

/// O servidor deixa de ser nativo-apenas porque o MyCockpit tem login próprio?
///
/// É a virada da A2: com credencial nossa, o `native_reason: oauth` para de
/// bloquear e o servidor passa a ser roteável pros DOIS motores através do
/// proxy local. Decisão por CAPABILITY (`mcp_escopo`), nunca por nome de
/// agent. Sem login, devolve `false` e o comportamento é o de sempre.
/// Este agent PODE usar este servidor? Nativamente (portável + capability) OU
/// pelo proxy local, quando quem autenticou foi o app.
///
/// Existe porque a regra estava escrita em dois lugares com respostas
/// diferentes: o planejador do run já somava as duas vias, e os portões do
/// binding só olhavam a nativa. Resultado na tela: "roteado pelo Frota" com o
/// interruptor preso, e um erro de "não suporta" se ele fosse liberado.
fn utilizavel_por(server: &DiscoveredServer, agent: &str) -> bool {
    server.compatible(agent) || roteavel_por_proxy(server, agent)
}

fn roteavel_por_proxy(server: &DiscoveredServer, agent: &str) -> bool {
    // A existência da credencial é injetada para o teste fixar os DOIS lados da
    // regra sem depender do Keychain da máquina.
    roteavel_por_proxy_com(server, agent, || {
        crate::mcp_auth::tem_credencial(&server.id)
    })
}

fn roteavel_por_proxy_com(
    server: &DiscoveredServer,
    agent: &str,
    tem_credencial: impl FnOnce() -> bool,
) -> bool {
    let Some(caps) = crate::adapters::capabilities_of(agent) else {
        return false;
    };
    if !caps.mcp_escopo.por_run() || !server.managed {
        return false;
    }
    let Some(launch) = server.launch.as_ref() else {
        return false;
    };
    // Só HTTP: o proxy fala JSON-RPC sobre POST. SSE/WS segue fora (A3).
    if launch.transport != "http" || launch.oauth.is_none() {
        return false;
    }
    // Credencial literal no arquivo é outro problema, e continua barrando.
    if launch.has_literal_secret() {
        return false;
    }
    tem_credencial()
}

/// Configuração de login do app para um servidor do registry.
///
/// Redescobre ao vivo: o `.mcp.json` é do usuário e pode ter mudado desde a
/// última listagem, e o registry (de propósito) não guarda esse bloco.
pub async fn oauth_config_for_server(
    project_path: &str,
    server_id: &str,
) -> Option<crate::mcp_auth::OauthConfig> {
    discover_live(project_path)
        .await
        .into_iter()
        .find(|server| server.id == server_id)
        .and_then(|server| server.launch)
        .and_then(|launch| launch.oauth)
}

fn string_array(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn string_map(v: Option<&Value>) -> BTreeMap<String, String> {
    v.and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn push_json_servers(
    out: &mut Vec<DiscoveredServer>,
    root: Option<&Value>,
    source: &str,
    scope: &str,
    source_agent: Option<&str>,
) {
    let Some(map) = root.and_then(Value::as_object) else {
        return;
    };
    for (name, raw) in map {
        let Some(launch) = parse_launch(raw) else {
            continue;
        };
        out.push(DiscoveredServer {
            id: server_id(source, scope, name),
            name: name.clone(),
            source: source.into(),
            scope: scope.into(),
            source_agent: source_agent.map(str::to_string),
            enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            managed: true,
            launch: Some(launch),
        });
    }
}

fn discover_claude(project_path: &str) -> Vec<DiscoveredServer> {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        if let Ok(text) = std::fs::read_to_string(PathBuf::from(home).join(".claude.json")) {
            if let Ok(root) = serde_json::from_str::<Value>(&text) {
                push_json_servers(
                    &mut out,
                    root.get("mcpServers"),
                    "claude",
                    "user",
                    Some("claude-code"),
                );
                // Claude guarda o escopo local dentro do mapa de projetos. A
                // chave é o path; se a versão instalada não usar esse shape,
                // simplesmente não há entradas locais.
                if let Some(local) = root
                    .get("projects")
                    .and_then(|p| p.get(project_path))
                    .and_then(|p| p.get("mcpServers"))
                {
                    push_json_servers(
                        &mut out,
                        Some(local),
                        "claude",
                        "local",
                        Some("claude-code"),
                    );
                }
            }
        }
    }
    let shared = Path::new(project_path).join(".mcp.json");
    if let Ok(text) = std::fs::read_to_string(shared) {
        if let Ok(root) = serde_json::from_str::<Value>(&text) {
            push_json_servers(&mut out, root.get("mcpServers"), "project", "project", None);
        }
    }
    out
}

fn codex_home_dir() -> Option<PathBuf> {
    std::env::var("CODEX_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| Path::new(&h).join(".codex"))
        })
}

fn expand_home_path(input: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        if input == "~" {
            return home;
        }
        if let Some(rest) = input.strip_prefix("~/") {
            return format!("{home}/{rest}");
        }
        if input.contains("${HOME}") {
            return input.replace("${HOME}", &home);
        }
        if input.contains("$HOME") {
            return input.replace("$HOME", &home);
        }
    }
    input.to_string()
}

fn normalize_codex_launch(server_name: &str, launch: &mut McpLaunchConfig) {
    let Some(codex_home) = codex_home_dir() else {
        return;
    };
    normalize_codex_launch_in(&codex_home, server_name, launch);
}

/// A regra, com o HOME injetado. Separada do `codex_home_dir()` pra ser testável
/// sem mexer em variável de ambiente: teste que faz `set_var` corre em paralelo
/// com os outros na mesma thread pool e vira flake por construção (a casa já
/// tem esse padrão no adapters.rs, com salvar/restaurar — aqui dá pra evitar).
fn normalize_codex_launch_in(codex_home: &Path, server_name: &str, launch: &mut McpLaunchConfig) {
    if let Some(cmd) = &launch.command {
        let path = Path::new(cmd);
        if !path.is_absolute() {
            let clean_cmd = cmd.strip_prefix("./").unwrap_or(cmd);
            let candidate_server_dir = codex_home.join(server_name).join(clean_cmd);
            let candidate_home = codex_home.join(clean_cmd);
            if candidate_server_dir.exists() {
                launch.command = Some(candidate_server_dir.to_string_lossy().to_string());
                if launch
                    .cwd
                    .as_deref()
                    .is_none_or(|cwd| cwd == "." || !Path::new(cwd).is_absolute())
                {
                    launch.cwd = Some(codex_home.join(server_name).to_string_lossy().to_string());
                }
            } else if candidate_home.exists() {
                launch.command = Some(candidate_home.to_string_lossy().to_string());
                if launch
                    .cwd
                    .as_deref()
                    .is_none_or(|cwd| cwd == "." || !Path::new(cwd).is_absolute())
                {
                    launch.cwd = Some(codex_home.to_string_lossy().to_string());
                }
            }
        }
    }
}

async fn discover_codex(project_path: &str) -> Result<Vec<DiscoveredServer>, String> {
    let cwd = project_path.to_string();
    let output = tokio::task::spawn_blocking(move || {
        crate::proc::run("codex", &["mcp", "list", "--json"], Some(&cwd))
    })
    .await
    .map_err(|e| format!("falha na task de discovery do Codex: {e}"))?
    .map_err(|e| format!("`codex mcp list --json` falhou: {e}"))?;
    let items = serde_json::from_str::<Vec<Value>>(&output)
        .map_err(|e| format!("`codex mcp list --json` devolveu JSON inválido: {e}"))?;
    Ok(items
        .into_iter()
        .filter_map(|item| {
            let name = item.get("name")?.as_str()?.to_string();
            let mut launch = parse_launch(item.get("transport")?)?;
            normalize_codex_launch(&name, &mut launch);
            Some(DiscoveredServer {
                id: server_id("codex", "user", &name),
                name,
                source: "codex".into(),
                scope: "user".into(),
                source_agent: Some("codex".into()),
                enabled: item.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                managed: true,
                launch: Some(launch),
            })
        })
        .collect())
}

/// Descoberta ao vivo + erros de inventário POR AGENT (a fonte que falhou se
/// identifica; o código genérico só pergunta "o inventário do MEU agent está
/// ok?" — sem comparar nome de fornecedor). Hoje só o Codex enumera via CLI
/// (pode falhar); as demais fontes são leitura de arquivo, infalível-ish.
async fn discover_live_with_status(
    project_path: &str,
) -> (Vec<DiscoveredServer>, HashMap<String, String>) {
    let mut out = discover_claude(project_path);
    let mut inventory_errors = HashMap::new();
    match discover_codex(project_path).await {
        Ok(servers) => {
            out.extend(servers);
        }
        Err(error) => {
            inventory_errors.insert("codex".to_string(), error);
        }
    };
    out.push(DiscoveredServer {
        id: "internal:run:mc-context".into(),
        name: "mc-context".into(),
        source: "mycockpit".into(),
        scope: "run".into(),
        source_agent: None,
        enabled: true,
        managed: false,
        launch: None,
    });
    out.push(DiscoveredServer {
        id: "internal:run:mc-approval".into(),
        name: "mc-approval".into(),
        source: "mycockpit".into(),
        scope: "run".into(),
        source_agent: Some("claude-code".into()),
        enabled: true,
        managed: false,
        launch: None,
    });
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.source.cmp(&b.source))
    });
    (out, inventory_errors)
}

async fn discover_live(project_path: &str) -> Vec<DiscoveredServer> {
    discover_live_with_status(project_path).await.0
}

fn persist_registry(conn: &Connection, servers: &[DiscoveredServer]) -> Result<(), String> {
    let now = now_ms();
    for server in servers {
        let launch = server.launch.as_ref();
        let transport = launch.map(|c| c.transport.as_str()).unwrap_or("internal");
        let locator = launch
            .map(McpLaunchConfig::locator)
            .unwrap_or_else(|| "gerenciado pela Frota".into());
        let env_keys = launch.map(McpLaunchConfig::env_keys).unwrap_or_default();
        let fingerprint = launch
            .map(McpLaunchConfig::sanitized_fingerprint)
            .unwrap_or_default();
        let old_fingerprint = conn
            .query_row(
                "SELECT fingerprint FROM mcp_servers WHERE id = ?1",
                [&server.id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if old_fingerprint
            .as_deref()
            .is_some_and(|old| old != fingerprint)
        {
            // Resultado de health pertence à configuração anterior. Mantê-lo
            // até o TTL poderia rotear um run com um command/URL já trocado.
            conn.execute("DELETE FROM mcp_health WHERE server_id = ?1", [&server.id])
                .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "INSERT INTO mcp_servers
               (id, name, source, scope, source_agent, transport, locator,
                env_keys_json, fingerprint, managed, portable, source_enabled, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, source=excluded.source, scope=excluded.scope,
               source_agent=excluded.source_agent, transport=excluded.transport,
               locator=excluded.locator, env_keys_json=excluded.env_keys_json,
               fingerprint=excluded.fingerprint, managed=excluded.managed,
               portable=excluded.portable, source_enabled=excluded.source_enabled,
               last_seen_at=excluded.last_seen_at",
            params![
                server.id,
                server.name,
                server.source,
                server.scope,
                server.source_agent,
                transport,
                locator,
                serde_json::to_string(&env_keys).unwrap_or_else(|_| "[]".into()),
                fingerprint,
                server.managed as i64,
                server.portable() as i64,
                server.enabled as i64,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn agent_state(
    conn: &Connection,
    project_id: &str,
    server: &DiscoveredServer,
    agent: &str,
) -> McpAgentState {
    let binding = conn
        .query_row(
            "SELECT required, fallback, browser FROM mcp_bindings
             WHERE project_id = ?1 AND server_id = ?2 AND agent = ?3",
            params![project_id, server.id, agent],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? != 0,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let health = conn
        .query_row(
            "SELECT status, detail, tool_names_json, checked_at FROM mcp_health
             WHERE project_id = ?1 AND server_id = ?2 AND agent = ?3",
            params![project_id, server.id, agent],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    serde_json::from_str::<Vec<String>>(&row.get::<_, String>(2)?)
                        .unwrap_or_default(),
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    McpAgentState {
        agent: agent.into(),
        compatible: server.compatible(agent),
        roteavel_pelo_app: roteavel_por_proxy(server, agent),
        roteia_mcp_gerenciado: crate::adapters::capabilities_of(agent)
            .is_some_and(|caps| caps.mcp_escopo.por_run()),
        escopo: crate::adapters::capabilities_of(agent)
            .map(|caps| caps.mcp_escopo.rotulo().to_string())
            .unwrap_or_else(|| "nenhum".into()),
        enabled: binding.is_some(),
        required: binding.as_ref().is_some_and(|b| b.0),
        browser: binding.as_ref().is_some_and(|b| b.2),
        fallback: binding
            .as_ref()
            .map(|b| b.1.clone())
            .unwrap_or_else(|| "ask".into()),
        health: health
            .as_ref()
            .map(|h| h.0.clone())
            .unwrap_or_else(|| "unchecked".into()),
        detail: health.as_ref().and_then(|h| h.1.clone()),
        checked_at: health.as_ref().map(|h| h.3),
        tool_names: health.map(|h| h.2).unwrap_or_default(),
    }
}

fn server_view(conn: &Connection, project_id: &str, server: &DiscoveredServer) -> McpServerView {
    let launch = server.launch.as_ref();
    McpServerView {
        id: server.id.clone(),
        name: server.name.clone(),
        source: server.source.clone(),
        scope: server.scope.clone(),
        transport: launch
            .map(|c| c.transport.clone())
            .unwrap_or_else(|| "internal".into()),
        locator: launch
            .map(McpLaunchConfig::locator)
            .unwrap_or_else(|| "gerenciado pela Frota".into()),
        env_keys: launch.map(McpLaunchConfig::env_keys).unwrap_or_default(),
        source_agent: server.source_agent.clone(),
        source_enabled: server.enabled,
        managed: server.managed,
        portable: server.portable(),
        native_reason: launch.and_then(|c| c.native_reason),
        literal_secret: launch.is_some_and(McpLaunchConfig::has_literal_secret),
        runtime_name: None,
        agent_states: crate::adapters::registered_agents()
            .map(|agent| agent_state(conn, project_id, server, agent))
            .collect(),
    }
}

#[tauri::command]
pub async fn discover_mcp_servers(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<McpDiscoveryView, String> {
    // Valida antes de ler `.mcp.json` ou executar CLI dentro do path recebido
    // pelo WebView.
    let validation = db(&app)?;
    let project_id = project_id_for_path(&validation, &project_path)?;
    drop(validation);
    let (servers, inventory_errors) = discover_live_with_status(&project_path).await;
    let mut canonical: HashMap<String, Vec<crate::provider_mcp_inventory::ProviderMcpServer>> =
        HashMap::new();
    for server in &servers {
        // Internos e `.mcp.json` compartilhado não são estado nativo de um
        // provider. Só configurações com origem identificada entram aqui.
        let (Some(agent), Some(launch)) = (&server.source_agent, &server.launch) else {
            continue;
        };
        let scope = match server.scope.as_str() {
            "run" => crate::adapters::CapabilityScope::Run,
            "local" | "project" => crate::adapters::CapabilityScope::Project,
            "user" => crate::adapters::CapabilityScope::User,
            _ => crate::adapters::CapabilityScope::Global,
        };
        canonical.entry(agent.clone()).or_default().push(
            crate::provider_mcp_inventory::ProviderMcpServer {
                resource_kinds: crate::resource_broker::integration_resources(&server.name),
                resource_owner: crate::resource_broker::ResourceOwner::Provider,
                resource_evidence: crate::resource_broker::ResourceEvidence::IntegrationRegistry,
                name: server.name.clone(),
                enabled: server.enabled,
                transport: Some(launch.transport.clone()),
                scope,
            },
        );
    }
    let provider_inventories =
        crate::provider_mcp_inventory::inspect(&project_path, canonical, &inventory_errors).await;
    let conn = db(&app)?;
    persist_registry(&conn, &servers)?;
    let mut views: Vec<McpServerView> = servers
        .iter()
        .map(|server| server_view(&conn, &project_id, server))
        .collect();
    annotate_runtime_names(&servers, &mut views);
    Ok(McpDiscoveryView {
        servers: views,
        provider_inventories,
    })
}

/// Preenche `runtime_name` nas views com as MESMAS regras do plano de run:
/// slug amigável quando único entre os vinculados, senão o desambiguado
/// `mcx-…`. Aproximação honesta e declarada: o plano real conta apenas os
/// selecionados após o health check; aqui contam todos os vinculados do
/// projeto (a diferença só aparece quando um homônimo cai por indisponível).
fn annotate_runtime_names(servers: &[DiscoveredServer], views: &mut [McpServerView]) {
    let reserved = reserved_runtime_names(
        servers
            .iter()
            .filter(|server| server.source == "codex")
            .map(|server| server.name.clone()),
    );
    let bound = |view: &McpServerView| view.agent_states.iter().any(|state| state.enabled);
    let mut counts: HashMap<String, usize> = HashMap::new();
    for (server, view) in servers.iter().zip(views.iter()) {
        if bound(view) && server.portable() {
            *counts.entry(slug(&server.name)).or_default() += 1;
        }
    }
    for (server, view) in servers.iter().zip(views.iter_mut()) {
        if !bound(view) || !server.portable() {
            continue;
        }
        view.runtime_name = Some(
            friendly_runtime_name(&server.name, &counts, &reserved)
                .unwrap_or_else(|| server.runtime_name()),
        );
    }
}

/// Bindings existentes por projeto. Alimenta o seletor de projeto das
/// Integrações MCP: "cadê meus toggles?" se responde vendo onde há contagem.
fn bindings_summary(conn: &Connection) -> Result<Vec<McpBindingsSummary>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT project_id, COUNT(*) FROM mcp_bindings
             GROUP BY project_id ORDER BY project_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(McpBindingsSummary {
                project_id: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

#[tauri::command]
pub async fn mcp_bindings_summary(
    app: tauri::AppHandle,
) -> Result<Vec<McpBindingsSummary>, String> {
    let conn = db(&app)?;
    bindings_summary(&conn)
}

fn validate_agent(agent: &str) -> Result<(), String> {
    // Exato, sem canonicalizar: "" não é um binding válido. A lista vive na
    // factory dos adapters — agent novo entra lá e passa a valer aqui.
    if crate::adapters::is_registered(agent) {
        Ok(())
    } else {
        Err("agent inválido".into())
    }
}

fn validate_fallback(fallback: &str) -> Result<(), String> {
    if matches!(fallback, "ask" | "deny" | "allow-readonly") {
        Ok(())
    } else {
        Err("fallback inválido".into())
    }
}

/// Recorte do registry persistido suficiente pra validar um binding sem
/// re-descobrir ao vivo (a descoberta anterior já gravou `mcp_servers`).
#[derive(Clone, Debug)]
struct RegistryServer {
    managed: bool,
    portable: bool,
}

fn registry_server(conn: &Connection, server_id: &str) -> Result<Option<RegistryServer>, String> {
    conn.query_row(
        "SELECT managed, portable FROM mcp_servers WHERE id = ?1",
        [server_id],
        |row| {
            Ok(RegistryServer {
                managed: row.get::<_, i64>(0)? != 0,
                portable: row.get::<_, i64>(1)? != 0,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Validação de enable pelo registry. Mesmas mensagens do caminho ao vivo.
/// A checagem fina de `cwd` (Codex → Claude) exige o launch config, que o
/// registry não guarda; esse caso raro segue barrado no `plan_for_run`.
fn validate_enable_from_registry(server: &RegistryServer, agent: &str) -> Result<(), String> {
    if !server.managed {
        return Err("MCP interno é gerenciado por run e não aceita binding manual".into());
    }
    if !server.portable {
        return Err(
            "config não portável: mova valores literais/extensões nativas para wrapper, Keychain ou env ref"
                .into(),
        );
    }
    // Capability, não nome: agent sem escopo por-run não roteia por aqui.
    if !crate::adapters::capabilities_of(agent).is_some_and(|c| c.mcp_escopo.por_run()) {
        return Err(format!("{agent} ainda não suporta este MCP"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn upsert_binding(
    conn: &Connection,
    project_id: &str,
    server_id: &str,
    agent: &str,
    required: bool,
    fallback: &str,
    browser: bool,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO mcp_bindings
           (project_id, server_id, agent, required, fallback, browser, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(project_id, server_id, agent) DO UPDATE SET
           required=excluded.required, fallback=excluded.fallback,
           browser=excluded.browser, updated_at=excluded.updated_at",
        params![
            project_id,
            server_id,
            agent,
            required as i64,
            fallback,
            browser as i64,
            now_ms()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Instala (ou desinstala) um MCP no CLI de um agent de escopo GLOBAL.
///
/// É o gesto HUMANO do F3: nada aqui acontece sozinho, e a tela diz antes o
/// que vai acontecer (vale pra todos os projetos, e continua depois do run).
/// O app não escreve arquivo nenhum: quem escreve é o CLI do agent, no lugar
/// que ELE escolher naquela máquina (ADR-103).
///
/// Devolve a frase do PRÓPRIO CLI em caso de sucesso ("Added MCP server …"),
/// porque ela é a evidência do que aconteceu. Em caso de falha devolve o que
/// ele escreveu no stderr, nunca um "não deu certo" nosso.
#[tauri::command]
pub async fn install_mcp_in_agent(
    project_path: String,
    server_id: String,
    agent: String,
    instalar: bool,
) -> Result<String, String> {
    validate_agent(&agent)?;
    let servers = discover_live(&project_path).await;
    let server = servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| "servidor não encontrado na descoberta atual".to_string())?;
    let via = crate::mcp_instalacao::instalacao_de(&agent)
        .ok_or_else(|| format!("{agent} não tem receita de instalação de MCP"))?;

    // Escopo de PROJETO: o app escreve, porque o CLI do opencode grava no
    // global (medido) e daria escopo errado calado. O nome do arquivo é
    // relativo ao diretório, então continua sem nada fixo de máquina.
    if let crate::mcp_instalacao::McpInstalacao::ArquivoDoProjeto(arquivo) = via {
        let destino = std::path::Path::new(&project_path).join(arquivo);
        let atual = std::fs::read_to_string(&destino).unwrap_or_default();
        let spec = if instalar {
            let launch = server
                .launch
                .as_ref()
                .ok_or_else(|| "este MCP não tem config de launch para instalar".to_string())?;
            Some(crate::mcp_instalacao::spec_de(
                &agent,
                &server.name,
                launch,
            )?)
        } else {
            None
        };
        let novo = crate::mcp_instalacao::merge_opencode_json(&atual, &server.name, spec.as_ref())?;
        std::fs::write(&destino, novo)
            .map_err(|e| format!("não consegui gravar {}: {e}", destino.display()))?;
        return Ok(format!(
            "{} {} em {arquivo} (arquivo deste projeto)",
            server.name,
            if instalar { "instalado" } else { "removido" }
        ));
    }

    let argv = if instalar {
        let launch = server
            .launch
            .as_ref()
            .ok_or_else(|| "este MCP não tem config de launch para instalar".to_string())?;
        let spec = crate::mcp_instalacao::spec_de(&agent, &server.name, launch)?;
        crate::mcp_instalacao::install_argv(&agent, &spec)
    } else {
        crate::mcp_instalacao::uninstall_argv(&agent, &server.name)
    }
    .ok_or_else(|| format!("{agent} não instala MCP por comando de CLI"))?;

    let (bin, resto) = argv.split_first().ok_or("comando vazio")?;
    let saida = tokio::process::Command::new(bin)
        .args(resto)
        // stdin fechado: o comando tem de ser não-interativo. Medido que o
        // `agy mcp add` é; se algum dia pedir input, é melhor falhar na hora
        // que pendurar o app esperando alguém que não está lá.
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| format!("não consegui rodar `{bin}`: {e}"))?;
    let stdout = String::from_utf8_lossy(&saida.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&saida.stderr).trim().to_string();
    if !saida.status.success() {
        // A voz do CLI vale mais que a nossa aqui: ele sabe por que recusou.
        let motivo = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if motivo.is_empty() {
            format!("`{bin}` falhou sem dizer o motivo")
        } else {
            motivo
        });
    }
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_mcp_binding(
    app: tauri::AppHandle,
    project_path: String,
    server_id: String,
    agent: String,
    enabled: bool,
    required: bool,
    fallback: String,
    browser: Option<bool>,
) -> Result<(), String> {
    validate_agent(&agent)?;
    validate_fallback(&fallback)?;
    // `None` = chamador antigo/sem o campo: preserva o default de mecanismo
    // desligado (o navegador do projeto nunca entra sem gesto explícito).
    let browser = browser.unwrap_or(false);
    {
        let conn = db(&app)?;
        let project_id = project_id_for_path(&conn, &project_path)?;
        if !enabled {
            // Disable é sempre local: remover o binding não depende do servidor
            // ainda existir na origem.
            conn.execute(
                "DELETE FROM mcp_bindings
                 WHERE project_id = ?1 AND server_id = ?2 AND agent = ?3",
                params![project_id, server_id, agent],
            )
            .map_err(|e| e.to_string())?;
            return Ok(());
        }
        // Caminho rápido: o registry persistido pela descoberta anterior já
        // sabe se dá pra rotear. Nada de `codex mcp list` a cada toggle.
        if let Some(server) = registry_server(&conn, &server_id)? {
            validate_enable_from_registry(&server, &agent)?;
            return upsert_binding(
                &conn,
                &project_id,
                &server_id,
                &agent,
                required,
                &fallback,
                browser,
            );
        }
    }
    // Caso raro: servidor nunca descoberto nesta máquina. Só aqui a descoberta
    // ao vivo (lenta) roda, com a validação completa de compatibilidade.
    let servers = discover_live(&project_path).await;
    let server = servers
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "servidor não encontrado na descoberta atual".to_string())?;
    if !utilizavel_por(server, &agent) {
        return Err(if !server.portable() {
            "config não portável: mova valores literais/extensões nativas para wrapper, Keychain ou env ref".into()
        } else {
            format!("{agent} ainda não suporta este MCP")
        });
    }
    let conn = db(&app)?;
    let project_id = project_id_for_path(&conn, &project_path)?;
    persist_registry(&conn, &servers)?;
    upsert_binding(
        &conn,
        &project_id,
        &server_id,
        &agent,
        required,
        &fallback,
        browser,
    )
}

async fn write_rpc(stdin: &mut tokio::process::ChildStdin, value: Value) -> Result<(), String> {
    let mut line = value.to_string();
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

async fn read_rpc(
    reader: &mut tokio::io::Lines<BufReader<ChildStdout>>,
    wanted_id: i64,
) -> Result<Value, String> {
    let read = async {
        for _ in 0..60 {
            let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? else {
                return Err("MCP fechou stdout antes da resposta".into());
            };
            let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if value.get("id").and_then(Value::as_i64) == Some(wanted_id) {
                return Ok(value);
            }
        }
        Err("MCP emitiu respostas demais sem responder ao request".into())
    };
    timeout(PROBE_TIMEOUT, read)
        .await
        .map_err(|_| "timeout esperando resposta MCP".to_string())?
}

async fn finish_probe_child(
    mut child: Child,
    mut stderr_task: tokio::task::JoinHandle<String>,
) -> String {
    let _ = child.start_kill();
    let _ = child.wait().await;
    match timeout(Duration::from_secs(1), &mut stderr_task).await {
        Ok(Ok(text)) => text,
        _ => {
            stderr_task.abort();
            String::new()
        }
    }
}

fn redact_probe_detail(config: &McpLaunchConfig, text: String) -> String {
    let mut redacted = text;
    let mut values: Vec<String> = config.env.values().cloned().collect();
    values.extend(
        config
            .env_keys()
            .into_iter()
            .filter_map(|key| std::env::var(key).ok()),
    );
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    for value in values {
        if value.len() >= 4 {
            redacted = redacted.replace(&value, "[REDACTED]");
        }
    }
    redacted
}

async fn probe_stdio(config: &McpLaunchConfig, project_path: &str) -> ProbeOutcome {
    let Some(program_raw) = &config.command else {
        return ProbeOutcome {
            status: "unavailable".into(),
            detail: Some("command ausente".into()),
            tool_names: Vec::new(),
        };
    };
    let program = expand_home_path(program_raw);
    let mut cmd = Command::new(&program);
    let args: Vec<String> = config.args.iter().map(|a| expand_home_path(a)).collect();
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let cwd_expanded = config.cwd.as_deref().map(expand_home_path);
    let cwd = cwd_expanded
        .as_deref()
        .filter(|cwd| Path::new(cwd).is_absolute())
        .unwrap_or(project_path);
    cmd.current_dir(cwd);
    for (key, value) in &config.env {
        cmd.env(key, value);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return ProbeOutcome {
                status: "unavailable".into(),
                detail: Some(cap_detail(format!("não iniciou: {e}"))),
                tool_names: Vec::new(),
            };
        }
    };
    let Some(mut stdin) = child.stdin.take() else {
        return ProbeOutcome {
            status: "unavailable".into(),
            detail: Some("stdin MCP indisponível".into()),
            tool_names: Vec::new(),
        };
    };
    let Some(stdout) = child.stdout.take() else {
        return ProbeOutcome {
            status: "unavailable".into(),
            detail: Some("stdout MCP indisponível".into()),
            tool_names: Vec::new(),
        };
    };
    let mut stderr = child.stderr.take().expect("stderr pipado");
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });
    let mut reader = BufReader::new(stdout).lines();
    let result = async {
        write_rpc(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name":"mycockpit-health","version":"1.0.0"}
                }
            }),
        )
        .await?;
        let init = read_rpc(&mut reader, 1).await?;
        if let Some(err) = init.pointer("/error/message").and_then(Value::as_str) {
            return Err(format!("initialize: {err}"));
        }
        write_rpc(
            &mut stdin,
            json!({"jsonrpc":"2.0","method":"notifications/initialized","params":{}}),
        )
        .await?;
        write_rpc(
            &mut stdin,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
        )
        .await?;
        let tools = read_rpc(&mut reader, 2).await?;
        if let Some(err) = tools.pointer("/error/message").and_then(Value::as_str) {
            return Err(format!("tools/list: {err}"));
        }
        let names = tools
            .pointer("/result/tools")
            .and_then(Value::as_array)
            .map(|tools| {
                tools
                    .iter()
                    .filter_map(|tool| tool.get("name").and_then(Value::as_str))
                    .take(MAX_TOOL_NAMES)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok::<_, String>(names)
    }
    .await;
    let stderr = finish_probe_child(child, stderr_task).await;
    match result {
        Ok(tool_names) => ProbeOutcome {
            status: "healthy".into(),
            detail: Some(format!("{} tools disponíveis", tool_names.len())),
            tool_names,
        },
        Err(error) => {
            let detail = if stderr.trim().is_empty() {
                error
            } else {
                format!("{error} · {}", stderr.lines().last().unwrap_or_default())
            };
            let detail = redact_probe_detail(config, detail);
            ProbeOutcome {
                status: if detail.to_lowercase().contains("auth")
                    || detail.to_lowercase().contains("token")
                {
                    "auth-required".into()
                } else {
                    "unavailable".into()
                },
                detail: Some(cap_detail(detail)),
                tool_names: Vec::new(),
            }
        }
    }
}

async fn probe_http(config: &McpLaunchConfig) -> ProbeOutcome {
    let Some(url) = &config.url else {
        return ProbeOutcome {
            status: "unavailable".into(),
            detail: Some("URL ausente".into()),
            tool_names: Vec::new(),
        };
    };
    let output = timeout(
        PROBE_TIMEOUT,
        Command::new("curl")
            .args([
                "--silent",
                "--show-error",
                "--max-time",
                "5",
                "--output",
                "/dev/null",
                "--write-out",
                "%{http_code}",
                "--request",
                "POST",
                "--header",
                "Content-Type: application/json",
                "--header",
                "Accept: application/json, text/event-stream",
                "--data",
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mycockpit-health","version":"1.0.0"}}}"#,
                url,
            ])
            .output(),
    )
    .await;
    match output {
        Ok(Ok(out)) => {
            let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let numeric = code.parse::<u16>().unwrap_or(0);
            let status = match numeric {
                200..=400 | 405 => "healthy",
                401 | 403 if delegated_http_auth_available(config) => "auth-delegated",
                401 | 403 => "auth-required",
                _ => "unavailable",
            };
            let detail = if status == "auth-delegated" {
                format!("HTTP {code}; endpoint alcançável, credencial delegada por env")
            } else {
                format!("HTTP {code}")
            };
            ProbeOutcome {
                status: status.into(),
                detail: Some(detail),
                tool_names: Vec::new(),
            }
        }
        Ok(Err(e)) => ProbeOutcome {
            status: "unavailable".into(),
            detail: Some(cap_detail(e.to_string())),
            tool_names: Vec::new(),
        },
        Err(_) => ProbeOutcome {
            status: "unavailable".into(),
            detail: Some("timeout no endpoint HTTP".into()),
            tool_names: Vec::new(),
        },
    }
}

fn delegated_http_auth_available(config: &McpLaunchConfig) -> bool {
    let bearer_ok = config
        .bearer_token_env_var
        .as_deref()
        .is_some_and(|key| std::env::var_os(key).is_some());
    let headers_ok = !config.env_http_headers.is_empty()
        && config
            .env_http_headers
            .values()
            .all(|key| std::env::var_os(key).is_some());
    bearer_ok || headers_ok
}

async fn probe(server: &DiscoveredServer, project_path: &str) -> ProbeOutcome {
    let Some(config) = &server.launch else {
        return ProbeOutcome {
            status: if server.source == "mycockpit" {
                "healthy".into()
            } else {
                "unavailable".into()
            },
            detail: Some("gerenciado internamente".into()),
            tool_names: Vec::new(),
        };
    };
    probe_launch(config, project_path).await
}

pub(crate) async fn probe_launch(config: &McpLaunchConfig, project_path: &str) -> ProbeOutcome {
    if config.transport == "stdio" {
        probe_stdio(config, project_path).await
    } else {
        probe_http(config).await
    }
}

fn persist_health(
    conn: &Connection,
    project_id: &str,
    server_id: &str,
    agent: &str,
    outcome: &ProbeOutcome,
) -> Result<McpHealthView, String> {
    let at = now_ms();
    conn.execute(
        "INSERT INTO mcp_health
           (project_id, server_id, agent, status, detail, tool_names_json, checked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(project_id, server_id, agent) DO UPDATE SET
           status=excluded.status, detail=excluded.detail,
           tool_names_json=excluded.tool_names_json, checked_at=excluded.checked_at",
        params![
            project_id,
            server_id,
            agent,
            outcome.status,
            outcome.detail,
            serde_json::to_string(&outcome.tool_names).unwrap_or_else(|_| "[]".into()),
            at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(McpHealthView {
        server_id: server_id.into(),
        agent: agent.into(),
        status: outcome.status.clone(),
        detail: outcome.detail.clone(),
        checked_at: at,
        tool_count: outcome.tool_names.len(),
        tool_names: outcome.tool_names.clone(),
    })
}

#[tauri::command]
pub async fn check_mcp_server(
    app: tauri::AppHandle,
    project_path: String,
    server_id: String,
    agent: String,
) -> Result<McpHealthView, String> {
    validate_agent(&agent)?;
    let validation = db(&app)?;
    project_id_for_path(&validation, &project_path)?;
    drop(validation);
    let servers = discover_live(&project_path).await;
    let server = servers
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "servidor não encontrado".to_string())?;
    if !utilizavel_por(server, &agent) && server.source != "mycockpit" {
        return Err(format!("{agent} não é compatível com este servidor"));
    }
    let outcome = probe(server, &project_path).await;
    let conn = db(&app)?;
    let project_id = project_id_for_path(&conn, &project_path)?;
    persist_registry(&conn, &servers)?;
    persist_health(&conn, &project_id, &server_id, &agent, &outcome)
}

fn bindings_for_run(
    conn: &Connection,
    project_id: &str,
    agent: &str,
) -> Result<Vec<Binding>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT server_id, required, fallback, browser FROM mcp_bindings
             WHERE project_id = ?1 AND agent = ?2 ORDER BY server_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id, agent], |row| {
            Ok(Binding {
                server_id: row.get(0)?,
                required: row.get::<_, i64>(1)? != 0,
                fallback: row.get(2)?,
                browser: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

fn cached_health(
    conn: &Connection,
    project_id: &str,
    server_id: &str,
    agent: &str,
) -> Option<ProbeOutcome> {
    conn.query_row(
        "SELECT status, detail, tool_names_json, checked_at FROM mcp_health
         WHERE project_id = ?1 AND server_id = ?2 AND agent = ?3",
        params![project_id, server_id, agent],
        |row| {
            let checked_at: i64 = row.get(3)?;
            if now_ms() - checked_at > HEALTH_TTL_MS {
                return Ok(None);
            }
            let names: String = row.get(2)?;
            Ok(Some(ProbeOutcome {
                status: row.get(0)?,
                detail: row.get(1)?,
                tool_names: serde_json::from_str(&names).unwrap_or_default(),
            }))
        },
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
}

fn unavailable_disposition(binding: &Binding) -> McpPlanDisposition {
    if !binding.required {
        return McpPlanDisposition::Omitted;
    }
    match binding.fallback.as_str() {
        "ask" => McpPlanDisposition::NeedsDecision,
        "allow-readonly" => McpPlanDisposition::NeedsReadonlyConsent,
        _ => McpPlanDisposition::BlockedByPolicy,
    }
}

fn record_unavailable(
    plan: &mut McpRunPlan,
    binding: &Binding,
    source_label: &str,
    code: McpPlanIssueCode,
    detail: Option<String>,
    overrides: &[McpRunOverride],
) -> bool {
    let disposition = unavailable_disposition(binding);
    let issue = McpPlanIssue {
        source_id: binding.server_id.clone(),
        source_label: source_label.to_string(),
        code,
        disposition,
        detail,
    };
    if disposition == McpPlanDisposition::Omitted {
        plan.omissions.push(issue);
        return false;
    }

    let mut allowed_recoveries = Vec::new();
    if binding.browser {
        allowed_recoveries.push(McpRecovery {
            kind: McpRecoveryKind::StartProjectBrowser,
            source_id: Some(binding.server_id.clone()),
        });
    }
    allowed_recoveries.push(McpRecovery {
        kind: McpRecoveryKind::OpenMcpSettings,
        source_id: Some(binding.server_id.clone()),
    });
    match disposition {
        McpPlanDisposition::NeedsDecision => allowed_recoveries.push(McpRecovery {
            kind: McpRecoveryKind::OmitForThisRun,
            source_id: Some(binding.server_id.clone()),
        }),
        McpPlanDisposition::NeedsReadonlyConsent => allowed_recoveries.push(McpRecovery {
            kind: McpRecoveryKind::RetryReadonly,
            source_id: Some(binding.server_id.clone()),
        }),
        McpPlanDisposition::Omitted | McpPlanDisposition::BlockedByPolicy => {}
    }
    let gate = McpPreflightGate::new(vec![issue.clone()], allowed_recoveries);
    let requested = overrides.iter().find(|request| {
        request.gate_fingerprint == gate.fingerprint && request.source_id == binding.server_id
    });
    if let Some(request) = requested {
        match (disposition, request.kind) {
            (McpPlanDisposition::NeedsDecision, McpRecoveryKind::OmitForThisRun) => {
                plan.omissions.push(McpPlanIssue {
                    disposition: McpPlanDisposition::Omitted,
                    ..issue
                });
                return false;
            }
            (McpPlanDisposition::NeedsReadonlyConsent, McpRecoveryKind::RetryReadonly) => {
                plan.omissions.push(McpPlanIssue {
                    disposition: McpPlanDisposition::Omitted,
                    ..issue
                });
                plan.force_readonly = true;
                return false;
            }
            _ => {}
        }
    }
    plan.gate = Some(gate);
    true
}

/// Resolve somente bindings explícitos. Sem binding, preserva o comportamento
/// legado dos CLIs (configs globais continuam visíveis). Com ao menos um
/// binding, o run entra em modo gerenciado e só recebe os MCPs selecionados.
pub async fn plan_for_run(
    app: &tauri::AppHandle,
    conv_id: &str,
    run_id: &str,
    agent: &str,
    cwd: &str,
    overrides: &[McpRunOverride],
) -> Result<McpRunPlan, String> {
    let agent = crate::adapters::canonical_agent(agent);
    if !crate::adapters::is_registered(agent) {
        return Ok(McpRunPlan::default());
    }
    let conn = db(app)?;
    let (project_id, project_path) = project_for_conv(&conn, conv_id, cwd)?;
    let bindings = bindings_for_run(&conn, &project_id, agent)?;
    if bindings.is_empty() {
        return Ok(McpRunPlan::default());
    }
    let (servers, inventory_errors) = discover_live_with_status(&project_path).await;
    // Inventário nativo do próprio agent indisponível impede provar a policy
    // efetiva. É gate de preflight, não falha de uma execução inexistente.
    if let Some(error) = inventory_errors.get(agent) {
        let mut plan = McpRunPlan {
            managed: true,
            ..Default::default()
        };
        plan.gate = Some(McpPreflightGate::control_plane(format!(
            "inventário MCP do {agent} indisponível: {error}"
        )));
        return Ok(plan);
    }
    persist_registry(&conn, &servers)?;
    let by_id: HashMap<&str, &DiscoveredServer> = servers
        .iter()
        .map(|server| (server.id.as_str(), server))
        .collect();
    let mut plan = McpRunPlan {
        managed: true,
        disabled_codex_servers: servers
            .iter()
            .filter(|server| server.source == "codex")
            .filter_map(|server| {
                server.launch.as_ref().map(|launch| McpRuntimeServer {
                    runtime_name: server.name.clone(),
                    display_name: server.name.clone(),
                    launch: launch.codex_public_transport(),
                    tool_names: Vec::new(),
                })
            })
            .collect(),
        ..Default::default()
    };
    let mut browser_pilot_acquired = false;
    for binding in bindings {
        let Some(server) = by_id.get(binding.server_id.as_str()).copied() else {
            if record_unavailable(
                &mut plan,
                &binding,
                &binding.server_id,
                McpPlanIssueCode::SourceMissing,
                Some("não existe mais na configuração de origem".into()),
                overrides,
            ) {
                break;
            }
            continue;
        };
        // Com login do MyCockpit, um servidor OAuth deixa de ser nativo-apenas:
        // ele passa a ser roteável pelos dois motores através do proxy local.
        let via_proxy = roteavel_por_proxy(server, agent);
        if !via_proxy && !server.compatible(agent) {
            if record_unavailable(
                &mut plan,
                &binding,
                &server.name,
                McpPlanIssueCode::Incompatible,
                Some(format!("não é portável ou compatível com {agent}")),
                overrides,
            ) {
                break;
            }
            continue;
        }
        let outcome = if let Some(cached) = cached_health(&conn, &project_id, &server.id, agent) {
            cached
        } else {
            let outcome = probe(server, &project_path).await;
            let _ = persist_health(&conn, &project_id, &server.id, agent, &outcome);
            outcome
        };
        // Com proxy, `auth-required` é resultado ESPERADO do preflight: o probe
        // bate no endpoint sem token (o registry não tem credencial) e leva 401.
        // Quem autentica é o proxy, na hora da chamada.
        let aceitavel = matches!(outcome.status.as_str(), "healthy" | "auth-delegated")
            || (via_proxy && outcome.status == "auth-required");
        if aceitavel {
            let mut launch = server.launch.clone().expect("compatible exige launch");
            let mut resolved_resource = None;
            // B2.2: o roteamento pro navegador do app entra aqui, no plano
            // efêmero, depois do probe com os args de origem. `browser` define
            // o transporte; somente `required` define se a ausência bloqueia.
            if binding.browser {
                let endpoint = crate::browser::live_endpoint(app, &project_id).await;
                let resource =
                    crate::resource_broker::project_browser(&server.name, endpoint.is_some());
                if endpoint.is_none() {
                    if record_unavailable(
                        &mut plan,
                        &binding,
                        &server.name,
                        McpPlanIssueCode::BrowserOffline,
                        Some("o navegador deste projeto está desligado".into()),
                        overrides,
                    ) {
                        break;
                    }
                    continue;
                }
                if endpoint.is_some() && !browser_pilot_acquired {
                    let broker = app
                        .state::<Arc<crate::experience_broker::ExperienceBroker>>()
                        .inner()
                        .clone();
                    match broker.acquire_agent(&project_id, run_id) {
                        Ok(lease) => {
                            plan.browser_pilot_leases.push(Arc::new(lease));
                            browser_pilot_acquired = true;
                        }
                        Err(message) => {
                            if record_unavailable(
                                &mut plan,
                                &binding,
                                &server.name,
                                McpPlanIssueCode::BrowserBusy,
                                Some(message),
                                overrides,
                            ) {
                                break;
                            }
                            continue;
                        }
                    }
                }
                match apply_cdp_endpoint(&mut launch, endpoint.as_deref(), &server.name) {
                    Ok(notices) => {
                        resolved_resource = Some(resource);
                        plan.notices.extend(notices);
                    }
                    Err(message) => {
                        if record_unavailable(
                            &mut plan,
                            &binding,
                            &server.name,
                            McpPlanIssueCode::BrowserUnavailable,
                            Some(message),
                            overrides,
                        ) {
                            break;
                        }
                        continue;
                    }
                }
            }
            // A troca acontece AQUI, no plano efêmero: o que o agent recebe é o
            // server local do proxy, sem URL e sem credencial. O token fica no
            // processo do app.
            if via_proxy {
                match subir_proxy(&launch, &server.id) {
                    Some((config, listener)) => {
                        launch = config.launch();
                        plan.proxies.push(Arc::new(listener));
                    }
                    None => {
                        // Fail-closed: sem proxy não se entrega o servidor cru
                        // (isso vazaria a exigência de auth pro agent, que
                        // falharia no meio da tarefa).
                        if record_unavailable(
                            &mut plan,
                            &binding,
                            &server.name,
                            McpPlanIssueCode::ProxyUnavailable,
                            Some("falha ao abrir o proxy autenticado".into()),
                            overrides,
                        ) {
                            break;
                        }
                        continue;
                    }
                }
            }
            if let Some(resource) = resolved_resource {
                plan.resources.push(resource);
            }
            plan.selected.push(McpRuntimeServer {
                runtime_name: server.runtime_name(),
                display_name: server.name.clone(),
                launch,
                tool_names: outcome.tool_names.clone(),
            });
            continue;
        }
        let detail = outcome
            .detail
            .clone()
            .unwrap_or_else(|| outcome.status.clone());
        if record_unavailable(
            &mut plan,
            &binding,
            &server.name,
            McpPlanIssueCode::HealthUnavailable,
            Some(detail),
            overrides,
        ) {
            break;
        }
    }
    apply_friendly_runtime_names(&mut plan);
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parseia_stdio_e_nunca_expoe_valores_no_fingerprint() {
        let raw = json!({
            "command": "/bin/server",
            "args": ["--x"],
            "env": {"TOKEN":"segredo-absoluto"}
        });
        let cfg = parse_launch(&raw).unwrap();
        assert_eq!(cfg.transport, "stdio");
        assert_eq!(cfg.env_keys(), vec!["TOKEN"]);
        assert!(!cfg.portable());
        assert!(!cfg.sanitized_fingerprint().contains("segredo-absoluto"));
    }

    /// H2 (prompt-hygiene-plan) — o fingerprint do plano decide o re-anúncio
    /// mid-conversa: estável a reordenação (mesmo conjunto = mesmo carimbo),
    /// sensível ao CONJUNTO (ligar um binding muda), e nunca carrega launch/env
    /// (só nomes viajam pro front via `mcp://announced`).
    #[test]
    fn fingerprint_do_plano_e_estavel_ao_conjunto_e_sem_segredos() {
        let srv = |name: &str| McpRuntimeServer {
            runtime_name: name.to_string(),
            display_name: name.to_string(),
            launch: Default::default(),
            tool_names: Vec::new(),
        };
        let plano = |names: &[&str]| McpRunPlan {
            managed: true,
            selected: names.iter().map(|n| srv(n)).collect(),
            ..Default::default()
        };
        // não gerenciado (legado): nada a anunciar, nada a carimbar
        assert_eq!(McpRunPlan::default().fingerprint(), None);
        // gerenciado VAZIO tem carimbo próprio: desligar todos os bindings é
        // mudança de plano (N→0 re-anuncia; ver preambulo_reanuncia_n_para_zero)
        let vazio = plano(&[]).fingerprint();
        assert!(vazio.is_some());
        assert_ne!(vazio, plano(&["playwright"]).fingerprint());
        // mesmo conjunto em outra ordem = mesmo carimbo
        assert_eq!(
            plano(&["playwright", "hostinger"]).fingerprint(),
            plano(&["hostinger", "playwright"]).fingerprint()
        );
        // conjunto diferente = carimbo diferente (é o gatilho do re-anúncio)
        assert_ne!(
            plano(&["playwright"]).fingerprint(),
            plano(&["playwright", "hostinger"]).fingerprint()
        );
        let contribuido = McpRunPlan {
            contributed: vec![srv("plugin__acme_quality__docs")],
            ..Default::default()
        };
        assert!(contribuido.fingerprint().is_some());
        assert_eq!(
            contribuido.announced_servers()[0].runtime_name,
            "plugin__acme_quality__docs"
        );
    }

    #[test]
    fn mcp_contribuido_entra_no_codex_sem_gerenciar_config_legado() {
        let plan = McpRunPlan {
            contributed: vec![McpRuntimeServer {
                runtime_name: "plugin__acme_quality__docs".into(),
                display_name: "Quality · Docs".into(),
                launch: McpLaunchConfig {
                    transport: "stdio".into(),
                    command: Some("/Applications/Frota".into()),
                    args: vec!["plugin-mcp-server".into(), "/tmp/descriptor".into()],
                    ..Default::default()
                },
                tool_names: vec!["search".into()],
            }],
            ..Default::default()
        };
        let mut command = Command::new("codex");
        plan.configure_codex(&mut command);
        let args = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(args.contains("plugin__acme_quality__docs"));
        assert!(args.contains("plugin-mcp-server"));
        assert!(!args.contains("enabled=false"));
    }

    #[test]
    fn wrapper_sem_segredo_literal_e_portavel() {
        let raw = json!({
            "type": "stdio",
            "command": "/Users/me/.claude/bin/hostinger-wrapper.sh",
            "args": []
        });
        let cfg = parse_launch(&raw).unwrap();
        assert!(cfg.portable());
    }

    /// O caso real que gerou a correção: `prime-mcp` do `.mcp.json` é HTTP com
    /// OAuth e NENHUM valor literal. A trava é correta (o token vive no
    /// keychain do CLI que logou), mas a causa é `native_reason`, não segredo
    /// literal — a UI precisa dos dois motivos separados pra não mentir.
    /// A1+A2: com login do MyCockpit, um MCP OAuth deixa de ser nativo-apenas e
    /// passa a ser roteável pelos DOIS motores (pelo proxy). Sem login, nada
    /// muda — a trava de hoje continua exatamente onde estava.
    #[test]
    fn servidor_oauth_so_vira_roteavel_quando_existe_login_do_app() {
        let raw = json!({
            "type": "http",
            "url": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp",
            "oauth": {
                "clientId": "c19d2b4a-1006-4564-8925-4bfe6156d147",
                "callbackPort": 8976,
                "authServerMetadataUrl": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/.well-known/oauth-authorization-server"
            }
        });
        let server = DiscoveredServer {
            id: "s1".into(),
            name: "prime-mcp".into(),
            source: "mcp.json".into(),
            scope: "project".into(),
            source_agent: None,
            enabled: true,
            managed: true,
            launch: parse_launch(&raw),
        };
        // A regra ANTIGA continua valendo: por portabilidade ele segue barrado.
        assert!(!server.compatible("claude-code"));
        assert!(!server.compatible("codex"));
        // Sem login, o proxy não entra e nada é roteado.
        for agent in ["claude-code", "codex"] {
            assert!(
                !roteavel_por_proxy_com(&server, agent, || false),
                "sem login, {agent} não pode rotear"
            );
        }
        // Com login, os DOIS motores passam a poder — a decisão é por
        // capability (`mcp_escopo`), nunca por nome de agent.
        for agent in ["claude-code", "codex"] {
            assert!(
                roteavel_por_proxy_com(&server, agent, || true),
                "com login, {agent} deve rotear pelo proxy"
            );
        }
    }

    /// O bug que o usuário viu: fez o login, os TRÊS viraram "roteado pelo
    /// Frota" e nenhum interruptor destravou.
    ///
    /// Eram duas mentiras em sentidos opostos, e esta é a guarda das duas.
    /// Claude e Codex ficaram travados podendo rodar. E o Agy foi prometido
    /// sem poder: o escopo dele é Global porque o CLI só configura MCP
    /// por arquivo GLOBAL, sem flag por-run (ver AGY_CAPS). Nenhum login
    /// conserta isso, e o rótulo dizia que sim.
    #[test]
    fn login_do_app_destrava_quem_roteia_e_nao_promete_quem_nao_roteia() {
        let raw = json!({
            "type": "http",
            "url": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp",
            "oauth": { "clientId": "c1", "callbackPort": 8976 }
        });
        let server = DiscoveredServer {
            id: "s1".into(),
            name: "prime-mcp".into(),
            source: "mcp.json".into(),
            scope: "project".into(),
            source_agent: None,
            enabled: true,
            managed: true,
            launch: parse_launch(&raw),
        };
        // A causa do interruptor preso: nativamente NENHUM dos três serve.
        for agent in ["claude-code", "codex", "agy"] {
            assert!(!server.compatible(agent), "{agent} não é nativo aqui");
        }
        // Com login, quem tem escopo por-run passa a poder de verdade.
        for agent in ["claude-code", "codex"] {
            assert!(
                roteavel_por_proxy_com(&server, agent, || true),
                "com login, {agent} deve destravar"
            );
        }
        // O Agy NÃO. E não é falta de login: é falta de capability.
        assert!(
            !roteavel_por_proxy_com(&server, "agy", || true),
            "agy não roteia MCP gerenciado nem com login (config global por arquivo)"
        );
    }

    #[test]
    fn sem_bloco_oauth_ou_fora_de_http_o_proxy_nao_entra() {
        let stdio = DiscoveredServer {
            id: "s2".into(),
            name: "local".into(),
            source: "claude".into(),
            scope: "user".into(),
            source_agent: Some("claude-code".into()),
            enabled: true,
            managed: true,
            launch: parse_launch(&json!({ "command": "node", "args": ["s.js"] })),
        };
        assert!(!roteavel_por_proxy_com(&stdio, "claude-code", || true));

        // HTTP sem bloco `oauth`: não há o que autenticar, segue o caminho
        // normal (não passa a ser problema do proxy).
        let http_sem_oauth = DiscoveredServer {
            launch: parse_launch(&json!({ "type": "http", "url": "https://x/mcp" })),
            ..stdio.clone()
        };
        assert!(!roteavel_por_proxy_com(
            &http_sem_oauth,
            "claude-code",
            || true
        ));
    }

    #[test]
    fn segredo_literal_continua_barrando_mesmo_com_login_do_app() {
        // As duas travas são independentes: resolver o OAuth não perdoa um
        // token literal no arquivo do usuário.
        let com_literal = DiscoveredServer {
            id: "s3".into(),
            name: "x".into(),
            source: "mcp.json".into(),
            scope: "project".into(),
            source_agent: None,
            enabled: true,
            managed: true,
            launch: parse_launch(&json!({
                "type": "http",
                "url": "https://x/mcp",
                "headers": { "X-Api-Key": "segredo-literal" },
                "oauth": { "clientId": "c", "callbackPort": 1234 }
            })),
        };
        assert!(!roteavel_por_proxy_com(&com_literal, "claude-code", || {
            true
        }));
    }

    #[test]
    fn oauth_sem_valor_literal_reporta_causa_nativa_e_nao_segredo() {
        let cfg = parse_launch(&json!({
            "type": "http",
            "url": "https://projeto.supabase.co/functions/v1/mcp",
            "oauth": {
                "clientId": "cliente-publico",
                "callbackPort": 8976,
                "authServerMetadataUrl": "https://projeto.supabase.co/.well-known/oauth-authorization-server"
            }
        }))
        .unwrap();
        assert_eq!(cfg.native_reason, Some(McpNativeReason::Oauth));
        assert!(!cfg.has_literal_secret());
        assert!(!cfg.portable());
    }

    #[test]
    fn cada_dependencia_nativa_tem_motivo_tipado_proprio() {
        let reason = |raw: Value| parse_launch(&raw).unwrap().native_reason;
        assert_eq!(
            reason(json!({"type": "sse", "url": "https://mcp.example.com/sse"})),
            Some(McpNativeReason::Stream)
        );
        assert_eq!(
            reason(json!({
                "type": "http",
                "url": "https://mcp.example.com/mcp",
                "headersHelper": "/opt/bin/auth-header"
            })),
            Some(McpNativeReason::HeadersHelper)
        );
        assert_eq!(
            reason(json!({"type": "http", "url": "https://mcp.example.com/mcp"})),
            None
        );
        // Contrato com a união TS de lib/mcp.ts: kebab-case, sem string livre.
        assert_eq!(
            serde_json::to_value(McpNativeReason::HeadersHelper).unwrap(),
            json!("headers-helper")
        );
    }

    #[test]
    fn segredo_literal_e_dependencia_nativa_sao_motivos_independentes() {
        let literal = parse_launch(&json!({
            "command": "/bin/server",
            "env": {"TOKEN": "segredo-absoluto"}
        }))
        .unwrap();
        assert_eq!(literal.native_reason, None);
        assert!(literal.has_literal_secret());

        // Os dois ao mesmo tempo continuam visíveis: nenhum motivo engole o outro.
        let ambos = parse_launch(&json!({
            "type": "sse",
            "url": "https://user:senha@mcp.example.com/sse"
        }))
        .unwrap();
        assert_eq!(ambos.native_reason, Some(McpNativeReason::Stream));
        assert!(ambos.has_literal_secret());
    }

    #[test]
    fn extensao_nativa_e_credencial_em_url_nao_sao_roteadas() {
        let oauth = parse_launch(&json!({
            "type": "http",
            "url": "https://mcp.example.com/mcp",
            "oauth": {"clientId": "local"}
        }))
        .unwrap();
        assert!(!oauth.portable());

        let url_secret = parse_launch(&json!({
            "type": "http",
            "url": "https://user:pass@mcp.example.com/mcp?token=abc"
        }))
        .unwrap();
        assert!(!url_secret.portable());

        let argv_secret = parse_launch(&json!({
            "command": "/bin/server",
            "args": ["--api-key", "abc"]
        }))
        .unwrap();
        assert!(!argv_secret.portable());
    }

    #[test]
    fn cwd_do_codex_nao_e_prometido_ao_claude() {
        let server = DiscoveredServer {
            id: "codex:user:local".into(),
            name: "local".into(),
            source: "codex".into(),
            scope: "user".into(),
            source_agent: Some("codex".into()),
            enabled: true,
            managed: true,
            launch: Some(McpLaunchConfig {
                transport: "stdio".into(),
                command: Some("node".into()),
                cwd: Some("/plugin".into()),
                ..Default::default()
            }),
        };
        assert!(server.compatible("codex"));
        assert!(!server.compatible("claude-code"));
    }

    #[test]
    fn detalhe_de_probe_remove_valores_conhecidos() {
        let config = McpLaunchConfig {
            env: BTreeMap::from([("TOKEN".into(), "super-secret-value".into())]),
            ..Default::default()
        };
        let detail = redact_probe_detail(&config, "falhou com token super-secret-value".into());
        assert_eq!(detail, "falhou com token [REDACTED]");
    }

    #[test]
    fn normaliza_refs_de_env_entre_claude_e_codex() {
        let raw = json!({
            "type": "http",
            "url": "https://mcp.example.com/mcp",
            "headers": {
                "Authorization": "Bearer ${MCP_TOKEN}",
                "X-Tenant": "${MCP_TENANT}"
            }
        });
        let cfg = parse_launch(&raw).unwrap();
        assert!(cfg.portable());
        assert_eq!(cfg.bearer_token_env_var.as_deref(), Some("MCP_TOKEN"));
        assert_eq!(
            cfg.env_http_headers.get("X-Tenant").map(String::as_str),
            Some("MCP_TENANT")
        );
        let claude = cfg.claude_json();
        assert_eq!(claude["headers"]["Authorization"], "Bearer ${MCP_TOKEN}");
        assert_eq!(claude["headers"]["X-Tenant"], "${MCP_TENANT}");
    }

    #[test]
    fn registry_remove_segredos_de_url() {
        let cfg = McpLaunchConfig {
            transport: "http".into(),
            url: Some("https://user:pass@example.com/mcp?token=abc#frag".into()),
            ..Default::default()
        };
        assert_eq!(cfg.locator(), "https://example.com/mcp");
        assert!(!cfg.sanitized_fingerprint().contains("abc"));
    }

    #[test]
    fn config_codex_usa_override_efemero() {
        let cfg = McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("/bin/server".into()),
            args: vec!["serve".into()],
            ..Default::default()
        };
        let mut cmd = Command::new("codex");
        cfg.configure_codex("mcx-test", &mut cmd);
        let dbg = format!("{cmd:?}");
        assert!(dbg.contains("mcp_servers.mcx-test.command"));
        assert!(dbg.contains("/bin/server"));
        assert!(!dbg.contains("config.toml"));
    }

    #[test]
    fn config_codex_cita_header_que_nao_e_chave_toml_simples() {
        let cfg = McpLaunchConfig {
            transport: "http".into(),
            url: Some("https://mcp.example.com/mcp".into()),
            env_http_headers: BTreeMap::from([("X Tenant".into(), "TENANT".into())]),
            ..Default::default()
        };
        let mut cmd = Command::new("codex");
        cfg.configure_codex("mcx-test", &mut cmd);
        assert!(format!("{cmd:?}").contains("env_http_headers.\\\"X Tenant\\\""));
    }

    fn command_args(cmd: &Command) -> Vec<String> {
        cmd.as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn plano_codex_materializa_plugin_http_antes_de_desabilitar() {
        let launch = McpLaunchConfig {
            transport: "http".into(),
            url: Some("http://user:literal-secret@127.0.0.1:29979/mcp?token=literal-secret".into()),
            http_headers: BTreeMap::from([(
                "Authorization".into(),
                "Bearer literal-secret".into(),
            )]),
            ..Default::default()
        }
        .codex_public_transport();
        assert_eq!(launch.url.as_deref(), Some("http://127.0.0.1:29979/mcp"));
        assert!(launch.http_headers.is_empty());
        let plan = McpRunPlan {
            managed: true,
            disabled_codex_servers: vec![McpRuntimeServer {
                runtime_name: "paper".into(),
                display_name: "Paper".into(),
                launch,
                tool_names: Vec::new(),
            }],
            ..Default::default()
        };
        let mut cmd = Command::new("codex");
        plan.configure_codex(&mut cmd);
        let args = command_args(&cmd);
        let url = args
            .iter()
            .position(|arg| arg == "mcp_servers.paper.url=\"http://127.0.0.1:29979/mcp\"")
            .expect("transporte HTTP materializado");
        let disabled = args
            .iter()
            .position(|arg| arg == "mcp_servers.paper.enabled=false")
            .expect("plugin desabilitado");
        assert!(url < disabled);
        assert!(!args.join(" ").contains("literal-secret"));
    }

    #[test]
    fn plano_codex_materializa_stdio_sem_copiar_env_literal() {
        let launch = McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("/opt/mcp/server".into()),
            args: vec!["serve".into()],
            env: BTreeMap::from([("TOKEN".into(), "literal-secret".into())]),
            env_vars: vec!["INHERITED_TOKEN".into()],
            cwd: Some("/opt/mcp".into()),
            ..Default::default()
        }
        .codex_public_transport();
        assert!(launch.env.is_empty());
        let plan = McpRunPlan {
            managed: true,
            disabled_codex_servers: vec![McpRuntimeServer {
                runtime_name: "local-tools".into(),
                display_name: "Local tools".into(),
                launch,
                tool_names: Vec::new(),
            }],
            ..Default::default()
        };
        let mut cmd = Command::new("codex");
        plan.configure_codex(&mut cmd);
        let args = command_args(&cmd);
        let command = args
            .iter()
            .position(|arg| arg == "mcp_servers.local-tools.command=\"/opt/mcp/server\"")
            .expect("comando stdio materializado");
        let disabled = args
            .iter()
            .position(|arg| arg == "mcp_servers.local-tools.enabled=false")
            .expect("stdio desabilitado");
        assert!(command < disabled);
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.local-tools.args=[\"serve\"]"));
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.local-tools.env_vars=[\"INHERITED_TOKEN\"]"));
        assert!(!args.join(" ").contains("literal-secret"));
    }

    #[test]
    fn plano_codex_configura_selecionado_e_desabilitado_com_transportes_completos() {
        let plan = McpRunPlan {
            managed: true,
            selected: vec![McpRuntimeServer {
                runtime_name: "mcx-project-db".into(),
                display_name: "Database".into(),
                launch: McpLaunchConfig {
                    transport: "stdio".into(),
                    command: Some("/opt/mcp/database".into()),
                    args: vec!["serve".into()],
                    ..Default::default()
                },
                tool_names: Vec::new(),
            }],
            disabled_codex_servers: vec![McpRuntimeServer {
                runtime_name: "paper".into(),
                display_name: "Paper".into(),
                launch: McpLaunchConfig {
                    transport: "http".into(),
                    url: Some("http://127.0.0.1:29979/mcp".into()),
                    ..Default::default()
                },
                tool_names: Vec::new(),
            }],
            ..Default::default()
        };
        let mut cmd = Command::new("codex");
        plan.configure_codex(&mut cmd);
        let args = command_args(&cmd);
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.paper.url=\"http://127.0.0.1:29979/mcp\""));
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.paper.enabled=false"));
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.mcx-project-db.command=\"/opt/mcp/database\""));
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.mcx-project-db.enabled=true"));
    }

    fn runtime(display: &str, name: &str) -> McpRuntimeServer {
        McpRuntimeServer {
            runtime_name: name.into(),
            display_name: display.into(),
            launch: McpLaunchConfig {
                transport: "stdio".into(),
                command: Some("/bin/server".into()),
                ..Default::default()
            },
            tool_names: Vec::new(),
        }
    }

    #[test]
    fn nome_de_runtime_vira_slug_quando_unico_entre_os_selecionados() {
        let mut plan = McpRunPlan {
            managed: true,
            selected: vec![runtime("Playwright", "mcx-claude-user-playwright-1a2b3c4d")],
            ..Default::default()
        };
        apply_friendly_runtime_names(&mut plan);
        assert_eq!(plan.selected[0].runtime_name, "playwright");
        assert_eq!(plan.selected[0].display_name, "Playwright");
    }

    #[test]
    fn colisao_de_display_name_mantem_os_nomes_desambiguados() {
        let mut plan = McpRunPlan {
            managed: true,
            selected: vec![
                runtime("playwright", "mcx-claude-user-playwright-1a2b3c4d"),
                runtime("playwright", "mcx-project-project-playwright-9f8e7d6c"),
            ],
            ..Default::default()
        };
        apply_friendly_runtime_names(&mut plan);
        assert_eq!(
            plan.selected[0].runtime_name,
            "mcx-claude-user-playwright-1a2b3c4d"
        );
        assert_eq!(
            plan.selected[1].runtime_name,
            "mcx-project-project-playwright-9f8e7d6c"
        );
    }

    #[test]
    fn disable_da_origem_codex_fica_intocado_e_reserva_o_nome() {
        // MCP vindo do próprio Codex: a tabela de origem `playwright` é
        // desligada pelo nome da config do usuário, e o selecionado NÃO pode
        // assumir esse nome (reconfigurar a mesma tabela mesclaria campos
        // velhos da config de origem no run).
        let mut plan = McpRunPlan {
            managed: true,
            selected: vec![runtime("playwright", "mcx-codex-user-playwright-1a2b3c4d")],
            disabled_codex_servers: vec![runtime("playwright", "playwright")],
            ..Default::default()
        };
        apply_friendly_runtime_names(&mut plan);
        assert_eq!(
            plan.selected[0].runtime_name,
            "mcx-codex-user-playwright-1a2b3c4d"
        );
        assert_eq!(plan.disabled_codex_servers[0].runtime_name, "playwright");
        let mut cmd = Command::new("codex");
        plan.configure_codex(&mut cmd);
        let args = command_args(&cmd);
        assert!(args
            .iter()
            .any(|arg| arg == "mcp_servers.playwright.enabled=false"));
        assert!(args
            .iter()
            .any(|arg| { arg.contains("mcp_servers.mcx-codex-user-playwright-1a2b3c4d.command") }));
    }

    #[test]
    fn nomes_dos_mcps_internos_do_app_sao_reservados() {
        let mut plan = McpRunPlan {
            managed: true,
            selected: vec![runtime("mc-work", "mcx-claude-user-mc-work-1a2b3c4d")],
            ..Default::default()
        };
        apply_friendly_runtime_names(&mut plan);
        assert_eq!(
            plan.selected[0].runtime_name,
            "mcx-claude-user-mc-work-1a2b3c4d"
        );
    }

    fn discovered(name: &str, source: &str) -> DiscoveredServer {
        DiscoveredServer {
            id: server_id(source, "user", name),
            name: name.into(),
            source: source.into(),
            scope: "user".into(),
            source_agent: None,
            enabled: true,
            managed: true,
            launch: Some(McpLaunchConfig {
                transport: "stdio".into(),
                command: Some("/usr/local/bin/server".into()),
                ..Default::default()
            }),
        }
    }

    fn view_of(server: &DiscoveredServer, bound: bool) -> McpServerView {
        McpServerView {
            id: server.id.clone(),
            name: server.name.clone(),
            source: server.source.clone(),
            scope: server.scope.clone(),
            transport: "stdio".into(),
            locator: "/usr/local/bin/server".into(),
            env_keys: Vec::new(),
            source_agent: None,
            source_enabled: true,
            managed: server.managed,
            portable: server.portable(),
            native_reason: None,
            literal_secret: false,
            runtime_name: None,
            agent_states: vec![McpAgentState {
                agent: "codex".into(),
                compatible: true,
                // nativo já basta; o proxy não precisa entrar neste fixture.
                roteavel_pelo_app: false,
                roteia_mcp_gerenciado: true,
                escopo: "por-run".into(),
                enabled: bound,
                required: false,
                browser: false,
                fallback: "ask".into(),
                health: "unchecked".into(),
                detail: None,
                checked_at: None,
                tool_names: Vec::new(),
            }],
        }
    }

    #[test]
    fn painel_anota_nome_de_sessao_so_para_servidores_vinculados() {
        let servers = vec![
            discovered("Playwright", "claude"),
            discovered("hostinger", "claude"),
        ];
        let mut views = vec![view_of(&servers[0], true), view_of(&servers[1], false)];
        annotate_runtime_names(&servers, &mut views);
        assert_eq!(views[0].runtime_name.as_deref(), Some("playwright"));
        assert_eq!(views[1].runtime_name, None);
    }

    #[test]
    fn painel_usa_desambiguado_quando_o_nome_colide_com_origem_do_codex() {
        // Config homônima no Codex: num run gerenciado a tabela de origem
        // `playwright` é desligada, então o nome de sessão fica no `mcx-…`.
        let servers = vec![
            discovered("playwright", "claude"),
            discovered("playwright", "codex"),
        ];
        let mut views = vec![view_of(&servers[0], true), view_of(&servers[1], false)];
        annotate_runtime_names(&servers, &mut views);
        assert_eq!(
            views[0].runtime_name.as_deref(),
            Some(servers[0].runtime_name().as_str())
        );
        assert!(views[0]
            .runtime_name
            .as_deref()
            .unwrap()
            .starts_with("mcx-claude-user-playwright-"));
    }

    #[test]
    fn plano_codex_preserva_nome_real_ao_desabilitar() {
        let plan = McpRunPlan {
            managed: true,
            disabled_codex_names: vec!["openaiDeveloperDocs".into()],
            ..Default::default()
        };
        let mut cmd = Command::new("codex");
        plan.configure_codex(&mut cmd);
        assert!(format!("{cmd:?}").contains("mcp_servers.openaiDeveloperDocs.enabled=false"));
    }

    #[test]
    fn descobre_mcp_json_de_projeto() {
        let root = std::env::temp_dir().join(format!("mc-mcp-project-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join(".mcp.json"),
            r#"{"mcpServers":{"repo-tools":{"command":"/bin/echo","args":["ok"]}}}"#,
        )
        .unwrap();
        let found = discover_claude(root.to_str().unwrap());
        assert!(found.iter().any(|server| {
            server.name == "repo-tools" && server.source == "project" && server.scope == "project"
        }));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn slug_e_ids_sao_estaveis() {
        assert_eq!(slug("Hostinger API"), "hostinger-api");
        let first = server_id("Claude", "User", "Hostinger API");
        assert!(first.starts_with("claude:user:hostinger-api-"));
        assert_eq!(first, server_id("Claude", "User", "Hostinger API"));
        assert_ne!(
            server_id("Claude", "User", "Hostinger API"),
            server_id("Claude", "Local", "Hostinger API")
        );
    }

    /// Mesmo schema da migração 27 (mcp_registry) em lib.rs.
    fn conn_with_registry() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mcp_servers ( \
               id TEXT PRIMARY KEY, \
               name TEXT NOT NULL, \
               source TEXT NOT NULL, \
               scope TEXT NOT NULL, \
               source_agent TEXT, \
               transport TEXT NOT NULL, \
               locator TEXT NOT NULL, \
               env_keys_json TEXT NOT NULL DEFAULT '[]', \
               fingerprint TEXT NOT NULL, \
               managed INTEGER NOT NULL DEFAULT 1, \
               portable INTEGER NOT NULL DEFAULT 0, \
               source_enabled INTEGER NOT NULL DEFAULT 1, \
               last_seen_at INTEGER NOT NULL \
             );",
        )
        .unwrap();
        conn
    }

    fn insert_registry_server(conn: &Connection, id: &str, managed: bool, portable: bool) {
        conn.execute(
            "INSERT INTO mcp_servers
               (id, name, source, scope, transport, locator, fingerprint, managed, portable, last_seen_at)
             VALUES (?1, ?1, 'claude', 'user', 'stdio', '/bin/server', 'fp', ?2, ?3, 1)",
            params![id, managed as i64, portable as i64],
        )
        .unwrap();
    }

    #[test]
    fn toggle_valida_pelo_registry_persistido_sem_descoberta_ao_vivo() {
        let conn = conn_with_registry();
        insert_registry_server(&conn, "claude:user:hostinger-abc", true, true);
        insert_registry_server(&conn, "claude:user:literal-def", true, false);
        insert_registry_server(&conn, "internal:run:mc-context", false, false);

        // Servidor conhecido: o caminho rápido resolve tudo pelo SQLite.
        let ok = registry_server(&conn, "claude:user:hostinger-abc")
            .unwrap()
            .expect("registry conhece o servidor");
        assert!(validate_enable_from_registry(&ok, "claude-code").is_ok());
        assert!(validate_enable_from_registry(&ok, "codex").is_ok());
        assert!(validate_enable_from_registry(&ok, "agy")
            .unwrap_err()
            .contains("agy"));

        // Não portável e interno mantêm as recusas de sempre.
        let literal = registry_server(&conn, "claude:user:literal-def")
            .unwrap()
            .unwrap();
        assert!(validate_enable_from_registry(&literal, "codex")
            .unwrap_err()
            .contains("não portável"));
        let internal = registry_server(&conn, "internal:run:mc-context")
            .unwrap()
            .unwrap();
        assert!(validate_enable_from_registry(&internal, "codex")
            .unwrap_err()
            .contains("gerenciado por run"));

        // Nunca descoberto: None sinaliza o fallback (único caso que
        // re-descobre ao vivo).
        assert!(registry_server(&conn, "codex:user:fantasma")
            .unwrap()
            .is_none());
    }

    #[test]
    fn resumo_de_bindings_conta_por_projeto_em_ordem_estavel() {
        let conn = Connection::open_in_memory().unwrap();
        // Mesmo schema das migrações 28 + 35 (mcp_bindings) em lib.rs.
        conn.execute_batch(
            "CREATE TABLE mcp_bindings ( \
               project_id TEXT NOT NULL, \
               server_id TEXT NOT NULL, \
               agent TEXT NOT NULL, \
               required INTEGER NOT NULL DEFAULT 0, \
               fallback TEXT NOT NULL DEFAULT 'ask', \
               updated_at INTEGER NOT NULL, \
               browser INTEGER NOT NULL DEFAULT 0, \
               PRIMARY KEY (project_id, server_id, agent) \
             );",
        )
        .unwrap();
        assert_eq!(bindings_summary(&conn).unwrap(), Vec::new());
        for (project, server, agent) in [
            ("viniciusmachado", "claude:user:hostinger", "claude-code"),
            ("viniciusmachado", "claude:user:hostinger", "codex"),
            ("prime-sales-hub", "codex:user:repo-tools", "codex"),
        ] {
            conn.execute(
                "INSERT INTO mcp_bindings (project_id, server_id, agent, required, fallback, updated_at)
                 VALUES (?1, ?2, ?3, 0, 'ask', 1)",
                params![project, server, agent],
            )
            .unwrap();
        }
        assert_eq!(
            bindings_summary(&conn).unwrap(),
            vec![
                McpBindingsSummary {
                    project_id: "prime-sales-hub".into(),
                    count: 1,
                },
                McpBindingsSummary {
                    project_id: "viniciusmachado".into(),
                    count: 2,
                },
            ]
        );
    }

    #[test]
    fn binding_opcional_nunca_bloqueia_e_exigido_respeita_o_fallback() {
        let binding = |required, fallback: &str| Binding {
            server_id: "server".into(),
            required,
            fallback: fallback.into(),
            browser: false,
        };
        // Fixture fiel ao incidente: required=0, fallback=ask, browser=1.
        let incidente = Binding {
            browser: true,
            ..binding(false, "ask")
        };
        assert_eq!(
            unavailable_disposition(&incidente),
            McpPlanDisposition::Omitted
        );
        assert_eq!(
            unavailable_disposition(&binding(false, "deny")),
            McpPlanDisposition::Omitted
        );
        assert_eq!(
            unavailable_disposition(&binding(false, "allow-readonly")),
            McpPlanDisposition::Omitted
        );
        assert_eq!(
            unavailable_disposition(&binding(true, "ask")),
            McpPlanDisposition::NeedsDecision
        );
        assert_eq!(
            unavailable_disposition(&binding(true, "deny")),
            McpPlanDisposition::BlockedByPolicy
        );
        assert_eq!(
            unavailable_disposition(&binding(true, "allow-readonly")),
            McpPlanDisposition::NeedsReadonlyConsent
        );
    }

    #[test]
    fn omissao_opcional_e_gate_exigido_usam_a_mesma_matriz() {
        let optional = Binding {
            server_id: "playwright".into(),
            required: false,
            fallback: "ask".into(),
            browser: true,
        };
        let mut plan = McpRunPlan::default();
        assert!(!record_unavailable(
            &mut plan,
            &optional,
            "Playwright",
            McpPlanIssueCode::BrowserOffline,
            Some("navegador desligado".into()),
            &[],
        ));
        assert_eq!(plan.omissions.len(), 1);
        assert!(plan.gate.is_none());

        let required = Binding {
            required: true,
            ..optional
        };
        assert!(record_unavailable(
            &mut plan,
            &required,
            "Playwright",
            McpPlanIssueCode::BrowserOffline,
            Some("navegador desligado".into()),
            &[],
        ));
        let gate = plan.gate.expect("binding exigido cria gate");
        assert_eq!(gate.issues.len(), 1);
        assert!(gate
            .allowed_recoveries
            .iter()
            .any(|recovery| recovery.kind == McpRecoveryKind::OmitForThisRun));
        assert!(gate
            .allowed_recoveries
            .iter()
            .any(|recovery| { recovery.kind == McpRecoveryKind::StartProjectBrowser }));

        let override_once = McpRunOverride {
            gate_fingerprint: gate.fingerprint,
            source_id: "playwright".into(),
            kind: McpRecoveryKind::OmitForThisRun,
        };
        let mut retried = McpRunPlan::default();
        assert!(!record_unavailable(
            &mut retried,
            &required,
            "Playwright",
            McpPlanIssueCode::BrowserOffline,
            Some("navegador desligado".into()),
            &[override_once],
        ));
        assert!(retried.gate.is_none());
        assert_eq!(retried.omissions.len(), 1);

        let readonly = Binding {
            fallback: "allow-readonly".into(),
            ..required
        };
        let mut consent = McpRunPlan::default();
        assert!(record_unavailable(
            &mut consent,
            &readonly,
            "Playwright",
            McpPlanIssueCode::BrowserOffline,
            Some("navegador desligado".into()),
            &[],
        ));
        let readonly_gate = consent.gate.expect("somente leitura exige gesto");
        let readonly_override = McpRunOverride {
            gate_fingerprint: readonly_gate.fingerprint,
            source_id: "playwright".into(),
            kind: McpRecoveryKind::RetryReadonly,
        };
        let mut readonly_run = McpRunPlan::default();
        assert!(!record_unavailable(
            &mut readonly_run,
            &readonly,
            "Playwright",
            McpPlanIssueCode::BrowserOffline,
            Some("navegador desligado".into()),
            &[readonly_override],
        ));
        assert!(readonly_run.force_readonly);
    }

    // ---- B2.2: roteamento pro navegador do projeto -------------------------

    /// Launch de origem REAL do Playwright MCP registrado no escopo user do
    /// Claude (`claude mcp add --scope user playwright -- npx @playwright/mcp@latest`).
    fn browser_mcp_launch(extra: &[&str]) -> McpLaunchConfig {
        let mut args = vec!["@playwright/mcp@latest".to_string()];
        args.extend(extra.iter().map(|arg| arg.to_string()));
        McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("npx".into()),
            args,
            ..Default::default()
        }
    }

    #[test]
    fn binding_de_navegador_injeta_o_cdp_endpoint_no_plano_efemero() {
        let mut launch = browser_mcp_launch(&[]);
        let notices =
            apply_cdp_endpoint(&mut launch, Some("http://127.0.0.1:62934"), "playwright").unwrap();
        assert_eq!(
            launch.args,
            vec![
                "@playwright/mcp@latest",
                "--cdp-endpoint",
                "http://127.0.0.1:62934"
            ]
        );
        // Injeção limpa não polui o fio com aviso nenhum.
        assert!(notices.is_empty());
        // O fingerprint do plano só hasheia NOMES: injetar arg não re-anuncia.
        let com_arg = McpRunPlan {
            managed: true,
            selected: vec![McpRuntimeServer {
                runtime_name: "playwright".into(),
                display_name: "playwright".into(),
                launch,
                tool_names: Vec::new(),
            }],
            ..Default::default()
        };
        let sem_arg = McpRunPlan {
            managed: true,
            selected: vec![McpRuntimeServer {
                runtime_name: "playwright".into(),
                display_name: "playwright".into(),
                launch: browser_mcp_launch(&[]),
                tool_names: Vec::new(),
            }],
            ..Default::default()
        };
        assert_eq!(com_arg.fingerprint(), sem_arg.fingerprint());
    }

    #[test]
    fn binding_do_projeto_substitui_endpoint_da_origem_e_avisa() {
        let mut launch = browser_mcp_launch(&["--cdp-endpoint", "http://127.0.0.1:9222"]);
        let notices =
            apply_cdp_endpoint(&mut launch, Some("http://127.0.0.1:62934"), "playwright").unwrap();
        // A marca do binding é a decisão mais específica deste projeto.
        assert_eq!(
            launch.args,
            vec![
                "@playwright/mcp@latest",
                "--cdp-endpoint",
                "http://127.0.0.1:62934"
            ]
        );
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains("--cdp-endpoint"));
        // A forma `--cdp-endpoint=<url>` é reconhecida do mesmo jeito.
        let mut colado = browser_mcp_launch(&["--cdp-endpoint=http://127.0.0.1:9222"]);
        let notices =
            apply_cdp_endpoint(&mut colado, Some("http://127.0.0.1:62934"), "playwright").unwrap();
        assert_eq!(colado.args.len(), 3);
        assert_eq!(colado.args[2], "http://127.0.0.1:62934");
        assert_eq!(notices.len(), 1);
    }

    #[test]
    fn browser_e_headless_da_origem_saem_do_run_com_aviso() {
        let mut launch = browser_mcp_launch(&["--browser", "chrome", "--headless", "--isolated"]);
        let notices =
            apply_cdp_endpoint(&mut launch, Some("http://127.0.0.1:62934"), "playwright").unwrap();
        assert_eq!(
            launch.args,
            vec![
                "@playwright/mcp@latest",
                "--isolated",
                "--cdp-endpoint",
                "http://127.0.0.1:62934"
            ]
        );
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains("--browser e --headless"));
        // Forma colada (`--browser=chrome`) também sai.
        let mut colado = browser_mcp_launch(&["--browser=chrome"]);
        apply_cdp_endpoint(&mut colado, Some("http://127.0.0.1:62934"), "playwright").unwrap();
        assert!(!colado.args.iter().any(|arg| arg.starts_with("--browser")));
    }

    #[test]
    fn sem_navegador_vivo_o_binding_bloqueia_sem_tocar_a_origem() {
        let mut launch = browser_mcp_launch(&["--browser", "chrome"]);
        let error = apply_cdp_endpoint(&mut launch, None, "playwright").unwrap_err();
        // O plano aborta antes de materializar o MCP; a cópia da origem fica intacta.
        assert_eq!(
            launch.args,
            vec!["@playwright/mcp@latest", "--browser", "chrome"]
        );
        assert!(error.contains("não está ligado"));
        assert!(error.contains("Ligue o navegador ou desmarque o binding"));
    }

    #[tokio::test]
    async fn health_stdio_faz_initialize_e_tools_list_reais() {
        let script = r#"
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1"}}}' ;;
    *'"id":2'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"inspect"},{"name":"search"}]}}' ;;
  esac
done
"#;
        let cfg = McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("/bin/sh".into()),
            args: vec!["-c".into(), script.into()],
            ..Default::default()
        };
        let result = probe_stdio(&cfg, "/tmp").await;
        assert_eq!(result.status, "healthy");
        assert_eq!(result.tool_names, vec!["inspect", "search"]);
    }

    /// O normalizador REESCREVE o caminho do comando que vai ser executado, e
    /// entrou sem teste. Com o HOME injetado dá pra cobrir sem `set_var`.
    fn launch_com_comando(cmd: &str) -> McpLaunchConfig {
        McpLaunchConfig {
            transport: "stdio".into(),
            command: Some(cmd.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn normaliza_comando_relativo_na_pasta_do_servidor() {
        let tmp = std::env::temp_dir().join(format!("mc-codex-{}", std::process::id()));
        let dir = tmp.join("meu-mcp");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.sh"), "#!/bin/sh\n").unwrap();

        let mut launch = launch_com_comando("./run.sh");
        normalize_codex_launch_in(&tmp, "meu-mcp", &mut launch);

        // O comando vira absoluto E o cwd passa a ser a pasta do servidor: sem
        // isso o probe rodaria com o cwd do projeto e não acharia o binário.
        assert_eq!(
            launch.command,
            Some(dir.join("run.sh").to_string_lossy().to_string())
        );
        assert_eq!(launch.cwd, Some(dir.to_string_lossy().to_string()));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn comando_absoluto_nao_e_tocado() {
        let mut launch = launch_com_comando("/usr/bin/node");
        normalize_codex_launch_in(Path::new("/tmp/qualquer"), "x", &mut launch);
        // Caminho que o usuário deu explicitamente é decisão dele.
        assert_eq!(launch.command, Some("/usr/bin/node".to_string()));
        assert_eq!(launch.cwd, None);
    }

    #[test]
    fn comando_que_nao_existe_no_home_do_codex_fica_como_esta() {
        let mut launch = launch_com_comando("npx");
        normalize_codex_launch_in(Path::new("/tmp/nao-existe-mc"), "x", &mut launch);
        // `npx` resolve pelo PATH. Reescrever pra um caminho que não existe
        // trocaria "funciona" por "command not found".
        assert_eq!(launch.command, Some("npx".to_string()));
    }

    #[test]
    fn cwd_absoluto_do_usuario_e_preservado() {
        let tmp = std::env::temp_dir().join(format!("mc-codex-cwd-{}", std::process::id()));
        let dir = tmp.join("srv");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.sh"), "#!/bin/sh\n").unwrap();

        let mut launch = launch_com_comando("./run.sh");
        launch.cwd = Some("/opt/escolhido".into());
        normalize_codex_launch_in(&tmp, "srv", &mut launch);

        // O comando é resolvido, mas o cwd que o usuário escolheu manda.
        assert!(launch.command.unwrap().ends_with("srv/run.sh"));
        assert_eq!(launch.cwd, Some("/opt/escolhido".to_string()));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn expande_home_path_corretamente() {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/fake".into());
        assert_eq!(expand_home_path("~/bin/tool"), format!("{home}/bin/tool"));
        assert_eq!(
            expand_home_path("${HOME}/bin/tool"),
            format!("{home}/bin/tool")
        );
        assert_eq!(
            expand_home_path("$HOME/bin/tool"),
            format!("{home}/bin/tool")
        );
        assert_eq!(expand_home_path("/opt/bin/tool"), "/opt/bin/tool");
    }

    #[test]
    fn normaliza_launch_relativo_do_codex() {
        let temp =
            std::env::temp_dir().join(format!("mc-codex-launch-test-{}", std::process::id()));
        let codex_dir = temp.join(".codex");
        let server_dir = codex_dir.join("computer-use");
        std::fs::create_dir_all(&server_dir).unwrap();
        let bin_path = server_dir.join("SkyClient");
        std::fs::write(&bin_path, b"fake").unwrap();

        std::env::set_var("CODEX_HOME", codex_dir.to_str().unwrap());

        let mut launch = McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("./SkyClient".into()),
            cwd: Some(".".into()),
            ..Default::default()
        };

        normalize_codex_launch("computer-use", &mut launch);

        assert_eq!(launch.command.as_deref(), Some(bin_path.to_str().unwrap()));
        assert_eq!(launch.cwd.as_deref(), Some(server_dir.to_str().unwrap()));

        std::env::remove_var("CODEX_HOME");
        let _ = std::fs::remove_dir_all(&temp);
    }
}
