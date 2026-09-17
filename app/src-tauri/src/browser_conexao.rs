//! Como um MCP de navegador se conecta ao Chromium do projeto (navegador PRD R5,
//! B4). A forma é propriedade do BINDING, nunca do nome do fornecedor:
//!
//! - `cdp-endpoint`: `--cdp-endpoint http://127.0.0.1:<porta>` (Playwright MCP;
//!   o caminho original, em `mcp_control::apply_cdp_endpoint`);
//! - `browser-url`: `--browserUrl http://127.0.0.1:<porta>`;
//! - `ws-endpoint`: `--wsEndpoint ws://…/devtools/browser/<id>`.
//!
//! As duas últimas são as do Chrome DevTools MCP 1.9.0 (flags conferidas no
//! `--help`, `testdata/chrome-devtools-mcp/`). O plano do run tira da
//! configuração de origem tudo que abriria OUTRO navegador.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConexaoDoNavegador {
    #[default]
    CdpEndpoint,
    BrowserUrl,
    WsEndpoint,
}

impl ConexaoDoNavegador {
    pub fn de_texto(valor: &str) -> Option<Self> {
        match valor {
            "cdp-endpoint" => Some(Self::CdpEndpoint),
            "browser-url" => Some(Self::BrowserUrl),
            "ws-endpoint" => Some(Self::WsEndpoint),
            _ => None,
        }
    }

    pub fn como_texto(self) -> &'static str {
        match self {
            Self::CdpEndpoint => "cdp-endpoint",
            Self::BrowserUrl => "browser-url",
            Self::WsEndpoint => "ws-endpoint",
        }
    }
}

/// Flags da configuração de origem que conectam ou abrem um navegador por conta
/// própria (`true` = consome o argumento seguinte). Nas duas grafias que o
/// yargs aceita, mais os atalhos de uma letra.
const CONFLITOS_DEVTOOLS: [(&str, bool); 18] = [
    ("--browserUrl", true),
    ("--browser-url", true),
    ("-u", true),
    ("--wsEndpoint", true),
    ("--ws-endpoint", true),
    ("-w", true),
    ("--wsHeaders", true),
    ("--ws-headers", true),
    ("--autoConnect", false),
    ("--auto-connect", false),
    ("--headless", false),
    ("--isolated", false),
    ("--executablePath", true),
    ("--executable-path", true),
    ("-e", true),
    ("--userDataDir", true),
    ("--user-data-dir", true),
    ("--channel", true),
];

/// Aplica `browser-url` ou `ws-endpoint` nos args do plano efêmero. Devolve os
/// avisos do que saiu da configuração de origem. `valor` é a URL http (para
/// `browser-url`) ou o WebSocket do browser (para `ws-endpoint`).
pub fn aplicar_conexao_devtools(
    args: &mut Vec<String>,
    conexao: ConexaoDoNavegador,
    valor: &str,
    display_name: &str,
) -> Vec<String> {
    let flag = match conexao {
        ConexaoDoNavegador::BrowserUrl => "--browserUrl",
        ConexaoDoNavegador::WsEndpoint => "--wsEndpoint",
        ConexaoDoNavegador::CdpEndpoint => unreachable!("cdp-endpoint usa apply_cdp_endpoint"),
    };
    let mut saiu: Vec<&str> = Vec::new();
    for (conflito, consome) in CONFLITOS_DEVTOOLS {
        if crate::mcp_control::strip_flag(args, conflito, consome) {
            saiu.push(conflito);
        }
    }
    args.push(flag.to_string());
    args.push(valor.to_string());
    if saiu.is_empty() {
        Vec::new()
    } else {
        vec![format!(
            "MCP {display_name}: {} da configuração de origem ficou fora deste run; o navegador do projeto manda via {flag}.",
            saiu.join(" e ")
        )]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELP_REAL: &str = include_str!("../testdata/chrome-devtools-mcp/help-conexao.txt");

    fn args(extra: &[&str]) -> Vec<String> {
        let mut v = vec!["-y".to_string(), "chrome-devtools-mcp@latest".to_string()];
        v.extend(extra.iter().map(|a| a.to_string()));
        v
    }

    #[test]
    fn as_flags_de_conexao_existem_no_help_real() {
        for flag in ["--browserUrl", "--wsEndpoint", "--autoConnect", "--headless", "--executablePath", "--isolated", "--userDataDir", "--channel"] {
            assert!(HELP_REAL.contains(flag), "flag {flag} sumiu do chrome-devtools-mcp 1.9.0");
        }
    }

    #[test]
    fn browser_url_gera_a_flag_com_o_endpoint_http() {
        let mut a = args(&[]);
        let avisos = aplicar_conexao_devtools(&mut a, ConexaoDoNavegador::BrowserUrl, "http://127.0.0.1:62934", "chrome-devtools");
        assert_eq!(a, args(&["--browserUrl", "http://127.0.0.1:62934"]));
        assert!(avisos.is_empty());
    }

    #[test]
    fn ws_endpoint_tira_o_que_abriria_outro_navegador_e_avisa() {
        let mut a = args(&["--headless", "--channel", "canary", "-u", "http://x:9222", "--userDataDir=/tmp/p", "--slim"]);
        let ws = "ws://127.0.0.1:62934/devtools/browser/f6645add-0357-4628-bdb6-06bd6c83bd65";
        let avisos = aplicar_conexao_devtools(&mut a, ConexaoDoNavegador::WsEndpoint, ws, "chrome-devtools");
        assert_eq!(a, args(&["--slim", "--wsEndpoint", ws]));
        assert_eq!(avisos.len(), 1);
        assert!(avisos[0].contains("--headless") && avisos[0].contains("--channel"));
    }

    #[test]
    fn texto_da_forma_ida_e_volta_e_desconhecido_recusa() {
        for c in [ConexaoDoNavegador::CdpEndpoint, ConexaoDoNavegador::BrowserUrl, ConexaoDoNavegador::WsEndpoint] {
            assert_eq!(ConexaoDoNavegador::de_texto(c.como_texto()), Some(c));
        }
        assert_eq!(ConexaoDoNavegador::de_texto("puppeteer"), None);
        assert_eq!(ConexaoDoNavegador::default(), ConexaoDoNavegador::CdpEndpoint);
    }
}
