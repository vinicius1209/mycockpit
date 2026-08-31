//! Limites de recursos dos processos de agent.
//!
//! stdout e stderr pertencem à fronteira de processo, portanto nenhum deles
//! pode decidir quanto o processo do Frota retém. O watchdog complementa esses
//! limites: um CLI também pode consumir memória dentro do próprio heap sem
//! publicar byte algum.

use std::fmt;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{Duration, Interval};

pub(crate) const MAX_PROTOCOL_LINE_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const STDERR_TAIL_BYTES: usize = 64 * 1024;
const MEMORY_WARNING_LEVELS_MB: [u64; 5] = [2 * 1024, 4 * 1024, 8 * 1024, 16 * 1024, 32 * 1024];
const MEMORY_POLL_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub(crate) enum LineReadError {
    Io(std::io::Error),
    TooLong { limit: usize },
}

impl fmt::Display for LineReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "falha lendo o stream do motor: {error}"),
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

    fn with_limit(reader: R, max_bytes: usize) -> Self {
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

/// Drena bytes crus para não permitir que uma linha sem `\n` cresça sem teto.
pub(crate) async fn collect_stderr_tail<R>(mut reader: R) -> CapturedTail
where
    R: AsyncRead + Unpin,
{
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
pub(crate) enum MemoryEvent {
    Warning { rss_mb: u64 },
}

pub(crate) struct ProcessMemoryWatch {
    pids: Vec<u32>,
    interval: Interval,
    next_warning: usize,
}

impl ProcessMemoryWatch {
    pub(crate) fn new(child_pid: Option<u32>) -> Self {
        let mut pids = vec![std::process::id()];
        if let Some(pid) = child_pid.filter(|pid| *pid != std::process::id()) {
            pids.push(pid);
        }
        Self {
            pids,
            interval: tokio::time::interval(MEMORY_POLL_INTERVAL),
            next_warning: 0,
        }
    }

    pub(crate) async fn next(&mut self) -> MemoryEvent {
        loop {
            self.interval.tick().await;
            let Some(rss_mb) = process_rss_mb(&self.pids).await else {
                continue;
            };
            let Some(threshold) = MEMORY_WARNING_LEVELS_MB.get(self.next_warning) else {
                std::future::pending::<()>().await;
                unreachable!();
            };
            if rss_mb >= *threshold {
                while MEMORY_WARNING_LEVELS_MB
                    .get(self.next_warning)
                    .is_some_and(|level| rss_mb >= *level)
                {
                    self.next_warning += 1;
                }
                return MemoryEvent::Warning { rss_mb };
            }
        }
    }
}

async fn process_rss_mb(pids: &[u32]) -> Option<u64> {
    #[cfg(unix)]
    {
        let pid_list = pids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let output = Command::new("ps")
            .args(["-o", "pid=,rss=", "-p", &pid_list])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await
            .ok()?;
        Some(rss_kb_for_pids(&String::from_utf8_lossy(&output.stdout), pids) / 1024)
    }
    #[cfg(not(unix))]
    {
        let _ = pids;
        None
    }
}

fn rss_kb_for_pids(table: &str, pids: &[u32]) -> u64 {
    table
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse::<u32>().ok()?;
            let rss = fields.next()?.parse::<u64>().ok()?;
            pids.contains(&pid).then_some(rss)
        })
        .sum()
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
    fn soma_apenas_o_rss_dos_processos_observados() {
        let table = "94445 131072\n95402 3145728\n94461 390144\n";
        assert_eq!(rss_kb_for_pids(table, &[94445, 95402]), 3_276_800);
    }
}
