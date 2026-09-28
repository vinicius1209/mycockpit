use super::*;
use crate::conversation_items::{FTS_CRIAR_TRIGRAM, FTS_TRIGGER_INSERT};

const ARQUIVO: &str = "backend/src/main/java/com/vini/financemonitor/ingestion/pdf/ParsedRow.java";

/// Itens reais de uma conversa do banco da pessoa (28/09/2026): o Claude leu
/// e depois editou o arquivo; mais tarde a conversa passou para o Codex, que é
/// o motor dela hoje. O resultado foi encurtado; o resto é o JSON gravado.
const READ_REAL: &str = r#"{"activityAt":1785711270298,"id":"a84accd2-f4a9-424b-90dd-2659e6a2d7ab","input":{"file_path":"/Users/viniciusmachado/projetos/pessoais/projeto/backend/src/main/java/com/vini/financemonitor/ingestion/pdf/ParsedRow.java"},"kind":"tool","name":"Read","parentToolId":"toolu_01QpYEjFU92EH5yNvb1wpUDN","result":{"lines":12,"ok":true,"text":"1\tpackage com.vini.financemonitor.ingestion.pdf;\n2\t\n3\timport"},"toolId":"toolu_01BnYc7XQ1uC7aBv1S3Sou6f","ts":1785711270261}"#;
const EDIT_REAL: &str = r#"{"activityAt":1785714577787,"id":"f7ee20db-eaf5-4a79-8d7f-3b2261208af4","input":{"file_path":"/Users/viniciusmachado/projetos/pessoais/projeto/backend/src/main/java/com/vini/financemonitor/ingestion/pdf/ParsedRow.java","new_string":"/**\n * Linha de transação extraída do PDF.\n * {@code amount} positivo = despesa, negativo = crédito.\n * {@code merchant} é o nome recuperado da linha anterior em transações internacionais.\n * {@code cardLast4} identifica de qual cartão veio a linha (seção \"Cartão ... (final NNNN)\"\n * da fatura) — base da atribuição automática por membro no modo casal.\n */\npublic record ParsedRow(int page, String raw, BigDecimal amount, String merchant, String cardLast4) {\n\n    public ParsedRow(int page, String raw, BigDecimal amount, String merchant) {\n        this(page, raw, amount, merchant, null);\n    }\n}","old_string":"/**\n * Linha de transação extraída do PDF.\n * {@code amount} positivo = despesa, negativo = crédito.\n * {@code merchant} é o nome recuperado da linha anterior em transações internacionais.\n */\npublic record ParsedRow(int page, String raw, BigDecimal amount, String merchant) {\n}","replace_all":false},"kind":"tool","name":"Edit","result":{"lines":1,"ok":true,"text":"The file /Users/viniciusmachado/projetos/pessoais/finance-mo"},"toolId":"toolu_013PdHY25yuVhEmra8Rkcjxq","ts":1785714577721}"#;

fn banco() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT, agent TEXT NOT NULL DEFAULT 'claude-code'); \
         CREATE TABLE conversation_items (conversation_id TEXT NOT NULL, position INTEGER NOT NULL, item_id TEXT NOT NULL, \
           item_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, position)); \
         CREATE TABLE turn_costs (run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conv_id TEXT NOT NULL, agent TEXT NOT NULL, created_at INTEGER NOT NULL);",
    )
    .unwrap();
    c.execute_batch(FTS_CRIAR_TRIGRAM).unwrap();
    c.execute_batch(FTS_TRIGGER_INSERT).unwrap();
    c
}

fn item(c: &Connection, conversa: &str, posicao: i64, json: &str) {
    c.execute(
        "INSERT INTO conversation_items VALUES (?1, ?2, ?3, ?4, 1, 0)",
        params![conversa, posicao, format!("i{posicao}"), json],
    )
    .unwrap();
}

fn turno(c: &Connection, conversa: &str, motor: &str, quando: i64) {
    c.execute(
        "INSERT INTO turn_costs VALUES (?1, 'p1', ?2, ?3, ?4)",
        params![format!("{conversa}-{quando}"), conversa, motor, quando],
    )
    .unwrap();
}

/// A conversa real: falas às 1785714216492 e 1785714402235, a edição às
/// 1785714577721, e o result do turno dela às 1785715270387, ainda Claude. O
/// revezamento para o Codex veio dias depois.
fn conversa_real(c: &Connection) {
    c.execute("INSERT INTO conversations VALUES ('c1', 'p1', 'finance monitor', 'codex')", []).unwrap();
    item(c, "c1", 0, r#"{"kind":"user","id":"u0","text":"vamos","ts":1785711201391}"#);
    item(c, "c1", 32, READ_REAL);
    item(c, "c1", 259, r#"{"kind":"user","id":"u259","text":"segue","ts":1785714402235}"#);
    item(c, "c1", 270, EDIT_REAL);
    for (m, t) in [
        ("claude-code", 1785711696464),
        ("claude-code", 1785714260197),
        ("claude-code", 1785715270387),
        ("codex", 1786486473482),
    ] {
        turno(c, "c1", m, t);
    }
}

#[test]
fn a_acao_antes_do_revezamento_e_do_claude_pelo_custo_do_turno_nunca_do_motor_atual() {
    let c = banco();
    conversa_real(&c);
    let achados = consultar(&c, "p1", ARQUIVO).unwrap();
    let edit = achados.iter().find(|a| a.nome == "Edit").unwrap();
    assert_eq!((edit.motor.as_str(), edit.fonte.as_str()), ("claude-code", "custo"));
    assert_eq!(edit.quando, 1785714577721);
    // A leitura também volta (a régua de alteração é do front), e o conteúdo
    // da edição não sai daqui.
    assert!(achados.iter().any(|a| a.nome == "Read"));
    assert!(edit.entrada.get("new_string").is_none_or(|v| v.as_str().is_some_and(|s| s.len() <= 512)));
    assert!(edit.entrada["file_path"].as_str().unwrap().ends_with("ParsedRow.java"));
}

#[test]
fn o_carimbo_ganha_de_tudo_e_outro_projeto_fica_de_fora() {
    let c = banco();
    conversa_real(&c);
    c.execute("INSERT INTO conversations VALUES ('c2', 'p1', 'revisão', 'claude-code')", []).unwrap();
    c.execute("INSERT INTO conversations VALUES ('c3', 'p2', 'outro projeto', 'codex')", []).unwrap();
    let carimbado = EDIT_REAL.replace(r#""kind":"tool""#, r#""kind":"tool","agent":"codex""#).replace("1785714577721", "1786500000000");
    item(&c, "c2", 5, &carimbado);
    item(&c, "c3", 1, EDIT_REAL);
    let achados = consultar(&c, "p1", ARQUIVO).unwrap();
    assert!(achados.iter().all(|a| a.conversa_id != "c3"));
    assert_eq!(achados[0].conversa_id, "c2", "a mais recente primeiro");
    assert_eq!((achados[0].motor.as_str(), achados[0].fonte.as_str()), ("codex", "carimbo"));
    assert_eq!(achados[0].titulo.as_deref(), Some("revisão"));
}

#[test]
fn caminho_so_no_resultado_nao_e_acao_sobre_o_arquivo() {
    let c = banco();
    conversa_real(&c);
    let grep = format!(
        r#"{{"kind":"tool","id":"g","name":"Bash","input":{{"command":"grep -rl record backend"}},"result":{{"ok":true,"text":"{ARQUIVO}"}},"ts":1785714600000}}"#
    );
    item(&c, "c1", 280, &grep);
    assert!(consultar(&c, "p1", ARQUIVO).unwrap().iter().all(|a| a.nome != "Bash"));
}

#[test]
fn sem_custo_no_turno_vale_o_vizinho_se_concordar_e_por_fim_a_conversa() {
    let t = vec![("claude-code".to_string(), 100), ("claude-code".to_string(), 300)];
    // Result depois da próxima fala: o turno da ação morreu sem custo.
    assert_eq!(motor_da_acao(None, 150, Some(200), &t, "codex"), ("claude-code".into(), "vizinho"));
    let t2 = vec![("claude-code".to_string(), 100), ("codex".to_string(), 300)];
    assert_eq!(motor_da_acao(None, 150, Some(200), &t2, "codex"), ("codex".into(), "conversa"));
    assert_eq!(motor_da_acao(None, 150, None, &[], "agy"), ("agy".into(), "conversa"));
    assert_eq!(motor_da_acao(Some(""), 150, None, &t, "agy"), ("claude-code".into(), "custo"));
}

#[test]
fn caminho_curto_demais_para_o_indice_nao_consulta() {
    let c = banco();
    assert!(consultar(&c, "p1", "a").unwrap().is_empty());
}
