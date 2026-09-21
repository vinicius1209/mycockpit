//! Navegador do projeto que sobrou de uma sessão anterior do app (navegador PRD
//! R6, B6). Se o app cai, o Chromium do projeto continua vivo segurando o
//! perfil, e o próximo "Ligar" morre sem explicar. Aqui a Frota só ENCONTRA e,
//! por gesto, ENCERRA: não adota o processo (o ciclo de vida do navegador é do
//! `ProcessRegistry`, que não tem o handle dele).

use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavegadorOrfao {
    pub pid: u32,
    pub project_id: String,
}

/// Processos principais de Chromium com perfil dentro de `raiz_dos_perfis` que
/// não são sessões vivas do app. Espera linhas `pid pgid comando`. Uma sessão
/// viva é reconhecida pelo pid OU pelo grupo: o app lança por `zsh -lc` num
/// grupo próprio, e o pid guardado pode ser o do shell. Auxiliares (`--type=`)
/// ficam de fora: encerrar o principal leva os auxiliares junto.
/// A mesma caça, sobre MAIS DE UMA raiz de perfis.
///
/// Existe porque o identificador do bundle mudou (ADR-222) e ele É o caminho
/// de `app_data_dir`. Um Chromium ainda vivo com perfil sob a raiz ANTIGA
/// deixaria de ser reconhecido como nosso: ficaria com `ppid=1` comendo CPU e
/// o app não o enxergaria para encerrar. Isso é o cenário de carga fantasma,
/// que aqui já custou diagnóstico, e a única coisa que o evita é aceitar as
/// duas raízes durante a janela.
pub fn orfaos_no_ps_em(
    ps: &str,
    raizes: &[&str],
    vivos: &HashSet<u32>,
) -> Vec<NavegadorOrfao> {
    let marcas: Vec<String> = raizes
        .iter()
        .map(|r| format!("--user-data-dir={}/", r.trim_end_matches('/')))
        .collect();
    ps.lines()
        .filter_map(|linha| {
            let linha = linha.trim_start();
            let (pid, resto) = linha.split_once(char::is_whitespace)?;
            let pid: u32 = pid.parse().ok()?;
            let (grupo, comando) = resto.trim_start().split_once(char::is_whitespace)?;
            let grupo: u32 = grupo.parse().ok()?;
            if comando.contains("--type=") || vivos.contains(&pid) || vivos.contains(&grupo) {
                return None;
            }
            let depois = marcas
                .iter()
                .find_map(|marca| comando.split_once(marca.as_str()))?
                .1;
            let project_id: String = depois
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            (!project_id.is_empty()).then_some(NavegadorOrfao { pid, project_id })
        })
        .collect()
}

/// As raízes de perfil a varrer: a de hoje e a do identificador legado, que é
/// irmã dela no mesmo diretório pai.
fn raizes_dos_perfis(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let dados = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let mut raizes = vec![dados.join("browser-profiles").to_string_lossy().into_owned()];
    if let Some(pai) = dados.parent() {
        raizes.push(
            pai.join(crate::ID_LEGADO)
                .join("browser-profiles")
                .to_string_lossy()
                .into_owned(),
        );
    }
    Ok(raizes)
}

fn tabela_de_processos() -> String {
    std::process::Command::new("ps")
        .args(["-axo", "pid=,pgid=,command="])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default()
}

fn orfaos_agora(app: &tauri::AppHandle) -> Result<Vec<NavegadorOrfao>, String> {
    let vivos: HashSet<u32> = app
        .state::<Arc<crate::browser::BrowserRegistry>>()
        .pids();
    let raizes = raizes_dos_perfis(app)?;
    let refs: Vec<&str> = raizes.iter().map(String::as_str).collect();
    Ok(orfaos_no_ps_em(&tabela_de_processos(), &refs, &vivos))
}

#[tauri::command]
pub fn browser_orfaos(app: tauri::AppHandle) -> Result<Vec<NavegadorOrfao>, String> {
    orfaos_agora(&app)
}

/// Encerra um navegador órfão. Confere de novo na hora: só mata um pid que
/// AINDA é Chromium de perfil da Frota sem sessão viva (pid reaproveitado pelo
/// sistema nunca recebe o sinal).
#[tauri::command]
pub fn browser_encerrar_orfao(app: tauri::AppHandle, pid: u32) -> Result<(), String> {
    if !orfaos_agora(&app)?.iter().any(|o| o.pid == pid) {
        return Err("esse navegador já não está aberto".into());
    }
    let status = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .map_err(|e| format!("não consegui encerrar o navegador: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("o sistema recusou encerrar o navegador".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS_REAL: &str = include_str!("../testdata/chromium-ps/navegador-orfao.txt");
    const RAIZ: &str = "/Users/exemplo/Library/Application Support/dev.vinicius.mycockpit/browser-profiles";

    #[test]
    fn acha_so_o_processo_principal_do_perfil_com_o_projeto() {
        let orfaos = orfaos_no_ps_em(PS_REAL, &[RAIZ], &HashSet::new());
        assert_eq!(
            orfaos,
            vec![NavegadorOrfao { pid: 60940, project_id: "54c053f3-9117-4522-a151-42015673bbfc".into() }]
        );
    }

    #[test]
    fn sessao_viva_do_app_nao_e_orfa() {
        let pelo_pid: HashSet<u32> = [60940].into_iter().collect();
        assert!(orfaos_no_ps_em(PS_REAL, &[RAIZ], &pelo_pid).is_empty());
        // pid guardado do shell que lançou: o grupo ainda reconhece a sessão
        let linha_sem_exec = "61001 61000 /Chromium --user-data-dir=/Users/exemplo/Library/Application Support/dev.vinicius.mycockpit/browser-profiles/abc-1 about:blank\n";
        let pelo_grupo: HashSet<u32> = [61000].into_iter().collect();
        assert!(orfaos_no_ps_em(linha_sem_exec, &[RAIZ], &pelo_grupo).is_empty());
    }

    #[test]
    fn chromium_de_outro_perfil_ou_outro_app_fica_de_fora() {
        assert!(orfaos_no_ps_em(PS_REAL, &["/Users/exemplo/outro-app/browser-profiles"], &HashSet::new()).is_empty());
        let chrome_pessoal = "  812     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/exemplo/Library/Application Support/Google/Chrome\n";
        assert!(orfaos_no_ps_em(chrome_pessoal, &[RAIZ], &HashSet::new()).is_empty());
    }

    /// A raiz NOVA, irmã da real no mesmo pai. A antiga (`RAIZ`) é a que está
    /// na captura de `ps` de verdade, colhida do incidente.
    const RAIZ_NOVA: &str = "/Users/exemplo/Library/Application Support/dev.vinicius.frota/browser-profiles";

    #[test]
    fn orfao_com_perfil_da_raiz_ANTIGA_continua_sendo_visto() {
        // O identificador do bundle mudou, e ele é o caminho de app_data_dir.
        // Se a caça olhasse só a raiz nova, este Chromium ficaria com ppid=1
        // comendo CPU e invisível para o app (ADR-222).
        let achados = orfaos_no_ps_em(PS_REAL, &[RAIZ_NOVA, RAIZ], &HashSet::new());
        assert!(
            !achados.is_empty(),
            "órfão de antes do rename sumiu da varredura"
        );
    }

    #[test]
    fn so_a_raiz_nova_perde_o_orfao_antigo() {
        // O contraprova do teste acima: é exatamente isto que a raiz dupla evita.
        assert!(orfaos_no_ps_em(PS_REAL, &[RAIZ_NOVA], &HashSet::new()).is_empty());
    }

    #[test]
    fn raiz_dupla_nao_afrouxa_o_filtro_de_terceiro() {
        // Chrome pessoal do usuário continua fora, com as duas raízes.
        let chrome_pessoal = "  812     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/exemplo/Library/Application Support/Google/Chrome\n";
        assert!(orfaos_no_ps_em(chrome_pessoal, &[RAIZ_NOVA, RAIZ], &HashSet::new()).is_empty());
    }
}
