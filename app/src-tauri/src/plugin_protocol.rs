//! Protocolo fechado entre a Frota e um worker de plugin.
//!
//! JSON Lines é intencionalmente simples e agnóstico de linguagem. Frames têm
//! limite antes da desserialização; stdout é protocolo, stderr é log sanitizado.

use serde::Deserialize;
use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};

pub(crate) const PROTOCOL_VERSION: u8 = 1;
pub(crate) const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Reserva espaço para envelopes do socket pai e do MCP sem aceitar um output
/// que caiba no worker, mas estoure ao ser materializado para o provider.
pub(crate) const MAX_RESULT_BYTES: usize = MAX_FRAME_BYTES - 16 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum WorkerMessage {
    Ready {
        #[serde(rename = "protocolVersion")]
        protocol_version: u8,
        tools: Vec<String>,
    },
    Result {
        #[serde(rename = "requestId")]
        request_id: String,
        output: Value,
    },
    Error {
        #[serde(rename = "requestId")]
        request_id: String,
        error: String,
    },
    Log {
        level: String,
        message: String,
    },
    Fatal {
        error: String,
    },
}

fn parse_frame(frame: &[u8]) -> Result<Value, String> {
    if frame.is_empty() {
        return Err("worker enviou frame vazio".into());
    }
    serde_json::from_slice(frame).map_err(|error| format!("frame inválido do worker: {error}"))
}

pub(crate) async fn read_value<R>(reader: &mut R) -> Result<Value, String>
where
    R: AsyncBufRead + Unpin,
{
    let mut frame = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|error| format!("falha lendo worker: {error}"))?;
        if available.is_empty() {
            return if frame.is_empty() {
                Err("worker encerrou o protocolo sem responder".into())
            } else {
                parse_frame(&frame)
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let payload_len = newline.unwrap_or(available.len());
        if frame.len().saturating_add(payload_len) > MAX_FRAME_BYTES {
            return Err(format!(
                "worker excedeu o limite de {} KiB por frame",
                MAX_FRAME_BYTES / 1024
            ));
        }
        frame.extend_from_slice(&available[..payload_len]);
        let consumed = newline.map_or(payload_len, |index| index + 1);
        reader.consume(consumed);
        if newline.is_some() {
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return parse_frame(&frame);
        }
    }
}

pub(crate) async fn read_message<R>(reader: &mut R) -> Result<WorkerMessage, String>
where
    R: AsyncBufRead + Unpin,
{
    serde_json::from_value(read_value(reader).await?)
        .map_err(|error| format!("mensagem inválida do worker: {error}"))
}

pub(crate) async fn write_value<W>(writer: &mut W, value: &Value) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    let mut encoded = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_FRAME_BYTES {
        return Err(format!(
            "pedido excede o limite de {} KiB por frame",
            MAX_FRAME_BYTES / 1024
        ));
    }
    encoded.push(b'\n');
    writer
        .write_all(&encoded)
        .await
        .map_err(|error| format!("falha escrevendo no worker: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("falha entregando pedido ao worker: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn protocolo_rejeita_campo_desconhecido_e_frame_grande() {
        let input = b"{\"type\":\"ready\",\"protocolVersion\":1,\"tools\":[],\"extra\":true}\n";
        let mut reader = BufReader::new(&input[..]);
        assert!(read_message(&mut reader).await.is_err());

        let oversized = vec![b'x'; MAX_FRAME_BYTES + 1];
        let mut reader = BufReader::new(&oversized[..]);
        assert!(read_message(&mut reader).await.is_err());
    }

    #[tokio::test]
    async fn protocolo_lê_resultado_real_sem_perder_json_estruturado() {
        let input = b"{\"type\":\"result\",\"requestId\":\"call-1\",\"output\":{\"ok\":true}}\n";
        let mut reader = BufReader::new(&input[..]);
        match read_message(&mut reader).await.unwrap() {
            WorkerMessage::Result { request_id, output } => {
                assert_eq!(request_id, "call-1");
                assert_eq!(output["ok"], true);
            }
            message => panic!("mensagem inesperada: {message:?}"),
        }
    }
}
