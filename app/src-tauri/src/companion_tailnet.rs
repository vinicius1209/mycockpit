//! Companion: o endereço seguro pela Tailscale (R2 do `docs/companion-chat-prd.md`).
//!
//! A Frota não instala, não liga e não configura a Tailscale: só LÊ o estado
//! (`tailscale status --json` e `tailscale serve status --json`) para dizer em
//! Configurações o que falta e, quando está tudo pronto, pôr no QR o endereço
//! `https://<mac>.<tailnet>.ts.net`. Comando que muda a rede da pessoa
//! (`tailscale serve`) é mostrado para ela rodar, nunca executado daqui.
//!
//! Interpretação PURA (testada com saída real em `testdata/tailscale-1.102.4/`);
//! a sonda roda os dois comandos com prazo e guarda o resultado por alguns
//! segundos, porque Configurações pergunta a cada 3 s.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// O que a pessoa roda no Terminal para expor o Companion na tailnet.
pub const COMANDO_SERVE: &str = "tailscale serve --bg 14200";
const PRAZO: Duration = Duration::from_secs(3);
const VALIDADE: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EstadoTailnet {
    /// Binário não encontrado ou sem resposta.
    Ausente,
    /// Instalada, mas desconectada (`BackendState` diferente de `Running`).
    Desligada,
    /// Conectada, sem certificado HTTPS habilitado no painel.
    SemHttps,
    /// HTTPS pronto, mas nenhum `serve` levando ao Companion.
    SemServe,
    /// `https://<nome>.ts.net` chega ao Companion.
    Pronta,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tailnet {
    pub estado: EstadoTailnet,
    /// Nome da máquina na tailnet, sem o ponto final (`mac.tailXXXX.ts.net`).
    pub nome: Option<String>,
    /// Endereço para o QR, só quando `Pronta`.
    pub url: Option<String>,
    pub comando: &'static str,
}

impl Tailnet {
    fn com(estado: EstadoTailnet, nome: Option<String>) -> Self {
        let url = (estado == EstadoTailnet::Pronta)
            .then(|| nome.as_ref().map(|n| format!("https://{n}")))
            .flatten();
        Tailnet { estado, nome, url, comando: COMANDO_SERVE }
    }
}

/// Lê as duas saídas e decide o estado. `status` ausente = Tailscale ausente.
/// `serve` que não é JSON (a CLI responde "No serve config") = sem serve.
pub fn interpretar(status: Option<&str>, serve: Option<&str>, porta: u16) -> Tailnet {
    let Some(status) = status.and_then(|s| serde_json::from_str::<Value>(s).ok()) else {
        return Tailnet::com(EstadoTailnet::Ausente, None);
    };
    let nome = status
        .pointer("/Self/DNSName")
        .and_then(Value::as_str)
        .map(|n| n.trim_end_matches('.').to_ascii_lowercase())
        .filter(|n| !n.is_empty());
    if status.get("BackendState").and_then(Value::as_str) != Some("Running") {
        return Tailnet::com(EstadoTailnet::Desligada, nome);
    }
    let Some(nome) = nome else {
        return Tailnet::com(EstadoTailnet::Desligada, None);
    };
    let tem_certificado = status
        .get("CertDomains")
        .and_then(Value::as_array)
        .is_some_and(|d| d.iter().filter_map(Value::as_str).any(|d| d.eq_ignore_ascii_case(&nome)));
    if !tem_certificado {
        return Tailnet::com(EstadoTailnet::SemHttps, Some(nome));
    }
    let serve_ok = serve
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .is_some_and(|v| serve_leva_a_porta(&v, &nome, porta));
    let estado = if serve_ok { EstadoTailnet::Pronta } else { EstadoTailnet::SemServe };
    Tailnet::com(estado, Some(nome))
}

/// Algum handler HTTPS em `<nome>:443` faz proxy para a porta do Companion na
/// loopback.
fn serve_leva_a_porta(serve: &Value, nome: &str, porta: u16) -> bool {
    let Some(web) = serve.get("Web").and_then(Value::as_object) else {
        return false;
    };
    let alvos = [
        format!("http://127.0.0.1:{porta}"),
        format!("http://localhost:{porta}"),
    ];
    web.iter()
        .filter(|(host, _)| host.to_ascii_lowercase() == format!("{nome}:443"))
        .filter_map(|(_, cfg)| cfg.get("Handlers").and_then(Value::as_object))
        .flat_map(|h| h.values())
        .filter_map(|h| h.get("Proxy").and_then(Value::as_str))
        .any(|proxy| alvos.iter().any(|a| proxy.trim_end_matches('/') == a))
}

/// Onde procurar a CLI. O app aberto pelo Finder não herda o PATH do Terminal,
/// então os caminhos conhecidos vêm antes do PATH.
fn candidatos() -> Vec<std::path::PathBuf> {
    let mut v: Vec<std::path::PathBuf> = [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/usr/bin/tailscale",
        "/usr/sbin/tailscale",
    ]
    .iter()
    .map(std::path::PathBuf::from)
    .collect();
    if let Some(path) = std::env::var_os("PATH") {
        v.extend(std::env::split_paths(&path).map(|d| d.join("tailscale")));
    }
    v
}

async fn rodar(bin: &std::path::Path, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args).kill_on_drop(true).stdin(std::process::Stdio::null());
    let out = tokio::time::timeout(PRAZO, cmd.output()).await.ok()?.ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

static CACHE: Mutex<Option<(Instant, Tailnet)>> = Mutex::new(None);

/// Estado atual da Tailscale para o Companion. Nunca falha: sem CLI ou sem
/// resposta vira `Ausente`, que Configurações explica em uma frase.
pub async fn sondar(porta: u16) -> Tailnet {
    if let Ok(g) = CACHE.lock() {
        if let Some((em, t)) = g.as_ref() {
            if em.elapsed() < VALIDADE {
                return t.clone();
            }
        }
    }
    let bin = candidatos().into_iter().find(|c| c.is_file());
    let resultado = match bin {
        None => Tailnet::com(EstadoTailnet::Ausente, None),
        Some(bin) => {
            let status = rodar(&bin, &["status", "--json"]).await;
            let serve = rodar(&bin, &["serve", "status", "--json"]).await;
            interpretar(status.as_deref(), serve.as_deref(), porta)
        }
    };
    if let Ok(mut g) = CACHE.lock() {
        *g = Some((Instant::now(), resultado.clone()));
    }
    resultado
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &str = include_str!("../testdata/tailscale-1.102.4/status-https-ligado.json");
    const SEM_HTTPS: &str = include_str!("../testdata/tailscale-1.102.4/status-sem-https.json");
    const SERVE: &str = include_str!("../testdata/tailscale-1.102.4/serve-status-proxy-14200.json");
    const NOME: &str = "macbook-pro-de-vinicius.taild44f89.ts.net";

    #[test]
    fn tudo_pronto_da_o_endereco_https_do_mac() {
        let t = interpretar(Some(STATUS), Some(SERVE), 14200);
        assert_eq!(t.estado, EstadoTailnet::Pronta);
        assert_eq!(t.nome.as_deref(), Some(NOME));
        assert_eq!(t.url.as_deref(), Some("https://macbook-pro-de-vinicius.taild44f89.ts.net"));
    }

    #[test]
    fn sem_https_no_painel_nao_oferece_endereco() {
        let t = interpretar(Some(SEM_HTTPS), Some(SERVE), 14200);
        assert_eq!(t.estado, EstadoTailnet::SemHttps);
        assert_eq!(t.url, None);
        let nulo = SEM_HTTPS.replacen("\"BackendState\"", "\"CertDomains\": null,\n  \"BackendState\"", 1);
        assert_eq!(interpretar(Some(&nulo), Some(SERVE), 14200).estado, EstadoTailnet::SemHttps);
    }

    #[test]
    fn sem_serve_mostra_o_comando_e_nao_o_endereco() {
        // A CLI sem configuração responde texto, não JSON.
        let t = interpretar(Some(STATUS), Some("No serve config\n"), 14200);
        assert_eq!(t.estado, EstadoTailnet::SemServe);
        assert_eq!(t.url, None);
        assert_eq!(t.comando, "tailscale serve --bg 14200");
        // serve apontando para outra porta não conta
        assert_eq!(interpretar(Some(STATUS), Some(&SERVE.replace("14200", "3000")), 14200).estado, EstadoTailnet::SemServe);
    }

    /// Contra a Tailscale real da máquina. `cargo test --lib -- --ignored
    /// sonda_real`: imprime o estado (não afirma, cada máquina é uma).
    #[tokio::test]
    #[ignore]
    async fn sonda_real_da_tailscale() {
        let t = sondar(14200).await;
        println!("tailnet real: {t:?}");
    }

    #[test]
    fn desligada_ou_ausente_nao_inventam_nome() {
        let parada = STATUS.replace("\"Running\"", "\"Stopped\"");
        assert_eq!(interpretar(Some(&parada), Some(SERVE), 14200).estado, EstadoTailnet::Desligada);
        let ausente = interpretar(None, None, 14200);
        assert_eq!(ausente.estado, EstadoTailnet::Ausente);
        assert_eq!(ausente.nome, None);
        assert_eq!(interpretar(Some("erro: daemon"), None, 14200).estado, EstadoTailnet::Ausente);
    }
}
