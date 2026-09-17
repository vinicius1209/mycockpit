//! Limites de recursos dos processos de agent.
//!
//! stdout e stderr pertencem à fronteira de processo, portanto nenhum deles
//! pode decidir quanto o processo do Frota retém. O watchdog complementa esses
//! limites: um CLI também pode consumir memória dentro do próprio heap sem
//! publicar byte algum.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{Duration, Interval};

pub(crate) const MAX_PROTOCOL_LINE_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const STDERR_TAIL_BYTES: usize = 64 * 1024;
const MEMORY_WARNING_LEVELS_MB: [u64; 5] = [2 * 1024, 4 * 1024, 8 * 1024, 16 * 1024, 32 * 1024];
const MEMORY_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Teto de quota em disco para arquivos de log e tarefas de background (5 GB).
/// Proteção contra loops infinitos de logs no SSD do usuário (ADR-183).
pub(crate) const MAX_OUTPUT_FILE_BYTES: u64 = 5 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DiskQuotaCheck {
    WithinQuota(u64),
    Exceeded { size_bytes: u64, limit_bytes: u64 },
    FileNotFound,
    IoError(String),
}

pub(crate) fn check_disk_quota(path: &std::path::Path, limit_bytes: u64) -> DiskQuotaCheck {
    match std::fs::metadata(path) {
        Ok(meta) => {
            let size = meta.len();
            if size > limit_bytes {
                DiskQuotaCheck::Exceeded {
                    size_bytes: size,
                    limit_bytes,
                }
            } else {
                DiskQuotaCheck::WithinQuota(size)
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => DiskQuotaCheck::FileNotFound,
        Err(err) => DiskQuotaCheck::IoError(err.to_string()),
    }
}

pub(crate) fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug)]
pub(crate) enum LineReadError {
    Io(std::io::Error),
    TooLong { limit: usize },
}

impl fmt::Display for LineReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "falha lendo o stream do motor: {error}"),
            Self::TooLong { limit } if *limit < 1024 * 1024 => write!(
                formatter,
                "uma linha do stream excedeu o limite de {} KiB",
                limit / 1024
            ),
            Self::TooLong { limit } => write!(
                formatter,
                "uma linha do stream excedeu o limite de {} MiB",
                limit / 1024 / 1024
            ),
        }
    }
}

/// Leitor de JSON Lines que limita uma linha ANTES de desserializar. Quando um
/// frame excede o teto, descarta o restante até `\n` sem voltar a acumulá-lo.
pub(crate) struct LimitedLineReader<R> {
    inner: BufReader<R>,
    frame: Vec<u8>,
    max_bytes: usize,
    discarding: bool,
}

impl<R> LimitedLineReader<R>
where
    R: AsyncRead + Unpin,
{
    pub(crate) fn new(reader: R) -> Self {
        Self::with_limit(reader, MAX_PROTOCOL_LINE_BYTES)
    }

    pub(crate) fn with_limit(reader: R, max_bytes: usize) -> Self {
        Self {
            inner: BufReader::new(reader),
            frame: Vec::with_capacity(max_bytes.min(64 * 1024)),
            max_bytes,
            discarding: false,
        }
    }

    pub(crate) async fn next_line(&mut self) -> Result<Option<String>, LineReadError> {
        loop {
            let available = self.inner.fill_buf().await.map_err(LineReadError::Io)?;
            if available.is_empty() {
                if self.discarding {
                    self.discarding = false;
                    return Err(LineReadError::TooLong {
                        limit: self.max_bytes,
                    });
                }
                if self.frame.is_empty() {
                    return Ok(None);
                }
                return Ok(Some(self.take_frame()));
            }

            let newline = available.iter().position(|byte| *byte == b'\n');
            let payload_len = newline.unwrap_or(available.len());
            if self.discarding || self.frame.len().saturating_add(payload_len) > self.max_bytes {
                self.discarding = true;
                self.frame.clear();
            } else {
                self.frame.extend_from_slice(&available[..payload_len]);
            }
            let consumed = newline.map_or(payload_len, |index| index + 1);
            self.inner.consume(consumed);

            if newline.is_some() {
                if self.discarding {
                    self.discarding = false;
                    return Err(LineReadError::TooLong {
                        limit: self.max_bytes,
                    });
                }
                return Ok(Some(self.take_frame()));
            }
        }
    }

    fn take_frame(&mut self) -> String {
        if self.frame.last() == Some(&b'\r') {
            self.frame.pop();
        }
        let frame = String::from_utf8_lossy(&self.frame).into_owned();
        self.frame.clear();
        frame
    }
}

#[derive(Default)]
pub(crate) struct CapturedTail {
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

/// Linha de stderr repassada ao vivo acima disto é descartada (a cauda
/// continua com os bytes): estado de motor cabe numa linha curta.
const STDERR_LIVE_LINE_BYTES: usize = 4096;
/// Fila das linhas ao vivo. Cheia, a linha nova cai: quem lê é o loop do run,
/// e stderr barulhento não pode reter memória nem travar a drenagem.
pub(crate) const STDERR_LIVE_QUEUE: usize = 256;

/// Drena bytes crus para não permitir que uma linha sem `\n` cresça sem teto.
pub(crate) async fn collect_stderr_tail<R>(reader: R) -> CapturedTail
where
    R: AsyncRead + Unpin,
{
    collect_stderr_tail_live(reader, None).await
}

/// Igual a `collect_stderr_tail`, e ainda repassa cada linha completa (até
/// `STDERR_LIVE_LINE_BYTES`) para quem precisa reagir durante o turno.
pub(crate) async fn collect_stderr_tail_live<R>(
    mut reader: R,
    live: Option<tokio::sync::mpsc::Sender<String>>,
) -> CapturedTail
where
    R: AsyncRead + Unpin,
{
    let mut linha = Vec::<u8>::new();
    let mut linha_estourou = false;
    let mut retained = vec![0_u8; STDERR_TAIL_BYTES];
    let mut retained_len = 0usize;
    let mut write_at = 0usize;
    let mut chunk = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        if let Some(tx) = &live {
            for &byte in &chunk[..read] {
                if byte == b'\n' {
                    if !linha_estourou {
                        let texto = String::from_utf8_lossy(&linha);
                        let _ = tx.try_send(texto.trim_end_matches('\r').to_string());
                    }
                    linha.clear();
                    linha_estourou = false;
                } else if linha.len() < STDERR_LIVE_LINE_BYTES {
                    linha.push(byte);
                } else {
                    linha_estourou = true;
                }
            }
        }
        if read >= STDERR_TAIL_BYTES {
            retained.copy_from_slice(&chunk[read - STDERR_TAIL_BYTES..read]);
            retained_len = STDERR_TAIL_BYTES;
            write_at = 0;
            truncated = true;
            continue;
        }
        if retained_len.saturating_add(read) > STDERR_TAIL_BYTES {
            truncated = true;
        }
        let first = read.min(STDERR_TAIL_BYTES - write_at);
        retained[write_at..write_at + first].copy_from_slice(&chunk[..first]);
        let remaining = read - first;
        if remaining > 0 {
            retained[..remaining].copy_from_slice(&chunk[first..read]);
        }
        write_at = (write_at + read) % STDERR_TAIL_BYTES;
        retained_len = retained_len.saturating_add(read).min(STDERR_TAIL_BYTES);
    }
    let ordered = if retained_len < STDERR_TAIL_BYTES {
        retained[..retained_len].to_vec()
    } else {
        retained[write_at..]
            .iter()
            .chain(&retained[..write_at])
            .copied()
            .collect()
    };
    CapturedTail {
        text: String::from_utf8_lossy(&ordered).into_owned(),
        truncated,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProcessObservation {
    /// `None` significa que o sistema operacional não respondeu à sonda.
    pub(crate) main_alive: Option<bool>,
    pub(crate) descendants: Option<u32>,
    pub(crate) rss_mb: Option<u64>,
    pub(crate) root_rss_mb: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ResourceEvent {
    pub(crate) observation: ProcessObservation,
    /// Só sobe quando cruza um novo patamar. RSS descreve recurso, nunca
    /// progresso do agente.
    pub(crate) warning_rss_mb: Option<u64>,
}

pub(crate) struct ProcessMemoryWatch {
    root_pid: Option<u32>,
    interval: Interval,
    next_warning: usize,
}

impl ProcessMemoryWatch {
    pub(crate) fn new(child_pid: Option<u32>) -> Self {
        Self {
            root_pid: child_pid,
            interval: tokio::time::interval(MEMORY_POLL_INTERVAL),
            next_warning: 0,
        }
    }

    pub(crate) async fn next(&mut self) -> ResourceEvent {
        self.interval.tick().await;
        let observation = process_tree_observation(self.root_pid).await;
        let mut warning_rss_mb = None;
        if let Some(rss_mb) = observation.rss_mb {
            if MEMORY_WARNING_LEVELS_MB
                .get(self.next_warning)
                .is_some_and(|threshold| rss_mb >= *threshold)
            {
                while MEMORY_WARNING_LEVELS_MB
                    .get(self.next_warning)
                    .is_some_and(|level| rss_mb >= *level)
                {
                    self.next_warning += 1;
                }
                warning_rss_mb = Some(rss_mb);
            }
        }
        ResourceEvent {
            observation,
            warning_rss_mb,
        }
    }
}

pub(crate) fn format_memory_warning_message(rss_mb: u64, root_rss_mb: Option<u64>) -> String {
    let root = root_rss_mb.unwrap_or(0);
    let desc = rss_mb.saturating_sub(root);
    if desc > root && desc >= 512 {
        format!(
            "A árvore de processos deste run atingiu {rss_mb} MB (incluindo {desc} MB em comandos e compiladores filhos; o processo principal consome {root} MB) e continua rodando sem teto artificial. Use Parar se esse consumo não for intencional."
        )
    } else {
        format!(
            "Este run chegou a {rss_mb} MB de memória e continua rodando sem teto artificial. Use Parar se esse consumo não for intencional."
        )
    }
}

async fn process_tree_observation(root_pid: Option<u32>) -> ProcessObservation {
    let Some(root_pid) = root_pid else {
        return ProcessObservation {
            main_alive: None,
            descendants: None,
            rss_mb: None,
            root_rss_mb: None,
        };
    };
    #[cfg(unix)]
    {
        let output = Command::new("ps")
            .args(["-axo", "pid=,ppid=,rss="])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await
            .ok();
        match output.filter(|value| value.status.success()) {
            Some(output) => {
                process_tree_from_ps(&String::from_utf8_lossy(&output.stdout), root_pid)
            }
            None => ProcessObservation {
                main_alive: None,
                descendants: None,
                rss_mb: None,
                root_rss_mb: None,
            },
        }
    }
    #[cfg(not(unix))]
    {
        let _ = root_pid;
        ProcessObservation {
            main_alive: None,
            descendants: None,
            rss_mb: None,
            root_rss_mb: None,
        }
    }
}

fn process_tree_from_ps(table: &str, root_pid: u32) -> ProcessObservation {
    let rows = table
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            Some((
                fields.next()?.parse::<u32>().ok()?,
                fields.next()?.parse::<u32>().ok()?,
                fields.next()?.parse::<u64>().ok()?,
            ))
        })
        .collect::<Vec<_>>();
    if !rows.iter().any(|(pid, _, _)| *pid == root_pid) {
        return ProcessObservation {
            main_alive: Some(false),
            descendants: Some(0),
            rss_mb: Some(0),
            root_rss_mb: Some(0),
        };
    }

    let rss_by_pid = rows
        .iter()
        .map(|(pid, _, rss)| (*pid, *rss))
        .collect::<HashMap<_, _>>();
    let mut children = HashMap::<u32, Vec<u32>>::new();
    for (pid, ppid, _) in rows {
        children.entry(ppid).or_default().push(pid);
    }
    let mut seen = HashSet::from([root_pid]);
    let mut queue = VecDeque::from([root_pid]);
    while let Some(parent) = queue.pop_front() {
        for child in children.get(&parent).into_iter().flatten() {
            if seen.insert(*child) {
                queue.push_back(*child);
            }
        }
    }
    let root_rss_kb = rss_by_pid.get(&root_pid).copied().unwrap_or(0);
    let rss_kb = seen
        .iter()
        .filter_map(|pid| rss_by_pid.get(pid))
        .sum::<u64>();
    ProcessObservation {
        main_alive: Some(true),
        descendants: Some(seen.len().saturating_sub(1) as u32),
        rss_mb: Some(rss_kb / 1024),
        root_rss_mb: Some(root_rss_kb / 1024),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn stderr_tagarela_retem_so_os_64_kib_finais() {
        let (mut writer, reader) = tokio::io::duplex(128 * 1024);
        let payload = format!(
            "{}no rollout found for thread id 01a04fe4-1bf8-7701-9274-a6102f0361af\n",
            "x".repeat(STDERR_TAIL_BYTES + 100)
        );
        let write = tokio::spawn(async move {
            writer.write_all(payload.as_bytes()).await.unwrap();
        });
        let captured = collect_stderr_tail(reader).await;
        write.await.unwrap();
        assert!(captured.truncated);
        assert!(captured.text.len() <= STDERR_TAIL_BYTES);
        assert!(captured.text.contains("no rollout found for thread id"));
    }

    #[tokio::test]
    async fn stderr_ao_vivo_repassa_linhas_e_mantem_a_cauda() {
        // Linha real do agy 1.2.5 (testdata/agy-1.2.5/bg-sleep.stderr), escrita
        // em dois pedaços, depois de uma linha longa demais para ir ao vivo.
        let real = include_str!("../testdata/agy-1.2.5/bg-sleep.stderr");
        let (mut writer, reader) = tokio::io::duplex(64 * 1024);
        let (tx, mut rx) = tokio::sync::mpsc::channel(STDERR_LIVE_QUEUE);
        let longa = "y".repeat(STDERR_LIVE_LINE_BYTES + 10);
        let (a, b) = real.split_at(20);
        let (a, b, longa) = (a.to_string(), b.to_string(), longa.clone());
        let write = tokio::spawn(async move {
            writer.write_all(format!("{longa}\r\n").as_bytes()).await.unwrap();
            writer.write_all(a.as_bytes()).await.unwrap();
            writer.write_all(b.as_bytes()).await.unwrap();
        });
        let captured = collect_stderr_tail_live(reader, Some(tx)).await;
        write.await.unwrap();
        let mut linhas = Vec::new();
        while let Some(l) = rx.recv().await {
            linhas.push(l);
        }
        assert_eq!(linhas, vec![real.trim_end().to_string()]);
        assert!(captured.text.contains("root agent idle"));
    }

    #[tokio::test]
    async fn linha_sem_quebra_excede_teto_sem_crescer_o_frame() {
        let (mut writer, reader) = tokio::io::duplex(1024);
        let write = tokio::spawn(async move {
            writer.write_all(&vec![b'x'; 4097]).await.unwrap();
            writer
                .write_all(b"\n{\"type\":\"turn.completed\"}\n")
                .await
                .unwrap();
        });
        let mut lines = LimitedLineReader::with_limit(reader, 4096);
        assert!(matches!(
            lines.next_line().await,
            Err(LineReadError::TooLong { limit: 4096 })
        ));
        assert_eq!(
            lines.next_line().await.unwrap().unwrap(),
            "{\"type\":\"turn.completed\"}"
        );
        write.await.unwrap();
    }

    #[test]
    fn arvore_soma_apenas_raiz_e_descendentes_do_run() {
        // Fixture no formato real de `ps -axo pid=,ppid=,rss=`. O processo
        // 77 pertence a outro run e não pode contaminar memória nem contagem.
        let table = "10 1 1024\n11 10 2048\n12 11 3072\n77 1 8192\n";
        assert_eq!(
            process_tree_from_ps(table, 10),
            ProcessObservation {
                main_alive: Some(true),
                descendants: Some(2),
                rss_mb: Some(6),
                root_rss_mb: Some(1),
            }
        );
    }

    #[test]
    fn arvore_confirma_quando_o_processo_principal_morreu() {
        assert_eq!(
            process_tree_from_ps("77 1 8192\n", 10),
            ProcessObservation {
                main_alive: Some(false),
                descendants: Some(0),
                rss_mb: Some(0),
                root_rss_mb: Some(0),
            }
        );
    }

    #[test]
    fn aviso_de_memoria_diferencia_harness_de_filhos_pesados() {
        let msg = format_memory_warning_message(2048, Some(150));
        assert!(msg.contains("A árvore de processos deste run atingiu 2048 MB"));
        assert!(msg.contains("incluindo 1898 MB em comandos e compiladores filhos"));
        assert!(msg.contains("o processo principal consome 150 MB"));

        let msg_pura = format_memory_warning_message(2048, Some(1900));
        assert!(msg_pura.contains("Este run chegou a 2048 MB de memória"));
    }

    #[test]
    fn check_disk_quota_detecta_limites_e_ausencia() {
        let temp_dir = std::env::temp_dir();
        let missing = temp_dir.join("arquivo-que-nao-existe-1234567.log");
        assert_eq!(
            super::check_disk_quota(&missing, 1024),
            super::DiskQuotaCheck::FileNotFound
        );

        let test_file = temp_dir.join("test_quota_ok.tmp");
        std::fs::write(&test_file, b"1234567890").unwrap();
        assert_eq!(
            super::check_disk_quota(&test_file, 100),
            super::DiskQuotaCheck::WithinQuota(10)
        );
        assert_eq!(
            super::check_disk_quota(&test_file, 5),
            super::DiskQuotaCheck::Exceeded {
                size_bytes: 10,
                limit_bytes: 5,
            }
        );
        let _ = std::fs::remove_file(test_file);
    }
}
