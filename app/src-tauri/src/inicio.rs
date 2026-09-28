//! O que roda uma vez, quando o app sobe (o fecho `.setup` do `Builder`). Saiu
//! do `lib.rs`, que está no teto congelado da ADR-232, sem mudar uma linha do
//! que faz.

use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;

use crate::{
    catalog, command_inventory, hook_gateway, hud, manutencao_do_banco, menu_da_janela, quit,
    tray, work_mcp_setup,
};

pub(crate) fn ao_iniciar(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // O banco antes do plugin SQL abrir; nunca bloqueia o boot.
    manutencao_do_banco::preparar_no_boot(app.handle());
    // ⌘W fecha a aba de arquivo, não a janela (ADR-243).
    menu_da_janela::instalar(app.handle());

    // Catálogo de preços (models.dev): registra onde fica o cache em
    // disco p/ o pricing achar preços dinâmicos já na 1ª consulta.
    catalog::init(app.handle());
    command_inventory::init(app.handle());

    // Titlebar overlay (decorum): visual unificado + traffic lights encaixados +
    // drag funcionando (sem o bug do Overlay nativo).
    let main_window = app
        .get_webview_window("main")
        .ok_or("janela main ausente")?;
    main_window.create_overlay_titlebar()?;
    // Semáforos centrados no header de 56px (h-14). Valor calibrado por
    // medição no app (o inset do decorum NÃO é o centro do botão).
    // O decorum reaplica a CONSTANTE (y=16) no observer de resize dele →
    // reaplicamos o nosso a cada evento de janela (ver on_window_event),
    // que roda DEPOIS (o delegate do decorum chama super = Tauri).
    #[cfg(target_os = "macos")]
    main_window.set_traffic_lights_inset(18.0, crate::TRAFFIC_LIGHTS_Y)?;

    // Tray: o app vive na barra de menu com a janela fechada (as
    // automações agendadas continuam); só "Sair" encerra de verdade.
    tray::create(app.handle())?;
    #[cfg(target_os = "macos")]
    quit::install_native_termination_bridge(app.handle()).map_err(std::io::Error::other)?;
    // Presenter do instrumento: carrega a preferência nativa, mede a
    // tela e só então decide entre popover clássico e HUD flutuante.
    // Falha mantém o popover clássico utilizável.
    if let Err(error) = hud::initialize(app.handle()) {
        log::warn!("HUD indisponível no boot: {error}");
    }

    // H0 — receptor local de hooks/statusline (loopback, porta
    // efêmera, token por boot). Falha degrada com log, nunca derruba
    // o boot: o medidor de janela ainda funciona por poll (codex).
    hook_gateway::start(app.handle());
    work_mcp_setup::warm();

    Ok(())
}
