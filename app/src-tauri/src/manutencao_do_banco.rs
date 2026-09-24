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

// ---------------- O banco vindo do nome antigo (ADR-222) ----------------
// Saiu do `lib.rs` para ele caber na catraca (ADR-240); os testes seguem lá,
// em `testes_migracao_do_banco`.

/// As árvores de blob que o banco endereça por caminho RELATIVO ao
/// `app_data_dir` (`attachments/<conv>/<hash>.<ext>`, `evidence/<conv>/...`).
/// Como o relativo é resolvido a partir do diretório NOVO, elas têm que vir
/// junto com o banco: deixá-las para trás transforma anexo e evidência de
/// conversa antiga em arquivo faltando, com o banco inteiro e correto.
const ARVORES: [&str; 2] = ["attachments", "evidence"];

/// Traz o banco do diretório/nome antigos para os novos, UMA vez.
///
/// Núcleo puro (recebe os dois diretórios) para o teste não precisar de
/// `AppHandle`. Roda antes de o plugin SQL abrir, que é a mesma janela em que
/// `backup_database` opera: db+wal+shm quiescentes.
///
/// **Copia e nunca move.** O diretório antigo fica inteiro para que voltar
/// para a versão anterior do app ache o banco onde ele estava. Quem apaga o
/// antigo é a pessoa, depois de conferir que o novo está bom.
///
/// Devolve `true` quando copiou o banco.
pub(crate) fn migrar_banco_entre(novo_dir: &std::path::Path, legado_dir: &std::path::Path) -> Result<bool, String> {
    if novo_dir.join(crate::BANCO).exists() {
        return Ok(false); // já migrado (ou instalação nova que já nasceu no nome novo)
    }
    // Candidatos, em ordem: mesmo diretório com nome velho (rename só do
    // arquivo) e diretório velho com nome velho (rename dos dois).
    let origem = [novo_dir.join(crate::BANCO_LEGADO), legado_dir.join(crate::BANCO_LEGADO)]
        .into_iter()
        .find(|p| p.exists());
    let Some(origem) = origem else {
        return Ok(false); // instalação nova: nada a migrar
    };
    let base_origem = origem.with_extension("");
    std::fs::create_dir_all(novo_dir).map_err(|e| e.to_string())?;
    for ext in crate::PARTES {
        let src = base_origem.with_extension(ext);
        if !src.exists() {
            continue; // sem WAL/SHM é estado normal (banco fechado limpo)
        }
        let dst = novo_dir.join(format!("frota.{ext}"));
        std::fs::copy(&src, &dst).map_err(|e| format!("cópia de {ext} falhou: {e}"))?;
    }
    Ok(true)
}

/// Copia uma árvore inteira, criando o que falta. Idempotente por arquivo:
/// destino que já existe é pulado, então rodar de novo não desfaz nada que o
/// app já escreveu no lugar novo.
fn copiar_arvore(de: &std::path::Path, para: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(para).map_err(|e| e.to_string())?;
    for entrada in std::fs::read_dir(de).map_err(|e| e.to_string())? {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let destino = para.join(entrada.file_name());
        let tipo = entrada.file_type().map_err(|e| e.to_string())?;
        if tipo.is_dir() {
            copiar_arvore(&entrada.path(), &destino)?;
        } else if tipo.is_file() && !destino.exists() {
            std::fs::copy(entrada.path(), &destino).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Traz `attachments/` e `evidence/` do diretório legado, cada uma com gate
/// próprio: o banco pode já ter migrado numa versão anterior desta função, e
/// nesse caso as árvores ainda estão para trás. Devolve as que copiou.
pub(crate) fn migrar_arvores_entre(
    novo_dir: &std::path::Path,
    legado_dir: &std::path::Path,
) -> Result<Vec<&'static str>, String> {
    let mut trazidas = Vec::new();
    for nome in ARVORES {
        let destino = novo_dir.join(nome);
        if destino.exists() {
            continue; // já veio (ou o app já criou a dele no lugar novo)
        }
        let origem = legado_dir.join(nome);
        if !origem.is_dir() {
            continue; // instalação nova, ou nunca houve anexo/evidência
        }
        copiar_arvore(&origem, &destino).map_err(|e| format!("{nome}: {e}"))?;
        trazidas.push(nome);
    }
    Ok(trazidas)
}

/// A versão que fala com o Tauri. O diretório legado é irmão do novo: o
/// identificador do bundle é o último componente do caminho.
pub(crate) fn migrar_banco(app: &tauri::AppHandle) -> Result<bool, String> {
    let novo = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let Some(legado) = novo.parent().map(|pai| pai.join(crate::ID_LEGADO)) else {
        return Ok(false);
    };
    let copiou = migrar_banco_entre(&novo, &legado)?;
    // As árvores vêm mesmo quando o banco já estava migrado: são gates
    // independentes, e errar isso deixa o banco certo apontando para o vazio.
    for nome in migrar_arvores_entre(&novo, &legado)? {
        log::info!("árvore {nome} migrada para o diretório novo");
    }
    Ok(copiou)
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

/// O banco antes do plugin SQL abrir: migra do nome antigo, faz o backup
/// rotativo e mantém. Saiu do `setup` de lib.rs para ele caber na catraca.
pub(crate) fn preparar_no_boot(app: &tauri::AppHandle) {
    // O banco vem do diretório/nome antigos ANTES de tudo: o backup logo
    // abaixo e o plugin SQL adiante precisam achá-lo já no lugar novo. Falha
    // aqui NÃO bloqueia o boot, mas grita no log: seguir com banco vazio em
    // silêncio seria perder o histórico sem aviso.
    match migrar_banco(app) {
        Ok(true) => log::info!("banco migrado para o nome novo ({})", crate::BANCO),
        Ok(false) => {}
        Err(e) => log::error!("migração do banco falhou: {e}"),
    }
    // Backup rotativo ANTES de qualquer escrita da sessão (o plugin SQL só
    // abre depois, então db+wal+shm estão quiescentes). Rede de segurança
    // contra corrupção/perda: nunca bloqueia o boot.
    if let Err(e) = backup_database(app) {
        log::warn!("backup do banco falhou (seguindo sem): {e}");
    }
    // Depois do backup e antes do plugin SQL: o histórico passa a morar só na
    // fonte itemizada, e o banco se compacta quando metade dele é espaço
    // livre (ADR-230). Nunca bloqueia o boot.
    if let Err(e) = manter_banco(app) {
        log::warn!("manutenção do banco falhou (seguindo sem): {e}");
    }
}
