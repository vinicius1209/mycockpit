//! O banco no boot, antes do plugin SQL abrir: o backup rotativo diário e a
//! manutenção (histórico consolidado na fonte itemizada e `VACUUM` quando
//! vale, ADR-230). Saiu do `lib.rs` quando a catraca de tamanho passou a
//! cobrir o Rust (ADR-232) e ele não cabia mais.

use tauri::Manager;

/// As três partes de um banco SQLite em WAL. Copiar só o `.db` deixaria para
/// trás transações que ainda vivem no log. (Morava em `lib.rs`; só este módulo
/// a usa.)
pub(crate) const PARTES: [&str; 3] = ["db", "db-wal", "db-shm"];

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
        for ext in PARTES {
            let src = dir.join(format!("frota-{from}.{ext}"));
            if src.exists() {
                let _ = std::fs::rename(&src, dir.join(format!("frota-{to}.{ext}")));
            }
        }
    }
    for ext in PARTES {
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
    for ext in PARTES {
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

#[cfg(test)]
mod testes_migracao_do_banco {
    use super::{migrar_banco_entre, PARTES};
    use crate::{BANCO, BANCO_LEGADO};
    use std::path::PathBuf;

    fn tmp(tag: &str) -> (PathBuf, PathBuf) {
        let raiz = std::env::temp_dir().join(format!(
            "frota-migra-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let novo = raiz.join("dev.vinicius.frota");
        let legado = raiz.join(crate::ID_LEGADO);
        std::fs::create_dir_all(&novo).unwrap();
        std::fs::create_dir_all(&legado).unwrap();
        (novo, legado)
    }

    /// Banco legado com as TRÊS partes do WAL, cada uma com conteúdo próprio.
    fn semear(dir: &PathBuf) {
        for (ext, corpo) in [("db", "pagina"), ("db-wal", "log"), ("db-shm", "mapa")] {
            std::fs::write(dir.join(BANCO_LEGADO.replace(".db", &format!(".{ext}"))), corpo).unwrap();
        }
    }

    #[test]
    fn copia_as_tres_partes_do_wal() {
        // Copiar só o .db deixaria para trás transação que ainda vive no log.
        let (novo, legado) = tmp("tres");
        semear(&legado);
        assert!(migrar_banco_entre(&novo, &legado).unwrap());
        for (ext, corpo) in [("db", "pagina"), ("db-wal", "log"), ("db-shm", "mapa")] {
            let f = novo.join(format!("frota.{ext}"));
            assert!(f.exists(), "faltou frota.{ext}");
            assert_eq!(std::fs::read_to_string(&f).unwrap(), corpo);
        }
    }

    #[test]
    fn copia_e_nunca_move() {
        // O diretório antigo fica inteiro: é o rollback para a versão
        // anterior do app, que procura o banco onde ele estava.
        let (novo, legado) = tmp("copia");
        semear(&legado);
        migrar_banco_entre(&novo, &legado).unwrap();
        for ext in PARTES {
            assert!(
                legado.join(BANCO_LEGADO.replace(".db", &format!(".{ext}"))).exists(),
                "o banco antigo sumiu: {ext}"
            );
        }
    }

    #[test]
    fn nao_sobrescreve_banco_novo_ja_existente() {
        // Segundo boot. Sobrescrever aqui apagaria tudo que a pessoa fez desde
        // a migração, que é a pior falha possível desta função.
        let (novo, legado) = tmp("segundo");
        semear(&legado);
        std::fs::write(novo.join(BANCO), "trabalho novo").unwrap();
        assert!(!migrar_banco_entre(&novo, &legado).unwrap());
        assert_eq!(
            std::fs::read_to_string(novo.join(BANCO)).unwrap(),
            "trabalho novo"
        );
    }

    #[test]
    fn e_idempotente() {
        let (novo, legado) = tmp("idem");
        semear(&legado);
        assert!(migrar_banco_entre(&novo, &legado).unwrap());
        assert!(!migrar_banco_entre(&novo, &legado).unwrap());
        assert_eq!(std::fs::read_to_string(novo.join(BANCO)).unwrap(), "pagina");
    }

    #[test]
    fn instalacao_nova_nao_inventa_banco() {
        let (novo, legado) = tmp("nova");
        assert!(!migrar_banco_entre(&novo, &legado).unwrap());
        assert!(!novo.join(BANCO).exists());
    }

    #[test]
    fn banco_fechado_limpo_migra_sem_wal() {
        // Sem WAL/SHM é estado NORMAL (banco fechado direito). Não é erro.
        let (novo, legado) = tmp("semwal");
        std::fs::write(legado.join(BANCO_LEGADO), "pagina").unwrap();
        assert!(migrar_banco_entre(&novo, &legado).unwrap());
        assert!(novo.join(BANCO).exists());
        assert!(!novo.join("frota.db-wal").exists());
    }

    #[test]
    fn nome_velho_no_diretorio_novo_tambem_migra() {
        // Caso do identificador inalterado e só o arquivo renomeado.
        let (novo, legado) = tmp("mesmodir");
        semear(&novo);
        assert!(migrar_banco_entre(&novo, &legado).unwrap());
        assert_eq!(std::fs::read_to_string(novo.join(BANCO)).unwrap(), "pagina");
    }

    use crate::manutencao_do_banco::migrar_arvores_entre;

    /// Anexo e evidência de uma conversa, no layout real
    /// (`<arvore>/<convId>/<arquivo>`).
    fn semear_arvores(dir: &PathBuf) {
        for (arvore, arquivo, corpo) in [
            ("attachments", "a1b2c3d4.png", "pixels"),
            ("evidence", "tool-0.txt", "saida"),
        ] {
            let conv = dir.join(arvore).join("conv-1");
            std::fs::create_dir_all(&conv).unwrap();
            std::fs::write(conv.join(arquivo), corpo).unwrap();
        }
    }

    #[test]
    fn traz_anexos_e_evidencias_junto_com_o_banco() {
        // O banco endereça os dois por caminho RELATIVO ao app_data_dir. Com o
        // diretório novo vazio, todo anexo de conversa antiga vira arquivo
        // faltando, com o banco inteiro e correto.
        let (novo, legado) = tmp("arvores");
        semear_arvores(&legado);
        let trazidas = migrar_arvores_entre(&novo, &legado).unwrap();
        assert_eq!(trazidas, vec!["attachments", "evidence"]);
        assert_eq!(
            std::fs::read_to_string(novo.join("attachments/conv-1/a1b2c3d4.png")).unwrap(),
            "pixels"
        );
        assert_eq!(
            std::fs::read_to_string(novo.join("evidence/conv-1/tool-0.txt")).unwrap(),
            "saida"
        );
    }

    #[test]
    fn as_arvores_tem_gate_proprio_e_nao_dependem_do_banco() {
        // Este é o estado real de 21/09/2026: o banco JÁ migrou num boot
        // anterior, e as árvores ficaram para trás. Se o gate fosse o do
        // banco, elas nunca viriam.
        let (novo, legado) = tmp("gate");
        semear(&legado);
        semear_arvores(&legado);
        migrar_banco_entre(&novo, &legado).unwrap();
        assert!(!migrar_banco_entre(&novo, &legado).unwrap(), "banco já migrou");
        assert_eq!(
            migrar_arvores_entre(&novo, &legado).unwrap(),
            vec!["attachments", "evidence"]
        );
    }

    #[test]
    fn nao_pisa_em_arvore_que_o_app_ja_criou() {
        // Sobrescrever aqui apagaria anexo gravado depois do rename.
        let (novo, legado) = tmp("pisa");
        semear_arvores(&legado);
        let conv = novo.join("attachments/conv-2");
        std::fs::create_dir_all(&conv).unwrap();
        std::fs::write(conv.join("novo.png"), "recente").unwrap();

        assert_eq!(migrar_arvores_entre(&novo, &legado).unwrap(), vec!["evidence"]);
        assert_eq!(
            std::fs::read_to_string(conv.join("novo.png")).unwrap(),
            "recente"
        );
    }

    #[test]
    fn arvores_copiam_e_nunca_movem() {
        let (novo, legado) = tmp("arvcopia");
        semear_arvores(&legado);
        migrar_arvores_entre(&novo, &legado).unwrap();
        assert!(legado.join("attachments/conv-1/a1b2c3d4.png").exists());
        assert!(legado.join("evidence/conv-1/tool-0.txt").exists());
    }

    #[test]
    fn instalacao_nova_nao_inventa_arvore() {
        let (novo, legado) = tmp("arvnova");
        assert!(migrar_arvores_entre(&novo, &legado).unwrap().is_empty());
        assert!(!novo.join("attachments").exists());
    }
}
