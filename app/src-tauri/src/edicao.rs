//! Edição de arquivos pelo visualizador (docs/edicao-de-arquivos-spec.md).
//!
//! Três portas, e nenhuma grava sem saber o que a pessoa leu:
//! - `abrir_para_edicao` lê o arquivo INTEIRO (a leitura do visualizador corta
//!   em 400 KB e cola um aviso no texto; salvar aquilo apagaria o resto) e diz
//!   se dá para gravar, e por quê não;
//! - `versao_no_disco` responde se o arquivo mudou desde a leitura;
//! - `salvar_arquivo` grava num temporário, confere a versão e só então troca.
//!
//! A leitura continua passando por `sources::scoped_file_path`. A escrita tem
//! lista PRÓPRIA (`pastas_gravaveis`): autorizar leitura nova (um `~/.claude`,
//! o brain de um motor) nunca autoriza escrita junto.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::sources::{read_text_file_scoped, scoped_file_path};

/// Acima disto o arquivo abre só leitura: o editor aguenta, mas a leitura
/// inteira pelo IPC e o hash a cada sinal de disco deixam de ser baratos.
pub(crate) const LIMITE_EDITAVEL: u64 = 2 * 1024 * 1024;

const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const FORA_DAS_PASTAS: &str = "Fora das pastas do projeto";
const PROTEGIDO: &str = "O arquivo está protegido contra escrita";
const MISTURADOS: &str = "Fins de linha misturados";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FimDeLinha {
    Lf,
    Crlf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoEditavel {
    /// Sem BOM; os fins de linha como estão no disco.
    pub conteudo: String,
    /// blake3 dos bytes crus, BOM incluído. É o que o `salvar` confere.
    pub versao: String,
    pub fim_de_linha: FimDeLinha,
    pub bom: bool,
    pub gravavel: bool,
    /// `Some` se e só se não é gravável, na língua da pessoa.
    pub motivo: Option<String>,
    /// Canônico: a identidade do arquivo no front (symlink e `~/` resolvidos).
    pub caminho_absoluto: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "tipo", rename_all = "kebab-case")]
pub enum ErroAoSalvar {
    /// O disco não é mais a versão que a pessoa leu. Nada foi escrito.
    Conflito { versao: String },
    Sumiu,
    ForaDasPastas,
    SoLeitura { motivo: String },
    Falhou { detalhe: String },
}

fn motivo_do_tamanho(bytes: u64) -> String {
    let mb = format!("{:.1}", bytes as f64 / (1024.0 * 1024.0)).replace('.', ",");
    format!("Grande demais para editar aqui ({mb} MB)")
}

/// A raiz efetiva (projeto ou worktree) e as pastas que a pessoa vinculou ao
/// projeto (`extra_dirs`, decidido em 26/09/2026). Nada mais.
fn pastas_gravaveis(root: &str) -> Vec<PathBuf> {
    let mut pastas: Vec<PathBuf> = crate::frota_dir::resolve_extra_dirs(root)
        .into_iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .collect();
    if let Ok(r) = std::fs::canonicalize(root) {
        pastas.push(r);
    }
    pastas
}

fn gravavel(canon: &Path, root: &str) -> bool {
    pastas_gravaveis(root).iter().any(|p| canon.starts_with(p))
}

/// `(crlf, lf solto, cr solto)` numa passada.
fn contar_fins(texto: &[u8]) -> (usize, usize, usize) {
    let (mut crlf, mut lf, mut cr) = (0, 0, 0);
    let mut i = 0;
    while i < texto.len() {
        match texto[i] {
            b'\r' if texto.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 1;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }
    (crlf, lf, cr)
}

/// O texto que chega para gravar tem de bater com o fim de linha declarado. Se
/// não bate é bug do front, e o Rust não "conserta" em silêncio.
fn fins_consistentes(conteudo: &str, fim: FimDeLinha) -> bool {
    let (crlf, lf, cr) = contar_fins(conteudo.as_bytes());
    match fim {
        FimDeLinha::Lf => crlf == 0 && cr == 0,
        FimDeLinha::Crlf => lf == 0 && cr == 0,
    }
}

fn hash_do_arquivo(caminho: &Path) -> std::io::Result<String> {
    let mut arquivo = std::fs::File::open(caminho)?;
    let mut hasher = blake3::Hasher::new();
    let mut bloco = vec![0u8; 64 * 1024];
    loop {
        let n = arquivo.read(&mut bloco)?;
        if n == 0 {
            break;
        }
        hasher.update(&bloco[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// O erro de `scoped_file_path` é texto. Inexistência tem a mesma assinatura
/// que o front já reconhece (`arquivoSumiu`).
fn sumiu(erro: &str) -> bool {
    let e = erro.to_lowercase();
    e.contains("(os error 2)") || e.contains("no such file or directory")
}

pub(crate) fn abrir_em(
    root: &str,
    path: &str,
    anexos: Option<&Path>,
) -> Result<ArquivoEditavel, String> {
    let canon = scoped_file_path(root, path, anexos)?;
    let meta = std::fs::metadata(&canon).map_err(|e| e.to_string())?;
    let caminho_absoluto = canon.to_string_lossy().into_owned();
    if meta.len() > LIMITE_EDITAVEL {
        return Ok(ArquivoEditavel {
            conteudo: read_text_file_scoped(root, path, anexos)?,
            versao: hash_do_arquivo(&canon).map_err(|e| e.to_string())?,
            fim_de_linha: FimDeLinha::Lf,
            bom: false,
            gravavel: false,
            motivo: Some(motivo_do_tamanho(meta.len())),
            caminho_absoluto,
        });
    }
    let bytes = std::fs::read(&canon).map_err(|e| e.to_string())?;
    let versao = blake3::hash(&bytes).to_hex().to_string();
    let bom = bytes.starts_with(&BOM);
    let corpo = if bom { &bytes[BOM.len()..] } else { &bytes[..] };
    let conteudo = std::str::from_utf8(corpo)
        .map_err(|e| format!("O arquivo não é texto UTF-8 válido: {e}"))?
        .to_string();
    let (crlf, lf, cr) = contar_fins(corpo);
    let misturado = cr > 0 || (crlf > 0 && lf > 0);
    let fim_de_linha = if crlf > 0 { FimDeLinha::Crlf } else { FimDeLinha::Lf };
    // Um motivo só, o primeiro que vale: tamanho (acima), pastas, proteção, fins.
    let motivo = if !gravavel(&canon, root) {
        Some(FORA_DAS_PASTAS.to_string())
    } else if meta.permissions().readonly() {
        Some(PROTEGIDO.to_string())
    } else if misturado {
        Some(MISTURADOS.to_string())
    } else {
        None
    };
    Ok(ArquivoEditavel {
        conteudo,
        versao,
        fim_de_linha,
        bom,
        gravavel: motivo.is_none(),
        motivo,
        caminho_absoluto,
    })
}

pub(crate) fn versao_em(
    root: &str,
    path: &str,
    anexos: Option<&Path>,
) -> Result<Option<String>, String> {
    match scoped_file_path(root, path, anexos) {
        Ok(canon) => match hash_do_arquivo(&canon) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        },
        Err(e) if sumiu(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

/// O temporário some sozinho em qualquer saída que não seja o `rename`: o
/// `?` no meio do caminho não pode deixar `.frota-*.tmp` no `git status`.
struct Temporario {
    caminho: PathBuf,
    vivo: bool,
}

impl Drop for Temporario {
    fn drop(&mut self) {
        if self.vivo {
            let _ = std::fs::remove_file(&self.caminho);
        }
    }
}

fn hex_aleatorio() -> String {
    use rand::Rng;
    let mut b = [0u8; 8];
    rand::rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn falhou(e: impl std::fmt::Display) -> ErroAoSalvar {
    ErroAoSalvar::Falhou { detalhe: e.to_string() }
}

pub(crate) fn salvar_em(
    root: &str,
    path: &str,
    conteudo: &str,
    versao_esperada: &str,
    fim: FimDeLinha,
    bom: bool,
    anexos: Option<&Path>,
) -> Result<String, ErroAoSalvar> {
    let canon = scoped_file_path(root, path, anexos).map_err(|e| {
        if sumiu(&e) {
            ErroAoSalvar::Sumiu
        } else {
            ErroAoSalvar::ForaDasPastas
        }
    })?;
    if !gravavel(&canon, root) {
        return Err(ErroAoSalvar::ForaDasPastas);
    }
    if !fins_consistentes(conteudo, fim) {
        return Err(falhou("fins de linha inconsistentes"));
    }
    let mut bytes = Vec::with_capacity(conteudo.len() + BOM.len());
    if bom {
        bytes.extend_from_slice(&BOM);
    }
    bytes.extend_from_slice(conteudo.as_bytes());
    if bytes.len() as u64 > LIMITE_EDITAVEL {
        return Err(ErroAoSalvar::SoLeitura { motivo: motivo_do_tamanho(bytes.len() as u64) });
    }
    let meta = std::fs::metadata(&canon).map_err(falhou)?;
    if meta.permissions().readonly() {
        return Err(ErroAoSalvar::SoLeitura { motivo: PROTEGIDO.to_string() });
    }
    let pasta = canon.parent().ok_or_else(|| falhou("arquivo sem pasta"))?;
    let nome = canon.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

    let mut tmp = Temporario {
        caminho: pasta.join(format!(".{nome}.frota-{}.tmp", hex_aleatorio())),
        vivo: false,
    };
    // `create_new`: não segue um link plantado com o mesmo nome.
    let mut arquivo = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp.caminho)
        .map_err(falhou)?;
    tmp.vivo = true;
    arquivo.write_all(&bytes).map_err(falhou)?;
    // Um script `+x` continua executável.
    std::fs::set_permissions(&tmp.caminho, meta.permissions()).map_err(falhou)?;
    arquivo.sync_all().map_err(falhou)?;
    drop(arquivo);

    // A conferência fica o mais perto possível do rename. A janela entre os dois
    // existe e é de microssegundos; não há trava (o agente não a respeitaria).
    let no_disco = match hash_do_arquivo(&canon) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(ErroAoSalvar::Sumiu),
        Err(e) => return Err(falhou(e)),
    };
    if no_disco != versao_esperada {
        return Err(ErroAoSalvar::Conflito { versao: no_disco });
    }
    std::fs::rename(&tmp.caminho, &canon).map_err(falhou)?;
    tmp.vivo = false;
    #[cfg(unix)]
    if let Err(e) = std::fs::File::open(pasta).and_then(|d| d.sync_all()) {
        log::warn!("edição: não consegui sincronizar a pasta de {path}: {e}");
    }
    log::info!("edição: {path} salvo ({} bytes)", bytes.len());
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

fn anexos(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("attachments"))
}

// Comando síncrono do Tauri 2 roda na thread principal; ler, hashear e gravar
// 2 MB ali travaria a tela. Os três vão para o pool de bloqueio.

#[tauri::command]
pub async fn abrir_para_edicao(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<ArquivoEditavel, String> {
    let anexos = anexos(&app);
    tauri::async_runtime::spawn_blocking(move || abrir_em(&root, &path, anexos.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn versao_no_disco(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<Option<String>, String> {
    let anexos = anexos(&app);
    tauri::async_runtime::spawn_blocking(move || versao_em(&root, &path, anexos.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn salvar_arquivo(
    app: tauri::AppHandle,
    root: String,
    path: String,
    conteudo: String,
    versao_esperada: String,
    fim_de_linha: FimDeLinha,
    bom: bool,
) -> Result<String, ErroAoSalvar> {
    let anexos = anexos(&app);
    tauri::async_runtime::spawn_blocking(move || {
        salvar_em(&root, &path, &conteudo, &versao_esperada, fim_de_linha, bom, anexos.as_deref())
    })
    .await
    .map_err(falhou)?
}

#[cfg(test)]
#[path = "edicao_tests.rs"]
mod tests;
