//! Ciclo de vida dos processos descendentes de um run de agent.
//!
//! Alguns CLIs abrem processos em background e os reparentam. PID e grupo do
//! filho direto deixam de bastar, mas o marcador único do run continua no
//! ambiente herdado (`MYCOCKPIT_RUN_ID`).

use std::collections::HashSet;

#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessRef {
    pid: u32,
    pgid: u32,
}

#[cfg(unix)]
fn tagged_processes(ps: &str, run_id: &str) -> Vec<ProcessRef> {
    let marker = format!("{}={run_id}", crate::hook_sessions::RUN_ENV);
    ps.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse::<u32>().ok()?;
            let pgid = fields.next()?.parse::<u32>().ok()?;
            (pid > 1 && fields.any(|field| field == marker)).then_some(ProcessRef { pid, pgid })
        })
        .collect()
}

#[cfg(unix)]
fn process_table() -> String {
    std::process::Command::new("ps")
        .args(["eww", "-axo", "pid=,pgid=,command="])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default()
}

#[cfg(unix)]
fn signal(target: &str) {
    let _ = std::process::Command::new("kill")
        .args(["-KILL", target])
        .output();
}

/// Mata somente processos que carregam o marcador exato do run. Grupos
/// próprios cobrem netos reparentados; o sinal por PID cobre processos antigos
/// que nasceram antes de o runner isolar o grupo.
pub(crate) fn terminate_run(run_id: &str, direct_pid: Option<u32>) {
    #[cfg(unix)]
    {
        let table = process_table();
        let tagged = tagged_processes(&table, run_id);
        let current_pid = std::process::id();
        let current_pgid = table.lines().find_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse::<u32>().ok()?;
            let pgid = fields.next()?.parse::<u32>().ok()?;
            (pid == current_pid).then_some(pgid)
        });
        let groups = tagged
            .iter()
            .map(|process| process.pgid)
            .filter(|pgid| *pgid > 1 && Some(*pgid) != current_pgid)
            .collect::<HashSet<_>>();
        for pgid in groups {
            signal(&format!("-{pgid}"));
        }
        for pid in tagged.iter().map(|process| process.pid) {
            signal(&pid.to_string());
        }
        if let Some(pid) = direct_pid.filter(|pid| *pid > 1) {
            signal(&pid.to_string());
        }
    }
    #[cfg(not(unix))]
    let _ = (run_id, direct_pid);
}

#[cfg(test)]
mod tests {
    use super::{tagged_processes, ProcessRef};

    #[test]
    fn encontra_o_processo_orfao_pelo_marcador_real_do_incidente() {
        let ps = " 1368 1368 python3 -m http.server 8089 HOME=/Users/vini MYCOCKPIT_RUN_ID=3edf1aeb-29f7-4f5a-8198-958a0069425c\n 1400 1400 outro MYCOCKPIT_RUN_ID=run-diferente\n";
        assert_eq!(
            tagged_processes(ps, "3edf1aeb-29f7-4f5a-8198-958a0069425c"),
            vec![ProcessRef {
                pid: 1368,
                pgid: 1368
            }]
        );
    }

    #[test]
    fn nao_aceita_prefixo_do_run_nem_pid_de_sistema() {
        let ps = " 1 1 launchd MYCOCKPIT_RUN_ID=run-1\n 99 99 agent MYCOCKPIT_RUN_ID=run-10\n";
        assert!(tagged_processes(ps, "run-1").is_empty());
    }
}
