use super::*;

fn ler_de<'a>(valores: &'a [(&'a str, Result<&'a str, &'a str>)]) -> impl Fn(&str) -> Result<String, String> + 'a {
    move |nome| {
        valores
            .iter()
            .find(|(n, _)| *n == nome)
            .map(|(_, r)| r.map(str::to_string).map_err(str::to_string))
            .unwrap_or_else(|| Err("o item não existe mais no Keychain".into()))
    }
}

#[test]
fn nome_de_variavel_de_verdade_e_fora_dos_reservados() {
    assert!(nome_valido("STRIPE_SECRET_KEY").is_ok());
    assert!(nome_valido("_TOKEN2").is_ok());
    for ruim in ["stripe_key", "2FA", "COM-HIFEN", "COM ESPACO", ""] {
        assert!(nome_valido(ruim).is_err(), "{ruim}");
    }
    assert!(nome_valido("PATH").unwrap_err().contains("do sistema"));
    assert!(nome_valido("FROTA_CONTEXT_DB").is_err());
}

#[test]
fn keychain_que_nao_entrega_vira_portao_com_continuar_sem() {
    let nomes = vec!["SUPABASE_URL".to_string(), "STRIPE_SECRET_KEY".to_string()];
    let (pares, falhas) = resolver(&nomes, &[], ler_de(&[("SUPABASE_URL", Ok("https://x.supabase.co")), ("STRIPE_SECRET_KEY", Err("o Keychain recusou: -25293"))]));
    assert_eq!(pares, vec![("SUPABASE_URL".to_string(), "https://x.supabase.co".to_string())]);
    assert_eq!(falhas.len(), 1);
    // O portão viaja no formato que o composer lê.
    let json = serde_json::to_value(portao(&falhas)).unwrap();
    assert_eq!(json["issues"][0]["code"], "secret-unavailable");
    assert_eq!(json["issues"][0]["sourceLabel"], "STRIPE_SECRET_KEY");
    assert_eq!(json["issues"][0]["detail"], "o Keychain recusou: -25293");
    assert_eq!(json["allowedRecoveries"][0]["kind"], "omit-for-this-run");
    assert_eq!(json["allowedRecoveries"][0]["sourceId"], FONTE_DOS_SEGREDOS);
    assert_eq!(json["allowedRecoveries"][1]["kind"], "open-mcp-settings");
}

#[test]
fn continuar_sem_vale_so_para_a_mesma_falha() {
    let nomes = vec!["A_KEY".to_string(), "B_KEY".to_string()];
    let falhando = [("A_KEY", Err("recusou")), ("B_KEY", Err("recusou"))];
    let (_, falhas) = resolver(&nomes, &[], ler_de(&falhando));
    let decisao = McpRunOverride {
        gate_fingerprint: portao(&falhas).fingerprint,
        source_id: FONTE_DOS_SEGREDOS.into(),
        kind: McpRecoveryKind::OmitForThisRun,
    };
    // Um clique libera os dois que falharam.
    let (pares, falhas) = resolver(&nomes, std::slice::from_ref(&decisao), ler_de(&falhando));
    assert!(pares.is_empty() && falhas.is_empty());
    // Se a falha mudou (agora só B), a decisão antiga não vale.
    let (_, falhas) = resolver(&nomes, &[decisao], ler_de(&[("A_KEY", Ok("valor-a-123")), ("B_KEY", Err("recusou"))]));
    assert_eq!(falhas.len(), 1);
}

#[test]
fn o_ambiente_do_run_leva_os_pares_e_so_do_run_certo() {
    por_run().lock().unwrap().insert("run-env".into(), vec![("STRIPE_SECRET_KEY".into(), "sk_test_123456".into())]);
    let mut cmd = tokio::process::Command::new("true");
    aplicar(&mut cmd, "run-env");
    let envs: Vec<_> = cmd.as_std().get_envs().map(|(k, v)| (k.to_owned(), v.map(|v| v.to_owned()))).collect();
    assert!(envs.contains(&("STRIPE_SECRET_KEY".into(), Some("sk_test_123456".into()))));
    let mut outro = tokio::process::Command::new("true");
    aplicar(&mut outro, "run-sem-segredo");
    assert_eq!(outro.as_std().get_envs().count(), 0);
}

#[test]
fn a_saida_mascara_o_valor_com_o_nome_e_ignora_valor_curto() {
    {
        let mut m = valores().lock().unwrap();
        m.insert("p1/SUPABASE_ANON_KEY".into(), "eyJhbGciOiJIUzI1NiJ9.segredo".into());
        m.insert("p1/CURTO".into(), "abc".into());
    }
    // Linha de `curl -v` como sai no terminal.
    let linha = "> apikey: eyJhbGciOiJIUzI1NiJ9.segredo".to_string();
    assert_eq!(mascarar(linha), "> apikey: ••••••••(SUPABASE_ANON_KEY)");
    assert_eq!(mascarar("abc de abcd".to_string()), "abc de abcd");
}

/// Contra o Keychain de verdade (`cargo test sonda_real_do_keychain -- --ignored`):
/// grava, lê pelo caminho do run (sem cópia em memória) e apaga um item de teste.
#[test]
#[ignore]
fn sonda_real_do_keychain() {
    let projeto = format!("sonda-{}", std::process::id());
    let nome = "FROTA_SONDA_NAO_E_NOME_VALIDO";
    entry(&projeto, nome).unwrap().set_password("valor-da-sonda-123").unwrap();
    valores().lock().unwrap().remove(&format!("{projeto}/{nome}"));
    assert_eq!(ler_valor(&projeto, nome).unwrap(), "valor-da-sonda-123");
    entry(&projeto, nome).unwrap().delete_credential().unwrap();
    valores().lock().unwrap().remove(&format!("{projeto}/{nome}"));
    assert!(ler_valor(&projeto, nome).unwrap_err().contains("não existe mais"));
}
