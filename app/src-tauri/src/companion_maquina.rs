//! Companion: o nome deste Mac no celular (R5 do `docs/companion-chat-prd.md`).
//!
//! Cada Mac é um servidor próprio, com a sua origem (`https://<mac>.ts.net`), e
//! o celular instala um atalho por Mac. Sem o nome, os dois atalhos se chamam
//! "FROTA" e a tela não diz em qual máquina você está aprovando. Quem sabe o
//! nome é o servidor, então ele entra na página e no manifest na hora de
//! servir; o snapshot segue opaco (o front define o shape).

use std::process::Command;
use std::sync::OnceLock;

/// Nome longo acima disto vira reticências: cabe no cabeçalho do celular.
const TETO_DO_NOME: usize = 40;

/// Marcadores do `index.html` que o servidor troca pelo nome.
const MARCA_META: &str = "<meta name=\"frota-maquina\" content=\"\">";
const MARCA_TITULO: &str = "<title>FROTA · Companion</title>";
const MARCA_APPLE: &str = "<meta name=\"apple-mobile-web-app-title\" content=\"FROTA\">";

/// Nome amigável da máquina, lido uma vez. Renomear o Mac pede reiniciar a
/// Frota; não vale uma sonda por requisição.
pub fn nome() -> Option<&'static str> {
    static NOME: OnceLock<Option<String>> = OnceLock::new();
    NOME.get_or_init(|| ler_do_sistema().and_then(|bruto| limpar(&bruto)))
        .as_deref()
}

fn ler_do_sistema() -> Option<String> {
    #[cfg(target_os = "macos")]
    if let Some(n) = saida("/usr/sbin/scutil", &["--get", "ComputerName"]) {
        return Some(n);
    }
    #[cfg(target_os = "linux")]
    if let Some(n) = saida("hostnamectl", &["--pretty"]) {
        return Some(n);
    }
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| saida("/bin/hostname", &[]))
}

fn saida(programa: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(programa).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let texto = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!texto.is_empty()).then_some(texto)
}

/// Tira caractere de controle, junta espaços e corta nomes longos.
pub fn limpar(bruto: &str) -> Option<String> {
    let junto = bruto
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if junto.is_empty() {
        return None;
    }
    Some(cortar(&junto, TETO_DO_NOME))
}

fn cortar(texto: &str, teto: usize) -> String {
    if texto.chars().count() <= teto {
        return texto.to_string();
    }
    let corpo: String = texto.chars().take(teto - 1).collect();
    format!("{}…", corpo.trim_end())
}

fn escapar_html(texto: &str) -> String {
    texto
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Página com o nome no `<meta>` que o JS lê, no título da aba e no nome que o
/// iOS dá ao atalho. Sem nome, a página sai como está.
pub fn pagina_com_maquina(pagina: &str, nome: Option<&str>) -> String {
    let Some(nome) = nome else {
        return pagina.to_string();
    };
    let n = escapar_html(nome);
    pagina
        .replacen(MARCA_META, &format!("<meta name=\"frota-maquina\" content=\"{n}\">"), 1)
        .replacen(MARCA_TITULO, &format!("<title>{n} · FROTA</title>"), 1)
        .replacen(
            MARCA_APPLE,
            &format!("<meta name=\"apple-mobile-web-app-title\" content=\"{n}\">"),
            1,
        )
}

/// Manifest com o nome da máquina: é o que diferencia os dois atalhos na tela
/// inicial. O `short_name` leva o nome inteiro de propósito: cortar em 12
/// letras transformava "MacBook Pro de Vinicius" e "MacBook Pro da empresa" no
/// mesmo "MacBook Pro…"; quem corta o que não cabe é o launcher. JSON montado
/// pelo serde, então o nome nunca quebra o arquivo.
pub fn manifesto_com_maquina(manifesto: &str, nome: Option<&str>) -> String {
    let (Some(nome), Ok(mut m)) = (nome, serde_json::from_str::<serde_json::Value>(manifesto))
    else {
        return manifesto.to_string();
    };
    m["name"] = format!("FROTA Companion · {nome}").into();
    m["short_name"] = nome.into();
    serde_json::to_string_pretty(&m).unwrap_or_else(|_| manifesto.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGINA: &str = include_str!("../companion/index.html");
    const MANIFESTO: &str = include_str!("../companion/manifest.webmanifest");

    #[test]
    fn nome_sai_limpo_e_cortado() {
        assert_eq!(limpar("  MacBook Pro de Vinicius\n").as_deref(), Some("MacBook Pro de Vinicius"));
        assert_eq!(limpar("Mac\tda\u{7}  empresa").as_deref(), Some("Mac da empresa"));
        assert_eq!(limpar(" \n\t"), None);
        let longo = limpar(&"a".repeat(80)).unwrap();
        assert_eq!(longo.chars().count(), TETO_DO_NOME);
        assert!(longo.ends_with('…'));
        // corte por caractere, nunca no meio de um byte UTF-8
        assert_eq!(cortar("Máquina çãõ é longa", 8), "Máquina…");
    }

    #[test]
    fn os_marcadores_existem_na_pagina_de_verdade() {
        // se alguém mexer no <head>, o nome some em silêncio: este teste avisa
        for marca in [MARCA_META, MARCA_TITULO, MARCA_APPLE] {
            assert_eq!(PAGINA.matches(marca).count(), 1, "marcador ausente ou repetido: {marca}");
        }
    }

    #[test]
    fn pagina_leva_o_nome_escapado() {
        let p = pagina_com_maquina(PAGINA, Some("Mac <b>\"da\" & empresa"));
        assert!(p.contains(
            "<meta name=\"frota-maquina\" content=\"Mac &lt;b&gt;&quot;da&quot; &amp; empresa\">"
        ));
        assert!(p.contains("<title>Mac &lt;b&gt;&quot;da&quot; &amp; empresa · FROTA</title>"));
        assert!(p.contains(
            "<meta name=\"apple-mobile-web-app-title\" content=\"Mac &lt;b&gt;&quot;da&quot; &amp; empresa\">"
        ));
        assert!(!p.contains("<b>\"da\""));
        assert_eq!(pagina_com_maquina(PAGINA, None), PAGINA);
    }

    #[test]
    fn manifesto_diferencia_os_atalhos_e_continua_json() {
        let m: serde_json::Value =
            serde_json::from_str(&manifesto_com_maquina(MANIFESTO, Some("Mac \"da\" empresa"))).unwrap();
        assert_eq!(m["name"], "FROTA Companion · Mac \"da\" empresa");
        assert_eq!(m["short_name"], "Mac \"da\" empresa");
        assert_eq!(m["start_url"], "/");
        assert_eq!(m["icons"].as_array().unwrap().len(), 3);
        assert_eq!(manifesto_com_maquina(MANIFESTO, None), MANIFESTO);
    }
}
