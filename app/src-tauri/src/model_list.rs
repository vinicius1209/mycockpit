//! Sonda de LISTA DE MODELOS — M1 do docs/model-autonomy-plan.md.
//!
//! POR QUE existe: hoje o portão humano das propostas de modelo
//! (`model_proposals`) é o substituto de uma verificação que o app não tinha.
//! O curador propõe a partir do CATÁLOGO (models.dev, que fala de API), e só
//! uma pessoa testando contra o CLI sabia dizer "esse slug o Codex não aceita
//! com auth ChatGPT". Este módulo é a metade barata dessa verificação:
//! **perguntar ao CLI o que ele conhece AGORA**, sem gastar quota.
//!
//! O que foi verificado NESTA máquina em 14/08/2026 (fixtures abaixo são as
//! saídas reais, ADR-016):
//!
//!   • agy 1.1.13 — `agy models` imprime TSV `slug<TAB>Rótulo` no stdout, com
//!     o "Fetching available models..." no stderr. Não há `--json` (o flag é
//!     recusado: "flags provided but not defined: -json"). 14 slugs.
//!   • codex 0.147 — `model/list` existe no app-server (confirmado por
//!     `codex app-server generate-json-schema`, que gera ModelListParams/
//!     ModelListResponse) e responde no MESMO canal read-only que o medidor de
//!     uso já abre. Além do id/rótulo, ele entrega o que M1 precisava: `hidden`
//!     e `upgrade`/`upgradeInfo.migrationMarkdown` — a APOSENTADORIA anunciada
//!     pelo próprio CLI (gpt-5.4 → gpt-5.6-terra).
//!   • claude 2.1.220 — NÃO há fonte. Nenhum subcomando de modelos
//!     (`claude --help`: agents, auth, auto-mode, doctor, gateway, install,
//!     mcp, plugin, project, setup-token, ultrareview, update) e nada oficial
//!     em `~/.claude` (o que casa com "claude-opus-4…" ali é cache de tooling
//!     do próprio usuário, não lista do CLI). Capability `None`: o catálogo
//!     segue sendo a fonte, exatamente como o §M1 do plano previu.
//!
//! Quem decide QUAL motor tem fonte é o registry (`Capabilities.lists_models`
//! em adapters.rs) — nada aqui compara nome de agent fora do match no ENUM de
//! dialeto (o enum confina o "como", padrão CommandSource/HookDialect).
//!
//! GUARDA DO PLANO ("nada some do seletor sem aviso"): lista vazia NUNCA é
//! sucesso. Se a sonda voltou sem nenhum modelo, isso é falha (`kind: "empty"`)
//! e não "este motor não tem modelos" — senão o consumidor apagaria o seletor
//! por causa de uma saída quebrada. Truncar também é mentir: se a paginação do
//! codex pedir mais páginas do que o teto, o resultado é erro, não meia lista.

use crate::adapters::{capabilities_of, ModelListSource};
use serde::Serialize;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;

/// Teto de cada sonda. Mesmo número do medidor de uso: um CLI pendurado não
/// pode segurar quem pediu a lista.
const PROBE_TIMEOUT_SECS: u64 = 20;

/// Páginas de `model/list` que a sonda percorre. Hoje uma basta (6 visíveis, 8
/// com `includeHidden`, `nextCursor: null` em 14/08/2026); o teto existe pra
/// que uma paginação futura falhe HONESTA em vez de devolver meia lista.
const MAX_PAGES: usize = 5;

/// Um esforço de raciocínio que o CLI declara aceitar PARA UM MODELO. O `id` é
/// o valor exato da flag de esforço; a descrição é do próprio CLI.
#[derive(Clone, Debug, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelEffortOption {
    pub id: String,
    pub description: Option<String>,
}

/// Um modelo que o CLI declara conhecer. Só campos que ALGUM dialeto entrega de
/// verdade — nada derivado nem inventado (o que não veio fica `None`/`false`).
///
/// `Default` existe para que dialeto nenhum precise repetir o campo que ele não
/// entrega: cada sonda preenche o que sabe e fecha com `..Default::default()`.
/// Campo novo aqui não vira quatro edições e um esquecimento silencioso.
#[derive(Clone, Debug, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelListEntry {
    /// O slug EXATO que se passa na flag de modelo do CLI.
    pub id: String,
    /// Rótulo de exibição do próprio CLI (o agy só entrega isto além do id).
    pub label: String,
    /// Descrição do próprio CLI, quando existe (não é copy nossa).
    pub description: Option<String>,
    /// O CLI esconde este slug do picker padrão dele. Existe, mas não é oferta
    /// — o consumidor mostra com estado explicado, nunca como recomendação.
    pub hidden: bool,
    /// O CLI marca este slug como o default DELE.
    pub is_default: bool,
    /// O CLI anuncia que este slug foi sucedido por outro (aposentadoria
    /// declarada). É o que permite "slug aposentado vira estado explicado, não
    /// desaparecimento silencioso".
    pub superseded_by: Option<String>,
    /// O texto do PRÓPRIO CLI sobre a aposentadoria (evidência, não paráfrase).
    pub retirement_note: Option<String>,
    /// Os esforços de raciocínio que ESTE modelo aceita, na ordem do CLI. Vazio
    /// = o dialeto não fala de esforço (não é "nenhum esforço serve"): quem lê
    /// cai na régua estática do registry em vez de esvaziar o seletor.
    pub efforts: Vec<ModelEffortOption>,
    /// O esforço que o CLI usa neste modelo quando ninguém escolhe.
    pub default_effort: Option<String>,
}

/// A lista viva de um motor, com procedência e carimbo (ADR-016: dado sem
/// data e sem versão de CLI não é evidência, é boato).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListing {
    pub agent: String,
    /// "agy-models" | "codex-app-server" — o dialeto que respondeu.
    pub source: String,
    /// Versão do CLI que respondeu (probe na hora, sem cache — regra da casa
    /// em hooks_install.rs). None = não deu pra ler a versão.
    pub cli_version: Option<String>,
    pub fetched_at: i64,
    pub models: Vec<ModelListEntry>,
}

/// Falha de sonda com o TIPO na cara — o consumidor precisa distinguir "este
/// motor não tem fonte" de "a fonte falhou agora" pra nunca sumir com opção
/// por causa de um erro passageiro.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListError {
    /// "unsupported" (capability None) | "spawn" | "timeout" | "protocol" |
    /// "rpc" (o servidor recusou) | "empty" (respondeu sem nenhum modelo).
    pub kind: String,
    pub message: String,
}

impl ModelListError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
}

/// Id estável do dialeto pro lado TS (espelho de `listsModels` em agents.ts).
pub(crate) fn source_id(source: ModelListSource) -> &'static str {
    match source {
        ModelListSource::AgyModelsSubcommand => "agy-models",
        ModelListSource::OpenCodeModelsSubcommand => "opencode-models",
        ModelListSource::CodexAppServer => "codex-app-server",
    }
}

// ---------------------------------------------------------------------------
// Peças PURAS (parse por dialeto), testadas com as saídas REAIS capturadas.
// ---------------------------------------------------------------------------

/// stdout de `agy models` → entradas. Formato real: uma linha por modelo,
/// `slug<TAB>Rótulo`. Linha sem TAB não é linha de modelo (é ruído/log do CLI):
/// não vira entrada inventada e também não some calada — vai pro log.
pub(crate) fn parse_agy_models(stdout: &str) -> Vec<ModelListEntry> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let Some((id, label)) = line.split_once('\t') else {
            log::warn!("model_list: linha de `agy models` fora do formato TSV: {line}");
            continue;
        };
        let id = id.trim();
        if id.is_empty() {
            log::warn!("model_list: linha de `agy models` sem slug: {line}");
            continue;
        }
        out.push(ModelListEntry {
            id: id.to_string(),
            label: label.trim().to_string(),
            // `agy models` não marca default nenhum (o default é o do
            // config) e embute o esforço no próprio slug (-high/-medium/-low),
            // então não há lista de esforço por modelo pra ler.
            ..Default::default()
        });
    }
    out
}

/// `result` de `model/list` (codex app-server) → entradas. Item sem `id` não
/// vira entrada (slug é o que se passa na flag: sem ele não há o que oferecer),
/// mas é logado — nada é descartado em silêncio.
pub(crate) fn parse_codex_model_list(result: &Value) -> Vec<ModelListEntry> {
    let Some(data) = result.get("data").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for m in data {
        let Some(id) = m.get("id").and_then(|v| v.as_str()) else {
            log::warn!("model_list: item de model/list sem id: {m}");
            continue;
        };
        let label = m
            .get("displayName")
            .and_then(|v| v.as_str())
            .unwrap_or(id)
            .to_string();
        out.push(ModelListEntry {
            id: id.to_string(),
            label,
            description: m
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            hidden: m.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false),
            is_default: m
                .get("isDefault")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            superseded_by: m
                .get("upgrade")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            retirement_note: m
                .get("upgradeInfo")
                .and_then(|v| v.get("migrationMarkdown"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            efforts: parse_codex_efforts(m.get("supportedReasoningEfforts")),
            default_effort: m
                .get("defaultReasoningEffort")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }
    out
}

/// `supportedReasoningEfforts` do model/list → esforços deste modelo, NA ORDEM
/// do CLI. Campo ausente = vetor vazio, que quem lê trata como "este dialeto
/// não fala de esforço" e cai na régua estática — nunca como "nenhum esforço".
///
/// A chave é `reasoningEffort`. O `codex debug models` chama o MESMO campo de
/// `effort`, e são superfícies diferentes do mesmo CLI: aceitar as duas custa
/// uma linha e evita que uma renomeação apague a régua de esforço inteira.
pub(crate) fn parse_codex_efforts(value: Option<&Value>) -> Vec<ModelEffortOption> {
    let Some(items) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items {
        let Some(id) = item
            .get("reasoningEffort")
            .or_else(|| item.get("effort"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            log::warn!("model_list: esforço de model/list sem id: {item}");
            continue;
        };
        out.push(ModelEffortOption {
            id: id.to_string(),
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
        });
    }
    out
}

/// Cursor da próxima página, quando o servidor diz que há mais.
fn next_cursor(result: &Value) -> Option<String> {
    result
        .get("nextCursor")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Sondas por dialeto (o ÚNICO lugar que conhece o "como" de cada fornecedor).
// ---------------------------------------------------------------------------

/// stdout de `opencode models` → entradas. Formato real (1.17.9): UMA LINHA
/// por modelo, no dialeto `provider/model`, sem rótulo e sem TAB.
///
/// O `id` guarda a linha INTEIRA porque é exatamente isso que o `-m` aceita;
/// partir e remontar depois seria inventar uma tradução onde não há nenhuma. O
/// rótulo fica com o nome do modelo e o provedor vira descrição — com 88
/// modelos em 4 provedores, saber DE QUEM é o modelo é metade da escolha, e o
/// provedor sem credencial falha com 401 (a seção Serviços é onde isso aparece).
pub(crate) fn parse_opencode_models(stdout: &str) -> Vec<ModelListEntry> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r').trim();
        if line.is_empty() {
            continue;
        }
        let Some((provider, model)) = line.split_once('/') else {
            // Linha sem `/` não é modelo (é log/ruído do CLI): não vira entrada
            // inventada e não some calada.
            log::warn!("model_list: linha de `opencode models` sem provider/: {line}");
            continue;
        };
        if provider.trim().is_empty() || model.trim().is_empty() {
            log::warn!("model_list: linha de `opencode models` incompleta: {line}");
            continue;
        }
        out.push(ModelListEntry {
            id: line.to_string(),
            label: model.trim().to_string(),
            description: Some(format!("via {}", provider.trim())),
            // `opencode models` não marca default nem aposentadoria: o default
            // é do config do usuário, e inventar aqui seria afirmar por ele. O
            // `--variant` dele também é por provedor, não por modelo.
            ..Default::default()
        });
    }
    out
}

/// `opencode models --verbose` alterna `provider/model` e um objeto JSON
/// multilinha. Além do rótulo, esse objeto diz se o modelo produz texto e sabe
/// chamar ferramentas. Só esses modelos são oferta de CODE AGENT: embeddings e
/// geradores de imagem continuam no catálogo do fornecedor, não no composer.
pub(crate) fn parse_opencode_models_verbose(stdout: &str) -> Vec<ModelListEntry> {
    let mut lines = stdout.lines().peekable();
    let mut out = Vec::new();
    while let Some(raw_id) = lines.next() {
        let id = raw_id.trim();
        if id.is_empty() || !id.contains('/') {
            continue;
        }
        while lines.peek().is_some_and(|line| line.trim().is_empty()) {
            lines.next();
        }
        if !lines
            .peek()
            .is_some_and(|line| line.trim_start().starts_with('{'))
        {
            continue;
        }
        let mut json_text = String::new();
        let mut depth: i64 = 0;
        let mut started = false;
        for line in lines.by_ref() {
            json_text.push_str(line);
            json_text.push('\n');
            // A saída medida só traz strings comuns; serde valida o objeto no
            // fim. O balanço serve apenas para achar seu limite no stream.
            depth += line.chars().filter(|c| *c == '{').count() as i64;
            depth -= line.chars().filter(|c| *c == '}').count() as i64;
            started = true;
            if depth == 0 {
                break;
            }
        }
        if !started {
            continue;
        }
        let Ok(meta) = serde_json::from_str::<Value>(&json_text) else {
            log::warn!("model_list: metadata verbose inválida para {id}");
            continue;
        };
        let active = meta
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            == "active";
        let tools = meta
            .pointer("/capabilities/toolcall")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let text_out = meta
            .pointer("/capabilities/output/text")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !active || !tools || !text_out {
            continue;
        }

        let provider = meta
            .get("providerID")
            .and_then(Value::as_str)
            .or_else(|| id.split_once('/').map(|x| x.0))
            .unwrap_or("opencode");
        let name = meta
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| id.split_once('/').map(|x| x.1))
            .unwrap_or(id);
        let mut facts = vec![format!("via {provider}"), "ferramentas".into()];
        if meta
            .pointer("/capabilities/reasoning")
            .and_then(Value::as_bool)
            == Some(true)
        {
            facts.push("raciocínio".into());
        }
        if meta
            .pointer("/capabilities/input/image")
            .and_then(Value::as_bool)
            == Some(true)
        {
            facts.push("imagem".into());
        }
        if let Some(context) = meta.pointer("/limit/context").and_then(Value::as_u64) {
            let display = if context >= 1_000_000 {
                format!("{}M", context / 1_000_000)
            } else if context >= 1_000 {
                format!("{}k", context / 1_000)
            } else {
                context.to_string()
            };
            facts.push(format!("contexto {display}"));
        }
        out.push(ModelListEntry {
            id: id.to_string(),
            label: name.to_string(),
            description: Some(facts.join(" · ")),
            ..Default::default()
        });
    }
    out
}

async fn probe_opencode() -> Result<Vec<ModelListEntry>, ModelListError> {
    let mut cmd = tokio::process::Command::new("opencode");
    cmd.args(["models", "--verbose"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(PROBE_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| {
            ModelListError::new(
                "timeout",
                format!("`opencode models` não respondeu em {PROBE_TIMEOUT_SECS}s"),
            )
        })?
        .map_err(|e| {
            ModelListError::new(
                "spawn",
                format!("não consegui rodar `opencode models`: {e}"),
            )
        })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(ModelListError::new(
            "protocol",
            if err.is_empty() {
                "`opencode models` falhou sem mensagem".to_string()
            } else {
                err
            },
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let rich = parse_opencode_models_verbose(&stdout);
    // Compatibilidade com CLIs anteriores: se `--verbose` for aceito mas não
    // tiver o framing medido, a lista simples ainda é melhor que apagar tudo.
    Ok(if stdout.lines().any(|line| line.trim() == "{") {
        rich
    } else {
        parse_opencode_models(&stdout)
    })
}

async fn probe_agy() -> Result<Vec<ModelListEntry>, ModelListError> {
    let mut cmd = tokio::process::Command::new("agy");
    cmd.arg("models")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(PROBE_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| {
            ModelListError::new(
                "timeout",
                format!("`agy models` não respondeu em {PROBE_TIMEOUT_SECS}s"),
            )
        })?
        .map_err(|e| {
            ModelListError::new("spawn", format!("não consegui rodar `agy models`: {e}"))
        })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(ModelListError::new(
            "protocol",
            if err.is_empty() {
                "`agy models` falhou sem mensagem".to_string()
            } else {
                err
            },
        ));
    }
    Ok(parse_agy_models(&String::from_utf8_lossy(&out.stdout)))
}

async fn probe_codex() -> Result<Vec<ModelListEntry>, ModelListError> {
    let mut all = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_PAGES {
        // `includeHidden`: modelo escondido do picker do CLI existe e precisa
        // ser CONHECIDO (senão a fumaça chamaria de "slug desconhecido" algo
        // que o CLI conhece). Ele viaja com `hidden: true` e o consumidor
        // decide — o app não esconde dado, explica estado.
        let params = match &cursor {
            Some(c) => json!({ "includeHidden": true, "cursor": c }),
            None => json!({ "includeHidden": true }),
        };
        let result = crate::codex_appserver::probe_once("model/list", params, PROBE_TIMEOUT_SECS)
            .await
            .map_err(|e| ModelListError::new(e.kind, e.message))?;
        all.extend(parse_codex_model_list(&result));
        cursor = next_cursor(&result);
        if cursor.is_none() {
            return Ok(all);
        }
    }
    // Cursor ainda pendente depois do teto: devolver o que temos seria dizer
    // "estes são todos", e slug de verdade sumiria calado. Falha honesta.
    Err(ModelListError::new(
        "protocol",
        format!("a lista de modelos não coube em {MAX_PAGES} páginas"),
    ))
}

// ---------------------------------------------------------------------------
// Comando.
// ---------------------------------------------------------------------------

/// Lista viva de modelos de um motor. Sonda LOCAL e read-only: nenhuma quota
/// consumida em nenhum dos dialetos (o `agy models` lê o catálogo do provider,
/// o `model/list` roda no app-server sem abrir turno).
#[tauri::command]
pub async fn model_list(agent: String) -> Result<ModelListing, ModelListError> {
    let source = capabilities_of(&agent).and_then(|c| c.lists_models);
    // match EXAUSTIVO de propósito: dialeto novo no registry não pode cair num
    // `_ =>` mudo e virar "motor sem fonte".
    let models = match source {
        Some(ModelListSource::AgyModelsSubcommand) => probe_agy().await?,
        Some(ModelListSource::OpenCodeModelsSubcommand) => probe_opencode().await?,
        Some(ModelListSource::CodexAppServer) => probe_codex().await?,
        None => {
            return Err(ModelListError::new(
                "unsupported",
                format!("{agent} não sabe listar os próprios modelos (sem fonte viva auditada)"),
            ))
        }
    };
    if models.is_empty() {
        // Guarda do plano: lista vazia nunca é "não há modelos".
        return Err(ModelListError::new(
            "empty",
            format!("{agent} respondeu sem nenhum modelo (resposta vazia não é lista)"),
        ));
    }
    Ok(ModelListing {
        source: source_id(source.expect("dialeto existe: o None já retornou acima")).to_string(),
        cli_version: crate::detect::detected_version(&agent).await,
        fetched_at: crate::usage_window::now_ms(),
        models,
        agent,
    })
}

// ---------------------------------------------------------------------------
// Testes — as fixtures são as saídas REAIS capturadas nesta máquina em
// 14/08/2026 (ADR-016: fixture inventada esconde bug). `agy models` de
// agy 1.1.13; `model/list` do codex-cli 0.147.0 com `includeHidden: true`.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// stdout LITERAL de `agy models` (o "Fetching available models..." fica
    /// no stderr e por isso não aparece aqui).
    const FIXTURE_AGY: &str = "gemini-3.7-flash-high\tGemini 3.7 Flash (High)
gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)
gemini-3.7-flash-low\tGemini 3.7 Flash (Low)
gemini-3.6-flash-high\tGemini 3.6 Flash (High)
gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)
gemini-3.6-flash-low\tGemini 3.6 Flash (Low)
gemini-3.5-flash-high\tGemini 3.5 Flash (High)
gemini-3.5-flash-medium\tGemini 3.5 Flash (Medium)
gemini-3.5-flash-low\tGemini 3.5 Flash (Low)
gemini-3.1-pro-high\tGemini 3.1 Pro (High)
gemini-3.1-pro-low\tGemini 3.1 Pro (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
";

    /// `result` LITERAL de `model/list` (recortado nos campos que o app lê,
    /// com os DOIS casos que interessam: o default e o aposentado).
    const FIXTURE_CODEX: &str = r#"{
      "data": [
        {
          "id": "gpt-5.6-sol",
          "model": "gpt-5.6-sol",
          "upgrade": null,
          "upgradeInfo": null,
          "displayName": "GPT-5.6-Sol",
          "description": "Latest frontier agentic coding model.",
          "hidden": false,
          "isDefault": true
        },
        {
          "id": "gpt-5.4",
          "model": "gpt-5.4",
          "upgrade": "gpt-5.6-terra",
          "upgradeInfo": {
            "model": "gpt-5.6-terra",
            "upgradeCopy": null,
            "modelLink": null,
            "migrationMarkdown": "GPT-5.4 will be deprecated soon\n\nCodex now uses GPT-5.6 Terra in place of GPT-5.4. Switch to GPT-5.6 Terra to continue.\n"
          },
          "displayName": "GPT-5.4",
          "description": "Strong model for everyday coding.",
          "hidden": false,
          "isDefault": false
        },
        {
          "id": "gpt-5.6-sol-wm",
          "model": "gpt-5.6-sol-wm",
          "upgrade": null,
          "upgradeInfo": null,
          "displayName": "GPT-5.6-Sol-WM",
          "description": "",
          "hidden": true,
          "isDefault": false
        }
      ],
      "nextCursor": null
    }"#;

    /// `result` LITERAL de `model/list` do codex-cli **0.153.4**, capturado em
    /// 09/09/2026 (só os campos que o app lê; os VALORES são os reais). Mora em
    /// arquivo porque a régua de esforço por modelo é longa e fixture inline
    /// desse tamanho esconde o teste dentro do dado.
    ///
    /// Este é o dia em que o GPT-6 chegou: o `isDefault` mudou de mão sem que
    /// ninguém tocasse no app, que é exatamente o que a lista viva existe pra
    /// capturar.
    const FIXTURE_CODEX_0_153: &str =
        include_str!("../fixtures/codex-model-list-0.153.4.json");

    #[test]
    fn codex_entrega_esforco_por_modelo_e_o_default_dele() {
        let result: Value = serde_json::from_str(FIXTURE_CODEX_0_153).unwrap();
        let models = parse_codex_model_list(&result);
        assert_eq!(models.len(), 8, "os 8 slugs reais de 09/09/2026");

        // A ORDEM é do CLI (prioridade dele) e não se reordena: o frontier vem
        // primeiro, e é isso que faz modelo novo estrear no topo do seletor.
        assert_eq!(models[0].id, "gpt-6-astra");
        assert!(models[0].is_default);
        assert_eq!(models.iter().filter(|m| m.is_default).count(), 1);

        // Esforço é POR MODELO, e os números divergem de verdade: o astra
        // aceita ultra, o gpt-5.5 para em xhigh. Régua fixa em código mentiria
        // pra um dos dois.
        let astra = &models[0];
        assert_eq!(
            astra.efforts.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["low", "medium", "high", "xhigh", "max", "ultra"],
        );
        assert_eq!(astra.default_effort.as_deref(), Some("medium"));
        assert!(astra.efforts[5].description.is_some(), "a copy é do CLI");
        let velho = models.iter().find(|m| m.id == "gpt-5.5").unwrap();
        assert_eq!(
            velho.efforts.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["low", "medium", "high", "xhigh"],
        );

        // `hidden` continua chegando marcado, não filtrado: quem oferece decide.
        assert!(models.iter().any(|m| m.hidden && m.id == "gpt-reserve"));
    }

    /// Dialeto que não fala de esforço devolve VAZIO, e vazio é "não sei", não
    /// "nenhum esforço serve" — é o que autoriza quem lê a cair na régua
    /// estática em vez de esvaziar o seletor.
    #[test]
    fn dialeto_sem_esforco_devolve_vazio_e_nao_zero_opcoes() {
        assert!(parse_codex_efforts(None).is_empty());
        assert!(parse_codex_efforts(Some(&json!("nada"))).is_empty());
        for m in parse_agy_models(FIXTURE_AGY) {
            assert!(m.efforts.is_empty());
            assert_eq!(m.default_effort, None);
        }
    }

    #[test]
    fn agy_tsv_vira_lista_com_slug_e_rotulo_do_proprio_cli() {
        let models = parse_agy_models(FIXTURE_AGY);
        assert_eq!(models.len(), 14, "os 14 slugs reais de 14/08/2026");
        assert_eq!(models[0].id, "gemini-3.7-flash-high");
        assert_eq!(models[0].label, "Gemini 3.7 Flash (High)");
        // O agy embute o esforço no id e não marca default nenhum.
        assert!(models.iter().all(|m| !m.is_default));
        assert!(models.iter().all(|m| !m.hidden));
        // A lista do agy mistura fornecedores — e isso é dado do CLI, não
        // motivo pra filtrar: o app não decide por ele o que é "dele".
        assert!(models.iter().any(|m| m.id == "claude-sonnet-4-6"));
        assert!(models.iter().any(|m| m.id == "gpt-oss-120b-medium"));
    }

    /// Regressão do incidente de 14/08/2026: um segundo leitor de `agy models`
    /// (o extinto `detect::parse_model_lines`) devolvia a LINHA INTEIRA como
    /// slug, e o app mandava `--model "gemini-3.7-flash-high\tGemini 3.7 Flash
    /// (High)"`. O agy recusava LOCALMENTE ("is not recognized as a known
    /// model") e o turno morria antes de nascer. Nenhum id pode carregar
    /// espaço em branco — é isso que separa slug de linha de listagem.
    #[test]
    fn nenhum_slug_carrega_rotulo_colado() {
        for m in parse_agy_models(FIXTURE_AGY) {
            assert!(
                !m.id.chars().any(char::is_whitespace),
                "slug com espaço/TAB vazaria pro --model: {:?}",
                m.id
            );
            assert!(
                !m.label.is_empty(),
                "rótulo do CLI não se perde: {:?}",
                m.id
            );
            // o rótulo saiu do id, não ficou colado nele.
            assert!(!m.id.contains(&m.label));
        }
    }

    #[test]
    fn linha_fora_do_formato_nao_vira_modelo_inventado() {
        let models = parse_agy_models("Fetching available models...\n\nok-slug\tOk\n\tsem-slug\n");
        assert_eq!(models.len(), 1, "só a linha TSV com slug vira modelo");
        assert_eq!(models[0].id, "ok-slug");
    }

    #[test]
    fn codex_model_list_traz_default_hidden_e_aposentadoria_anunciada() {
        let result: Value = serde_json::from_str(FIXTURE_CODEX).unwrap();
        let models = parse_codex_model_list(&result);
        assert_eq!(models.len(), 3);

        let sol = &models[0];
        assert_eq!(sol.id, "gpt-5.6-sol");
        assert_eq!(sol.label, "GPT-5.6-Sol");
        assert!(sol.is_default);
        assert!(!sol.hidden);
        assert_eq!(sol.superseded_by, None);

        // O achado que M1 precisava: o CLI ANUNCIA a aposentadoria. Slug velho
        // não some calado do seletor, some com motivo escrito pelo fornecedor.
        let velho = &models[1];
        assert_eq!(velho.id, "gpt-5.4");
        assert_eq!(velho.superseded_by.as_deref(), Some("gpt-5.6-terra"));
        assert!(velho
            .retirement_note
            .as_deref()
            .unwrap()
            .contains("will be deprecated soon"));

        // Hidden viaja marcado (não é oferta, mas o CLI o conhece — some da
        // recomendação, nunca do conhecimento).
        let escondido = &models[2];
        assert!(escondido.hidden);
        assert_eq!(
            escondido.description, None,
            "descrição vazia não vira texto"
        );
    }

    #[test]
    fn item_sem_id_nao_vira_modelo() {
        let result = json!({"data":[{"displayName":"Sem slug"},{"id":"bom","displayName":"Bom"}]});
        let models = parse_codex_model_list(&result);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "bom");
    }

    #[test]
    fn resposta_sem_data_nao_explode_e_nao_inventa() {
        assert!(parse_codex_model_list(&json!({})).is_empty());
        assert!(parse_codex_model_list(&json!({"data": "isso não é lista"})).is_empty());
    }

    #[test]
    fn cursor_vazio_ou_nulo_significa_fim_de_lista() {
        assert_eq!(next_cursor(&json!({"nextCursor": null})), None);
        assert_eq!(next_cursor(&json!({"nextCursor": ""})), None);
        assert_eq!(next_cursor(&json!({})), None);
        assert_eq!(
            next_cursor(&json!({"nextCursor": "abc"})).as_deref(),
            Some("abc")
        );
    }

    /// Saída REAL do `opencode models` (1.17.9): uma linha por `provider/model`.
    #[test]
    fn opencode_models_le_provider_e_modelo() {
        let out = parse_opencode_models(
            "opencode-go/kimi-k3\ngoogle/gemini-2.5-pro\nopenai/gpt-5.6-sol\n",
        );
        assert_eq!(out.len(), 3);
        // O `id` guarda a LINHA INTEIRA: é exatamente o que o `-m` aceita.
        assert_eq!(out[0].id, "opencode-go/kimi-k3");
        assert_eq!(out[0].label, "kimi-k3");
        assert_eq!(out[0].description.as_deref(), Some("via opencode-go"));
        assert_eq!(out[1].id, "google/gemini-2.5-pro");
    }

    #[test]
    fn opencode_models_ignora_linha_sem_provider() {
        // Ruído/log do CLI não vira modelo inventado (e vai pro log, não some).
        let out = parse_opencode_models("carregando...\ngoogle/gemini-2.5-flash\n\n");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "google/gemini-2.5-flash");
    }

    #[test]
    fn opencode_models_recusa_linha_incompleta() {
        // "google/" e "/modelo" não descrevem modelo nenhum.
        assert!(parse_opencode_models("google/\n/gemini\n").is_empty());
    }

    #[test]
    fn opencode_models_nao_inventa_default_nem_aposentadoria() {
        // O default é do config do usuário; marcar aqui seria afirmar por ele.
        let out = parse_opencode_models("google/gemini-2.5-pro\n");
        assert!(!out[0].is_default);
        assert!(out[0].superseded_by.is_none());
        assert!(out[0].retirement_note.is_none());
    }

    #[test]
    fn opencode_models_preserva_barra_no_nome_do_modelo() {
        // `split_once` parte na PRIMEIRA barra: um id com barra no meio
        // (provider/familia/modelo) mantém o resto inteiro no rótulo.
        let out = parse_opencode_models("openrouter/anthropic/claude-4\n");
        assert_eq!(out[0].id, "openrouter/anthropic/claude-4");
        assert_eq!(out[0].label, "anthropic/claude-4");
        assert_eq!(out[0].description.as_deref(), Some("via openrouter"));
    }

    #[test]
    fn opencode_verbose_oferece_so_modelo_de_agente() {
        let fixture = r#"nvidia/moonshotai/kimi-k3
{
  "id":"moonshotai/kimi-k3", "providerID":"nvidia", "name":"Kimi K3",
  "status":"active", "limit":{"context":1000000},
  "capabilities":{"reasoning":true,"toolcall":true,"input":{"image":true},"output":{"text":true}}
}
nvidia/baai/bge-m3
{
  "id":"baai/bge-m3", "providerID":"nvidia", "name":"BGE M3", "status":"active",
  "capabilities":{"toolcall":false,"output":{"text":true}}
}
nvidia/black-forest-labs/flux
{
  "id":"black-forest-labs/flux", "providerID":"nvidia", "name":"Flux", "status":"active",
  "capabilities":{"toolcall":false,"output":{"text":false}}
}
"#;
        let models = parse_opencode_models_verbose(fixture);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "nvidia/moonshotai/kimi-k3");
        assert_eq!(models[0].label, "Kimi K3");
        assert_eq!(
            models[0].description.as_deref(),
            Some("via nvidia · ferramentas · raciocínio · imagem · contexto 1M")
        );
    }

    #[test]
    fn id_do_dialeto_e_o_mesmo_do_espelho_ts() {
        // Mexeu aqui, mexa em lib/agents.ts (campo `listsModels`).
        assert_eq!(
            source_id(ModelListSource::AgyModelsSubcommand),
            "agy-models"
        );
        assert_eq!(
            source_id(ModelListSource::CodexAppServer),
            "codex-app-server"
        );
    }
}
