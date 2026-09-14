//! Escrita atômica de TEXTO (tmp + rename no mesmo diretório). Os arquivos de
//! `.mycockpit/` (config, doutrina, contexto exportado) são lidos pelo app E
//! pelos agents em paralelo: um `fs::write` direto (truncate+write) deixa o
//! leitor ver o arquivo truncado no meio. O rename
//! no mesmo filesystem é atômico; aceitamos last-writer-wins, nunca corrupção.
//! (attachments.rs mantém a variante própria de bytes com chmod 0600.)

use std::fs;
use std::path::Path;

pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    write_atomic_impl(path, contents, false)
}

/// Variante PRIVADA (token local): o tmp NASCE com 0600 (`OpenOptions.mode`),
/// então nem por uma janela curta o conteúdo fica legível por outros — mais
/// forte que o chmod-depois-de-criar do attachments.rs. Pro
/// `hook-endpoint.json` do hook_gateway e afins.
pub fn write_atomic_private(path: &Path, contents: &str) -> Result<(), String> {
    write_atomic_impl(path, contents, true)
}

fn write_atomic_impl(path: &Path, contents: &str, private: bool) -> Result<(), String> {
    let dir = path.parent().ok_or("caminho sem diretório pai")?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("arquivo");
    // pid + contador atômico (B4b): duas escritas concorrentes no MESMO processo
    // não podem disputar o mesmo tmp (só o pid colidia).
    static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.tmp-{}-{seq}", std::process::id()));
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.flush()
    };
    write().map_err(|e| e.to_string())?;
    // rename NÃO muda o modo: o destino herda o 0600 do tmp. Se o destino já
    // existia com modo mais aberto, o rename o substitui inteiro (inode novo).
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn variante_privada_nasce_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("mc-fsx-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("segredo.json");
        write_atomic_private(&p, "{\"token\":\"x\"}").unwrap();
        let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        // reescrever por cima de um arquivo mais aberto volta a 0600
        fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
        write_atomic_private(&p, "{\"token\":\"y\"}").unwrap();
        let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }
}
