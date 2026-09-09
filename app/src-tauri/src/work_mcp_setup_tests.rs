use super::*;

#[test]
fn reativacao_preserva_a_entrada_em_vez_de_tentar_instalar_sobre_ela() {
    assert_eq!(
        crate::mcp_instalacao::enable_argv("agy", "mc-work").unwrap(),
        ["agy", "mcp", "enable", "mc-work"]
    );
    assert!(crate::mcp_instalacao::enable_argv("desconhecido", "mc-work").is_none());
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
