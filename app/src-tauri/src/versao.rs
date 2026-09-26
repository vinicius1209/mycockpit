//! Qual Frota está aberto (ADR-264): o canal, o número do build, o commit e
//! quando foi feito. A faixa dizia só "local · v0.1.0-t442".
//!
//! O número, o commit, se havia mudança local e a data são carimbados no
//! binário pelo `scripts/build.sh` (variáveis `FROTA_BUILD_*`, lidas por
//! `option_env!` na compilação). O canal vem de ONDE o app roda: o mesmo
//! binário de teste, promovido para `/Applications`, passa a ser o oficial.

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InfoDoBuild {
    /// "oficial", "teste", "dev" ou "local" (build solto, fora das pastas
    /// conhecidas).
    pub canal: &'static str,
    pub numero: Option<u32>,
    pub commit: Option<&'static str>,
    pub mudancas_locais: bool,
    /// Carimbo local do `build.sh` ("2026-09-26T14:32:10").
    pub feito_em: Option<&'static str>,
    /// De onde o app roda, a partir de `builds/` ou da `/Applications`.
    pub pasta: Option<String>,
}

/// O canal pelo caminho do executável. PURO.
pub fn canal_de(exe: &str, debug: bool) -> &'static str {
    if debug {
        "dev"
    } else if exe.contains("/builds/test/") {
        "teste"
    } else if exe.starts_with("/Applications/") {
        "oficial"
    } else {
        "local"
    }
}

/// A pasta que identifica o build, sem o caminho da máquina: "builds/test/442-
/// b982da6" ou "/Applications". PURO.
pub fn pasta_de(exe: &str) -> Option<String> {
    let bundle = exe.find(".app/").map(|i| &exe[..i])?;
    let pai = bundle.rsplit_once('/').map(|(p, _)| p)?;
    if let Some(i) = pai.find("/builds/") {
        return Some(pai[i + 1..].to_string());
    }
    Some(pai.to_string()).filter(|p| !p.is_empty())
}

#[tauri::command]
pub fn build_info() -> InfoDoBuild {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    InfoDoBuild {
        canal: canal_de(&exe, cfg!(debug_assertions)),
        numero: option_env!("FROTA_BUILD_NUM").and_then(|n| n.trim().parse().ok()),
        commit: option_env!("FROTA_BUILD_SHA").filter(|s| !s.is_empty()),
        mudancas_locais: option_env!("FROTA_BUILD_DIRTY") == Some("1"),
        feito_em: option_env!("FROTA_BUILD_DATE").filter(|s| !s.is_empty()),
        pasta: pasta_de(&exe),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TESTE: &str = "/Users/u/projetos/frota/builds/test/442-b982da6/Frota.app/Contents/MacOS/app";
    const OFICIAL: &str = "/Applications/Frota.app/Contents/MacOS/app";

    #[test]
    fn o_canal_vem_de_onde_o_app_roda() {
        assert_eq!(canal_de(TESTE, false), "teste");
        assert_eq!(canal_de(OFICIAL, false), "oficial");
        assert_eq!(canal_de("/tmp/Frota.app/Contents/MacOS/app", false), "local");
        assert_eq!(canal_de(OFICIAL, true), "dev");
    }

    #[test]
    fn a_pasta_do_build_sem_o_caminho_da_maquina() {
        assert_eq!(pasta_de(TESTE).as_deref(), Some("builds/test/442-b982da6"));
        assert_eq!(pasta_de(OFICIAL).as_deref(), Some("/Applications"));
        assert_eq!(pasta_de("/usr/bin/app"), None);
    }
}
