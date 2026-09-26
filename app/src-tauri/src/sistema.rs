//! A máquina na faixa de baixo (ADR-262, ADR-263): memória e CPU do computador
//! inteiro e, com o painel aberto, quanto disso é do Frota, turno a turno e
//! processo a processo.
//!
//! Antes só existia a memória POR TURNO (`run_resources`, soma da árvore do
//! processo do agente a cada 5 s), que vira aviso no fio ao passar de 2, 4,
//! 8 GB. Faltava o todo: "o Mac está lento por causa de quem?".
//!
//! Memória total e CPU vêm do `sysinfo` (sem subprocesso a cada 2 s). A árvore
//! vem do leitor único (`arvore_de_processos`), o mesmo que mede o turno: o
//! `sysinfo` perdia o pai de parte dos processos e dava outro número.
//!
//! Custo: a amostra da faixa lê só memória e CPU e o front só pede com a
//! janela visível. A árvore, que é a parte cara, só com o painel aberto.

use crate::arvore_de_processos::{arvore, ler_processo, soma_mb, Papel, Processo};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::Manager;

#[derive(Default)]
pub struct Sistema {
    sys: Mutex<Option<System>>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AmostraDoSistema {
    pub mem_usada_mb: u64,
    pub mem_total_mb: u64,
    /// `None` na primeira leitura: CPU é diferença entre duas amostras, e
    /// "0%" inventado seria teatro.
    pub cpu_pct: Option<f32>,
    pub nucleos: usize,
}

/// Um processo na árvore de um turno ou de um navegador, pronto para o painel.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessoNaArvore {
    pub pid: u32,
    pub profundidade: usize,
    pub papel: Papel,
    pub nome: String,
    pub executor: Option<String>,
    /// A linha de comando inteira, com o home como `~`, para o hover.
    pub comando: String,
    pub rss_mb: u64,
    pub cpu_pct: f32,
    pub tempo_s: u64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TurnoNaMaquina {
    pub run_id: String,
    pub mb: u64,
    pub processos: Vec<ProcessoNaArvore>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavegadorNaMaquina {
    pub project_id: String,
    pub project_path: String,
    pub mb: u64,
    pub processos: Vec<ProcessoNaArvore>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetalheDaMaquina {
    /// O app e tudo o que ele abriu: agentes, MCPs, Chromium. A mesma soma que
    /// mede cada turno: um número só.
    pub frota_mb: u64,
    pub turnos: Vec<TurnoNaMaquina>,
    pub navegadores: Vec<NavegadorNaMaquina>,
}

const MB: u64 = 1024 * 1024;

/// O home como `~` na linha de comando: mais curta e sem o nome do usuário.
fn sem_home(args: &str, home: &str) -> String {
    if home.len() > 1 {
        args.replace(home, "~")
    } else {
        args.to_string()
    }
}

/// A árvore de `raiz` como o painel a desenha. PURO.
pub fn processos_da_arvore(procs: &[Processo], raiz: u32, exe_do_app: &str, home: &str) -> Vec<ProcessoNaArvore> {
    arvore(procs, raiz)
        .into_iter()
        .map(|(profundidade, p)| {
            let leitura = ler_processo(p, raiz, exe_do_app);
            ProcessoNaArvore {
                pid: p.pid,
                profundidade,
                papel: leitura.papel,
                nome: leitura.nome,
                executor: leitura.executor,
                comando: sem_home(&p.args, home),
                rss_mb: p.rss_kb / 1024,
                cpu_pct: p.cpu_pct,
                tempo_s: p.tempo_s,
            }
        })
        .collect()
}

/// Os pids a sinalizar para encerrar `alvo` dentro do turno de `raiz`: ele e
/// os descendentes, os filhos primeiro. Recusa o que não é mais do turno (o
/// pid pode ter morrido e sido reciclado entre a tela e o clique) e a própria
/// raiz (parar o turno é o Parar, que o fecha direito). PURO.
pub fn alvos_para_encerrar(procs: &[Processo], raiz: u32, alvo: u32) -> Result<Vec<u32>, String> {
    if alvo == raiz {
        return Err("o processo principal do turno se encerra pelo Parar".into());
    }
    if !arvore(procs, raiz).iter().any(|(_, p)| p.pid == alvo) {
        return Err("esse processo não faz mais parte do turno".into());
    }
    let mut pids: Vec<u32> = arvore(procs, alvo).iter().map(|(_, p)| p.pid).collect();
    pids.reverse();
    Ok(pids)
}

#[tauri::command]
pub fn sistema_amostra(app: tauri::AppHandle) -> Result<AmostraDoSistema, String> {
    let estado = app.state::<Arc<Sistema>>();
    let mut guarda = estado.sys.lock().map_err(|_| "leitura da máquina indisponível".to_string())?;
    let primeira = guarda.is_none();
    let sys = guarda.get_or_insert_with(System::new);
    sys.refresh_memory();
    sys.refresh_cpu_usage();
    Ok(AmostraDoSistema {
        mem_usada_mb: sys.used_memory() / MB,
        mem_total_mb: sys.total_memory() / MB,
        cpu_pct: (!primeira).then(|| sys.global_cpu_usage()),
        nucleos: sys.cpus().len(),
    })
}

fn exe_do_app() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

/// Os turnos vivos: run → pid do processo do motor.
fn runs_vivos(app: &tauri::AppHandle) -> Vec<(String, u32)> {
    app.state::<crate::agent::RunRegistry>()
        .1
        .lock()
        .map(|m| m.iter().map(|(run, pid)| (run.clone(), *pid)).collect())
        .unwrap_or_default()
}

/// O detalhe do painel, só com ele aberto (é a leitura cara).
#[tauri::command]
pub async fn sistema_detalhe(app: tauri::AppHandle) -> Result<DetalheDaMaquina, String> {
    let procs = crate::arvore_de_processos::ler()
        .await
        .ok_or("não consegui ler os processos do sistema")?;
    let (exe, home) = (exe_do_app(), home());
    let turnos = runs_vivos(&app)
        .into_iter()
        .map(|(run_id, pid)| TurnoNaMaquina {
            mb: soma_mb(&procs, pid),
            processos: processos_da_arvore(&procs, pid, &exe, &home),
            run_id,
        })
        .filter(|t| !t.processos.is_empty())
        .collect();
    let navegadores = app
        .state::<Arc<crate::browser::BrowserRegistry>>()
        .sessoes()
        .into_iter()
        .map(|s| NavegadorNaMaquina {
            mb: soma_mb(&procs, s.pid),
            processos: processos_da_arvore(&procs, s.pid, &exe, &home),
            project_id: s.project_id,
            project_path: s.project_path,
        })
        .collect();
    Ok(DetalheDaMaquina {
        frota_mb: soma_mb(&procs, std::process::id()),
        turnos,
        navegadores,
    })
}

/// Encerra UM processo de um turno e os filhos dele (TERM, não KILL: ele tem a
/// chance de fechar direito). Gesto humano, com confirmação na tela; o turno
/// segue e o agente vê a ferramenta cair.
#[tauri::command]
pub async fn sistema_encerrar(app: tauri::AppHandle, run_id: String, pid: u32) -> Result<(), String> {
    let raiz = runs_vivos(&app)
        .into_iter()
        .find_map(|(run, p)| (run == run_id).then_some(p))
        .ok_or("esse turno já terminou")?;
    let procs = crate::arvore_de_processos::ler()
        .await
        .ok_or("não consegui ler os processos do sistema")?;
    let pids = alvos_para_encerrar(&procs, raiz, pid)?;
    let status = tokio::process::Command::new("kill")
        .arg("-TERM")
        .args(pids.iter().map(u32::to_string))
        .status()
        .await
        .map_err(|e| format!("não consegui encerrar: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("o processo recusou o encerramento".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arvore_de_processos::parse_ps;

    /// Recorte REAL (26/09/2026) do turno do Claude na árvore do Frota; o home
    /// é o do usuário de teste.
    const TURNO: &str = "\
26535 19920 373760 16.5 01:43 claude --add-dir /Users/u/Library/Application Support/dev.vinicius.frota/attachments/14ff6eb1
26596 26535   9216  0.0 01:43 /Applications/Frota.app/Contents/MacOS/app approval-server
26606 26535  74752  0.0 01:43 node /Users/u/.nvm/versions/node/v24.16.0/bin/hostinger-api-mcp
28452 26535   3072  0.0 00:00 /bin/zsh -c source /Users/u/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && eval 'npm test -- --run' \\< /dev/null && pwd -P
28454 28452   2048  0.0 00:00 node /Users/u/proj/node_modules/.bin/vitest --run
";
    const APP: &str = "/Applications/Frota.app/Contents/MacOS/app";

    #[test]
    fn a_arvore_do_turno_sai_com_papel_nome_e_o_comando_sem_o_home() {
        let procs = parse_ps(TURNO);
        let arv = processos_da_arvore(&procs, 26535, APP, "/Users/u");
        let resumo: Vec<(usize, Papel, &str)> =
            arv.iter().map(|p| (p.profundidade, p.papel, p.nome.as_str())).collect();
        assert_eq!(
            resumo,
            vec![
                (0, Papel::Motor, "claude"),
                (1, Papel::Frota, "aprovações"),
                (1, Papel::Mcp, "hostinger-api-mcp"),
                (1, Papel::Comando, "npm test -- --run"),
                (2, Papel::Processo, "node"),
            ]
        );
        assert_eq!(arv[2].comando, "node ~/.nvm/versions/node/v24.16.0/bin/hostinger-api-mcp");
        assert_eq!(arv[0].rss_mb, 365);
    }

    #[test]
    fn encerrar_leva_o_processo_e_os_filhos_e_nunca_o_motor_nem_o_que_saiu_do_turno() {
        let procs = parse_ps(TURNO);
        assert_eq!(alvos_para_encerrar(&procs, 26535, 28452), Ok(vec![28454, 28452]));
        assert_eq!(alvos_para_encerrar(&procs, 26535, 26606), Ok(vec![26606]));
        assert!(alvos_para_encerrar(&procs, 26535, 26535).unwrap_err().contains("Parar"));
        assert!(alvos_para_encerrar(&procs, 26535, 1).unwrap_err().contains("não faz mais parte"));
    }

    /// Sonda manual: `cargo test --lib sistema::tests::sonda -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn sonda() {
        let mut sys = System::new();
        sys.refresh_memory();
        sys.refresh_cpu_usage();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        sys.refresh_cpu_usage();
        eprintln!(
            "mem {}/{} MB · cpu {:.0}% · {} núcleos",
            sys.used_memory() / MB,
            sys.total_memory() / MB,
            sys.global_cpu_usage(),
            sys.cpus().len()
        );
    }
}
