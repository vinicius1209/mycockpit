use super::*;

#[test]
fn reativacao_preserva_a_entrada_em_vez_de_tentar_instalar_sobre_ela() {
    assert_eq!(
        crate::mcp_instalacao::enable_argv("agy", "frota-work").unwrap(),
        ["agy", "mcp", "enable", "frota-work"]
    );
    assert!(crate::mcp_instalacao::enable_argv("desconhecido", "frota-work").is_none());
}

#[test]
fn cadastro_so_e_reconhecido_quando_aponta_o_binario_e_subcomando_esperados() {
    let binary = Path::new("/Applications/Frota.app/Contents/MacOS/app");
    let mut entry = GlobalCliEntry {
        enabled: true,
        transport: "stdio".into(),
        command_line: format!("{} work-server", binary.display()),
    };
    assert_eq!(state_of(None, binary), SetupState::Absent);
    assert_eq!(state_of(Some(&entry), binary), SetupState::Configured);
    entry.enabled = false;
    assert_eq!(state_of(Some(&entry), binary), SetupState::Disabled);
    entry.command_line.push_str(" --outro-argumento");
    assert_eq!(state_of(Some(&entry), binary), SetupState::Conflict);
    entry.command_line = "npx outro-servidor".into();
    assert_eq!(state_of(Some(&entry), binary), SetupState::Conflict);
}

#[test]
fn caminho_com_espacos_preserva_identidade_e_nao_vira_match_parcial() {
    let binary = Path::new("/Aplicativos da pessoa/Frota.app/app");
    let entry = GlobalCliEntry {
        enabled: true,
        transport: "stdio".into(),
        command_line: format!("{} work-server", binary.display()),
    };
    assert_eq!(state_of(Some(&entry), binary), SetupState::Configured);
    assert_eq!(
        state_of(Some(&entry), Path::new("/Aplicativos")),
        SetupState::Conflict
    );
}

#[test]
fn transporte_e_versao_sao_precondicoes_explicitas() {
    let binary = Path::new("/app/frota");
    let entry = GlobalCliEntry {
        enabled: true,
        transport: "http".into(),
        command_line: "/app/frota work-server".into(),
    };
    assert_eq!(state_of(Some(&entry), binary), SetupState::Conflict);
    assert_eq!(
        crate::provider_mcp_inventory::global_work_min_version("agy"),
        Some("1.1.27")
    );
    assert_eq!(
        crate::provider_mcp_inventory::global_work_min_version("desconhecido"),
        None
    );
    assert!(!supports("desconhecido"));
}

/// ADR-224: o navegador tem a MESMA receita do trabalho, só muda o subcomando.
/// Entrada do work-server não conta como cadastro do navegador, e vice-versa.
#[test]
fn o_canal_do_navegador_e_reconhecido_pelo_proprio_subcomando() {
    let binary = Path::new("/Applications/Frota.app/Contents/MacOS/app");
    let navegador = GlobalCliEntry {
        enabled: true,
        transport: "stdio".into(),
        command_line: format!("{} browser-server", binary.display()),
    };
    assert_eq!(state_of_canal(Some(&navegador), binary, NAVEGADOR), SetupState::Configured);
    assert_eq!(state_of_canal(Some(&navegador), binary, TRABALHO), SetupState::Conflict);
    let trabalho = GlobalCliEntry {
        enabled: true,
        transport: "stdio".into(),
        command_line: format!("{} work-server", binary.display()),
    };
    assert_eq!(state_of_canal(Some(&trabalho), binary, NAVEGADOR), SetupState::Conflict);
    assert_eq!(NAVEGADOR.nome, "frota-browser");
    assert_ne!(chave("agy", TRABALHO), chave("agy", NAVEGADOR));
}

/// ADR-225: o desktop tem a MESMA receita do trabalho, só muda o subcomando.
#[test]
fn o_canal_do_desktop_e_reconhecido_pelo_proprio_subcomando() {
    let binary = Path::new("/Applications/Frota.app/Contents/MacOS/app");
    let desktop = GlobalCliEntry {
        enabled: true,
        transport: "stdio".into(),
        command_line: format!("{} desktop-server", binary.display()),
    };
    assert_eq!(state_of_canal(Some(&desktop), binary, DESKTOP), SetupState::Configured);
    assert_eq!(state_of_canal(Some(&desktop), binary, TRABALHO), SetupState::Conflict);
    assert_eq!(state_of_canal(Some(&desktop), binary, NAVEGADOR), SetupState::Conflict);
    assert_eq!(DESKTOP.nome, "frota-desktop");
    assert_ne!(chave("agy", TRABALHO), chave("agy", DESKTOP));
}


// ADR-268: o aviso do turno aponta para a página do motor, e diz o que falta
// para a pessoa, não o nome do MCP. Antes mandava para "Configurações > MCPs",
// onde o `frota-work` nem era linha (26/09/2026).
#[test]
fn aviso_do_acompanhamento_ausente_aponta_a_pagina_do_motor_e_diz_o_que_falta() {
    let aviso = aviso_do_acompanhamento(None);
    assert!(aviso.contains(ONDE_CONECTAR));
    assert!(aviso.contains("título automático"));
    assert!(!aviso.contains("> MCPs"));
    let ausente = WorkMcpSetup {
        agent: "agy".into(),
        state: SetupState::Absent,
        checked_at: now_ms(),
        detail: None,
    };
    assert_eq!(aviso_do_acompanhamento(Some(&ausente)), aviso);
}

#[test]
fn aviso_do_acompanhamento_conectado_diz_a_idade_da_verificacao() {
    let conectado = WorkMcpSetup {
        agent: "agy".into(),
        state: SetupState::Configured,
        checked_at: now_ms(),
        detail: None,
    };
    let aviso = aviso_do_acompanhamento(Some(&conectado));
    assert!(aviso.contains("verificado há 0s"));
    assert!(aviso.contains(ONDE_CONECTAR));
}

#[test]
fn canal_ausente_so_conta_o_que_a_pessoa_resolve_com_um_gesto() {
    // Motor de cadastro global, sem o gateway de trabalho: falta o canal.
    assert_eq!(canais_ausentes(true, false, false), vec![CANAL_TRABALHO.to_string()]);
    // Com o gateway de pé, nada falta.
    assert!(canais_ausentes(true, false, true).is_empty());
    // Só leitura nunca recebe o canal: não é ausência, é o modo.
    assert!(canais_ausentes(true, true, false).is_empty());
    // Motor que recebe por turno não tem cadastro para fazer.
    assert!(canais_ausentes(false, false, false).is_empty());
}
