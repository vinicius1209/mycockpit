use super::*;
use std::path::PathBuf;

/// Banco com três conversas: `atual` e `irma` no projeto p1, `alheia` no p2.
/// Itens no formato real do fio (kinds `user` e `text`), pela varredura do
/// blob, que é o caminho que a conversa sem índice usa.
fn banco(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("frota-citadas-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("db.sqlite");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT, items TEXT NOT NULL);
         CREATE TABLE conversation_item_state (conversation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, item_count INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
    )
    .unwrap();
    for (id, projeto, titulo, texto) in [
        ("atual", "p1", "Composer novo", "o placeholder ficou fraco"),
        ("irma", "p1", "Refatorar o parser de OFX", "decidimos tratar o fuso como horário local do banco"),
        ("outra", "p1", "Migração 63", "o índice de custo entrou na migração"),
        ("alheia", "p2", "Checkout lento", "o fuso do checkout está errado"),
    ] {
        let items = json!([{"kind": "user", "id": format!("{id}-0"), "text": "e o fuso?"}, {"kind": "text", "id": format!("{id}-1"), "text": texto}]);
        conn.execute(
            "INSERT INTO conversations (id, project_id, title, items) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, projeto, titulo, items.to_string()],
        )
        .unwrap();
    }
    db
}

fn citou(ids: &[&str]) -> Concessao {
    Concessao { ids: ids.iter().map(|s| s.to_string()).collect(), todas: false }
}

#[test]
fn sem_citacao_so_a_conversa_do_turno() {
    let db = banco("sem");
    let conn = abrir(&db).unwrap();
    assert!(permitir(&conn, "atual", "atual", &Concessao::default()).is_ok());
    let recusa = permitir(&conn, "atual", "irma", &Concessao::default()).unwrap_err();
    assert!(recusa.contains("não foi citada"), "{recusa}");
}

#[test]
fn a_citada_abre_e_so_ela() {
    let db = banco("uma");
    let c = citou(&["irma"]);
    let achado: Value = serde_json::from_str(&buscar(&db, "atual", "irma", "fuso", 5, &c).unwrap()).unwrap();
    let primeiro = &achado["results"][0];
    assert_eq!(primeiro["ref"], "conversation:irma:item:1");
    assert_eq!(primeiro["conversation"]["title"], "Refatorar o parser de OFX");
    // A leitura do ref volta o item inteiro.
    let lido = ler(Some(&db), "atual", "conversation:irma:item:1", 4000, &c).unwrap().unwrap();
    assert!(lido.contains("horário local do banco"), "{lido}");
    // A irmã não citada segue fechada, na busca e na leitura.
    assert!(buscar(&db, "atual", "outra", "índice", 5, &c).unwrap_err().contains("não foi citada"));
    assert!(ler(Some(&db), "atual", "conversation:outra:item:1", 4000, &c).unwrap().unwrap_err().contains("não foi citada"));
    // Ref de outro formato segue o caminho de sempre.
    assert!(ler(Some(&db), "atual", "conversation:item:1", 4000, &c).is_none());
}

#[test]
fn citacao_de_outro_projeto_nao_abre() {
    // D1: só o mesmo projeto, mesmo que o id viaje na concessão.
    let db = banco("alheia");
    let conn = abrir(&db).unwrap();
    assert!(permitir(&conn, "atual", "alheia", &citou(&["alheia"])).is_err());
}

#[test]
fn todas_so_quando_citado_e_so_do_projeto() {
    let db = banco("todas");
    let sem = buscar(&db, "atual", TODAS, "fuso", 5, &Concessao::default()).unwrap_err();
    assert!(sem.contains("todas as conversas"), "{sem}");
    let todas = Concessao { ids: vec![], todas: true };
    let achado: Value = serde_json::from_str(&buscar(&db, "atual", TODAS, "fuso", 10, &todas).unwrap()).unwrap();
    let conversas: Vec<&str> = achado["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["conversation"]["id"].as_str().unwrap())
        .collect();
    assert!(conversas.contains(&"irma"));
    assert!(!conversas.contains(&"alheia"), "outro projeto vazou: {conversas:?}");
    assert!(!conversas.contains(&"atual"), "a própria conversa não precisa de citação");
}

#[test]
fn o_ambiente_leva_so_id_valido() {
    let c = Concessao { ids: vec!["irma".into(), "x;rm -rf".into()], todas: true };
    assert_eq!(c.ambiente(), [(CITADAS_ENV, "irma".to_string()), (TODAS_ENV, "1".to_string())]);
    assert_eq!(Concessao::default().ambiente(), [(CITADAS_ENV, String::new()), (TODAS_ENV, String::new())]);
}

#[test]
fn a_concessao_chega_do_front_em_camel_case() {
    let c: Concessao = serde_json::from_value(json!({"ids": ["irma"], "todas": false})).unwrap();
    assert_eq!(c, citou(&["irma"]));
    let so_todas: Concessao = serde_json::from_value(json!({"todas": true})).unwrap();
    assert!(so_todas.todas && so_todas.ids.is_empty());
}
