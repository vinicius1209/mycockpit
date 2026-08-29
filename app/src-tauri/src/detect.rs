//! Detecção de ferramentas na máquina (onboarding, docs/onboarding.md §1). Roda
//! TODOS os probes em paralelo, cada um com timeout curto (probe pendurado vira
//! `unknown`, nunca trava o wizard). Nenhum probe dispara run pago — só metadata.
//! Depende do PATH já hidratado no startup (path.rs) p/ achar os binários.

use serde::Serialize;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// auth: "ok" (logado) | "missing" (instalado, deslogado) | "unknown"
/// (instalado, auth indeterminada) | "na" (não se aplica: git/swiftc).
///
/// latest é POR CANAL do binário gerenciado (incidente do sucesso falso: a
/// "última" vinha do npm, o binário era do brew cujo tap topava numa versão
/// menor — botão "Atualizar" eterno prometendo o impossível). O canal vem do
/// MESMO classify do update.rs; a fonte é a daquele canal (npm registry ×
/// formulae.brew.sh). alt_latest/alt_channel: a última do OUTRO canal, pra UI
/// dizer na cara quando outro canal tem versão maior (trocar de canal é gesto
/// do usuário, não botão). None = fonte indisponível/offline/não aplicável.
/// Comparação de versão é do FRONTEND.
#[derive(Serialize, Clone)]
pub struct DetectedTool {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub auth: String,
    pub detail: Option<String>,
    pub latest: Option<String>,
    /// canal da fonte do `latest` ("npm" | "homebrew").
    #[serde(rename = "latestChannel")]
    pub latest_channel: Option<String>,
    #[serde(rename = "altLatest")]
    pub alt_latest: Option<String>,
    #[serde(rename = "altChannel")]
    pub alt_channel: Option<String>,
    /// Path REAL (canonizado) da cópia que VENCE no PATH do app — é a que o
    /// spawn roda (`Command::new("claude")`) e a que o updater atualiza
    /// (`resolve_bin`, o mesmo `command -v`). None = não resolvido.
    #[serde(rename = "binPath")]
    pub bin_path: Option<String>,
    /// Demais cópias no PATH, além da vencedora. Vazio = instalação única.
    #[serde(rename = "otherPaths")]
    pub other_paths: Vec<String>,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
/// Timeout dos lookups de `latest` (rede): mais curto que o probe local pra
/// nunca virar o gargalo do `tokio::join!` da detecção.
const LATEST_TIMEOUT: Duration = Duration::from_secs(4);

fn tool(
    id: &str,
    installed: bool,
    version: Option<String>,
    auth: &str,
    detail: Option<String>,
) -> DetectedTool {
    DetectedTool {
        id: id.to_string(),
        installed,
        version,
        auth: auth.to_string(),
        detail,
        latest: None,
        latest_channel: None,
        alt_latest: None,
        alt_channel: None,
        bin_path: None,
        other_paths: Vec::new(),
    }
}

/// Roda um comando; devolve (exit_ok, stdout_trimmado) ou None se o binário não
/// existe (ENOENT) ou estourou o timeout. stderr é ignorado (só metadata).
async fn run(bin: &str, args: &[&str]) -> Option<(bool, String)> {
    match timeout(PROBE_TIMEOUT, Command::new(bin).args(args).output()).await {
        Ok(Ok(out)) => Some((
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        )),
        _ => None,
    }
}

/// Extrai o número de versão (1º token que começa com dígito e tem "."). Ex.:
/// "2.1.145 (Claude Code)" → "2.1.145"; "codex-cli 0.141.0" → "0.141.0".
/// pub(crate): o update.rs usa no probe antes×depois do desfecho verificado.
pub(crate) fn extract_version(s: &str) -> Option<String> {
    s.lines().next().and_then(|line| {
        line.split_whitespace()
            .map(|t| t.trim_start_matches('v'))
            .find(|t| {
                t.contains('.') && t.chars().next().is_some_and(|c| c.is_ascii_digit())
            })
            .map(str::to_string)
    })
}

/// `<bin> --version` pelo caminho ÚNICO: mesma invocação, mesmo timeout e
/// mesmo parse pra todo mundo que pergunta "que versão está instalada".
/// None = binário ausente (ENOENT) ou timeout; `Some((exit_ok, versão))`, com
/// versão None quando a saída não tem número legível.
async fn version_probe(bin: &str) -> Option<(bool, Option<String>)> {
    let (ok, out) = run(bin, &["--version"]).await?;
    Some((ok, extract_version(&out)))
}

/// Binário de cada agent do registry. Conhecimento POR-PROVIDER, e este módulo
/// é a camada onde ele mora (os probes abaixo já são um por fornecedor);
/// código genérico pergunta `detected_version`, nunca esta tabela. None =
/// agent sem CLI conhecida.
pub(crate) fn agent_bin(agent: &str) -> Option<&'static str> {
    match agent {
        "claude-code" => Some("claude"),
        "codex" => Some("codex"),
        "agy" => Some("agy"),
        "opencode" => Some("opencode"),
        _ => None,
    }
}

/// Versão instalada de um agent pela detecção CANÔNICA do app: o MESMO
/// `<bin> --version` + `extract_version` que preenche "Agentes na máquina"
/// (`detect_agents`). É a fonte ÚNICA de versão pra qualquer decisão do app,
/// inclusive gate de capability por versão (hooks_install.rs) — nunca ler
/// arquivo do diretório do fornecedor pra responder isso (não é contrato: o
/// `~/.gemini/antigravity-cli/version` que o gate de hooks lia no build 193
/// simplesmente não existe no agy 1.1.12). None = binário fora do PATH, exit
/// != 0, timeout ou saída sem versão legível: o chamador decide fail-closed
/// com mensagem honesta.
pub async fn detected_version(agent: &str) -> Option<String> {
    match version_probe(agent_bin(agent)?).await {
        Some((true, v)) => v,
        _ => None,
    }
}

/// Busca um JSON via `curl` subprocess (o app já orquestra CLIs; zero
/// dependência de HTTP client). Best-effort: qualquer falha (sem curl,
/// offline, timeout, JSON inesperado) devolve None em silêncio.
async fn fetch_json(url: &str) -> Option<serde_json::Value> {
    let out = timeout(
        LATEST_TIMEOUT,
        Command::new("curl")
            .args(["-s", "--max-time", "3", url])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() {
        return None;
    }
    serde_json::from_slice(&out.stdout).ok()
}

// ---- última versão POR CANAL (parse puro + decisão pura, testáveis) --------

/// npm registry `/latest` → `.version`.
fn parse_npm_version(v: &serde_json::Value) -> Option<String> {
    v.get("version")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// formulae.brew.sh `/api/cask/<nome>.json` → `.version`. Casks às vezes
/// carregam build depois da vírgula ("1.2.3,4567") — fica só a versão.
fn parse_cask_version(v: &serde_json::Value) -> Option<String> {
    v.get("version")
        .and_then(|x| x.as_str())
        .and_then(|s| s.split(',').next())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// formulae.brew.sh `/api/formula/<nome>.json` → `.versions.stable`.
fn parse_formula_stable(v: &serde_json::Value) -> Option<String> {
    v.get("versions")
        .and_then(|x| x.get("stable"))
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// Fontes de "última" por agent: (pacote npm, nome no brew). None = sem canal
/// conhecido (agy). Espelha o plan() do update.rs.
fn channel_sources(agent: &str) -> Option<(&'static str, &'static str)> {
    match agent {
        "claude-code" => Some(("@anthropic-ai/claude-code", "claude-code")),
        "codex" => Some(("@openai/codex", "codex")),
        _ => None,
    }
}

/// Decisão PURA de canais pelo método do binário gerenciado: (canal do
/// `latest`, canal alternativo a informar). Homebrew/Npm têm alternativo (é a
/// linha "o canal X tem vY" da UI); nativo/desconhecido usa npm como
/// best-effort e não promete teto de canal nenhum.
fn channels_for(method: &crate::update::Method) -> (&'static str, Option<&'static str>) {
    use crate::update::Method;
    match method {
        Method::Homebrew => ("homebrew", Some("npm")),
        Method::Npm => ("npm", Some("homebrew")),
        Method::Native | Method::Unknown => ("npm", None),
    }
}

/// Última do npm pro pacote.
async fn latest_npm(package: &str) -> Option<String> {
    parse_npm_version(&fetch_json(&format!("https://registry.npmjs.org/{package}/latest")).await?)
}

/// Última do brew: tenta CASK primeiro (claude-code e codex são casks hoje) e
/// cai pra formula — resolve dinamicamente sem hardcodar o tipo.
async fn latest_brew(name: &str) -> Option<String> {
    if let Some(v) = fetch_json(&format!("https://formulae.brew.sh/api/cask/{name}.json"))
        .await
        .and_then(|j| parse_cask_version(&j))
    {
        return Some(v);
    }
    parse_formula_stable(&fetch_json(&format!("https://formulae.brew.sh/api/formula/{name}.json")).await?)
}

/// Quem vence no PATH e quem mais está lá. Mora na DETECÇÃO, não no updater:
/// "instalei duas vezes" é fato da MÁQUINA, verdadeiro antes de qualquer
/// atualização e depois de fechar o app. Enquanto isso só era calculado dentro
/// do job de update, o aviso aparecia justamente quando não fazia falta (logo
/// após um update bem-sucedido) e sumia quando fazia (numa máquina que nunca
/// rodou update pelo app, e em todo reinício — o job vive em memória).
///
/// Mesma resolução do spawn e do updater (`command -v` + canonicalize), então
/// `bin_path` é literalmente o binário que roda. Best-effort: falha vira
/// None/vazio e nunca derruba a detecção.
async fn fill_paths(t: &mut DetectedTool, bin: &str) {
    if !t.installed {
        return;
    }
    let Some(managed) = crate::update::resolve_bin(bin).await else {
        return;
    };
    t.other_paths = crate::update::other_paths_of(crate::update::which_all(bin).await, &managed);
    t.bin_path = Some(managed);
}

/// `latest` honesto pro agent: canal do BINÁRIO GERENCIADO (classify do
/// update.rs sobre o path real) manda; o outro canal vira alt_latest — só
/// informação, nunca botão. Preenche direto no DetectedTool.
async fn fill_latest(t: &mut DetectedTool, bin: &str) {
    let Some((npm_pkg, brew_name)) = channel_sources(&t.id) else {
        return;
    };
    let method = crate::update::resolve_bin(bin)
        .await
        .as_deref()
        .map(crate::update::classify)
        .unwrap_or(crate::update::Method::Unknown);
    let (primary, alt) = channels_for(&method);
    let fetch = |channel: &'static str| async move {
        match channel {
            "homebrew" => latest_brew(brew_name).await,
            _ => latest_npm(npm_pkg).await,
        }
    };
    match alt {
        Some(alt_channel) => {
            let (latest, alt_latest) = tokio::join!(fetch(primary), fetch(alt_channel));
            t.latest = latest;
            t.latest_channel = Some(primary.to_string());
            t.alt_latest = alt_latest;
            t.alt_channel = Some(alt_channel.to_string());
        }
        None => {
            t.latest = fetch(primary).await;
            t.latest_channel = Some(primary.to_string());
        }
    }
}

async fn probe_claude() -> DetectedTool {
    let Some((true, version)) = version_probe("claude").await else {
        return tool("claude-code", false, None, "missing", None);
    };
    // auth: `claude auth status` → JSON {"loggedIn": bool, "email"|"authMethod"…}
    let (auth, detail) = match run("claude", &["auth", "status"]).await {
        Some((_, json)) => match serde_json::from_str::<serde_json::Value>(&json) {
            Ok(v) => {
                let logged = v.get("loggedIn").and_then(|x| x.as_bool()).unwrap_or(false);
                let detail = v
                    .get("email")
                    .and_then(|x| x.as_str())
                    .or_else(|| v.get("authMethod").and_then(|x| x.as_str()))
                    .map(str::to_string);
                (if logged { "ok" } else { "missing" }.to_string(), detail)
            }
            Err(_) => ("unknown".to_string(), None),
        },
        None => ("unknown".to_string(), None),
    };
    tool("claude-code", true, version, &auth, detail)
}

async fn probe_codex() -> DetectedTool {
    let Some((true, version)) = version_probe("codex").await else {
        return tool("codex", false, None, "missing", None);
    };
    // auth: `codex login status` → exit 0 + "Logged in using ChatGPT"; sem JSON,
    // decide pelo exit code.
    let (auth, detail) = match run("codex", &["login", "status"]).await {
        Some((true, line)) => (
            "ok".to_string(),
            line.lines().next().map(str::to_string),
        ),
        Some((false, _)) => ("missing".to_string(), None),
        None => ("unknown".to_string(), None),
    };
    tool("codex", true, version, &auth, detail)
}

async fn probe_agy() -> DetectedTool {
    let Some((true, version)) = version_probe("agy").await else {
        return tool("agy", false, None, "missing", None);
    };
    // agy NÃO tem subcomando de auth (1.1.1). Degradação: `agy models` — lista
    // não-vazia → provavelmente logado; erro/vazio/timeout → unknown (honesto).
    let auth = match run("agy", &["models"]).await {
        Some((true, list)) if !list.is_empty() => "ok",
        _ => "unknown",
    };
    tool("agy", true, version, auth, None)
}

/// Credenciais que o `opencode providers list` reporta. O formato (1.17.9), já
/// sem ANSI:
///
/// ```text
/// ┌  Credentials ~/.local/share/opencode/auth.json
/// ●  OpenAI oauth
/// ●  Google oauth
/// └  3 credentials
/// ```
///
/// Lemos as LINHAS `●`, não o rodapé "N credentials": o rodapé é um número que
/// já vem contado, e contar de novo o que se leu é o que permite dizer QUAIS
/// provedores existem, não só quantos. Puro e testável com a saída real.
/// OpenCode (1.17.9): 4º motor e MULTIPLICADOR de credencial — ele fala com
/// provedores por OAuth (Copilot, SuperGrok, GitLab Duo…) que o Frota não
/// alcança sozinho.
///
/// A auth aqui NÃO é booleana como nos outros: o que importa é QUANTOS
/// provedores existem, porque é isso que decide quantos modelos o seletor terá.
/// Zero credencial = instalado e inútil, e isso é `missing`, não `ok`.
async fn probe_opencode() -> DetectedTool {
    let Some((true, version)) = version_probe("opencode").await else {
        return tool("opencode", false, None, "missing", None);
    };
    match crate::opencode_auth::list().await {
        Ok(creds) => {
            if creds.is_empty() {
                return tool("opencode", true, version, "missing", Some("nenhum provedor conectado".into()));
            }
            let nomes: Vec<&str> = creds.iter().map(|c| c.provider.as_str()).collect();
            tool("opencode", true, version, "ok", Some(nomes.join(", ")))
        }
        // Comando não respondeu: instalado, mas não sei se dá pra usar. O selo
        // verde exige probe que passou (doutrina do MachineAgents).
        Err(_) => tool("opencode", true, version, "unknown", None),
    }
}

async fn probe_simple(id: &str, bin: &str) -> DetectedTool {
    match version_probe(bin).await {
        Some((true, version)) => tool(id, true, version, "na", None),
        _ => tool(id, false, None, "na", None),
    }
}

/// Detecta todas as ferramentas em PARALELO. Chamado pelo wizard e pela
/// re-detecção nas Configurações. Nunca falha (cada probe degrada p/
/// missing/unknown). Os probes rodam num join; os lookups de `latest`
/// (resolve do canal + rede best-effort) rodam num segundo join em cima dos
/// resultados. agy/git/swiftc: sem fonte pública conhecida → latest = None.
#[tauri::command]
pub async fn detect_agents() -> Vec<DetectedTool> {
    let (mut claude, mut codex, mut agy, mut opencode, git, swiftc) = tokio::join!(
        probe_claude(),
        probe_codex(),
        probe_agy(),
        probe_opencode(),
        probe_simple("git", "git"),
        probe_simple("swiftc", "swiftc"),
    );
    // `latest` (rede) e `paths` (disco) em joins separados porque o borrow
    // checker não deixa a mesma ferramenta ser emprestada mut duas vezes no
    // mesmo join. agy entra só no segundo: não tem `latest` (sem fonte pública
    // conhecida), mas as cópias no PATH são fato local e valem pra ele igual.
    tokio::join!(fill_latest(&mut claude, "claude"), fill_latest(&mut codex, "codex"));
    tokio::join!(
        fill_paths(&mut claude, "claude"),
        fill_paths(&mut codex, "codex"),
        fill_paths(&mut agy, "agy"),
        fill_paths(&mut opencode, "opencode"),
    );
    vec![claude, codex, agy, opencode, git, swiftc]
}

// A lista de modelos do agy NÃO mora mais aqui. Havia dois leitores de
// `agy models` no app: este (que devolvia a LINHA INTEIRA como slug) e o de
// `model_list.rs` (que faz `split_once('\t')`). O `agy models` virou TSV
// `slug<TAB>Rótulo`, e o leitor que ninguém olhava apodreceu: o seletor passou
// a gravar `"gemini-3.7-flash-high\tGemini 3.7 Flash (High)"` como slug e todo
// envio morria em "model … is not recognized as a known model". Fonte única
// agora: `model_list::model_list("agy")` (mesmo dialeto, mesma sonda, fixture
// da saída real). Não recrie um segundo parser aqui.

#[cfg(test)]
mod tests {
    use super::*;

    /// Saída REAL do `opencode providers list` (1.17.9) desta máquina, com os
    /// códigos ANSI que ele emite mesmo sem TTY. Fixture copiada, não inventada.
    const PROVIDERS_REAL: &str = "\u{1b}[0m\n\u{250c}  Credentials \u{1b}[90m~/.local/share/opencode/auth.json\n\u{2502}\n\u{25cf}  OpenAI \u{1b}[90moauth\n\u{2502}\n\u{25cf}  Google \u{1b}[90moauth\n\u{2502}\n\u{25cf}  OpenCode Go \u{1b}[90mapi\n\u{2502}\n\u{2514}  3 credentials\n";

    #[test]
    fn le_as_credenciais_da_saida_real() {
        let creds = crate::opencode_auth::parse_credentials(PROVIDERS_REAL);
        assert_eq!(creds.iter().map(|c| c.provider.as_str()).collect::<Vec<_>>(), vec!["OpenAI", "Google", "OpenCode Go"]);
    }

    #[test]
    fn sem_credencial_nenhuma_devolve_vazio() {
        // Instalado e sem provedor é um estado real: o motor existe e não serve
        // pra nada. Vazio aqui vira `auth: missing`, nunca `ok`.
        let vazio = "\u{250c}  Credentials ~/.local/share/opencode/auth.json\n\u{2514}  0 credentials\n";
        assert!(crate::opencode_auth::parse_credentials(vazio).is_empty());
    }

    #[test]
    fn ignora_o_rodape_e_o_cabecalho() {
        // O rodapé "3 credentials" tem número e palavra e casaria num parser
        // frouxo; ele NÃO começa com o marcador.
        let creds = crate::opencode_auth::parse_credentials(PROVIDERS_REAL);
        assert!(!creds.iter().any(|c| c.provider.contains("credential")));
        assert!(!creds.iter().any(|c| c.provider.contains("Credentials")));
    }

    #[test]
    fn opencode_tem_binario_conhecido() {
        // Sem isto, `detected_version("opencode")` devolveria None e qualquer
        // gate por versão trataria o motor como ausente.
        assert_eq!(agent_bin("opencode"), Some("opencode"));
    }

    // ---- última por canal: parses com fixtures REAIS das APIs ----------------

    #[test]
    fn parse_npm_registry_latest() {
        // registry.npmjs.org/@anthropic-ai/claude-code/latest (recortado).
        let fixture = serde_json::json!({
            "name": "@anthropic-ai/claude-code",
            "version": "2.1.220",
            "description": "Use Claude, Anthropic's AI assistant, right from your terminal.",
            "bin": { "claude": "cli.js" }
        });
        assert_eq!(parse_npm_version(&fixture), Some("2.1.220".to_string()));
        assert_eq!(parse_npm_version(&serde_json::json!({})), None);
        assert_eq!(parse_npm_version(&serde_json::json!({ "version": "" })), None);
    }

    #[test]
    fn parse_cask_do_brew() {
        // formulae.brew.sh/api/cask/claude-code.json (recortado): o tap do
        // cask topava em 2.1.212 enquanto o npm já tinha 2.1.220 — a raiz do
        // botão "Atualizar" eterno.
        let fixture = serde_json::json!({
            "token": "claude-code",
            "full_token": "claude-code",
            "tap": "homebrew/cask",
            "name": ["Claude Code"],
            "version": "2.1.212",
            "url": "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.212/darwin-arm64/claude-2.1.212.tar.gz"
        });
        assert_eq!(parse_cask_version(&fixture), Some("2.1.212".to_string()));
        // cask com build depois da vírgula → fica só a versão.
        let with_build = serde_json::json!({ "version": "1.2.3,45678" });
        assert_eq!(parse_cask_version(&with_build), Some("1.2.3".to_string()));
        assert_eq!(parse_cask_version(&serde_json::json!({})), None);
    }

    #[test]
    fn parse_formula_do_brew() {
        // formulae.brew.sh/api/formula/<nome>.json (recortado).
        let fixture = serde_json::json!({
            "name": "codex",
            "full_name": "codex",
            "versions": { "stable": "0.146.0", "head": "HEAD", "bottle": true }
        });
        assert_eq!(parse_formula_stable(&fixture), Some("0.146.0".to_string()));
        assert_eq!(parse_formula_stable(&serde_json::json!({})), None);
        assert_eq!(
            parse_formula_stable(&serde_json::json!({ "versions": {} })),
            None
        );
    }

    #[test]
    fn decisao_de_canal_pelo_metodo_do_binario() {
        use crate::update::Method;
        // binário do brew → latest do brew, npm vira o canal informativo.
        assert_eq!(channels_for(&Method::Homebrew), ("homebrew", Some("npm")));
        // binário do npm → latest do npm, brew vira o informativo.
        assert_eq!(channels_for(&Method::Npm), ("npm", Some("homebrew")));
        // nativo/desconhecido: npm best-effort, sem promessa de outro canal.
        assert_eq!(channels_for(&Method::Native), ("npm", None));
        assert_eq!(channels_for(&Method::Unknown), ("npm", None));
    }

    #[test]
    fn fontes_por_agent() {
        assert_eq!(
            channel_sources("claude-code"),
            Some(("@anthropic-ai/claude-code", "claude-code"))
        );
        assert_eq!(channel_sources("codex"), Some(("@openai/codex", "codex")));
        // agy: sem canal conhecido → sem latest (honesto).
        assert_eq!(channel_sources("agy"), None);
    }

    #[test]
    fn binario_canonico_por_agent_do_registry() {
        // a tabela que `detected_version` usa pra perguntar a versão: os
        // agents do registry têm binário, o resto não tem (e o gate que
        // depende dela recusa em vez de chutar).
        assert_eq!(agent_bin("claude-code"), Some("claude"));
        assert_eq!(agent_bin("codex"), Some("codex"));
        assert_eq!(agent_bin("agy"), Some("agy"));
        assert_eq!(agent_bin("motor-inventado"), None);
    }

    #[tokio::test]
    async fn versao_detectada_de_agent_sem_binario_conhecido_e_desconhecida() {
        // sem entrada na tabela não há o que perguntar: None (o chamador
        // fail-closed com mensagem honesta, nunca um palpite).
        assert_eq!(detected_version("motor-inventado").await, None);
    }

}
