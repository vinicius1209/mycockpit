//! v0.2.x, anexos (imagem + PDF). Salva bytes colados/escolhidos em disco
//! estável, valida por magic-bytes (não confia no clipboard) e resolve caminhos.
//!
//! Layout: `app_data_dir()/attachments/<convId>/<hash16>.<ext>` (blob = conteúdo).
//! O DB guarda só o path RELATIVO "attachments/<convId>/<file>", a linha do DB é
//! a verdade; o blob é retido enquanto a conversa vive (TTL/LRU + wipe ao deletar).
//! Invariante de segurança: o NOME original do usuário é só display (chip), nunca
//! vira caminho de disco (usamos o hash) nem é injetado no prompt.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[path = "attachments_pastas_do_turno.rs"]
pub mod pastas_do_turno;

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
    /// Nome original, SÓ display (chip). Nunca usado em path de disco nem no prompt.
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

/// blake3 truncado a 16 hex, nome do arquivo + dedup por-conversa.
pub fn hash16(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex()[..16].to_string()
}

/// convId só pode ser hex/uuid, blinda contra path traversal no nome da pasta.
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

/// Raiz da evidência VISUAL de tool_result (browser-plan B1): mesmo layout
/// por-conversa (`evidence/<convId>/…`), então o GC varre com a MESMA política
/// dos anexos (G3.3 do capability-registry-plan).
fn evidence_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("evidence"))
}

pub fn conv_dir(app: &AppHandle, conv_id: &str) -> Result<PathBuf, String> {
    Ok(attachments_root(app)?.join(sanitize_conv_id(conv_id)))
}

/// Pasta das notas, DENTRO da raiz de anexos: `attachments/notes/<noteId>/`.
///
/// Morar aqui dentro não é acaso — é o que faz `delete_attachment`,
/// `read_attachment` e o object URL do front funcionarem sem uma linha nova:
/// os três só exigem que o caminho esteja sob a raiz de anexos.
///
/// E o GC por-conversa **não** varre isto por CONSTRUÇÃO: `is_conv_dir_name`
/// exige nome de 32 ou 36 chars hex, e "notes" não é. A nota tem ciclo de vida
/// próprio (ela sobrevive à conversa e pode nem ter uma), então ser varrida
/// pela régua da conversa apagaria anexo vivo — em silêncio, que é o pior jeito.
const DIR_DE_NOTAS: &str = "notes";

pub fn notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(attachments_root(app)?.join(DIR_DE_NOTAS))
}

pub fn note_dir(app: &AppHandle, note_id: &str) -> Result<PathBuf, String> {
    Ok(notes_root(app)?.join(sanitize_conv_id(note_id)))
}

/// Escrita atômica (.tmp + rename) com permissão 0600, evita blob meio-escrito.
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

/// Tamanho + mtime de uma pasta (soma rasa dos arquivos diretos, basta p/ o cap).
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

/// Teto no INGEST (guardião primário, F2): se o total passar de CAP, evicta
/// pastas por mtime ascendente (a pasta ativa tem mtime fresco → protegida) até
/// LOW_WATER. Sem ConvRef aqui; mtime-de-pasta é proxy seguro porque a pasta
/// sendo escrita agora é a mais recente. Pula conversas com run ATIVO (F23): a
/// proteção-por-mtime só cobre a pasta sendo escrita agora; um run lendo o blob de
/// OUTRA conversa (mtime mais velho) precisa do mesmo skip que o `lru_evict` faz.
fn enforce_cap(app: &AppHandle, active: &ActiveConvs) -> Result<(), String> {
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
        // F23: run ativo nesta conversa → não apaga o blob que o agent ainda vai ler.
        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if active.contains(name) {
                continue;
            }
        }
        let _ = std::fs::remove_dir_all(&p);
        total = total.saturating_sub(size);
    }
    Ok(())
}

/// Núcleo comum de save_attachment/attach_path (e do upload do Companion):
/// valida tamanho, sniffa o MIME, aplica allowlist, grava atômico (dedup por
/// hash) e aplica o teto. pub(crate) p/ o companion.rs reusar a MESMA lógica.
pub(crate) fn save_to_disk(
    app: &AppHandle,
    conv_id: &str,
    name: &str,
    declared_mime: Option<String>,
    bytes: &[u8],
    active: &ActiveConvs,
) -> Result<Attachment, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(format!("\"{name}\" excede {} MB", MAX_BYTES / 1024 / 1024));
    }
    // sniff dos magic bytes manda; o declared_mime do clipboard é só fallback.
    let mime = sniff(bytes)
        .or(declared_mime)
        .ok_or_else(|| "não consegui identificar o tipo do arquivo".to_string())?;
    let ext = ext_for_mime(&mime).ok_or_else(|| format!("tipo não suportado: {mime}"))?;

    let dir = conv_dir(app, conv_id)?;
    let rel = format!("attachments/{}", sanitize_conv_id(conv_id));
    gravar_em(app, &dir, &rel, name, &mime, ext, bytes, active)
}

/// A gravação em si, já com MIME e extensão decididos: dedup por hash, escrita
/// atômica e teto do cache. Existe separada porque a NOTA grava pelo mesmo
/// caminho que a conversa — validação, sniff e allowlist são as mesmas, só a
/// pasta muda. Duplicar isso seria duplicar a allowlist, que é justamente o que
/// não pode divergir.
#[allow(clippy::too_many_arguments)]
fn gravar_em(
    app: &AppHandle,
    dir: &Path,
    rel: &str,
    name: &str,
    mime: &str,
    ext: &str,
    bytes: &[u8],
    active: &ActiveConvs,
) -> Result<Attachment, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let fname = format!("{}.{ext}", hash16(bytes));
    let abs = dir.join(&fname);
    if !abs.exists() {
        // dedup por pasta: mesmo conteúdo → mesmo arquivo, não reescreve.
        write_atomic(&abs, bytes)?;
    }
    enforce_cap(app, active)?;

    Ok(Attachment {
        path: format!("{rel}/{fname}"),
        name: name.to_string(),
        kind: classify(mime),
        mime: mime.to_string(),
        bytes: bytes.len() as u64,
    })
}

/// Mesmo núcleo, pasta da NOTA.
pub(crate) fn save_note_to_disk(
    app: &AppHandle,
    note_id: &str,
    name: &str,
    declared_mime: Option<String>,
    bytes: &[u8],
    active: &ActiveConvs,
) -> Result<Attachment, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(format!("\"{name}\" excede {} MB", MAX_BYTES / 1024 / 1024));
    }
    let mime = sniff(bytes)
        .or(declared_mime)
        .ok_or_else(|| "não consegui identificar o tipo do arquivo".to_string())?;
    let ext = ext_for_mime(&mime).ok_or_else(|| format!("tipo não suportado: {mime}"))?;
    let dir = note_dir(app, note_id)?;
    let rel = format!("attachments/{DIR_DE_NOTAS}/{}", sanitize_conv_id(note_id));
    gravar_em(app, &dir, &rel, name, &mime, ext, bytes, active)
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
    active: tauri::State<'_, ActiveConvs>,
) -> Result<Attachment, String> {
    let declared = if declared_mime.is_empty() {
        None
    } else {
        Some(declared_mime)
    };
    save_to_disk(&app, &conv_id, &name, declared, &bytes, active.inner())
}

/// Anexa um arquivo já em disco (file picker). Checa o tamanho ANTES de ler o
/// payload (F8) e copia p/ o cache (estabilidade: o original pode sumir/mudar).
#[tauri::command]
pub async fn attach_path(
    app: AppHandle,
    conv_id: String,
    src_path: String,
    active: tauri::State<'_, ActiveConvs>,
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
    save_to_disk(&app, &conv_id, &name, None, &bytes, active.inner())
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

/// Lê os bytes de um anexo (p/ thumbnail no histórico). Valida sob attachments/.
#[tauri::command]
pub async fn read_attachment(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let root = attachments_root(&app)?;
    let abs = app_data(&app)?.join(&path);
    let canon_root = root.canonicalize().unwrap_or(root);
    match abs.canonicalize() {
        Ok(canon) if canon.starts_with(&canon_root) => {
            std::fs::read(&canon).map_err(|e| e.to_string())
        }
        _ => Err("caminho de anexo inválido".to_string()),
    }
}

// ---------------- suporte ao run + GC (A4/A5) ----------------

/// Conversas com run em andamento, o GC pula a pasta delas (não apaga um blob que
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
    let root = match attachments_root(app) {
        Ok(r) => r,
        Err(_) => return (Vec::new(), atts.len()),
    };
    resolve_live_em(&base, &root, atts)
}

/// Os anexos que chegam ao adapter neste run: rel→abs, descarta os sumidos e
/// os que o motor não lê, avisando no fio de cada um (saiu de `agent.rs` pela
/// catraca de tamanho; a regra é a mesma).
pub fn do_run(
    app: &AppHandle,
    atts: Vec<Attachment>,
    agent: &str,
    suporta: impl Fn(&AttachmentKind) -> bool,
    avisar: impl Fn(String),
) -> Vec<Attachment> {
    let (live, missing) = resolve_live(app, atts);
    let (used, unsupported): (Vec<_>, Vec<_>) =
        live.into_iter().partition(|a| suporta(&a.kind));
    if missing > 0 {
        avisar(format!("{missing} anexo(s) expiraram e não foram enviados."));
    }
    for a in &unsupported {
        avisar(format!(
            "\"{}\" não é suportado pelo {agent} e foi ignorado.",
            a.name
        ));
    }
    used
}

/// Núcleo puro do `resolve_live`: `base` é o app_data, `root` a raiz de anexos.
/// Vale para anexo de conversa e de nota (`attachments/notes/<id>/`, ADR-192).
fn resolve_live_em(base: &Path, root: &Path, atts: Vec<Attachment>) -> (Vec<Attachment>, usize) {
    // Raiz canônica dos anexos: TODO path resolvido (este é o único caminho que
    // entrega path ao CLI) precisa morar sob ela, mesma checagem anti-traversal de
    // read_attachment/delete_attachment. Um path forjado (`../../etc/passwd`) cai em missing.
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut live = Vec::new();
    let mut missing = 0usize;
    for mut a in atts {
        let abs = base.join(&a.path);
        match abs.canonicalize() {
            // canonicalize já garante que o arquivo existe; valida contenção sob a raiz.
            Ok(canon) if canon.is_file() && canon.starts_with(&canon_root) => {
                a.path = abs.to_string_lossy().to_string();
                live.push(a);
            }
            _ => missing += 1,
        }
    }
    (live, missing)
}

// ---------------- GC (A5), garante que o cache NÃO acumula pra sempre ----------------

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

/// LRU por `updatedAt` da CONVERSA (não mtime do arquivo, F3/F5): evicta as menos
/// recentes até LOW_WATER. Pula conversas com run ativo (F23).
fn lru_evict(root: &Path, updated: &HashMap<String, i64>, active: &ActiveConvs, s: &mut GcSummary) {
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

/// Varre a pasta das notas removendo o que não pertence a nota viva nenhuma.
fn gc_notas(root: &Path, valid: &[String], s: &mut GcSummary) {
    if !root.exists() || valid.is_empty() {
        return;
    }
    let vivos: HashSet<String> = valid.iter().map(|id| sanitize_conv_id(id)).collect();
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if !p.is_dir() || !is_conv_dir_name(&name) || vivos.contains(&name) {
            continue;
        }
        let (size, _) = dir_size_mtime(&p);
        if std::fs::remove_dir_all(&p).is_ok() {
            s.freed_bytes += size;
            s.removed_dirs += 1;
        }
    }
}

/// Varre UMA raiz de blobs por-conversa (`attachments/` ou `evidence/`) com a
/// política ÚNICA do cache: tmp-sweep + órfãs (conversa deletada, só com lista
/// de refs não-vazia, F1) + TTL pelo `updated_at` AUTORITATIVO da conversa +
/// LRU até LOW_WATER. Pula conversa com run ativo (F23) — nunca apaga o que um
/// run ainda vai ler. `now` injetável p/ teste determinístico.
fn gc_root(
    root: &Path,
    valid: &HashSet<String>,
    updated: &HashMap<String, i64>,
    active: &ActiveConvs,
    now: i64,
    s: &mut GcSummary,
) {
    if !root.exists() {
        return;
    }
    let mut conv_dirs: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && is_conv_dir_name(&name) {
                conv_dirs.push((name, p));
            }
        }
    }

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

    lru_evict(root, updated, active, s);
}

/// GC do cache de anexos (chamado no boot com os ConvRef autoritativos do DB).
/// Ordem: throttle → (tmp-sweep + orphan + TTL por pasta) → LRU, aplicado às
/// DUAS raízes por-conversa: `attachments/` e `evidence/` (G3.3 — o wipe ao
/// deletar a conversa já cobria a morte; isto cobre conversa VIVA antiga, que
/// acumulava captura de tela pra sempre). Pula run ativo. O throttle (.gc-meta
/// na raiz de anexos) cobre as duas varreduras — é um GC só.
#[tauri::command]
pub async fn gc_attachments(
    app: AppHandle,
    valid_convs: Vec<ConvRef>,
    // Ids das notas VIVAS. Lista vazia não apaga nada (mesma guarda do F1 das
    // conversas): "não recebi a lista" e "não há nota nenhuma" são
    // indistinguíveis aqui, e apagar no primeiro caso seria destruir dado por
    // causa de um front que ainda não montou.
    valid_notes: Vec<String>,
    active: tauri::State<'_, ActiveConvs>,
) -> Result<GcSummary, String> {
    let root = attachments_root(&app)?;
    let ev_root = evidence_root(&app)?;
    if !root.exists() && !ev_root.exists() {
        return Ok(GcSummary::default());
    }
    let meta = root.join(".gc-meta");
    if recently_gced(&meta) {
        return Ok(GcSummary {
            skipped: true,
            ..Default::default()
        });
    }

    let valid: HashSet<String> = valid_convs
        .iter()
        .map(|c| sanitize_conv_id(&c.id))
        .collect();
    let updated: HashMap<String, i64> = valid_convs
        .iter()
        .map(|c| (sanitize_conv_id(&c.id), c.updated_at))
        .collect();

    let mut s = GcSummary::default();
    let now = now_ms();
    gc_root(&root, &valid, &updated, active.inner(), now, &mut s);
    gc_root(&ev_root, &valid, &updated, active.inner(), now, &mut s);
    // Notas: régua PRÓPRIA, e só a de órfã. Nota não tem `updated_at`
    // autoritativo no banco (ela vive no front) e não tem run ativo, então TTL
    // e LRU não se aplicam — o que se aplica é "a nota não existe mais".
    gc_notas(&notes_root(&app)?, &valid_notes, &mut s);
    // o meta mora na raiz de anexos; garante a pasta caso só evidence/ exista.
    let _ = std::fs::create_dir_all(&root);
    let _ = std::fs::write(&meta, now_ms().to_string());
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONV_VIVA: &str = "11111111-1111-1111-1111-111111111111";
    const CONV_EXPIRADA: &str = "22222222-2222-2222-2222-222222222222";
    const CONV_ORFA: &str = "33333333-3333-3333-3333-333333333333";

    /// Fixture: uma raiz estilo `evidence/` com pastas por-conversa + um blob
    /// em cada. Isolada por tag+pid (mesmo padrão do evidence.rs).
    fn fixture_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mc-gc-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for conv in [CONV_VIVA, CONV_EXPIRADA, CONV_ORFA] {
            let dir = root.join(conv);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("toolu_01-0.png"), b"png-fake").unwrap();
        }
        std::fs::write(root.join(".gc-meta"), b"0").unwrap();
        root
    }

    fn refs(now: i64) -> (HashSet<String>, HashMap<String, i64>) {
        // viva = fresca; expirada = parada há mais que o TTL; a órfã fica FORA
        // da lista (conversa deletada cujo wipe não rodou).
        let valid: HashSet<String> = [CONV_VIVA.to_string(), CONV_EXPIRADA.to_string()]
            .into_iter()
            .collect();
        let mut updated = HashMap::new();
        updated.insert(CONV_VIVA.to_string(), now - 1_000);
        updated.insert(CONV_EXPIRADA.to_string(), now - TTL_MS - 1);
        (valid, updated)
    }

    /// G3.3 — a raiz `evidence/` entra no GC com a MESMA política dos anexos:
    /// órfã e TTL-expirada caem; conversa viva referenciada fica; dotfile
    /// (.gc-meta) nunca é varrido como pasta de conversa.
    #[test]
    fn gc_de_evidence_apaga_orfa_e_expirada_e_preserva_a_viva() {
        let root = fixture_root("politica");
        let now = now_ms();
        let (valid, updated) = refs(now);
        let active = ActiveConvs::default();
        let mut s = GcSummary::default();
        gc_root(&root, &valid, &updated, &active, now, &mut s);

        assert!(
            root.join(CONV_VIVA).exists(),
            "conversa viva referenciada fica"
        );
        assert!(!root.join(CONV_EXPIRADA).exists(), "TTL vencido cai");
        assert!(
            !root.join(CONV_ORFA).exists(),
            "órfã (conversa deletada) cai"
        );
        assert!(
            root.join(".gc-meta").exists(),
            "dotfile não é pasta de conversa"
        );
        assert_eq!(s.removed_dirs, 2);
        assert!(s.freed_bytes > 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F23 espelhado na evidência: run ATIVO segura a pasta mesmo órfã/expirada
    /// (o agent ainda pode ler a captura durante o turno).
    #[test]
    fn gc_de_evidence_pula_conversa_com_run_ativo() {
        let root = fixture_root("ativo");
        let now = now_ms();
        let (valid, updated) = refs(now);
        let active = ActiveConvs::default();
        active.insert(CONV_EXPIRADA);
        active.insert(CONV_ORFA);
        let mut s = GcSummary::default();
        gc_root(&root, &valid, &updated, &active, now, &mut s);

        assert!(
            root.join(CONV_EXPIRADA).exists(),
            "run ativo segura a expirada"
        );
        assert!(root.join(CONV_ORFA).exists(), "run ativo segura a órfã");
        assert_eq!(s.removed_dirs, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F1 espelhado: lista de refs VAZIA nunca vira "apagar tudo como órfã" —
    /// sem referência não há evidência de deleção, só o TTL (desconhecido =
    /// sem `updated_at` = não expira por aqui).
    #[test]
    fn gc_sem_refs_nao_apaga_nada_como_orfa() {
        let root = fixture_root("semrefs");
        let now = now_ms();
        let active = ActiveConvs::default();
        let mut s = GcSummary::default();
        gc_root(
            &root,
            &HashSet::new(),
            &HashMap::new(),
            &active,
            now,
            &mut s,
        );

        for conv in [CONV_VIVA, CONV_EXPIRADA, CONV_ORFA] {
            assert!(root.join(conv).exists(), "sem refs, {conv} fica");
        }
        assert_eq!(s.removed_dirs, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    const NOTA_VIVA: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const NOTA_MORTA: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    /// Fixture da pasta de notas: duas notas com um blob cada.
    fn fixture_notas(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mc-notas-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for nota in [NOTA_VIVA, NOTA_MORTA] {
            let dir = root.join(nota);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("abc123.png"), b"png-fake").unwrap();
        }
        root
    }

    #[test]
    fn gc_de_nota_leva_a_orfa_e_preserva_a_viva() {
        let root = fixture_notas("orfa");
        let mut s = GcSummary::default();
        gc_notas(&root, &[NOTA_VIVA.to_string()], &mut s);
        assert!(root.join(NOTA_VIVA).exists(), "nota viva perdeu o anexo");
        assert!(
            !root.join(NOTA_MORTA).exists(),
            "nota morta ficou com blob órfão"
        );
        assert_eq!(s.removed_dirs, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn lista_vazia_de_notas_nao_apaga_nada() {
        // "não recebi a lista" e "não há nota nenhuma" são indistinguíveis
        // aqui. Apagar no primeiro caso destruiria dado por causa de um front
        // que ainda não montou — mesma guarda do F1 das conversas.
        let root = fixture_notas("vazia");
        let mut s = GcSummary::default();
        gc_notas(&root, &[], &mut s);
        assert!(root.join(NOTA_VIVA).exists());
        assert!(root.join(NOTA_MORTA).exists());
        assert_eq!(s.removed_dirs, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn anexo_de_nota_resolve_para_o_run_e_travessia_continua_barrada() {
        let base = std::env::temp_dir().join(format!("mc-resolve-nota-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("attachments");
        let nota = root.join("notes").join("4160d4c8-bfa3-4347-83e5-e1f296aee8a9");
        std::fs::create_dir_all(&nota).unwrap();
        std::fs::write(nota.join("0db7fa79806c9a70.png"), b"png").unwrap();
        std::fs::write(base.join("segredo.txt"), b"x").unwrap();
        let anexo = |path: &str| Attachment {
            path: path.into(),
            name: "image.png".into(),
            kind: AttachmentKind::Image,
            mime: "image/png".into(),
            bytes: 3,
        };
        let (vivos, sumidos) = resolve_live_em(
            &base,
            &root,
            vec![
                anexo("attachments/notes/4160d4c8-bfa3-4347-83e5-e1f296aee8a9/0db7fa79806c9a70.png"),
                anexo("attachments/notes/../../segredo.txt"),
            ],
        );
        assert_eq!(vivos.len(), 1);
        assert!(std::path::Path::new(&vivos[0].path).is_absolute());
        assert!(vivos[0].path.ends_with("notes/4160d4c8-bfa3-4347-83e5-e1f296aee8a9/0db7fa79806c9a70.png"));
        assert_eq!(sumidos, 1, "travessia para fora da raiz não vira anexo");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn a_pasta_de_notas_nao_e_varrida_pela_regua_da_CONVERSA() {
        // A garantia que faz o desenho inteiro funcionar: o GC por-conversa
        // varre a raiz de anexos, e a pasta "notes" mora lá dentro. Ela
        // sobrevive porque não TEM nome de conversa — se alguém afrouxar o
        // `is_conv_dir_name`, os anexos de todas as notas somem em silêncio no
        // próximo boot.
        assert!(!is_conv_dir_name(DIR_DE_NOTAS));
    }
}

/// Apaga TODOS os anexos de uma conversa (ao deletá-la), reclaim + privacidade
/// imediatos. Síncrono e sem depender do GC throttled.
/// Salva bytes colados numa NOTA. Mesma validação, mesmo sniff, mesma
/// allowlist e mesmo teto da conversa — só a pasta muda.
#[tauri::command]
pub async fn save_note_attachment(
    app: AppHandle,
    note_id: String,
    name: String,
    declared_mime: String,
    bytes: Vec<u8>,
    active: tauri::State<'_, ActiveConvs>,
) -> Result<Attachment, String> {
    let declared = if declared_mime.is_empty() {
        None
    } else {
        Some(declared_mime)
    };
    save_note_to_disk(&app, &note_id, &name, declared, &bytes, active.inner())
}

/// Apaga os anexos de UMA nota (ao deletar a nota). Espelha o
/// `wipe_conv_attachments`: quem morre leva os blobs junto, na hora.
#[tauri::command]
pub async fn wipe_note_attachments(app: AppHandle, note_id: String) -> Result<(), String> {
    let dir = note_dir(&app, &note_id)?;
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}

#[tauri::command]
pub async fn wipe_conv_attachments(app: AppHandle, conv_id: String) -> Result<(), String> {
    let dir = conv_dir(&app, &conv_id)?;
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    // Evidência visual (browser-plan B1) mora em evidence/<convId> e morre
    // junto com a conversa, pela mesma razão (reclaim + privacidade).
    let ev = app_data(&app)?
        .join("evidence")
        .join(sanitize_conv_id(&conv_id));
    if ev.exists() {
        let _ = std::fs::remove_dir_all(&ev);
    }
    Ok(())
}
