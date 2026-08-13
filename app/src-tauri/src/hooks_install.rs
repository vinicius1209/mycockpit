//! Instalação RESPEITOSA dos hooks de status (hooks-plan H1) — SEMPRE por
//! gesto do usuário (botão em Configurações), nunca no boot.
//!
//! Mesmo padrão provado do statusline_install.rs, com uma diferença de
//! mecânica: statusline é um SLOT único (por isso encadeia); hooks são ARRAYS
//! de entradas que coexistem — a nossa entrada entra AO LADO das existentes
//! (afplay/thaytool/Xirp/Orca convivem hoje no settings desta máquina) e a
//! desinstalação remove SÓ o que é nosso (identificável pelo path do script).
//!
//! Regras (hooks-plan §4):
//!   1. Entrada própria ao lado das existentes, nunca substituindo. Claude/
//!      Codex: append nos arrays de cada evento; agy: grupo nomeado
//!      "mycockpit" (coexistência é a forma natural do formato).
//!   2. Script gerado com header "não edite" em diretório NOSSO
//!      (app_data_dir/hook-scripts/<engine>/); o config referencia só o PATH
//!      estável — token/porta rotacionam no hook-endpoint.json que o script lê
//!      a cada disparo. No Codex isso preserva o trusted_hash entre boots.
//!   3. Backup antes de mexer (`<arquivo>.bak-mycockpit-<ts>`), JSON por
//!      parse→merge→write atômico, nunca regex.
//!   4. Desinstalação limpa: remove só as nossas entradas + o script; arrays
//!      que ficarem vazios saem, o resto do arquivo fica com o MESMO conteúdo
//!      (a re-serialização pode mudar formatação/ordem — mesma honestidade de
//!      claim do statusline_install; preserve_order rejeitado lá, vale aqui).
//!   5. Fail-open por construção no script: fire-and-forget com timeout ~1s em
//!      background, erro engolido, exit 0 — o CLI do usuário nunca quebra nem
//!      atrasa porque o app morreu.
//!   6. Correlação por env: `MYCOCKPIT_RUN_ID` (setada só nos runs que o app
//!      spawna) viaja num header; sessão sem a env = EXTERNA (o H1 existe pra
//!      elas). Env vazia = header omitido pelo curl, inofensivo fora do app.
//!   7. Gate de versão honesto: agy <1.1.10 não roda Stop hooks (changelog) →
//!      o instalador confere a versão e aborta com o motivo em vez de instalar
//!      algo que não funciona. **Regra da casa**: gate de capability por
//!      versão SEMPRE consulta a detecção CANÔNICA do app
//!      (`detect::detected_version`, o mesmo `<bin> --version` que preenche
//!      "Agentes na máquina"); NUNCA um artefato interno do diretório do
//!      fornecedor. Bug do build 193: o gate lia
//!      `~/.gemini/antigravity-cli/version`, arquivo que o agy 1.1.12 não
//!      escreve — o app recusava "não consegui confirmar a versão do agy"
//!      enquanto a seção ao lado, no MESMO dialog, mostrava "instalado
//!      v1.1.12". Artefato interno de fornecedor não é contrato: some sem
//!      aviso.

use crate::adapters::{capabilities_of, HookDialect};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SCRIPT_NAME: &str = "mycockpit-hook.sh";
/// Nome do grupo do agy (chave de topo do hooks.json dele). É o identificador
/// de desinstalação — nunca renomear sem migração.
pub const AGY_GROUP: &str = "mycockpit";

/// UM evento a instalar: nome + matcher de tool (None = sem matcher) +
/// timeout (s).
#[derive(Clone)]
struct EventSpec {
    name: &'static str,
    matcher: Option<&'static str>,
    timeout: u64,
}

const fn ev(name: &'static str, matcher: bool, timeout: u64) -> EventSpec {
    EventSpec {
        name,
        matcher: if matcher { Some("*") } else { None },
        timeout,
    }
}

/// Eventos de STATUS por dialeto — só o que foi PROVADO no motor (fixtures
/// reais 12/08/2026 pro claude; hooks vivos do Xirp/Orca pro codex; grupo
/// vivo do Orca + doc embarcada pro agy). Evento não provado fica de fora:
/// registrar algo que o CLI rejeita viraria erro no terminal do usuário.
const CLAUDE_STATUS_EVENTS: &[EventSpec] = &[
    ev("SessionStart", false, 10),
    ev("UserPromptSubmit", false, 10),
    ev("PreToolUse", true, 10),
    ev("PostToolUse", true, 10),
    ev("Notification", false, 10),
    ev("Stop", false, 10),
    ev("SessionEnd", false, 10),
];
// codex: SessionEnd/Notification NÃO provados no 0.146 (nem Xirp nem Orca
// registram) — ficam de fora até evidência.
const CODEX_STATUS_EVENTS: &[EventSpec] = &[
    ev("SessionStart", false, 10),
    ev("UserPromptSubmit", false, 10),
    ev("PreToolUse", true, 10),
    ev("PostToolUse", true, 10),
    ev("Stop", false, 10),
];
// agy: status SEM PreToolUse de propósito — o output dele exige um campo
// `decision` (semântica de permissão, hooks-plan achado 4); pra presença
// bastam PreInvocation/PostInvocation/PostToolUse/Stop (o mesmo recorte do
// grupo vivo do Orca).
const AGY_STATUS_EVENTS: &[EventSpec] = &[
    ev("PreInvocation", false, 10),
    ev("PostInvocation", false, 10),
    ev("PostToolUse", true, 10),
    ev("Stop", false, 10),
];

fn status_events(dialect: HookDialect) -> &'static [EventSpec] {
    match dialect {
        HookDialect::ClaudeSettings => CLAUDE_STATUS_EVENTS,
        HookDialect::CodexHooksJson => CODEX_STATUS_EVENTS,
        HookDialect::AgyConfigHooks => AGY_STATUS_EVENTS,
    }
}

/// Eventos de PERMISSÃO por dialeto (H2, opt-in separado). Timeout 35s no
/// config: maior que o teto de 30s do round-trip humano do gateway — o CLI
/// nunca mata o hook antes de o app responder `ask`.
const CLAUDE_PERMISSION_EVENTS: &[EventSpec] = &[ev("PermissionRequest", true, 35)];
const CODEX_PERMISSION_EVENTS: &[EventSpec] = &[ev("PermissionRequest", true, 35)];
/// agy: o gate É o PreToolUse (não há evento separado). Matcher ESCOPADO a
/// `run_command` de propósito — o hook é síncrono e segura o loop; escopar à
/// tool que exige a permissão "command" evita atrasar tool call inofensiva
/// (view_file etc.). Nome de tool é domínio do dialeto (confinado aqui).
const AGY_PERMISSION_EVENTS: &[EventSpec] = &[EventSpec {
    name: "PreToolUse",
    matcher: Some("run_command"),
    timeout: 35,
}];

fn permission_events(dialect: HookDialect) -> &'static [EventSpec] {
    match dialect {
        HookDialect::ClaudeSettings => CLAUDE_PERMISSION_EVENTS,
        HookDialect::CodexHooksJson => CODEX_PERMISSION_EVENTS,
        HookDialect::AgyConfigHooks => AGY_PERMISSION_EVENTS,
    }
}

/// Nome do evento de permissão de um dialeto (o gateway consulta pra decidir
/// o round-trip síncrono; o resto dos eventos é fire-and-forget).
pub fn permission_event_name(dialect: HookDialect) -> &'static str {
    match dialect {
        HookDialect::ClaudeSettings | HookDialect::CodexHooksJson => "PermissionRequest",
        HookDialect::AgyConfigHooks => "PreToolUse",
    }
}

/// Conjunto de eventos de uma instalação: status sempre; permissão opt-in.
fn events_for(dialect: HookDialect, permission: bool) -> Vec<EventSpec> {
    let mut evs: Vec<EventSpec> = status_events(dialect).to_vec();
    if permission {
        evs.extend(permission_events(dialect).iter().cloned());
    }
    evs
}

/// Estado da instalação por agent — o que a UI de Configurações mostra,
/// incluindo o PREVIEW exato do que será escrito (transparência antes do
/// gesto).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    /// As entradas de status estão no config apontando pro nosso script?
    pub installed: bool,
    /// As entradas de PERMISSÃO (H2) também estão instaladas?
    pub permission_installed: bool,
    pub config_path: String,
    pub script_path: String,
    /// Fragmento JSON exato que a instalação de STATUS escreve no config.
    pub preview: String,
    /// Fragmento ADICIONAL escrito quando a permissão está ligada (H2).
    pub preview_permission: String,
    /// Eventos NOSSOS presentes no config hoje.
    pub events: Vec<String>,
    /// Estado inconsistente detectado (ex.: entradas presentes mas script
    /// sumido) — a UI mostra; reinstalar conserta.
    pub warning: Option<String>,
    /// "claude-settings" | "codex-hooks-json" | "agy-config-hooks".
    pub dialect: String,
}

// ---------------------------------------------------------------------------
// Peças PURAS (render do script + merge por dialeto).
// ---------------------------------------------------------------------------

/// Script único por engine; o EVENTO chega como $1 (a entrada instalada no
/// config o passa) e vai num header — o comando fica ESTÁVEL (importante pro
/// trusted_hash do codex). Dois perfis no MESMO script:
///   • status: fire-and-forget em background (timeout ~1s, erro engolido);
///   • permissão (H2): SÍNCRONO — segura até 32s e pipa a resposta do app
///     pro stdout (o formato é do dialeto; o gateway monta). App fechado/sem
///     resposta = fail-open pro CLI: claude/codex recebem stdout VAZIO (sem
///     opinião → prompt nativo); agy recebe `{"decision":"ask"}` (o output
///     dele exige um campo decision — "ask" preserva o fluxo nativo).
pub fn render_script(engine: &str, dialect: HookDialect, endpoint_file: &str) -> String {
    let header = format!(
        "#!/bin/sh\n\
         # Generated by MyCockpit — DO NOT EDIT (regenerado a cada instalação)\n\
         # mycockpit-hook-schema: 2\n\
         # Hooks do MyCockpit: postam o evento de ciclo de vida ($1) pro app\n\
         # em loopback; o evento de permissão espera a SUA decisão no app (até\n\
         # 32s) e devolve pro CLI. Fail-open: app fechado = a CLI segue como\n\
         # se o hook não existisse (o prompt nativo aparece no terminal).\n\
         # Desinstalação limpa em Configurações do MyCockpit.\n\
         ev=\"$1\"\n\
         input=$(cat)\n\
         port=\"\"; token=\"\"\n\
         ep=\"{endpoint_file}\"\n\
         if [ -r \"$ep\" ]; then\n\
         \x20 port=$(sed -n 's/.*\"port\":[[:space:]]*\\([0-9]*\\).*/\\1/p' \"$ep\" | head -1)\n\
         \x20 token=$(sed -n 's/.*\"token\":[[:space:]]*\"\\([a-f0-9]*\\)\".*/\\1/p' \"$ep\" | head -1)\n\
         fi\n"
    );
    let curl_common = format!(
        "curl -s -X POST \"http://127.0.0.1:${{port}}/hook/{engine}\" \\\n\
         \x20   -H \"Authorization: Bearer ${{token}}\" -H \"Content-Type: application/json\" \\\n\
         \x20   -H \"X-Mycockpit-Event: ${{ev}}\" -H \"X-Mycockpit-Run: ${{MYCOCKPIT_RUN_ID}}\""
    );
    let body = match dialect {
        // claude/codex: PermissionRequest síncrono (stdout vazio = sem
        // opinião = fluxo nativo); o resto fire-and-forget.
        HookDialect::ClaudeSettings | HookDialect::CodexHooksJson => format!(
            "if [ \"$ev\" = \"PermissionRequest\" ]; then\n\
             \x20 if [ -n \"$port\" ] && [ -n \"$token\" ]; then\n\
             \x20   printf '%s' \"$input\" | {curl_common} \\\n\
             \x20     --connect-timeout 1 --max-time 32 --data-binary @- 2>/dev/null\n\
             \x20 fi\n\
             \x20 exit 0\n\
             fi\n\
             [ -n \"$port\" ] && [ -n \"$token\" ] || exit 0\n\
             printf '%s' \"$input\" | {curl_common} \\\n\
             \x20 --connect-timeout 1 --max-time 2 --data-binary @- >/dev/null 2>&1 &\n\
             exit 0\n"
        ),
        // agy: o contrato é síncrono pra TODO evento (stdout JSON exigido).
        // PreToolUse é o gate de permissão; os demais respondem neutro na
        // hora e postam em background.
        HookDialect::AgyConfigHooks => format!(
            "if [ \"$ev\" = \"PreToolUse\" ]; then\n\
             \x20 body=\"\"\n\
             \x20 if [ -n \"$port\" ] && [ -n \"$token\" ]; then\n\
             \x20   body=$(printf '%s' \"$input\" | {curl_common} \\\n\
             \x20     --connect-timeout 1 --max-time 32 --data-binary @- 2>/dev/null)\n\
             \x20 fi\n\
             \x20 if [ -n \"$body\" ]; then printf '%s\\n' \"$body\"; else printf '{{\"decision\":\"ask\"}}\\n'; fi\n\
             \x20 exit 0\n\
             fi\n\
             case \"$ev\" in\n\
             \x20 Stop) printf '{{\"decision\":\"\"}}\\n' ;;\n\
             \x20 *) printf '{{}}\\n' ;;\n\
             esac\n\
             [ -n \"$port\" ] && [ -n \"$token\" ] || exit 0\n\
             printf '%s' \"$input\" | {curl_common} \\\n\
             \x20 --connect-timeout 1 --max-time 2 --data-binary @- >/dev/null 2>&1 &\n\
             exit 0\n"
        ),
    };
    format!("{header}{body}")
}

/// Comando instalado no config: path do script entre aspas simples (blinda o
/// espaço de "Application Support") + o evento como $1.
fn hook_command(script: &str, event: &str) -> String {
    format!("'{script}' {event}")
}

/// A entrada (do array de um evento) é NOSSA? Identificação pelo path do
/// script dentro do comando — o mesmo critério da desinstalação.
fn entry_is_ours(entry: &Value, script: &str) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .is_some_and(|arr| {
            arr.iter().any(|h| {
                h.get("command")
                    .and_then(|c| c.as_str())
                    .is_some_and(|c| c.contains(script))
            })
        })
}

/// Entrada nossa de UM evento (dialeto Claude-family: claude e codex, mesmo
/// schema — provado em [E4] do hooks-plan).
fn our_entry(script: &str, spec: &EventSpec) -> Value {
    let mut e = json!({
        "hooks": [{
            "type": "command",
            "command": hook_command(script, spec.name),
            "timeout": spec.timeout,
        }]
    });
    if let Some(m) = spec.matcher {
        e["matcher"] = json!(m);
    }
    e
}

/// Config Claude-family com as NOSSAS entradas dos eventos dados: remove as
/// nossas antigas (reinstalação idempotente) e appenda as novas AO LADO das
/// existentes. Nunca regex: parse→merge.
fn with_hooks_claude_family(settings: &Value, script: &str, events: &[EventSpec]) -> Value {
    let mut out = without_hooks_claude_family(settings, script);
    if !out.is_object() {
        out = json!({});
    }
    let mut hooks = out
        .get("hooks")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    for spec in events {
        let mut arr = hooks
            .get(spec.name)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        arr.push(our_entry(script, spec));
        hooks[spec.name] = Value::Array(arr);
    }
    out["hooks"] = hooks;
    out
}

/// Config Claude-family SEM as nossas entradas: remove só o que aponta pro
/// nosso script; array que ficar vazio sai; `hooks` que ficar vazio sai. As
/// entradas dos OUTROS (afplay/thaytool/Xirp/Orca) ficam intocadas.
fn without_hooks_claude_family(settings: &Value, script: &str) -> Value {
    let mut out = settings.clone();
    let Some(hooks) = out.get_mut("hooks").and_then(|v| v.as_object_mut()) else {
        return out;
    };
    let events: Vec<String> = hooks.keys().cloned().collect();
    for event in events {
        if let Some(arr) = hooks.get_mut(&event).and_then(|v| v.as_array_mut()) {
            arr.retain(|entry| !entry_is_ours(entry, script));
            if arr.is_empty() {
                hooks.remove(&event);
            }
        }
    }
    if hooks.is_empty() {
        if let Some(obj) = out.as_object_mut() {
            obj.remove("hooks");
        }
    }
    out
}

/// Eventos com entrada NOSSA no config Claude-family (estado pro status).
fn installed_events_claude_family(settings: &Value, script: &str) -> Vec<String> {
    let Some(hooks) = settings.get("hooks").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut out: Vec<String> = hooks
        .iter()
        .filter(|(_, arr)| {
            arr.as_array()
                .is_some_and(|a| a.iter().any(|e| entry_is_ours(e, script)))
        })
        .map(|(k, _)| k.clone())
        .collect();
    out.sort();
    out
}

/// Valor do grupo "mycockpit" do agy: eventos de LOOP (PreInvocation/
/// PostInvocation/Stop) são listas FLAT de handlers; eventos de TOOL
/// (PostToolUse) levam o wrapper {matcher, hooks} — formato do doc embarcado
/// e do grupo vivo do Orca [E8].
fn agy_group_value(script: &str, events: &[EventSpec]) -> Value {
    let mut group = serde_json::Map::new();
    for spec in events {
        let handler = json!({
            "type": "command",
            "command": hook_command(script, spec.name),
            "timeout": spec.timeout,
        });
        let entry = if let Some(m) = spec.matcher {
            json!([{ "matcher": m, "hooks": [handler] }])
        } else {
            json!([handler])
        };
        group.insert(spec.name.to_string(), entry);
    }
    Value::Object(group)
}

/// hooks.json do agy com o NOSSO grupo (chave de topo). Os grupos dos outros
/// ("orca-status" etc.) ficam intocados — coexistência é a forma do formato.
fn with_agy_group(cfg: &Value, group: Value) -> Value {
    let mut out = cfg.clone();
    if !out.is_object() {
        out = json!({});
    }
    out[AGY_GROUP] = group;
    out
}

/// hooks.json do agy SEM o nosso grupo.
fn without_agy_group(cfg: &Value) -> Value {
    let mut out = cfg.clone();
    if let Some(obj) = out.as_object_mut() {
        obj.remove(AGY_GROUP);
    }
    out
}

/// Eventos presentes no nosso grupo do agy (estado pro status).
fn installed_events_agy(cfg: &Value) -> Vec<String> {
    let Some(group) = cfg.get(AGY_GROUP).and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut out: Vec<String> = group
        .keys()
        .filter(|k| *k != "enabled")
        .cloned()
        .collect();
    out.sort();
    out
}

/// Versão mínima do agy pros hooks (changelog 1.1.10: "lets Stop hooks run at
/// all"). Aparece nas mensagens do gate, então mora num lugar só.
const AGY_MIN: &str = "1.1.10";

/// Gate de versão do agy: Stop hooks só rodam ≥1.1.10 (changelog 1.1.10 —
/// "lets Stop hooks run at all"). Abaixo disso, instalar daria uma presença
/// que nunca vira "ociosa" — mentira de estado. PURO (recebe a string lida).
pub fn agy_version_ok(version: &str) -> bool {
    let mut parts = version.trim().split('.').map(|p| p.parse::<u64>().ok());
    let (a, b, c) = (
        parts.next().flatten(),
        parts.next().flatten(),
        parts.next().flatten(),
    );
    match (a, b, c) {
        (Some(a), Some(b), Some(c)) => (a, b, c) >= (1, 1, 10),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Caminhos e IO por dialeto.
// ---------------------------------------------------------------------------

/// Gate de capability: só motor que declara hooks tem instalador — os demais
/// recebem erro honesto, nunca um no-op silencioso.
fn require_hooks(agent: &str) -> Result<HookDialect, String> {
    match capabilities_of(agent).and_then(|c| c.hook_dialect) {
        Some(d) if capabilities_of(agent).is_some_and(|c| c.hooks_status) => Ok(d),
        _ => Err(format!("{agent} não tem hooks de status (capability ausente)")),
    }
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "sem HOME no ambiente".to_string())
}

/// Path do config de hooks por dialeto. Respeita as envs de config dir dos
/// CLIs (mesmo contrato deles): CLAUDE_CONFIG_DIR e CODEX_HOME.
fn config_path(dialect: HookDialect) -> Result<PathBuf, String> {
    match dialect {
        HookDialect::ClaudeSettings => {
            if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
                if !dir.trim().is_empty() {
                    return Ok(PathBuf::from(dir).join("settings.json"));
                }
            }
            Ok(home_dir()?.join(".claude").join("settings.json"))
        }
        HookDialect::CodexHooksJson => {
            if let Ok(dir) = std::env::var("CODEX_HOME") {
                if !dir.trim().is_empty() {
                    return Ok(PathBuf::from(dir).join("hooks.json"));
                }
            }
            Ok(home_dir()?.join(".codex").join("hooks.json"))
        }
        HookDialect::AgyConfigHooks => Ok(home_dir()?
            .join(".gemini")
            .join("config")
            .join("hooks.json")),
    }
}

fn script_path(app: &AppHandle, agent: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?
        .join("hook-scripts")
        .join(agent)
        .join(SCRIPT_NAME))
}

/// Lê e parseia o config. Ausente → objeto vazio (instalação cria); inválido
/// ou não-objeto → erro honesto, nada é alterado (mesma regra do statusline:
/// nunca sobrescrevemos um arquivo que não entendemos).
fn read_config(path: &PathBuf) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => {
            let v: Value = serde_json::from_str(&s).map_err(|e| {
                format!(
                    "{} não parseia como JSON ({e}); nada foi alterado",
                    path.display()
                )
            })?;
            if !v.is_object() {
                return Err(format!(
                    "{} é JSON válido mas não é um objeto; nada foi alterado",
                    path.display()
                ));
            }
            Ok(v)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("não consegui ler {}: {e}", path.display())),
    }
}

/// Backup `<arquivo>.bak-mycockpit-<ts>` (só se o arquivo existe).
fn backup_config(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let bak = path.with_file_name(format!("{name}.bak-mycockpit-{ts}"));
    std::fs::copy(path, &bak).map_err(|e| format!("backup falhou ({e}); nada foi alterado"))?;
    Ok(())
}

fn write_config(path: &PathBuf, v: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    crate::fsx::write_atomic(path, &body)
}

fn write_script(path: &PathBuf, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    crate::fsx::write_atomic(path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Decisão PURA do gate de versão do agy a partir da versão DETECTADA.
/// `detected` = o que a detecção canônica do app respondeu (None = ela não
/// soube dizer). As duas recusas são mensagens DIFERENTES de propósito: uma
/// diz qual é a versão instalada e por que ela não serve; a outra admite que
/// não deu pra perguntar. O build 193 mostrava a segunda sabendo a primeira.
fn agy_version_gate(agent: &str, detected: Option<String>) -> Result<(), String> {
    match detected {
        Some(v) if agy_version_ok(&v) => Ok(()),
        Some(v) => Err(format!(
            "o {agent} instalado nesta máquina é a v{v}, e os hooks exigem ≥{AGY_MIN} (abaixo disso o Stop hook não roda e a sessão nunca ficaria ociosa); atualize a CLI e tente de novo. Nada foi alterado"
        )),
        None => Err(format!(
            "não consegui perguntar a versão ao binário do {agent} ({} --version não respondeu); os hooks exigem ≥{AGY_MIN}, então nada foi alterado. Confira a seção Agentes na máquina e tente de novo",
            crate::detect::agent_bin(agent).unwrap_or(agent)
        )),
    }
}

/// Gate específico do dialeto (chamado SÓ na instalação; status não bloqueia).
/// A versão vem da detecção CANÔNICA (`detect::detected_version`) — a MESMA
/// fonte que a UI mostra em "Agentes na máquina". Nunca de arquivo interno do
/// fornecedor: ver a regra 7 do topo do módulo.
///
/// Por que perguntar ao binário AQUI e não reusar um cache: o snapshot da
/// detecção é do FRONTEND (`GlobalSettings.detected`, gravado no boot e no
/// "Verificar agora"), não do Rust. Entre aquele boot e este clique a CLI pode
/// ter sido atualizada, e o gesto é raro — então o caminho honesto é o probe
/// na hora (mesmo `<bin> --version`, mesmo timeout de 6s do detect). Se um dia
/// existir cache no Rust, ele entra dentro de `detected_version`, e este gate
/// não muda.
async fn dialect_install_gate(agent: &str, dialect: HookDialect) -> Result<(), String> {
    if dialect != HookDialect::AgyConfigHooks {
        return Ok(());
    }
    agy_version_gate(agent, crate::detect::detected_version(agent).await)
}

fn dialect_id(dialect: HookDialect) -> &'static str {
    match dialect {
        HookDialect::ClaudeSettings => "claude-settings",
        HookDialect::CodexHooksJson => "codex-hooks-json",
        HookDialect::AgyConfigHooks => "agy-config-hooks",
    }
}

/// Fragmento de preview (o que a instalação escreve), por dialeto.
fn preview_fragment(
    dialect: HookDialect,
    script: &str,
    events: &[EventSpec],
) -> Result<String, String> {
    let v = match dialect {
        HookDialect::AgyConfigHooks => json!({ AGY_GROUP: agy_group_value(script, events) }),
        _ => {
            let mut hooks = serde_json::Map::new();
            for spec in events {
                hooks.insert(spec.name.to_string(), json!([our_entry(script, spec)]));
            }
            json!({ "hooks": Value::Object(hooks) })
        }
    };
    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

fn status_of(app: &AppHandle, agent: &str) -> Result<HooksStatus, String> {
    let dialect = require_hooks(agent)?;
    let cpath = config_path(dialect)?;
    let script = script_path(app, agent)?;
    let script_str = script.to_string_lossy().to_string();
    let cfg = read_config(&cpath)?;
    let events = match dialect {
        HookDialect::AgyConfigHooks => installed_events_agy(&cfg),
        _ => installed_events_claude_family(&cfg, &script_str),
    };
    let installed = !events.is_empty();
    let permission_installed = events
        .iter()
        .any(|e| e == permission_event_name(dialect));
    let script_exists = script.exists();
    let mut warning = None;
    if installed && !script_exists {
        warning = Some(
            "as entradas apontam pro script do MyCockpit, mas ele sumiu do disco; reinstale ou desinstale"
                .to_string(),
        );
    }
    Ok(HooksStatus {
        installed,
        permission_installed,
        config_path: cpath.to_string_lossy().to_string(),
        script_path: script_str.clone(),
        preview: preview_fragment(dialect, &script_str, status_events(dialect))?,
        preview_permission: preview_fragment(
            dialect,
            &script_str,
            permission_events(dialect),
        )?,
        events,
        warning,
        dialect: dialect_id(dialect).to_string(),
    })
}

// ---------------------------------------------------------------------------
// Comandos (gesto do usuário em Configurações — NUNCA no boot).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn hooks_status(app: AppHandle, agent: String) -> Result<HooksStatus, String> {
    status_of(&app, &agent)
}

/// Instala (ou reinstala, idempotente): gera o script e escreve as entradas
/// de STATUS ao lado das existentes (+ as de PERMISSÃO quando `permission`,
/// H2 — gate de capability próprio), com backup.
#[tauri::command]
pub async fn hooks_install(
    app: AppHandle,
    agent: String,
    permission: Option<bool>,
) -> Result<HooksStatus, String> {
    let dialect = require_hooks(&agent)?;
    let permission = permission.unwrap_or(false);
    if permission && !capabilities_of(&agent).is_some_and(|c| c.hooks_permission) {
        return Err(format!(
            "{agent} não tem hook de permissão síncrono (capability ausente)"
        ));
    }
    dialect_install_gate(&agent, dialect).await?;
    let cpath = config_path(dialect)?;
    let script = script_path(&app, &agent)?;
    let endpoint = crate::hook_gateway::endpoint_file(&app)?;
    install_files(
        &agent,
        dialect,
        &cpath,
        &script,
        &endpoint.to_string_lossy(),
        permission,
    )?;
    log::info!(
        "hooks: instalado pra {agent} em {} (permissão: {permission})",
        cpath.display()
    );
    status_of(&app, &agent)
}

/// A ESCRITA da instalação (script + merge no config, com backup), separada da
/// resolução de caminhos: é este corpo que roda no gesto do usuário e o mesmo
/// que a prova empírica exercita contra os arquivos reais.
fn install_files(
    agent: &str,
    dialect: HookDialect,
    cpath: &PathBuf,
    script: &PathBuf,
    endpoint: &str,
    permission: bool,
) -> Result<(), String> {
    let script_str = script.to_string_lossy().to_string();
    let cfg = read_config(cpath)?;
    write_script(script, &render_script(agent, dialect, endpoint))?;
    backup_config(cpath)?;
    let events = events_for(dialect, permission);
    let next = match dialect {
        HookDialect::AgyConfigHooks => with_agy_group(&cfg, agy_group_value(&script_str, &events)),
        _ => with_hooks_claude_family(&cfg, &script_str, &events),
    };
    write_config(cpath, &next)
}

/// A REMOÇÃO (só o que é nosso + o script), mesma separação do `install_files`.
fn uninstall_files(dialect: HookDialect, cpath: &PathBuf, script: &PathBuf) -> Result<(), String> {
    let script_str = script.to_string_lossy().to_string();
    let cfg = read_config(cpath)?;
    let next = match dialect {
        HookDialect::AgyConfigHooks => without_agy_group(&cfg),
        _ => without_hooks_claude_family(&cfg, &script_str),
    };
    if next != cfg {
        backup_config(cpath)?;
        write_config(cpath, &next)?;
    }
    if script.exists() {
        std::fs::remove_file(script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Desinstala limpo: remove SÓ as nossas entradas + o script. O backup da
/// instalação fica no disco.
#[tauri::command]
pub fn hooks_uninstall(app: AppHandle, agent: String) -> Result<HooksStatus, String> {
    let dialect = require_hooks(&agent)?;
    let cpath = config_path(dialect)?;
    let script = script_path(&app, &agent)?;
    uninstall_files(dialect, &cpath, &script)?;
    log::info!("hooks: desinstalado pra {agent}");
    status_of(&app, &agent)
}

// ---------------------------------------------------------------------------
// Testes — fixtures REAIS desta máquina (12/08/2026): o settings.json do
// claude com afplay + thaytool + Xirp + Orca convivendo, o hooks.json do
// codex com Xirp + Orca, e o hooks.json do agy com o grupo "orca-status".
// A regra que os testes protegem: a nossa entrada entra AO LADO e a
// desinstalação devolve o CONTEÚDO byte-equivalente (igualdade de Value).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str =
        "/Users/x/Library/Application Support/mycockpit/hook-scripts/claude-code/mycockpit-hook.sh";
    const ENDPOINT: &str = "/Users/x/Library/Application Support/mycockpit/hook-endpoint.json";

    /// Recorte REAL do ~/.claude/settings.json desta máquina: 3 origens
    /// convivendo no mesmo evento (afplay do usuário, thaytool, Xirp com
    /// matcher ".*") + vizinhos que não podem ser perdidos no merge.
    fn settings_reais_claude() -> Value {
        json!({
            "$schema": "https://json.schemastore.org/claude-code-settings.json",
            "includeCoAuthoredBy": false,
            "model": "claude-fable-5[1m]",
            "hooks": {
                "Notification": [
                    { "hooks": [{ "command": "afplay /System/Library/Sounds/Purr.aiff", "type": "command" }] },
                    { "hooks": [{ "command": "[ -n \"$THAYTOOL_SESSION_ID\" ] && \"$HOME/.thaytool/hooks/notify.sh\" || true", "type": "command" }] },
                    { "hooks": [{ "command": "'/Users/x/Library/Application Support/Xirp/xirp-external/hook-scripts/claude/notification.cjs'", "type": "command" }], "matcher": ".*" }
                ],
                "Stop": [
                    { "hooks": [{ "command": "'/Users/x/Library/Application Support/Xirp/xirp-external/hook-scripts/claude/stop.cjs'", "type": "command" }], "matcher": ".*" }
                ]
            }
        })
    }

    /// Recorte REAL do ~/.codex/hooks.json (Xirp + Orca no mesmo evento).
    fn hooks_reais_codex() -> Value {
        json!({
            "hooks": {
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "afplay /System/Library/Sounds/Funk.aiff" }] },
                    { "matcher": ".*", "hooks": [{ "type": "command", "command": "'/Users/x/…/xirp-external/hook-scripts/codex/stop.cjs'" }] }
                ],
                "SessionStart": [
                    { "matcher": ".*", "hooks": [{ "type": "command", "command": "'/Users/x/…/xirp-external/hook-scripts/codex/sessionStart.cjs'" }] }
                ]
            }
        })
    }

    /// Recorte REAL do ~/.gemini/config/hooks.json (grupo vivo do Orca).
    fn hooks_reais_agy() -> Value {
        json!({
            "orca-status": {
                "PreInvocation": [
                    { "type": "command", "command": "ORCA_ANTIGRAVITY_EVENT='PreInvocation' /bin/sh '/Users/x/.orca/agent-hooks/antigravity-hook.sh'", "timeout": 10 }
                ],
                "PostToolUse": [
                    { "matcher": "*", "hooks": [{ "type": "command", "command": "ORCA_ANTIGRAVITY_EVENT='PostToolUse' /bin/sh '/Users/x/.orca/agent-hooks/antigravity-hook.sh'", "timeout": 10 }] }
                ]
            }
        })
    }

    #[test]
    fn instala_ao_lado_das_entradas_existentes_sem_tocar_nelas() {
        let out = with_hooks_claude_family(
            &settings_reais_claude(),
            SCRIPT,
            status_events(HookDialect::ClaudeSettings),
        );
        // as 3 entradas pré-existentes de Notification seguem lá, NA ORDEM,
        // e a nossa entrou como 4ª (append, nunca substituição).
        let notif = out["hooks"]["Notification"].as_array().unwrap();
        assert_eq!(notif.len(), 4);
        assert!(notif[0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("afplay"));
        assert!(entry_is_ours(&notif[3], SCRIPT));
        // evento que não existia (SessionStart) nasce só com a nossa.
        let ss = out["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(ss.len(), 1);
        assert!(entry_is_ours(&ss[0], SCRIPT));
        // eventos de tool levam matcher "*"; os demais não.
        let pre = out["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre[0]["matcher"], "*");
        assert!(ss[0].get("matcher").is_none());
        // vizinhos do settings intocados (o arquivo é do usuário).
        assert_eq!(out["model"], "claude-fable-5[1m]");
        assert_eq!(out["includeCoAuthoredBy"], false);
    }

    #[test]
    fn desinstalar_devolve_o_conteudo_como_estava() {
        let antes = settings_reais_claude();
        let instalado = with_hooks_claude_family(
            &antes,
            SCRIPT,
            status_events(HookDialect::ClaudeSettings),
        );
        // garantia HONESTA: o CONTEÚDO volta (igualdade de Value); formatação/
        // ordem de chaves do arquivo podem mudar (mesmo claim do statusline).
        assert_eq!(without_hooks_claude_family(&instalado, SCRIPT), antes);
    }

    #[test]
    fn desinstalar_num_config_que_nasceu_vazio_volta_ao_vazio() {
        let instalado = with_hooks_claude_family(
            &json!({}),
            SCRIPT,
            status_events(HookDialect::CodexHooksJson),
        );
        // remove os arrays que ficaram vazios E a chave hooks (arquivo do
        // usuário volta byte-equivalente ao {} de antes).
        assert_eq!(without_hooks_claude_family(&instalado, SCRIPT), json!({}));
    }

    #[test]
    fn reinstalar_e_idempotente_nunca_duplica() {
        let uma = with_hooks_claude_family(
            &hooks_reais_codex(),
            SCRIPT,
            status_events(HookDialect::CodexHooksJson),
        );
        let duas = with_hooks_claude_family(&uma, SCRIPT, status_events(HookDialect::CodexHooksJson));
        assert_eq!(uma, duas);
        let stop = duas["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(
            stop.iter().filter(|e| entry_is_ours(e, SCRIPT)).count(),
            1,
            "reinstalação não pode empilhar entradas nossas"
        );
    }

    #[test]
    fn comando_instalado_e_estavel_por_path_e_evento() {
        // trust model do codex [E5]: o comando é hasheado; token/porta ficam
        // DENTRO do script (regenerável) — reinstalar não muda o comando.
        let c = hook_command(SCRIPT, "Stop");
        assert_eq!(c, format!("'{SCRIPT}' Stop"));
        let entry = our_entry(SCRIPT, &ev("Stop", false, 10));
        assert_eq!(entry["hooks"][0]["command"], c);
        assert_eq!(entry["hooks"][0]["timeout"], 10);
    }

    #[test]
    fn agy_entra_como_grupo_nomeado_ao_lado_do_orca() {
        let out = with_agy_group(
            &hooks_reais_agy(),
            agy_group_value(SCRIPT, status_events(HookDialect::AgyConfigHooks)),
        );
        // o grupo do Orca fica intocado.
        assert!(out["orca-status"]["PreInvocation"].is_array());
        // o nosso: eventos de loop FLAT, tool com wrapper matcher/hooks
        // (formato do doc embarcado + grupo vivo do Orca).
        let ours = &out[AGY_GROUP];
        assert!(ours["PreInvocation"][0]["command"]
            .as_str()
            .unwrap()
            .contains(SCRIPT));
        assert!(ours["PreInvocation"][0].get("matcher").is_none());
        assert_eq!(ours["PostToolUse"][0]["matcher"], "*");
        assert!(ours["PostToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains(SCRIPT));
        // status do agy NÃO registra PreToolUse (output exige `decision`).
        assert!(ours.get("PreToolUse").is_none());
        // desinstalar devolve o arquivo como estava.
        assert_eq!(without_agy_group(&out), hooks_reais_agy());
    }

    #[test]
    fn eventos_instalados_detectam_o_que_e_nosso() {
        let out = with_hooks_claude_family(
            &settings_reais_claude(),
            SCRIPT,
            status_events(HookDialect::ClaudeSettings),
        );
        let evs = installed_events_claude_family(&out, SCRIPT);
        assert!(evs.contains(&"SessionStart".to_string()));
        assert!(evs.contains(&"Stop".to_string()));
        // no config original (só Xirp/Orca), NADA é nosso.
        assert!(installed_events_claude_family(&settings_reais_claude(), SCRIPT).is_empty());
        // agy idem.
        assert!(installed_events_agy(&hooks_reais_agy()).is_empty());
        let agy = with_agy_group(
            &hooks_reais_agy(),
            agy_group_value(SCRIPT, status_events(HookDialect::AgyConfigHooks)),
        );
        assert_eq!(
            installed_events_agy(&agy),
            vec!["PostInvocation", "PostToolUse", "PreInvocation", "Stop"]
        );
    }

    #[test]
    fn script_fail_open_por_construcao() {
        let s = render_script("claude-code", HookDialect::ClaudeSettings, ENDPOINT);
        // fire-and-forget: timeout de 1s, background, erro engolido, exit 0.
        assert!(s.contains("--connect-timeout 1"));
        assert!(s.contains(">/dev/null 2>&1 &"));
        assert!(s.trim_end().ends_with("exit 0"));
        // rota do motor certo + evento e correlação por header (env do run).
        assert!(s.contains("/hook/claude-code"));
        assert!(s.contains("X-Mycockpit-Event: ${ev}"));
        assert!(s.contains("X-Mycockpit-Run: ${MYCOCKPIT_RUN_ID}"));
        // claude-family NÃO imprime nada no stdout (stdout vazio = sem opinião).
        assert!(!s.contains("printf '{}"));
    }

    #[test]
    fn script_do_agy_responde_o_contrato_sincrono_antes_de_postar() {
        let s = render_script("agy", HookDialect::AgyConfigHooks, ENDPOINT);
        // resposta neutra IMEDIATA (Stop = decision vazia, resto = {}) — o
        // mesmo contrato que o hook vivo do Orca respeita [E11].
        assert!(s.contains(r#"Stop) printf '{"decision":""}\n' ;;"#));
        assert!(s.contains(r#"*) printf '{}\n' ;;"#));
        assert!(s.contains("/hook/agy"));
        assert!(s.trim_end().ends_with("exit 0"));
    }

    // ---- H2: hooks de permissão (opt-in separado) ----

    #[test]
    fn permissao_do_claude_family_e_o_permission_request_com_folga_de_timeout() {
        for d in [HookDialect::ClaudeSettings, HookDialect::CodexHooksJson] {
            let evs = permission_events(d);
            assert_eq!(evs.len(), 1);
            assert_eq!(evs[0].name, "PermissionRequest");
            assert_eq!(evs[0].matcher, Some("*"));
            // timeout do config (35s) > teto do round-trip humano (30s do
            // gateway) + folga do curl (32s): o CLI nunca mata o hook antes
            // de o app devolver `ask`.
            assert!(evs[0].timeout > 32);
            assert_eq!(permission_event_name(d), "PermissionRequest");
        }
    }

    #[test]
    fn permissao_do_agy_e_o_pre_tool_use_escopado_a_run_command() {
        let evs = permission_events(HookDialect::AgyConfigHooks);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].name, "PreToolUse");
        // escopo deliberado: segurar TODA tool call do agy por até 30s seria
        // punir tool inofensiva; run_command é a que exige permissão.
        assert_eq!(evs[0].matcher, Some("run_command"));
        assert_eq!(permission_event_name(HookDialect::AgyConfigHooks), "PreToolUse");
    }

    #[test]
    fn instalar_com_permissao_soma_o_evento_e_sem_ela_nao() {
        let sem = with_hooks_claude_family(
            &json!({}),
            SCRIPT,
            &events_for(HookDialect::ClaudeSettings, false),
        );
        assert!(sem["hooks"].get("PermissionRequest").is_none());
        let com = with_hooks_claude_family(
            &json!({}),
            SCRIPT,
            &events_for(HookDialect::ClaudeSettings, true),
        );
        assert!(entry_is_ours(&com["hooks"]["PermissionRequest"][0], SCRIPT));
        // reinstalar SEM permissão remove a entrada de permissão (opt-out
        // limpo — a reinstalação primeiro tira tudo que é nosso).
        let de_volta = with_hooks_claude_family(
            &com,
            SCRIPT,
            &events_for(HookDialect::ClaudeSettings, false),
        );
        assert!(de_volta["hooks"].get("PermissionRequest").is_none());
        // agy: o grupo ganha/perde o PreToolUse do mesmo jeito.
        let agy = with_agy_group(
            &json!({}),
            agy_group_value(SCRIPT, &events_for(HookDialect::AgyConfigHooks, true)),
        );
        assert_eq!(agy[AGY_GROUP]["PreToolUse"][0]["matcher"], "run_command");
    }

    #[test]
    fn script_do_claude_family_segura_a_permissao_e_cala_no_timeout() {
        let s = render_script("codex", HookDialect::CodexHooksJson, ENDPOINT);
        // ramo síncrono: espera até 32s e pipa a resposta do app pro stdout.
        assert!(s.contains("if [ \"$ev\" = \"PermissionRequest\" ]; then"));
        assert!(s.contains("--max-time 32"));
        // fail-open: sem app/sem resposta = stdout VAZIO (sem opinião → o
        // prompt nativo aparece no terminal). Nunca um deny fabricado.
        assert!(!s.contains("deny"));
        // status segue fire-and-forget em background.
        assert!(s.contains("--max-time 2"));
        assert!(s.contains(">/dev/null 2>&1 &"));
    }

    #[test]
    fn script_do_agy_devolve_ask_quando_o_app_nao_responde() {
        let s = render_script("agy", HookDialect::AgyConfigHooks, ENDPOINT);
        assert!(s.contains("if [ \"$ev\" = \"PreToolUse\" ]; then"));
        // o output do PreToolUse EXIGE decision: sem resposta do app, `ask`
        // preserva o comportamento nativo (inclusive o cache de Always Allow).
        assert!(s.contains(r#"printf '{"decision":"ask"}\n'"#));
        assert!(s.contains("--max-time 32"));
    }

    #[test]
    fn gate_de_versao_do_agy() {
        assert!(agy_version_ok("1.1.12"));
        assert!(agy_version_ok("1.1.10"));
        assert!(agy_version_ok("2.0.0"));
        assert!(!agy_version_ok("1.1.9")); // Stop hooks não rodam
        assert!(!agy_version_ok("1.0.16"));
        assert!(!agy_version_ok("")); // ilegível = não instala
        assert!(!agy_version_ok("abc"));
    }

    #[test]
    fn gate_instala_quando_a_versao_detectada_atinge_o_minimo() {
        // a versão vem da detecção canônica do app (a MESMA que a UI mostra em
        // "Agentes na máquina"): 1.1.12 ≥ 1.1.10 ⇒ instala.
        assert!(agy_version_gate("agy", Some("1.1.12".to_string())).is_ok());
        assert!(agy_version_gate("agy", Some("1.1.10".to_string())).is_ok());
    }

    #[test]
    fn gate_recusa_versao_abaixo_do_minimo_dizendo_qual_e() {
        let err = agy_version_gate("agy", Some("1.1.9".to_string())).unwrap_err();
        // a mensagem carrega a versão detectada E o mínimo: quem lê sabe o que
        // fazer (atualizar), em vez de achar que o app não enxerga a CLI.
        assert!(err.contains("v1.1.9"), "{err}");
        assert!(err.contains("1.1.10"), "{err}");
        assert!(err.contains("Nada foi alterado"), "{err}");
    }

    #[test]
    fn gate_recusa_fail_closed_quando_a_versao_e_desconhecida() {
        let err = agy_version_gate("agy", None).unwrap_err();
        // recusa continua (fail-closed), mas com a mensagem PRÓPRIA de "não
        // deu pra perguntar ao binário" — nunca a de versão baixa.
        assert!(err.contains("agy --version"), "{err}");
        assert!(err.contains("nada foi alterado"), "{err}");
        assert_ne!(
            err,
            agy_version_gate("agy", Some("1.0.16".to_string())).unwrap_err(),
            "não achar a versão e a versão ser baixa são coisas diferentes"
        );
    }

    #[tokio::test]
    async fn gate_so_existe_no_dialeto_do_agy() {
        // claude/codex não têm mínimo declarado: o gate passa reto (e nem
        // chega a perguntar versão a binário nenhum).
        assert!(dialect_install_gate("claude-code", HookDialect::ClaudeSettings)
            .await
            .is_ok());
        assert!(dialect_install_gate("codex", HookDialect::CodexHooksJson)
            .await
            .is_ok());
    }

    #[test]
    fn gate_por_capability_nunca_por_nome() {
        assert!(require_hooks("claude-code").is_ok());
        assert!(require_hooks("codex").is_ok());
        assert!(require_hooks("agy").is_ok());
        assert!(require_hooks("motor-inventado").is_err());
    }

    #[test]
    fn config_json_valido_mas_nao_objeto_aborta() {
        let dir = std::env::temp_dir().join(format!("mc-hooks-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("hooks.json");
        for corpo in ["[]", "null", "\"texto\""] {
            std::fs::write(&p, corpo).unwrap();
            let err = read_config(&p).unwrap_err();
            assert!(err.contains("não é um objeto"), "{corpo}: {err}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// PROVA EMPÍRICA do gate de versão (bug do build 193), FORA da suíte por
/// default porque toca os arquivos REAIS desta máquina. Rodar à mão:
///
/// ```text
/// cargo test prova_real -- --ignored --nocapture
/// ```
///
/// Ativa os hooks do agy pelo MESMO corpo do comando (gate canônico +
/// `install_files`), imprime o antes/depois do `~/.gemini/config/hooks.json` e
/// desativa no fim (`uninstall_files`), conferindo que o arquivo voltou ao
/// conteúdo anterior e que os grupos dos outros (orca-status) nunca foram
/// tocados. Os backups `.bak-mycockpit-<ts>` ficam no disco: é o
/// comportamento do produto, não sujeira do teste.
#[cfg(test)]
mod prova_real {
    use super::*;

    /// app_data_dir do macOS sem AppHandle: ~/Library/Application Support/
    /// <identifier do tauri.conf.json> (lido do arquivo, nunca decorado).
    fn app_data_dir_real() -> PathBuf {
        let conf = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"),
        )
        .expect("tauri.conf.json");
        let v: Value = serde_json::from_str(&conf).expect("tauri.conf.json parseia");
        let id = v["identifier"].as_str().expect("identifier").to_string();
        PathBuf::from(std::env::var("HOME").expect("HOME"))
            .join("Library")
            .join("Application Support")
            .join(id)
    }

    #[tokio::test]
    #[ignore = "toca os arquivos reais desta máquina; prova manual do gate"]
    async fn ativar_e_desativar_hooks_do_agy_nesta_maquina() {
        let agent = "agy";
        let dialect = require_hooks(agent).expect("agy declara hooks no registry");
        let cpath = config_path(dialect).expect("path do hooks.json do agy");
        let antes = read_config(&cpath).expect("hooks.json do agy");
        println!("--- ANTES ({}) ---", cpath.display());
        println!("{}", serde_json::to_string_pretty(&antes).unwrap());

        // 1) o gate roda pela detecção canônica (agy --version), não por
        //    arquivo do fornecedor.
        let detectada = crate::detect::detected_version(agent).await;
        println!("versão detectada (agy --version): {detectada:?}");
        dialect_install_gate(agent, dialect)
            .await
            .expect("o gate tem que PASSAR com o agy ≥1.1.10 instalado");

        // 2) instalar de verdade.
        let data = app_data_dir_real();
        let script = data.join("hook-scripts").join(agent).join(SCRIPT_NAME);
        let endpoint = data.join("hook-endpoint.json");
        install_files(
            agent,
            dialect,
            &cpath,
            &script,
            &endpoint.to_string_lossy(),
            false,
        )
        .expect("instalação");
        let depois = read_config(&cpath).expect("hooks.json depois");
        println!("--- DEPOIS ---");
        println!("{}", serde_json::to_string_pretty(&depois).unwrap());
        assert_eq!(
            depois["orca-status"], antes["orca-status"],
            "o grupo do Orca não pode ser tocado"
        );
        assert_eq!(
            installed_events_agy(&depois),
            vec!["PostInvocation", "PostToolUse", "PreInvocation", "Stop"]
        );
        assert!(script.exists(), "o script tem que estar no disco");
        let backups: Vec<String> = std::fs::read_dir(cpath.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
            .filter(|n| n.starts_with("hooks.json.bak-mycockpit-"))
            .collect();
        println!("backups: {backups:?}");
        assert!(!backups.is_empty(), "backup antes de mexer");

        // 3) desativar devolve o arquivo ao estado anterior.
        uninstall_files(dialect, &cpath, &script).expect("desinstalação");
        let restaurado = read_config(&cpath).expect("hooks.json restaurado");
        println!("--- DEPOIS DE DESATIVAR ---");
        println!("{}", serde_json::to_string_pretty(&restaurado).unwrap());
        assert_eq!(restaurado, antes, "desativar devolve o conteúdo anterior");
        assert!(!script.exists(), "o script sai junto");
    }
}

#[cfg(test)]
mod tests_shell {
    use super::*;

    /// Prova de shell REAL: o script gerado passa no `sh -n` e, com endpoint
    /// morto, sai 0 rápido e sem stderr (fail-open de verdade) — e no agy o
    /// stdout carrega a resposta síncrona neutra.
    #[test]
    #[cfg(unix)]
    fn script_gerado_roda_de_verdade() {
        let dir = std::env::temp_dir().join(format!("mc-hooks-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ep = dir.join("hook-endpoint.json");
        std::fs::write(&ep, r#"{"port":1,"token":"abc123","startedAt":0}"#).unwrap();
        for (dialect, expected_stdout) in [
            (HookDialect::ClaudeSettings, ""),
            (HookDialect::AgyConfigHooks, "{}"),
        ] {
            let script = dir.join(SCRIPT_NAME);
            std::fs::write(
                &script,
                render_script("claude-code", dialect, &ep.to_string_lossy()),
            )
            .unwrap();
            let syn = std::process::Command::new("sh")
                .arg("-n")
                .arg(&script)
                .output()
                .unwrap();
            assert!(
                syn.status.success(),
                "sh -n falhou: {}",
                String::from_utf8_lossy(&syn.stderr)
            );
            let out = std::process::Command::new("sh")
                .arg(&script)
                .arg("PreInvocation")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .and_then(|mut c| {
                    use std::io::Write;
                    c.stdin
                        .take()
                        .unwrap()
                        .write_all(b"{\"hook_event_name\":\"PreInvocation\"}")
                        .unwrap();
                    c.wait_with_output()
                })
                .unwrap();
            assert!(out.status.success(), "script saiu com erro (porta morta tem que ser engolida)");
            assert_eq!(
                String::from_utf8_lossy(&out.stdout).trim(),
                expected_stdout,
                "{dialect:?}"
            );
        }
        // H2 — agy PreToolUse com o app MORTO (porta 1): o script devolve
        // `ask` no stdout (fail-open do gate: o prompt nativo do agy decide).
        let script = dir.join(SCRIPT_NAME);
        std::fs::write(
            &script,
            render_script("agy", HookDialect::AgyConfigHooks, &ep.to_string_lossy()),
        )
        .unwrap();
        let out = std::process::Command::new("sh")
            .arg(&script)
            .arg("PreToolUse")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                use std::io::Write;
                c.stdin
                    .take()
                    .unwrap()
                    .write_all(b"{\"toolCall\":{\"name\":\"run_command\"}}")
                    .unwrap();
                c.wait_with_output()
            })
            .unwrap();
        assert!(out.status.success());
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            r#"{"decision":"ask"}"#
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
