//! Evidência VISUAL de tool_result (browser-plan B1). Um MCP que devolve
//! imagem (Playwright screenshot, etc.) manda o payload como base64 dentro do
//! content do tool_result; antes o adapter resumia a texto e DESCARTAVA o
//! bloco — o screenshot existia e ninguém via. Aqui o base64 vira ARQUIVO em
//! `app_data_dir()/evidence/<convId>/<toolId>-<idx>.<ext>` e o evento
//! normalizado carrega só o path RELATIVO ("evidence/<convId>/<file>") —
//! nunca base64 no Channel nem no SQLite (mesma doutrina dos anexos).
//!
//! Capability AGNÓSTICA: qualquer provider cujo transporte reporte blocos de
//! imagem usa o mesmo sink (Claude stream-json + Codex app-server hoje);
//! transporte sem imagem degrada honesto (Vec vazio = comportamento atual).

use std::path::PathBuf;
use tauri::Manager;

/// Destino de gravação da evidência de UMA conversa. `dir` é o diretório
/// ABSOLUTO em disco; `rel_prefix` é o prefixo do path RELATIVO ao
/// app_data_dir que vai no evento ("evidence/<convId>"). Separados para o
/// sink ser testável sem AppHandle.
pub struct EvidenceSink {
    dir: PathBuf,
    rel_prefix: String,
}

impl EvidenceSink {
    pub fn new(dir: PathBuf, rel_prefix: String) -> Self {
        Self { dir, rel_prefix }
    }

    /// Sink da conversa via app_data_dir. None = sem app_data_dir (degrada
    /// sem evidência, nunca derruba o run).
    pub fn for_conv(app: &tauri::AppHandle, conv_id: &str) -> Option<Self> {
        let root = app.path().app_data_dir().ok()?;
        let conv = sanitize_conv_id(conv_id);
        if conv.is_empty() {
            return None;
        }
        Some(Self::new(
            root.join("evidence").join(&conv),
            format!("evidence/{conv}"),
        ))
    }

    /// Grava UM bloco de imagem (bytes já decodificados). Nome DETERMINÍSTICO
    /// (toolId + índice do bloco + extensão do media_type): replay do mesmo
    /// evento sobrescreve o mesmo arquivo (idempotente). Retorna o path
    /// relativo ao app_data_dir, ou None (tipo desconhecido/erro de disco,
    /// com rastro no log — nunca pânico no meio do stream).
    pub fn write(&self, tool_id: &str, idx: usize, media_type: &str, bytes: &[u8]) -> Option<String> {
        let ext = ext_for_media_type(media_type)?;
        if let Err(e) = std::fs::create_dir_all(&self.dir) {
            log::warn!("evidência: não criei {:?}: {e}", self.dir);
            return None;
        }
        let name = format!("{}-{idx}.{ext}", sanitize_tool_id(tool_id));
        if let Err(e) = std::fs::write(self.dir.join(&name), bytes) {
            log::warn!("evidência: não gravei {name}: {e}");
            return None;
        }
        Some(format!("{}/{name}", self.rel_prefix))
    }
}

/// Extrai e GRAVA os blocos `image` do content de um tool_result; retorna os
/// paths relativos. Aceita os DOIS shapes reais:
///   • Anthropic/stream-json: `{type:"image", source:{type:"base64", media_type, data}}`
///   • MCP CallToolResult:    `{type:"image", data:"…", mimeType:"image/png"}`
/// `content` que não é array (string, null) → vazio. Sink None (sem
/// app_data_dir) → vazio. Fail-open: bloco malformado é pulado, o texto do
/// tool_result segue o fluxo de sempre.
pub fn collect_images(
    sink: Option<&EvidenceSink>,
    tool_id: &str,
    content: &serde_json::Value,
) -> Vec<String> {
    let Some(sink) = sink else {
        return Vec::new();
    };
    let Some(blocks) = content.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for block in blocks {
        if block.get("type").and_then(|x| x.as_str()) != Some("image") {
            continue;
        }
        let (media_type, data) = match block.get("source") {
            // shape Anthropic: source.type precisa ser base64 (URL não é payload)
            Some(src) => {
                if src.get("type").and_then(|x| x.as_str()) != Some("base64") {
                    continue;
                }
                (
                    src.get("media_type").and_then(|x| x.as_str()),
                    src.get("data").and_then(|x| x.as_str()),
                )
            }
            // shape MCP: data/mimeType no próprio bloco
            None => (
                block.get("mimeType").and_then(|x| x.as_str()),
                block.get("data").and_then(|x| x.as_str()),
            ),
        };
        let (Some(media_type), Some(data)) = (media_type, data) else {
            continue;
        };
        let Some(bytes) = decode_base64(data) else {
            log::warn!("evidência: base64 inválido no bloco de imagem de {tool_id}");
            continue;
        };
        // idx = posição entre os blocos de IMAGEM (não do content inteiro):
        // determinístico e denso (tool com 2 capturas → -0 e -1).
        if let Some(rel) = sink.write(tool_id, out.len(), media_type, &bytes) {
            out.push(rel);
        }
    }
    out
}

/// Allowlist de media_type → extensão (mesma régua dos anexos). None = tipo
/// não-imagem/desconhecido, pulado com honestidade (nunca grava .bin cego).
fn ext_for_media_type(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

/// convId vira nome de pasta: só hex/dash (blinda traversal; espelha attachments).
fn sanitize_conv_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_hexdigit() || *c == '-')
        .collect()
}

/// toolId vira nome de arquivo: [A-Za-z0-9._-], resto vira '_'. Vazio → "tool".
fn sanitize_tool_id(id: &str) -> String {
    let s: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() { "tool".to_string() } else { s }
}

/// Decodifica base64 padrão (tolerante a whitespace/quebras de linha, que
/// alguns transportes inserem). Sem crate novo: a tabela é fixa e o payload é
/// nosso conhecido (data URI-less, padding opcional).
fn decode_base64(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &c in s.as_bytes() {
        if c.is_ascii_whitespace() || c == b'=' {
            continue;
        }
        let v = val(c)?;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

// ---------------- comandos (leitura + abrir no app padrão) ----------------

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))
}

/// Resolve um path RELATIVO ao app_data_dir com contenção sob `root_name`
/// ("evidence" ou "attachments") — mesma checagem anti-traversal do
/// read_attachment. Erro = path forjado ou arquivo sumido.
fn contained(app: &tauri::AppHandle, root_name: &str, path: &str) -> Result<PathBuf, String> {
    let base = app_data(app)?;
    let root = base.join(root_name);
    let canon_root = root.canonicalize().unwrap_or(root);
    match base.join(path).canonicalize() {
        Ok(canon) if canon.is_file() && canon.starts_with(&canon_root) => Ok(canon),
        _ => Err("caminho de evidência inválido".to_string()),
    }
}

/// Bytes de uma evidência p/ o thumbnail/lightbox (espelho do read_attachment).
#[tauri::command]
pub async fn read_evidence(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    let abs = contained(&app, "evidence", &path)?;
    std::fs::read(&abs).map_err(|e| e.to_string())
}

/// Abre uma imagem do fio (evidência OU anexo do usuário) no app padrão do
/// SO, via plugin opener já registrado. O path continua RELATIVO e contido —
/// o front nunca manda path absoluto/arbitrário.
#[tauri::command]
pub async fn open_conv_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = if path.starts_with("evidence/") {
        "evidence"
    } else {
        "attachments"
    };
    let abs = contained(&app, root, &path)?;
    app.opener()
        .open_path(abs.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("não consegui abrir no app padrão: {e}"))
}

/// Mostra a imagem do fio na pasta dela (Finder no macOS, gerenciador de
/// arquivos no Linux) — item "Mostrar na pasta" do menu de contexto
/// (ADR-042). Passa pela MESMA contenção do open_conv_image em vez de usar o
/// `opener:allow-reveal-item-in-dir` direto do JS: assim o front continua sem
/// poder mandar path absoluto/arbitrário pro SO.
#[tauri::command]
pub async fn reveal_conv_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = if path.starts_with("evidence/") {
        "evidence"
    } else {
        "attachments"
    };
    let abs = contained(&app, root, &path)?;
    app.opener()
        .reveal_item_in_dir(abs)
        .map_err(|e| format!("não consegui mostrar na pasta: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_sink(tag: &str) -> (EvidenceSink, PathBuf) {
        let dir = std::env::temp_dir().join(format!("mc-evidence-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (
            EvidenceSink::new(dir.clone(), "evidence/conv-1".to_string()),
            dir,
        )
    }

    // 1×1 PNG real (67 bytes), o menor fixture honesto possível.
    const PNG_1X1_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    #[test]
    fn bloco_anthropic_vira_arquivo_com_nome_deterministico() {
        let (sink, dir) = tmp_sink("anthropic");
        let content = json!([
            { "type": "text", "text": "Took screenshot" },
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": PNG_1X1_B64 } }
        ]);
        let paths = collect_images(Some(&sink), "toolu_01AbC", &content);
        assert_eq!(paths, vec!["evidence/conv-1/toolu_01AbC-0.png"]);
        let bytes = std::fs::read(dir.join("toolu_01AbC-0.png")).unwrap();
        // PNG de verdade no disco (magic bytes), não o base64 recopiado.
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bloco_mcp_data_mime_type_tambem_e_aceito() {
        let (sink, dir) = tmp_sink("mcp");
        let content = json!([
            { "type": "image", "data": PNG_1X1_B64, "mimeType": "image/png" }
        ]);
        let paths = collect_images(Some(&sink), "call_9", &content);
        assert_eq!(paths, vec!["evidence/conv-1/call_9-0.png"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duas_imagens_ganham_indices_densos() {
        let (sink, dir) = tmp_sink("dois");
        let content = json!([
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": PNG_1X1_B64 } },
            { "type": "text", "text": "meio" },
            { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": PNG_1X1_B64 } }
        ]);
        let paths = collect_images(Some(&sink), "t1", &content);
        assert_eq!(
            paths,
            vec!["evidence/conv-1/t1-0.png", "evidence/conv-1/t1-1.jpg"]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sem_sink_ou_sem_imagem_degrada_vazio() {
        let content = json!([{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": PNG_1X1_B64 } }]);
        assert!(collect_images(None, "t", &content).is_empty());
        let (sink, dir) = tmp_sink("texto");
        assert!(collect_images(Some(&sink), "t", &json!("string pura")).is_empty());
        assert!(collect_images(Some(&sink), "t", &json!([{ "type": "text", "text": "x" }])).is_empty());
        // nada foi criado no disco
        assert!(!dir.exists());
    }

    #[test]
    fn media_type_desconhecido_e_base64_invalido_sao_pulados() {
        let (sink, dir) = tmp_sink("ruins");
        let content = json!([
            { "type": "image", "source": { "type": "base64", "media_type": "image/tiff", "data": PNG_1X1_B64 } },
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "%%%não-base64%%%" } },
            { "type": "image", "source": { "type": "url", "media_type": "image/png", "data": "https://x/y.png" } }
        ]);
        assert!(collect_images(Some(&sink), "t", &content).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tool_id_hostil_e_sanitizado_no_nome_do_arquivo() {
        let (sink, dir) = tmp_sink("hostil");
        let content = json!([
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": PNG_1X1_B64 } }
        ]);
        let paths = collect_images(Some(&sink), "../../etc/passwd", &content);
        assert_eq!(paths, vec!["evidence/conv-1/.._.._etc_passwd-0.png"]);
        // o arquivo mora DENTRO do dir do sink, não subiu a árvore
        assert!(dir.join(".._.._etc_passwd-0.png").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn decode_base64_tolera_quebras_de_linha_e_padding() {
        let com_quebras = format!(
            "{}\n{}",
            &PNG_1X1_B64[..40],
            &PNG_1X1_B64[40..]
        );
        assert_eq!(
            decode_base64(&com_quebras),
            decode_base64(PNG_1X1_B64)
        );
        assert!(decode_base64("abc!").is_none());
    }
}
