//! A cauda do stdout pertence ao turno, mesmo depois que o processo saiu.
//!
//! Incidente de 13/09/2026: o Claude Code gravou na sessão uma resposta de 2030
//! caracteres com `stop_reason: end_turn`, e a Frota guardou só os primeiros 406
//! (parou em `"pert`). O `run_once` corria "próxima linha do stdout" contra
//! "processo terminou" num `select!`; quando o fim do processo ganhava, o loop
//! saía sem ler o que ainda estava no pipe, e o `terminate_run` fechava o resto.
//!
//! Fixture: `testdata/claude-2.1.266/texto-tool-texto.jsonl`, stream REAL do
//! `claude -p --output-format stream-json --verbose --include-partial-messages`
//! (texto, Read, texto). Só saíram as linhas `system` (init e hooks carregam a
//! configuração da máquina); as do turno estão como vieram.
use super::*;
use crate::adapters::{AgentAdapter, ClaudeAdapter};

const FIXTURE: &str = include_str!("../testdata/claude-2.1.266/texto-tool-texto.jsonl");

/// Linha real da captura que o adapter ignora: serve de lastro pra encher o
/// pipe sem mudar o texto esperado.
fn lastro() -> &'static str {
    FIXTURE
        .lines()
        .find(|l| l.contains("\"input_json_delta\""))
        .expect("a captura tem delta de input de tool")
}

/// O texto que o motor mandou, somando os `text_delta` da própria captura.
fn texto_da_captura() -> String {
    FIXTURE
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.pointer("/event/delta/type").and_then(|t| t.as_str()) == Some("text_delta"))
        .filter_map(|v| {
            v.pointer("/event/delta/text")
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })
        .collect()
}

async fn rodar_replay(saida: &std::path::Path) -> (Vec<serde_json::Value>, Outcome) {
    let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let captured = events.clone();
    let channel = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(json) = body {
            captured
                .lock()
                .unwrap()
                .push(serde_json::from_str(&json).unwrap());
        }
        Ok(())
    });
    let mut cmd = Command::new("cat");
    cmd.arg(saida);
    let mut adapter: Box<dyn AgentAdapter> = Box::new(ClaudeAdapter::default());
    let notify = Arc::new(Notify::new());
    let registry = RunRegistry::default();
    let run_id = format!("frota-cauda-{}-{}", std::process::id(), saida.display());
    let outcome = run_once(
        cmd,
        false,
        &channel,
        &mut adapter,
        &notify,
        &registry,
        &run_id,
        ("claude-code", "/tmp/frota-teste-inventario"),
    )
    .await
    .unwrap();
    registry.1.lock().unwrap().remove(&run_id);
    let events = events.lock().unwrap().clone();
    (events, outcome)
}

fn texto_entregue(events: &[serde_json::Value]) -> String {
    events
        .iter()
        .filter(|e| e["type"] == "text_delta")
        .filter_map(|e| e["text"].as_str())
        .collect()
}

/// `cat` escreve centenas de KB e sai assim que o último byte entra no pipe.
/// O que sobra no buffer do pipe nesse instante é exatamente a cauda do turno:
/// os últimos `text_delta`, o `assistant` e o `result`.
#[tokio::test]
async fn processo_que_sai_com_o_pipe_cheio_entrega_o_turno_inteiro() {
    let dir = std::env::temp_dir().join(format!("frota-cauda-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let saida = dir.join("stdout.jsonl");
    let mut conteudo = String::new();
    for _ in 0..6_000 {
        conteudo.push_str(lastro());
        conteudo.push('\n');
    }
    conteudo.push_str(FIXTURE);
    std::fs::write(&saida, &conteudo).unwrap();
    let esperado = texto_da_captura();
    assert!(
        esperado.contains("arquivo nota.txt"),
        "captura sem resposta não prova nada"
    );

    // Várias rodadas: o `select!` sorteia entre ramos prontos, então uma rodada
    // só poderia passar por sorte no código antigo.
    for rodada in 0..8 {
        let (events, outcome) = rodar_replay(&saida).await;
        assert!(
            outcome.success,
            "rodada {rodada}: o replay deveria sair limpo"
        );
        assert_eq!(
            texto_entregue(&events),
            esperado,
            "rodada {rodada}: a cauda sumiu"
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e["type"] == "result" && e["ok"] == true)
                .count(),
            1,
            "rodada {rodada}: o result do turno sumiu junto com a cauda"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// A drenagem tem prazo: um neto em background que herdou o stdout e ficou
/// mudo não pode pendurar o fim do turno (foi por isso que o ramo do
/// `child.wait()` nasceu, em 794a909).
#[tokio::test]
async fn neto_que_segura_o_pipe_nao_pendura_o_fim_do_turno() {
    let channel = Channel::new(|_| Ok(()));
    let mut cmd = Command::new("sh");
    // O `sleep` herda o STDOUT e fica vivo depois que o `sh` sai. O stderr vai
    // pro /dev/null de propósito: neto que segura o stderr pendura o
    // `stderr_task` por outro caminho, que não é o desta correção.
    cmd.args([
        "-c",
        "echo '{\"type\":\"system\",\"subtype\":\"status\"}'; sleep 20 2>/dev/null & exit 0",
    ]);
    let mut adapter: Box<dyn AgentAdapter> = Box::new(ClaudeAdapter::default());
    let notify = Arc::new(Notify::new());
    let registry = RunRegistry::default();
    let run_id = format!("frota-cauda-neto-{}", std::process::id());
    let inicio = std::time::Instant::now();
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        run_once(
            cmd,
            false,
            &channel,
            &mut adapter,
            &notify,
            &registry,
            &run_id,
            ("claude-code", "/tmp/frota-teste-inventario"),
        ),
    )
    .await
    .expect("o fim do turno pendurou no neto que segura o pipe")
    .unwrap();
    registry.1.lock().unwrap().remove(&run_id);
    assert!(outcome.success);
    assert!(
        inicio.elapsed() < std::time::Duration::from_secs(5),
        "a drenagem precisa de teto curto, levou {:?}",
        inicio.elapsed()
    );
}

/// Mesmo um descendente que escreve sem pausa não pode renovar a drenagem
/// indefinidamente. Cancelar durante essa drenagem também continua funcionando.
///
/// Runtime de várias threads, como o do app: no de uma thread só (o padrão do
/// `#[tokio::test]`) o `yes` inundando o pipe matava o relógio de fome, o
/// cancelamento de 100 ms chegava com ~2,5 s e a régua de 5 s estourava na
/// suíte completa (instável desde 21/09/2026). Medido: 65 ms do sinal ao fim.
async fn verificar_neto_ativo(cancelar: bool) {
    let channel = Channel::new(|_| Ok(()));
    let mut cmd = Command::new("sh");
    cmd.args(["-c", "yes '{}' 2>/dev/null & exit 0"]);
    let mut adapter: Box<dyn AgentAdapter> = Box::new(ClaudeAdapter::default());
    let notify = Arc::new(Notify::new());
    let registry = RunRegistry::default();
    let run_id = format!("frota-cauda-ativo-{}-{cancelar}", std::process::id());
    let inicio = std::time::Instant::now();
    let sinal = notify.clone();
    let cancel_task = tokio::spawn(async move {
        if cancelar {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            sinal.notify_one();
        }
    });
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        run_once(
            cmd,
            false,
            &channel,
            &mut adapter,
            &notify,
            &registry,
            &run_id,
            ("claude-code", "/tmp/frota-teste-inventario"),
        ),
    )
    .await
    .expect("descendente ativo prendeu o turno")
    .unwrap();
    cancel_task.await.unwrap();
    registry.1.lock().unwrap().remove(&run_id);
    assert_eq!(outcome.cancelled, cancelar);
    assert!(inicio.elapsed() < std::time::Duration::from_secs(5));
    if cancelar {
        // o Stop não espera a drenagem: volta logo depois do sinal
        assert!(
            inicio.elapsed() < std::time::Duration::from_secs(1),
            "cancelar esperou a drenagem: {:?}",
            inicio.elapsed()
        );
    }
    if !cancelar {
        assert!(outcome.success);
        assert!(inicio.elapsed() >= DRENAGEM_TETO);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn neto_que_escreve_sem_parar_respeita_teto_total() {
    verificar_neto_ativo(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelamento_interrompe_drenagem_de_neto_ativo() {
    verificar_neto_ativo(true).await;
}
