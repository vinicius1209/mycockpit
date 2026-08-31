//! Sinalização barata para retomadas cujo histórico nativo já é grande.
//!
//! A busca olha somente nomes e metadata dentro do CODEX_HOME. O rollout nunca
//! é carregado pelo Frota, e nenhuma sessão é apagada ou alterada.

use std::path::{Path, PathBuf};

pub(crate) const LARGE_ROLLOUT_WARNING_BYTES: u64 = 64 * 1024 * 1024;
const MAX_VISITED_ENTRIES: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResumeRisk {
    pub(crate) bytes: u64,
}

impl ResumeRisk {
    pub(crate) fn deserves_warning(&self) -> bool {
        self.bytes > LARGE_ROLLOUT_WARNING_BYTES
    }

    pub(crate) fn size_mib(&self) -> u64 {
        self.bytes.div_ceil(1024 * 1024)
    }
}

pub(crate) async fn assess(session_id: &str) -> Result<Option<ResumeRisk>, String> {
    let session_id = session_id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
            .ok_or_else(|| "CODEX_HOME e HOME indisponíveis".to_string())?;
        assess_in(&home, &session_id)
    })
    .await
    .map_err(|error| format!("preflight de retomada falhou: {error}"))?
}

fn assess_in(codex_home: &Path, session_id: &str) -> Result<Option<ResumeRisk>, String> {
    if session_id.len() < 8
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("id de sessão inválido para o preflight".into());
    }
    let mut stack = [
        codex_home.join("sessions"),
        codex_home.join("archived_sessions"),
    ]
    .into_iter()
    .filter(|path| path.is_dir())
    .collect::<Vec<_>>();
    let mut visited = 0usize;
    let mut largest = None;
    while let Some(directory) = stack.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_VISITED_ENTRIES {
                return Err("inventário de sessões excedeu o limite de entradas".into());
            }
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(entry.path());
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if !name.ends_with(".jsonl") || !name.contains(session_id) {
                continue;
            }
            let bytes = match entry.metadata() {
                Ok(metadata) => metadata.len(),
                Err(_) => continue,
            };
            largest = Some(largest.map_or(bytes, |current: u64| current.max(bytes)));
        }
    }
    Ok(largest.map(|bytes| ResumeRisk { bytes }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollout_do_incidente_e_sinalizado_sem_ler_o_conteudo() {
        let root = std::env::temp_dir().join(format!(
            "frota-resume-guard-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let directory = root.join("sessions/2026/08/29");
        std::fs::create_dir_all(&directory).unwrap();
        let session = "01a04fe4-1bf8-7701-9274-a6102f0361af";
        let path = directory.join(format!("rollout-2026-08-29T20-39-04-{session}.jsonl"));
        let file = std::fs::File::create(path).unwrap();
        file.set_len(85_223_130).unwrap();

        let risk = assess_in(&root, session).unwrap().unwrap();
        assert_eq!(risk.bytes, 85_223_130);
        assert_eq!(risk.size_mib(), 82);
        assert!(risk.deserves_warning());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn id_nao_pode_virar_path_ou_busca_ambigua() {
        assert!(assess_in(Path::new("/tmp"), "../sessions").is_err());
        assert!(assess_in(Path::new("/tmp"), "curto").is_err());
    }
}
