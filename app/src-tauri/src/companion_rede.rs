//! Companion: quem pode chegar ao servidor e com que endereço (R1 do
//! `docs/companion-chat-prd.md`). Regras PURAS, testadas sem servidor; o
//! `companion.rs` só as aplica nos middlewares.
//!
//! Por que existe: o servidor escuta em `0.0.0.0:14200` com HTTP puro. Num
//! Wi-Fi compartilhado, qualquer um na rede alcança a porta, e o que está em
//! jogo é aprovar ferramenta no Mac. Estas regras não cifram nada (isso é o
//! `tailscale serve`), mas fecham o que dá para fechar sem instalar nada:
//! origem fora de rede privada, `Host` de fora (DNS rebinding), aparelho
//! esquecido e o arquivo de credenciais com permissão aberta.

use std::io::Write;
use std::net::IpAddr;
use std::path::Path;

/// Aparelho sem uso por este prazo sai do conjunto de credenciais.
pub const APARELHO_EXPIRA_EM_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// Origem aceita: loopback, redes privadas (RFC 1918), CGNAT do Tailscale
/// (100.64.0.0/10), link-local e IPv6 local único (fc00::/7, onde mora o
/// `fd7a:115c:a1e0::/48` do Tailscale). IPv4 mapeado em IPv6 é julgado como v4.
pub fn origem_permitida(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || (o[0] == 100 && (64..=127).contains(&o[1]))
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return origem_permitida(IpAddr::V4(v4));
            }
            let s = v6.segments();
            v6.is_loopback() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80
        }
    }
}

/// `Host` aceito: `localhost`, IP literal de rede privada (mesma régua da
/// origem), nome da tailnet (`*.ts.net`, que é o que `tailscale serve`
/// entrega) ou nome mDNS (`*.local`, que só resolve dentro da rede local).
/// Qualquer outro nome é DNS rebinding em potencial. Porta é ignorada; IPv6
/// vem entre colchetes.
pub fn host_permitido(host: &str) -> bool {
    let host = host.trim();
    if host.is_empty() || !host.bytes().all(|b| b.is_ascii_graphic()) {
        return false;
    }
    let nome = if let Some(resto) = host.strip_prefix('[') {
        match resto.split_once(']') {
            Some((ip, _)) => ip,
            None => return false,
        }
    } else {
        host.rsplit_once(':').map_or(host, |(nome, porta)| {
            if porta.bytes().all(|b| b.is_ascii_digit()) {
                nome
            } else {
                host
            }
        })
    };
    let nome = nome.trim_end_matches('.').to_ascii_lowercase();
    if nome == "localhost" {
        return true;
    }
    if let Ok(ip) = nome.parse::<IpAddr>() {
        return origem_permitida(ip);
    }
    (nome.ends_with(".ts.net") || nome.ends_with(".local"))
        && nome
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

/// Aparelho vencido: nenhuma requisição autenticada há mais que o prazo,
/// contando do pareamento quando nunca foi visto.
pub fn aparelho_expirado(pareado_em: u64, visto_em: Option<u64>, agora: u64) -> bool {
    let ultimo = visto_em.unwrap_or(pareado_em).max(pareado_em);
    agora.saturating_sub(ultimo) > APARELHO_EXPIRA_EM_MS
}

/// Quando o aparelho expira, para a tela de Configurações.
pub fn expira_em(pareado_em: u64, visto_em: Option<u64>) -> u64 {
    visto_em.unwrap_or(pareado_em).max(pareado_em) + APARELHO_EXPIRA_EM_MS
}

/// Chave do rate-limit. Por IP, exceto na loopback: atrás de `tailscale serve`
/// todo aparelho chega de 127.0.0.1 e viraria um balde só. Lá a chave inclui o
/// começo do token apresentado (64 hex; força bruta não é viável por aqui, e o
/// token inteiro nunca vira chave nem log).
pub fn chave_do_limite(ip: IpAddr, token: Option<&str>) -> String {
    if ip.is_loopback() {
        let prefixo: String = token.unwrap_or("").chars().take(12).collect();
        return format!("loopback:{prefixo}");
    }
    ip.to_string()
}

/// CSP da página com o WebSocket preso ao host da própria requisição. Alguns
/// navegadores de celular não casam WebSocket com `'self'`, por isso o `ws:`
/// explícito; mas `ws: wss:` genérico deixava abrir WebSocket para qualquer
/// host. Host inválido ou ausente fica só com `'self'`.
pub fn csp_da_pagina(base: &str, host: Option<&str>) -> String {
    match host.filter(|h| host_permitido(h)) {
        Some(h) => base.replace(
            "connect-src 'self';",
            &format!("connect-src 'self' ws://{h} wss://{h};"),
        ),
        None => base.to_string(),
    }
}

/// Escreve o arquivo de credenciais já nascendo 0600 (sem a janela em que
/// `fs::write` cria com a umask e só depois o `chmod` fecha). Se o arquivo já
/// existia com outra permissão, ela é corrigida também.
pub fn escrever_privado(path: &Path, conteudo: &[u8]) -> std::io::Result<()> {
    let mut opcoes = std::fs::OpenOptions::new();
    opcoes.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opcoes.mode(0o600);
    }
    let mut arquivo = opcoes.open(path)?;
    arquivo.write_all(conteudo)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn origem_de_rede_privada_passa_e_publica_nao() {
        for ok in [
            "127.0.0.1", "10.0.0.8", "172.16.4.2", "172.31.255.1", "192.168.0.42",
            "100.64.0.1", "100.101.102.103", "100.127.255.254", "169.254.10.1",
            "::1", "fd7a:115c:a1e0::1", "fe80::1", "::ffff:192.168.0.42",
        ] {
            assert!(origem_permitida(ip(ok)), "{ok} deveria passar");
        }
        for nao in [
            "8.8.8.8", "172.32.0.1", "100.63.255.255", "100.128.0.1", "203.0.113.9",
            "2001:4860:4860::8888", "::ffff:8.8.8.8",
        ] {
            assert!(!origem_permitida(ip(nao)), "{nao} deveria ser recusado");
        }
    }

    #[test]
    fn host_de_lan_localhost_e_tailnet_passam() {
        for ok in [
            "192.168.0.42:14200", "192.168.0.42", "localhost:14200", "127.0.0.1:14200",
            "100.101.102.103:14200", "[fd7a:115c:a1e0::1]:14200", "mac-do-vinicius.tail1234.ts.net",
            "MAC.TAIL1234.TS.NET.", "mac-do-vinicius.local:14200",
        ] {
            assert!(host_permitido(ok), "{ok} deveria passar");
        }
    }

    #[test]
    fn host_de_fora_e_rebinding_sao_recusados() {
        for nao in [
            "", "evil.example", "evil.example:14200", "8.8.8.8:14200", "ts.net",
            "evil.com#.ts.net", "192.168.0.42.evil.example", "[2001:4860::1]:80",
            "[fd7a::1", "a b.ts.net", "local", "evil.example.local.evil.com",
        ] {
            assert!(!host_permitido(nao), "{nao} deveria ser recusado");
        }
    }

    #[test]
    fn aparelho_expira_trinta_dias_depois_do_ultimo_uso() {
        let dia = 24 * 60 * 60 * 1000;
        let pareado = 1_000 * dia;
        assert!(!aparelho_expirado(pareado, None, pareado + 29 * dia));
        assert!(aparelho_expirado(pareado, None, pareado + 31 * dia));
        assert!(!aparelho_expirado(pareado, Some(pareado + 20 * dia), pareado + 45 * dia));
        assert!(aparelho_expirado(pareado, Some(pareado + 20 * dia), pareado + 51 * dia));
        // relógio que andou para trás não vence ninguém
        assert!(!aparelho_expirado(pareado, Some(pareado), pareado - dia));
        assert_eq!(expira_em(pareado, Some(pareado + dia)), pareado + 31 * dia);
    }

    #[test]
    fn limite_separa_aparelhos_atras_da_loopback() {
        let a = chave_do_limite(ip("127.0.0.1"), Some("aaaaaaaaaaaa1111"));
        let b = chave_do_limite(ip("127.0.0.1"), Some("bbbbbbbbbbbb2222"));
        assert_ne!(a, b);
        assert_eq!(chave_do_limite(ip("192.168.0.42"), Some("aaaa")), "192.168.0.42");
        assert!(!a.contains("1111"), "o token inteiro nunca vira chave");
    }

    #[test]
    fn csp_prende_o_websocket_ao_host_da_requisicao() {
        let base = "default-src 'none'; connect-src 'self'; worker-src 'self'";
        let csp = csp_da_pagina(base, Some("mac.tail1234.ts.net"));
        assert!(csp.contains("connect-src 'self' ws://mac.tail1234.ts.net wss://mac.tail1234.ts.net;"));
        assert!(!csp.contains("ws: "));
        assert_eq!(csp_da_pagina(base, Some("evil.example")), base);
        assert_eq!(csp_da_pagina(base, None), base);
    }

    #[cfg(unix)]
    #[test]
    fn arquivo_de_credenciais_nasce_0600_e_corrige_permissao_antiga() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("frota-companion-rede-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let novo = dir.join("novo.json");
        escrever_privado(&novo, b"[]").unwrap();
        assert_eq!(std::fs::metadata(&novo).unwrap().permissions().mode() & 0o777, 0o600);
        let antigo = dir.join("antigo.json");
        std::fs::write(&antigo, b"x").unwrap();
        std::fs::set_permissions(&antigo, std::fs::Permissions::from_mode(0o644)).unwrap();
        escrever_privado(&antigo, b"[]").unwrap();
        assert_eq!(std::fs::metadata(&antigo).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read(&antigo).unwrap(), b"[]");
        std::fs::remove_dir_all(&dir).ok();
    }
}
