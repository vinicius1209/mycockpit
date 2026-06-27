//! v0.2.x — anexos (imagem + PDF). Salva bytes colados/escolhidos em disco
//! estável, valida por magic-bytes (não confia no clipboard) e resolve caminhos.
//!
//! Layout: `app_data_dir()/attachments/<convId>/<hash16>.<ext>` (blob = conteúdo).
//! O DB guarda só o path RELATIVO "attachments/<convId>/<file>" — a linha do DB é
//! a verdade; o blob é retido enquanto a conversa vive (TTL/LRU + wipe ao deletar).
//! Invariante de segurança: o NOME original do usuário é só display (chip), nunca
//! vira caminho de disco (usamos o hash) nem é injetado no prompt.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Tipo do anexo, derivado do MIME sniffado. `render_attachments` do adapter casa
/// com isso; `Other` nunca deve chegar nos adapters (allowlist barra antes).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentKind {
    Image,
    Pdf,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attachment {
    /// RELATIVO ao app_data_dir: "attachments/<convId>/<hash16>.<ext>".
    pub path: String,
    /// Nome original — SÓ display (chip). Nunca usado em path de disco nem no prompt.
    pub name: String,
    pub kind: AttachmentKind,
    /// MIME sniffado (magic bytes), já dentro da allowlist.
    pub mime: String,
    /// Tamanho em bytes (nunca o payload).
    pub bytes: u64,
}

/// Referência de conversa p/ o GC (id + recência autoritativa do DB). (A5)
#[allow(dead_code)] // construído na A5 (gc_attachments)
#[derive(Clone, Debug, Deserialize)]
pub struct ConvRef {
    pub id: String,
    pub updated_at: i64,
}

/// 10 MB por arquivo (validado no JS antes de materializar + aqui no backstop).
const MAX_BYTES: u64 = 10 * 1024 * 1024;
/// Teto global do cache de anexos; ao passar, evicta por LRU até a marca baixa.
const CAP_BYTES: u64 = 256 * 1024 * 1024;
const LOW_WATER: u64 = 205 * 1024 * 1024;

// ---------------- helpers puros ----------------

/// Allowlist pós-sniff → extensão canônica. None = tipo rejeitado.
fn ext_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "application/pdf" => Some("pdf"),
        _ => None,
    }
}

pub fn classify(mime: &str) -> AttachmentKind {
    if mime == "application/pdf" {
        AttachmentKind::Pdf
    } else if mime.starts_with("image/") {
        AttachmentKind::Image
    } else {
        AttachmentKind::Other
    }
}

/// MIME pelos magic bytes (não confia no `type` do clipboard). None = desconhecido.
pub fn sniff(bytes: &[u8]) -> Option<String> {
    infer::get(bytes).map(|t| t.mime_type().to_string())
}

/// blake3 truncado a 16 hex — nome do arquivo + dedup por-conversa.
pub fn hash16(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex()[..16].to_string()
}

/// convId só pode ser hex/uuid — blinda contra path traversal no nome da pasta.
fn sanitize_conv_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_hexdigit() || *c == '-')
        .collect()
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))
}

pub fn attachments_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("attachments"))
}

pub fn conv_dir(app: &AppHandle, conv_id: &str) -> Result<PathBuf, String> {
    Ok(attachments_root(app)?.join(sanitize_conv_id(conv_id)))
}

/// Escrita atômica (.tmp + rename) com permissão 0600 — evita blob meio-escrito.
fn write_atomic(abs: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let name = abs
        .file_name()
        .ok_or("caminho sem nome")?
        .to_string_lossy()
        .to_string();
    let tmp = abs.with_file_name(format!(".{name}.tmp"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, abs).map_err(|e| e.to_string())
}

/// Tamanho + mtime de uma pasta (soma rasa dos arquivos diretos — basta p/ o cap).
fn dir_size_mtime(dir: &Path) -> (u64, std::time::SystemTime) {
    let mut size = 0u64;
    let mut mtime = std::time::UNIX_EPOCH;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    size += m.len();
                    if let Ok(t) = m.modified() {
                        if t > mtime {
                            mtime = t;
                        }
                    }
                }
            }
        }
    }
    (size, mtime)
}

/// Teto no INGEST (guardião primário — F2): se o total passar de CAP, evicta
/// pastas por mtime ascendente (a pasta ativa tem mtime fresco → protegida) até
/// LOW_WATER. Sem ConvRef aqui; mtime-de-pasta é proxy seguro porque a pasta
/// sendo escrita agora é a mais recente.
fn enforce_cap(app: &AppHandle) -> Result<(), String> {
    let root = attachments_root(app)?;
    let mut total = 0u64;
    let mut dirs: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                let (size, mtime) = dir_size_mtime(&p);
                total += size;
                dirs.push((p, mtime, size));
            }
        }
    }
    if total <= CAP_BYTES {
        return Ok(());
    }
    dirs.sort_by_key(|(_, mtime, _)| *mtime); // mais antigas primeiro
    for (p, _, size) in dirs {
        if total <= LOW_WATER {
            break;
        }
        let _ = std::fs::remove_dir_all(&p);
        total = total.saturating_sub(size);
    }
    Ok(())
}

/// Núcleo comum de save_attachment/attach_path: valida tamanho, sniffa o MIME,
/// aplica allowlist, grava atômico (dedup por hash) e aplica o teto.
fn save_to_disk(
    app: &AppHandle,
    conv_id: &str,
    name: &str,
    declared_mime: Option<String>,
    bytes: &[u8],
) -> Result<Attachment, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(format!(
            "\"{name}\" excede {} MB",
            MAX_BYTES / 1024 / 1024
        ));
    }
    // sniff dos magic bytes manda; o declared_mime do clipboard é só fallback.
    let mime = sniff(bytes)
        .or(declared_mime)
        .ok_or_else(|| "não consegui identificar o tipo do arquivo".to_string())?;
    let ext = ext_for_mime(&mime).ok_or_else(|| format!("tipo não suportado: {mime}"))?;

    let dir = conv_dir(app, conv_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let fname = format!("{}.{ext}", hash16(bytes));
    let abs = dir.join(&fname);
    if !abs.exists() {
        // dedup por-conversa: mesmo conteúdo → mesmo arquivo, não reescreve.
        write_atomic(&abs, bytes)?;
    }
    enforce_cap(app)?;

    Ok(Attachment {
        path: format!("attachments/{}/{}", sanitize_conv_id(conv_id), fname),
        name: name.to_string(),
        kind: classify(&mime),
        mime,
        bytes: bytes.len() as u64,
    })
}

// ---------------- comandos Tauri ----------------

/// Salva bytes colados (clipboard) → Attachment. `declared_mime` vem do clipboard
/// (não-confiável); o sniff decide de verdade.
#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    conv_id: String,
    name: String,
    declared_mime: String,
    bytes: Vec<u8>,
) -> Result<Attachment, String> {
    let declared = if declared_mime.is_empty() {
        None
    } else {
        Some(declared_mime)
    };
    save_to_disk(&app, &conv_id, &name, declared, &bytes)
}

/// Anexa um arquivo já em disco (file picker). Checa o tamanho ANTES de ler o
/// payload (F8) e copia p/ o cache (estabilidade: o original pode sumir/mudar).
#[tauri::command]
pub async fn attach_path(
    app: AppHandle,
    conv_id: String,
    src_path: String,
) -> Result<Attachment, String> {
    let meta = std::fs::metadata(&src_path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err(format!("excede {} MB", MAX_BYTES / 1024 / 1024));
    }
    let bytes = std::fs::read(&src_path).map_err(|e| e.to_string())?;
    let name = Path::new(&src_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "anexo".to_string());
    save_to_disk(&app, &conv_id, &name, None, &bytes)
}

/// Remove um anexo individual (chip pré-envio ou botão no histórico). `path` é o
/// relativo do Attachment; valida que resolve DENTRO de attachments/ (anti-traversal).
#[tauri::command]
pub async fn delete_attachment(app: AppHandle, path: String) -> Result<(), String> {
    let root = attachments_root(&app)?;
    let abs = app_data(&app)?.join(&path);
    let canon_root = root.canonicalize().unwrap_or(root);
    match abs.canonicalize() {
        Ok(canon) if canon.starts_with(&canon_root) => {
            let _ = std::fs::remove_file(&canon);
            Ok(())
        }
        _ => Err("caminho de anexo inválido".to_string()),
    }
}

// ---------------- suporte ao run + GC (A4/A5) ----------------

/// Conversas com run em andamento — o GC pula a pasta delas (não apaga um blob que
/// o agent ainda vai ler). Refcount p/ robustez (F23).
#[derive(Default)]
pub struct ActiveConvs(pub Mutex<HashMap<String, usize>>);

impl ActiveConvs {
    pub fn insert(&self, conv_id: &str) {
        if let Ok(mut m) = self.0.lock() {
            *m.entry(conv_id.to_string()).or_insert(0) += 1;
        }
    }
    pub fn remove(&self, conv_id: &str) {
        if let Ok(mut m) = self.0.lock() {
            if let Some(c) = m.get_mut(conv_id) {
                *c = c.saturating_sub(1);
                if *c == 0 {
                    m.remove(conv_id);
                }
            }
        }
    }
    #[allow(dead_code)] // usado na A5 (gc_attachments)
    pub fn contains(&self, conv_id: &str) -> bool {
        self.0
            .lock()
            .map(|m| m.contains_key(conv_id))
            .unwrap_or(false)
    }
}

/// Anexos (path RELATIVO, vindos do JS) → path ABSOLUTO; descarta os que sumiram do
/// disco (o GC pode ter limpado). Retorna (vivos com path absoluto, nº de sumidos).
pub fn resolve_live(app: &AppHandle, atts: Vec<Attachment>) -> (Vec<Attachment>, usize) {
    let base = match app_data(app) {
        Ok(b) => b,
        Err(_) => return (Vec::new(), atts.len()),
    };
    let mut live = Vec::new();
    let mut missing = 0usize;
    for mut a in atts {
        let abs = base.join(&a.path);
        if abs.is_file() {
            a.path = abs.to_string_lossy().to_string();
            live.push(a);
        } else {
            missing += 1;
        }
    }
    (live, missing)
}

// ---------------- GC (A5) — garante que o cache NÃO acumula pra sempre ----------------

const TTL_MS: i64 = 30 * 24 * 3600 * 1000; // 30 dias desde o ÚLTIMO uso da conversa
const GC_THROTTLE_MS: i64 = 24 * 3600 * 1000; // roda no máx 1×/24h

#[derive(Serialize, Default)]
pub struct GcSummary {
    pub freed_bytes: u64,
    pub removed_dirs: usize,
    pub skipped: bool,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Nome de pasta de conversa válido: uuid (36, hex+dashes) ou 32-hex. Blinda o
/// sweep contra apagar dotfiles (.gc-meta) ou arquivos soltos (F4).
fn is_conv_dir_name(name: &str) -> bool {
    if name.starts_with('.') {
        return false;
    }
    let n = name.len();
    (n == 32 || n == 36) && name.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn recently_gced(meta: &Path) -> bool {
    std::fs::read_to_string(meta)
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .map(|last| now_ms().saturating_sub(last) < GC_THROTTLE_MS)
        .unwrap_or(false)
}

/// Remove .*.tmp órfãos (crash no meio da escrita atômica) com idade > 1h.
fn sweep_tmp(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name.ends_with(".tmp") {
                if let Ok(m) = e.metadata() {
                    if m.modified()
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .map(|d| d.as_secs() > 3600)
                        .unwrap_or(false)
                    {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
        }
    }
}

/// LRU por `updatedAt` da CONVERSA (não mtime do arquivo — F3/F5): evicta as menos
/// recentes até LOW_WATER. Pula conversas com run ativo (F23).
fn lru_evict(
    root: &Path,
    updated: &HashMap<String, i64>,
    active: &ActiveConvs,
    s: &mut GcSummary,
) {
    let mut total = 0u64;
    let mut dirs: Vec<(String, PathBuf, u64, i64)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && is_conv_dir_name(&name) {
                let (size, _) = dir_size_mtime(&p);
                total += size;
                let upd = updated.get(&name).copied().unwrap_or(0); // desconhecido = mais antigo
                dirs.push((name, p, size, upd));
            }
        }
    }
    if total <= CAP_BYTES {
        return;
    }
    dirs.sort_by_key(|(_, _, _, upd)| *upd); // menos recente primeiro
    for (name, p, size, _) in dirs {
        if total <= LOW_WATER {
            break;
        }
        if active.contains(&name) {
            continue;
        }
        if std::fs::remove_dir_all(&p).is_ok() {
            total = total.saturating_sub(size);
            s.freed_bytes += size;
            s.removed_dirs += 1;
        }
    }
}

/// GC do cache de anexos (chamado no boot com os ConvRef autoritativos do DB).
/// Ordem: throttle → (tmp-sweep + orphan + TTL por pasta) → LRU. Pula run ativo.
#[tauri::command]
pub async fn gc_attachments(
    app: AppHandle,
    valid_convs: Vec<ConvRef>,
    active: tauri::State<'_, ActiveConvs>,
) -> Result<GcSummary, String> {
    let root = attachments_root(&app)?;
    if !root.exists() {
        return Ok(GcSummary::default());
    }
    let meta = root.join(".gc-meta");
    if recently_gced(&meta) {
        return Ok(GcSummary {
            skipped: true,
            ..Default::default()
        });
    }

    let valid: HashSet<String> = valid_convs.iter().map(|c| sanitize_conv_id(&c.id)).collect();
    let updated: HashMap<String, i64> = valid_convs
        .iter()
        .map(|c| (sanitize_conv_id(&c.id), c.updated_at))
        .collect();

    let mut conv_dirs: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && is_conv_dir_name(&name) {
                conv_dirs.push((name, p));
            }
        }
    }

    let mut s = GcSummary::default();
    let now = now_ms();
    // F1: orphan sweep só roda com lista de refs NÃO-vazia (deletar-tudo é só wipe).
    let do_orphans = !valid.is_empty();

    for (name, p) in &conv_dirs {
        if active.contains(name) {
            continue; // F23: run ativo → não toca
        }
        sweep_tmp(p);
        let is_orphan = do_orphans && !valid.contains(name);
        let expired = updated
            .get(name)
            .map(|&u| now.saturating_sub(u) > TTL_MS)
            .unwrap_or(false);
        if is_orphan || expired {
            let (size, _) = dir_size_mtime(p);
            if std::fs::remove_dir_all(p).is_ok() {
                s.freed_bytes += size;
                s.removed_dirs += 1;
            }
        }
    }

    lru_evict(&root, &updated, active.inner(), &mut s);
    let _ = std::fs::write(&meta, now_ms().to_string());
    Ok(s)
}

/// Apaga TODOS os anexos de uma conversa (ao deletá-la) — reclaim + privacidade
/// imediatos. Síncrono e sem depender do GC throttled.
#[tauri::command]
pub async fn wipe_conv_attachments(app: AppHandle, conv_id: String) -> Result<(), String> {
    let dir = conv_dir(&app, &conv_id)?;
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}
