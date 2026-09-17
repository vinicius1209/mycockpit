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
pub fn orfaos_no_ps(ps: &str, raiz_dos_perfis: &str, vivos: &HashSet<u32>) -> Vec<NavegadorOrfao> {
    let marca = format!("--user-data-dir={}/", raiz_dos_perfis.trim_end_matches('/'));
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
            let depois = comando.split_once(&marca)?.1;
            let project_id: String = depois
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            (!project_id.is_empty()).then_some(NavegadorOrfao { pid, project_id })
        })
        .collect()
}

fn raiz_dos_perfis(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?
        .join("browser-profiles")
        .to_string_lossy()
        .into_owned())
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
    Ok(orfaos_no_ps(&tabela_de_processos(), &raiz_dos_perfis(app)?, &vivos))
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
        let orfaos = orfaos_no_ps(PS_REAL, RAIZ, &HashSet::new());
        assert_eq!(
            orfaos,
            vec![NavegadorOrfao { pid: 60940, project_id: "54c053f3-9117-4522-a151-42015673bbfc".into() }]
        );
    }

    #[test]
    fn sessao_viva_do_app_nao_e_orfa() {
        let pelo_pid: HashSet<u32> = [60940].into_iter().collect();
        assert!(orfaos_no_ps(PS_REAL, RAIZ, &pelo_pid).is_empty());
        // pid guardado do shell que lançou: o grupo ainda reconhece a sessão
        let linha_sem_exec = "61001 61000 /Chromium --user-data-dir=/Users/exemplo/Library/Application Support/dev.vinicius.mycockpit/browser-profiles/abc-1 about:blank\n";
        let pelo_grupo: HashSet<u32> = [61000].into_iter().collect();
        assert!(orfaos_no_ps(linha_sem_exec, RAIZ, &pelo_grupo).is_empty());
    }

    #[test]
    fn chromium_de_outro_perfil_ou_outro_app_fica_de_fora() {
        assert!(orfaos_no_ps(PS_REAL, "/Users/exemplo/outro-app/browser-profiles", &HashSet::new()).is_empty());
        let chrome_pessoal = "  812     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/exemplo/Library/Application Support/Google/Chrome\n";
        assert!(orfaos_no_ps(chrome_pessoal, RAIZ, &HashSet::new()).is_empty());
    }
}
