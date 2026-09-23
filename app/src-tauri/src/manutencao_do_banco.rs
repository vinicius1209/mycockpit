//! O banco no boot, antes do plugin SQL abrir: o backup rotativo diário e a
//! manutenção (histórico consolidado na fonte itemizada e `VACUUM` quando
//! vale, ADR-230). Saiu do `lib.rs` quando a catraca de tamanho passou a
//! cobrir o Rust (ADR-232) e ele não cabia mais.

use tauri::Manager;

/// Backup rotativo do banco no boot (rede de segurança contra perda de dados).
/// Copia db + WAL + SHM (snapshot consistente: roda antes do plugin SQL abrir)
/// para app_data_dir/backups/frota-{1..3}.db, no máx. 1x a cada ~20h.
pub(crate) fn backup_database(app: &tauri::AppHandle) -> Result<(), String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let db = data.join(crate::BANCO);
    if !db.exists() {
        return Ok(()); // primeira execução: nada a proteger ainda
    }
    let dir = data.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // já tem backup fresco (<20h)? então não gira (1 backup por dia de uso).
    let newest = dir.join("frota-1.db");
    if let Ok(meta) = std::fs::metadata(&newest) {
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                if age < std::time::Duration::from_secs(20 * 60 * 60) {
                    return Ok(());
                }
            }
        }
    }

    // rotação 2→3, 1→2 (o 3 mais antigo cai), depois copia o atual pro 1.
    for (from, to) in [(2u8, 3u8), (1, 2)] {
        for ext in crate::PARTES {
            let src = dir.join(format!("frota-{from}.{ext}"));
            if src.exists() {
                let _ = std::fs::rename(&src, dir.join(format!("frota-{to}.{ext}")));
            }
        }
    }
    for ext in crate::PARTES {
        let src = data.join(format!("frota.{ext}"));
        let dst = dir.join(format!("frota-1.{ext}"));
        if src.exists() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        } else {
            let _ = std::fs::remove_file(&dst); // não deixa WAL órfão de outra era
        }
    }
    log::info!("backup do banco atualizado em {}", dir.display());
    Ok(())
}

/// Manutenção do banco no boot (ADR-230): consolida o histórico na fonte
/// itemizada e compacta quando o espaço livre passa de um quarto do arquivo
/// (medido em 23/09/2026: 34 MB livres num banco de 84 MB).
pub(crate) fn manter_banco(app: &tauri::AppHandle) -> Result<(), String> {
    let caminho = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?
        .join(crate::BANCO);
    if !caminho.exists() {
        return Ok(());
    }
    let mut conn = rusqlite::Connection::open(&caminho).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let (itemizadas, esvaziadas) = crate::conversation_items::consolidar_historico(&mut conn)?;
    if itemizadas + esvaziadas > 0 {
        log::info!("histórico consolidado: {itemizadas} conversas itemizadas, {esvaziadas} blobs esvaziados");
    }
    if let Some((livres, total)) = compactar_se_vale(&conn)? {
        log::info!("banco compactado: {livres} de {total} páginas estavam livres");
    }
    Ok(())
}

/// `VACUUM` só quando vale: mais de um quarto das páginas livres. Devolve
/// (livres, total) de antes quando compactou.
fn compactar_se_vale(conn: &rusqlite::Connection) -> Result<Option<(i64, i64)>, String> {
    let livres: i64 = conn
        .query_row("PRAGMA freelist_count", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let total: i64 = conn
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if total == 0 || livres * 4 <= total {
        return Ok(None);
    }
    conn.execute_batch("VACUUM").map_err(|e| e.to_string())?;
    Ok(Some((livres, total)))
}

#[cfg(test)]
mod tests {
    use super::compactar_se_vale;

    fn banco_com_folga(apagar: usize) -> (tempfile_like::Arquivo, rusqlite::Connection) {
        let arquivo = tempfile_like::Arquivo::novo();
        let conn = rusqlite::Connection::open(&arquivo.0).unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT);").unwrap();
        for _ in 0..400 {
            conn.execute("INSERT INTO t VALUES (?1)", [&"x".repeat(2000)]).unwrap();
        }
        conn.execute("DELETE FROM t WHERE rowid <= ?1", [apagar as i64]).unwrap();
        (arquivo, conn)
    }

    mod tempfile_like {
        pub struct Arquivo(pub std::path::PathBuf);
        impl Arquivo {
            pub fn novo() -> Self {
                let nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos();
                Arquivo(std::env::temp_dir().join(format!("frota-vacuum-{}-{nanos}.db", std::process::id())))
            }
        }
        impl Drop for Arquivo {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
    }

    #[test]
    fn metade_livre_compacta_e_o_arquivo_encolhe() {
        let (_arquivo, conn) = banco_com_folga(300);
        let antes: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
        let (livres, total) = compactar_se_vale(&conn).unwrap().expect("devia compactar");
        assert_eq!(total, antes);
        assert!(livres * 4 > total);
        let depois: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
        assert!(depois < antes / 2, "antes {antes}, depois {depois}");
        let restantes: i64 = conn.query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(restantes, 100);
    }

    #[test]
    fn pouca_folga_nao_paga_o_vacuum() {
        let (_arquivo, conn) = banco_com_folga(20);
        assert_eq!(compactar_se_vale(&conn).unwrap(), None);
    }
}
