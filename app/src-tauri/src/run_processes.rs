//! Ciclo de vida dos processos descendentes de um run de agent.
//!
//! Alguns CLIs abrem processos em background e os reparentam. PID e grupo do
//! filho direto deixam de bastar, mas o marcador único do run continua no
//! ambiente herdado (`MYCOCKPIT_RUN_ID`). Além disso, processos filhos gerados
//! pelo run (como compiladores e runners de teste) são varridos recursivamente
//! por PPID para garantir que nenhum processo órfão sobreviva ao cancelamento.

use std::collections::{HashMap, HashSet, VecDeque};

#[cfg(unix)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessEntry {
    pub(crate) pid: u32,
    pub(crate) ppid: u32,
    pub(crate) pgid: u32,
    pub(crate) has_marker: bool,
}

#[cfg(unix)]
pub(crate) fn parse_process_entries(ps: &str, run_id: &str) -> Vec<ProcessEntry> {
    let marker = format!("{}={run_id}", crate::hook_sessions::RUN_ENV);
    ps.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse::<u32>().ok()?;
            let ppid = fields.next()?.parse::<u32>().ok()?;
            let pgid = fields.next()?.parse::<u32>().ok()?;
            if pid <= 1 {
                return None;
            }
            let has_marker = fields.any(|field| field == marker);
            Some(ProcessEntry {
                pid,
                ppid,
                pgid,
                has_marker,
            })
        })
        .collect()
}

#[cfg(unix)]
pub(crate) fn find_termination_targets(
    entries: &[ProcessEntry],
    direct_pid: Option<u32>,
    current_pid: u32,
    current_pgid: Option<u32>,
) -> (HashSet<u32>, HashSet<u32>) {
    let mut roots = HashSet::new();
    if let Some(pid) = direct_pid.filter(|p| *p > 1 && *p != current_pid) {
        roots.insert(pid);
    }
    for entry in entries {
        if entry.has_marker && entry.pid != current_pid {
            roots.insert(entry.pid);
        }
    }

    let mut children_map = HashMap::<u32, Vec<u32>>::new();
    let mut pgid_map = HashMap::<u32, u32>::new();
    for entry in entries {
        children_map.entry(entry.ppid).or_default().push(entry.pid);
        pgid_map.insert(entry.pid, entry.pgid);
    }

    let mut all_pids = HashSet::new();
    let mut queue = VecDeque::new();
    for root in &roots {
        all_pids.insert(*root);
        queue.push_back(*root);
    }

    while let Some(parent) = queue.pop_front() {
        if let Some(children) = children_map.get(&parent) {
            for child in children {
                if *child > 1 && *child != current_pid && all_pids.insert(*child) {
                    queue.push_back(*child);
                }
            }
        }
    }

    let mut groups = HashSet::new();
    for pid in &all_pids {
        if let Some(pgid) = pgid_map.get(pid) {
            if *pgid > 1 && Some(*pgid) != current_pgid {
                groups.insert(*pgid);
            }
        }
    }

    (groups, all_pids)
}

#[cfg(unix)]
fn process_table() -> String {
    std::process::Command::new("ps")
        .args(["eww", "-axo", "pid=,ppid=,pgid=,command="])
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

/// Mata processos que carregam o marcador exato do run e todos os descendentes
/// em árvore (PPID) a partir do processo direto ou marcado. Grupos próprios
/// cobrem netos desacoplados; o sinal por PID cobre processos que nasceram antes
/// do isolamento de grupo.
pub(crate) fn terminate_run(run_id: &str, direct_pid: Option<u32>) {
    #[cfg(unix)]
    {
        let table = process_table();
        let entries = parse_process_entries(&table, run_id);
        let current_pid = std::process::id();
        let current_pgid = entries
            .iter()
            .find(|e| e.pid == current_pid)
            .map(|e| e.pgid);
        let (groups, pids) = find_termination_targets(
            &entries,
            direct_pid,
            current_pid,
            current_pgid,
        );
        for pgid in groups {
            signal(&format!("-{pgid}"));
        }
        for pid in pids {
            signal(&pid.to_string());
        }
    }
    #[cfg(not(unix))]
    let _ = (run_id, direct_pid);
}

#[cfg(test)]
mod tests {
    use super::{find_termination_targets, parse_process_entries, ProcessEntry};

    #[test]
    fn encontra_o_processo_orfao_pelo_marcador_real_do_incidente() {
        let ps = " 1368 1 1368 python3 -m http.server 8089 HOME=/Users/vini MYCOCKPIT_RUN_ID=3edf1aeb-29f7-4f5a-8198-958a0069425c\n 1400 1 1400 outro MYCOCKPIT_RUN_ID=run-diferente\n";
        let entries = parse_process_entries(ps, "3edf1aeb-29f7-4f5a-8198-958a0069425c");
        assert_eq!(
            entries,
            vec![
                ProcessEntry {
                    pid: 1368,
                    ppid: 1,
                    pgid: 1368,
                    has_marker: true,
                },
                ProcessEntry {
                    pid: 1400,
                    ppid: 1,
                    pgid: 1400,
                    has_marker: false,
                }
            ]
        );
        let (groups, pids) = find_termination_targets(&entries, None, 9999, Some(9999));
        assert!(groups.contains(&1368));
        assert!(pids.contains(&1368));
        assert!(!pids.contains(&1400));
    }

    #[test]
    fn nao_aceita_prefixo_do_run_nem_pid_de_sistema() {
        let ps = " 1 0 1 launchd MYCOCKPIT_RUN_ID=run-1\n 99 1 99 agent MYCOCKPIT_RUN_ID=run-10\n";
        let entries = parse_process_entries(ps, "run-1");
        // PID 1 é filtrado
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].pid, 99);
        assert!(!entries[0].has_marker);
        let (groups, pids) = find_termination_targets(&entries, None, 9999, Some(9999));
        assert!(groups.is_empty());
        assert!(pids.is_empty());
    }

    #[test]
    fn varre_arvore_recursiva_de_descendentes_a_partir_do_direct_pid() {
        // Cenário do incidente: direct_pid 2000 (cargo) -> 2001 (rustc) -> 2002 (link)
        // Nenhum dos filhos carrega a tag explicitamente
        let entries = vec![
            ProcessEntry {
                pid: 2000,
                ppid: 100,
                pgid: 2000,
                has_marker: false,
            },
            ProcessEntry {
                pid: 2001,
                ppid: 2000,
                pgid: 2000,
                has_marker: false,
            },
            ProcessEntry {
                pid: 2002,
                ppid: 2001,
                pgid: 2000,
                has_marker: false,
            },
            ProcessEntry {
                pid: 3000,
                ppid: 100,
                pgid: 3000,
                has_marker: false,
            },
        ];
        let (groups, pids) = find_termination_targets(&entries, Some(2000), 100, Some(100));
        assert!(groups.contains(&2000));
        assert!(pids.contains(&2000));
        assert!(pids.contains(&2001));
        assert!(pids.contains(&2002));
        assert!(!pids.contains(&3000)); // Outro processo não é afetado
    }

    #[test]
    fn protege_o_proprio_processo_do_app_e_seu_pgid() {
        let entries = vec![ProcessEntry {
            pid: 500,
            ppid: 1,
            pgid: 500,
            has_marker: true,
        }];
        let (groups, pids) = find_termination_targets(&entries, Some(500), 500, Some(500));
        assert!(groups.is_empty());
        assert!(pids.is_empty());
    }
}

