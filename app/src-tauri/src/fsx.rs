//! Escrita atômica de TEXTO (tmp + rename no mesmo diretório). O manifest do
//! SDD é lido/escrito pelo cockpit E pelos agents em paralelo: um `fs::write`
//! direto (truncate+write) deixa o leitor ver JSON truncado no meio. O rename
//! no mesmo filesystem é atômico; aceitamos last-writer-wins, nunca corrupção.
//! (attachments.rs mantém a variante própria de bytes com chmod 0600.)

use std::fs;
use std::path::Path;

pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("caminho sem diretório pai")?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("arquivo");
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}
