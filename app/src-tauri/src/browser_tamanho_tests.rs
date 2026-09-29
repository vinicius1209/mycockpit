use super::*;

/// `Browser.getVersion().product` do Chrome for Testing 153, lido na sonda de
/// 29/09/2026.
const PRODUTO: &str = "Chrome/153.0.8010.12";

fn t(preset: &str) -> Tamanho {
    Tamanho { preset: preset.into(), largura: 0, altura: 0, celular: false, girado: false }
}

fn metodo(c: &Value) -> &str {
    c["method"].as_str().unwrap()
}

#[test]
fn preset_usa_as_medidas_da_tabela_e_o_padrao_e_o_notebook() {
    let cel = t("celular").normalizado().unwrap();
    assert_eq!((cel.largura, cel.altura, cel.celular), (390, 844, true));
    assert!(t("notebook").normalizado().unwrap().e_padrao());
    assert!(!Tamanho { girado: true, ..t("notebook") }.normalizado().unwrap().e_padrao());
    assert!(t("iphone").normalizado().unwrap_err().contains("tamanho desconhecido"));
}

#[test]
fn personalizado_exige_medidas_plausiveis() {
    let ok = Tamanho { preset: PERSONALIZADO.into(), largura: 1024, altura: 768, celular: false, girado: false };
    assert_eq!(ok.clone().normalizado().unwrap(), ok);
    let pequeno = Tamanho { largura: 50, ..ok.clone() };
    assert!(pequeno.normalizado().unwrap_err().contains("200"));
}

#[test]
fn celular_emula_viewport_escala_toque_e_user_agent() {
    let cel = t("celular").normalizado().unwrap();
    let cmds = comandos(&cel, PRODUTO);
    assert_eq!(
        cmds.iter().map(metodo).collect::<Vec<_>>(),
        ["Emulation.setDeviceMetricsOverride", "Emulation.setTouchEmulationEnabled", "Emulation.setUserAgentOverride"]
    );
    let m = &cmds[0]["params"];
    assert_eq!((m["width"].as_u64(), m["height"].as_u64()), (Some(390), Some(844)));
    assert_eq!(m["deviceScaleFactor"], 3.0);
    assert_eq!(m["mobile"], true);
    assert_eq!(m["screenOrientation"]["type"], "portraitPrimary");
    assert_eq!(cmds[1]["params"]["enabled"], true);
    let ua = cmds[2]["params"]["userAgent"].as_str().unwrap();
    assert!(ua.contains("Chrome/153.0.0.0 Mobile Safari"), "{ua}");
    assert!(!ua.contains("Headless"), "{ua}");
    assert_eq!(cmds[2]["params"]["userAgentMetadata"]["mobile"], true);
}

#[test]
fn tablet_nao_diz_mobile_e_girar_troca_a_orientacao() {
    let tab = Tamanho { girado: true, ..t("tablet") }.normalizado().unwrap();
    let cmds = comandos(&tab, PRODUTO);
    let m = &cmds[0]["params"];
    assert_eq!((m["width"].as_u64(), m["height"].as_u64()), (Some(1180), Some(820)));
    assert_eq!(m["screenOrientation"]["type"], "landscapePrimary");
    assert_eq!(m["screenOrientation"]["angle"], 90);
    let ua = cmds[2]["params"]["userAgent"].as_str().unwrap();
    assert!(!ua.contains("Mobile"), "{ua}");
    assert_eq!(cmds[2]["params"]["userAgentMetadata"]["mobile"], false);
}

#[test]
fn desktop_so_muda_o_tamanho_sem_toque_nem_user_agent() {
    let cmds = comandos(&t("desktop").normalizado().unwrap(), PRODUTO);
    assert_eq!(cmds.len(), 2);
    assert_eq!(cmds[0]["params"]["mobile"], false);
    assert_eq!(cmds[1]["params"]["enabled"], false);
}

#[test]
fn voltar_ao_padrao_limpa_a_emulacao_antes_de_fechar() {
    // Fechar a sessão sozinho deixa o tamanho preso (medido na sonda).
    let limpeza = comandos_de_limpeza();
    assert_eq!(metodo(&limpeza[0]), "Emulation.clearDeviceMetricsOverride");
    assert_eq!(limpeza[1]["params"]["enabled"], false);
}

#[test]
fn no_modo_celular_o_clique_vira_toque() {
    let raiz = std::path::Path::new("/tmp");
    let clique = || crate::browser_cdp::BrowserInputAction::Click { x: 50.0, y: 40.0 };
    let toque = crate::browser_cdp::comandos_de_input(clique(), raiz, true).unwrap();
    assert_eq!(toque[0]["method"], "Input.dispatchTouchEvent");
    assert_eq!(toque[0]["params"]["type"], "touchStart");
    assert_eq!(toque[0]["params"]["touchPoints"][0]["x"], 50.0);
    assert_eq!(toque[1]["params"]["type"], "touchEnd");
    let mouse = crate::browser_cdp::comandos_de_input(clique(), raiz, false).unwrap();
    assert_eq!(mouse[0]["method"], "Input.dispatchMouseEvent");
}

#[test]
fn o_tamanho_viaja_em_camel_case_para_a_tela() {
    let json = serde_json::to_value(t("celular").normalizado().unwrap()).unwrap();
    assert_eq!(json, json!({"preset": "celular", "largura": 390, "altura": 844, "celular": true, "girado": false}));
    let lido: Tamanho = serde_json::from_value(json!({"preset": "tablet", "largura": 1, "altura": 1, "celular": false})).unwrap();
    assert!(!lido.girado);
}

/// Contra o Chromium de verdade (`cargo test sonda_real_da_emulacao -- --ignored`):
/// a sessão de emulação põe a página em celular para QUALQUER sessão, e ao
/// parar ela volta ao tamanho de antes, não fica presa.
#[tokio::test]
#[ignore]
async fn sonda_real_da_emulacao() {
    let bin = crate::browser::find_chromium().expect("Chromium");
    let perfil = std::env::temp_dir().join(format!("frota-sonda-emulacao-{}", std::process::id()));
    let porta = 9347;
    let mut filho = std::process::Command::new(bin)
        .args([
            "--headless=new",
            &format!("--remote-debugging-port={porta}"),
            &format!("--user-data-dir={}", perfil.display()),
            "--window-size=1280,800",
            "about:blank",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("subir o Chromium");
    let base = format!("http://127.0.0.1:{porta}");
    let cliente = reqwest::Client::new();
    let mut pagina: Option<Value> = None;
    for _ in 0..50 {
        if let Ok(r) = cliente.put(format!("{base}/json/new?about:blank")).send().await {
            pagina = r.json().await.ok();
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let ws = pagina.expect("página nova")["webSocketDebuggerUrl"].as_str().unwrap().to_string();
    let ler = |ws: String| async move {
        crate::browser_cdp::avaliar(
            &ws,
            "(() => { if (!document.querySelector('meta[name=viewport]')) document.head.insertAdjacentHTML('beforeend','<meta name=viewport content=\"width=device-width\">'); return { w: innerWidth, ua: navigator.userAgent, toque: navigator.maxTouchPoints, grossa: matchMedia('(pointer: coarse)').matches } })()",
        )
        .await
        .unwrap()
    };
    let antes = ler(ws.clone()).await;
    let (parar, receptor) = tokio::sync::watch::channel(false);
    let (pronto_tx, pronto_rx) = tokio::sync::oneshot::channel();
    let cel = t("celular").normalizado().unwrap();
    let ws_emul = ws.clone();
    let tarefa = tokio::spawn(async move { manter(&ws_emul, &cel, receptor, pronto_tx).await });
    pronto_rx.await.expect("emulação aplicada");
    let durante = ler(ws.clone()).await;
    parar.send(true).unwrap();
    tarefa.await.unwrap().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let depois = ler(ws.clone()).await;
    let _ = filho.kill();
    let _ = std::fs::remove_dir_all(&perfil);
    println!("antes {antes}\ndurante {durante}\ndepois {depois}");
    assert_eq!(durante["w"], 390, "{durante}");
    assert!(durante["ua"].as_str().unwrap().contains("Mobile"), "{durante}");
    assert_eq!(durante["toque"], 5);
    assert_eq!(durante["grossa"], true);
    assert_eq!(depois["w"], antes["w"], "o tamanho não pode ficar preso: {depois}");
    assert_eq!(depois["toque"], 0);
}
