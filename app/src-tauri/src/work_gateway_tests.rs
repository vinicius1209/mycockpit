use super::*;
use tauri::{test::mock_app, Listener};

fn run_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

// Payload real publicado via mc-work neste fio em 08/09/2026.
fn plan() -> Value {
    json!({"tasks":[{"id":"contrato-agy","title":"Verificar o suporte real do Agy e definir a identidade do canal","status":"in_progress"}]})
}

#[test]
fn processos_respeitam_modo_e_planejamento_enquanto_etapas_continuam_disponiveis() {
    use crate::adapters::Permission::*;
    for mode in [Leitura, Auto, FusionRo] {
        assert!(!processes_allowed(mode, false));
    }
    for mode in [Padrao, Liberado] {
        assert!(processes_allowed(mode, false));
        assert!(!processes_allowed(mode, true));
    }
    assert!(available_tools(None).is_empty());
    assert!(available_tools(Some(&json!({"ok":false}))).is_empty());
    let readiness = json!({"ok":true,"result":{"ready":true,"processesAllowed":false}});
    let names: Vec<_> = available_tools(Some(&readiness))
        .into_iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, [WORK_PLAN_TOOL, WORK_UPDATE_TOOL]);
    assert_eq!(
        available_tools(Some(
            &json!({"ok":true,"result":{"ready":true,"processesAllowed":true}})
        ))
        .len(),
        5
    );
}

#[tokio::test]
async fn listener_restrito_aceita_plano_mas_recusa_efeito_mesmo_em_chamada_direta() {
    let app = mock_app();
    let registry = Arc::new(ProcessRegistry::default());
    let listener = WorkListener::spawn(
        app.handle().clone(),
        run_id(),
        "restrita".into(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        registry.clone(),
        false,
    )
    .unwrap();
    let readiness = request_socket(listener.path(), "work_ready", &json!({}))
        .await
        .unwrap();
    assert_eq!(available_tools(Some(&readiness)).len(), 2);
    for action in [PROCESS_START_TOOL, PROCESS_POLL_TOOL, PROCESS_STOP_TOOL] {
        let reply = request_socket(
            listener.path(),
            action,
            &json!({"command":"true","process_id":"x"}),
        )
        .await
        .unwrap();
        assert_eq!(reply["ok"], false);
        assert!(reply["error"]
            .as_str()
            .unwrap()
            .contains("modo de permissão"));
    }
    assert!(registry.processes.lock().unwrap().is_empty());
    assert_eq!(
        request_socket(listener.path(), WORK_PLAN_TOOL, &plan())
            .await
            .unwrap()["ok"],
        true
    );
}

#[tokio::test]
async fn duas_conversas_na_mesma_pasta_recebem_somente_os_proprios_eventos() {
    let app = mock_app();
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = events.clone();
    app.listen("work://event", move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    let registry = Arc::new(ProcessRegistry::default());
    let cwd = std::env::temp_dir().to_string_lossy().into_owned();
    let run_a = run_id();
    let run_b = run_id();
    let a = WorkListener::spawn(
        app.handle().clone(),
        run_a.clone(),
        "conversa-a".into(),
        cwd.clone(),
        registry.clone(),
        true,
    )
    .unwrap();
    let b = WorkListener::spawn(
        app.handle().clone(),
        run_b.clone(),
        "conversa-b".into(),
        cwd,
        registry,
        true,
    )
    .unwrap();
    assert_ne!(a.path(), b.path());
    assert_eq!(
        request_socket(a.path(), WORK_PLAN_TOOL, &plan())
            .await
            .unwrap()["ok"],
        true
    );
    assert_eq!(
        request_socket(
            b.path(),
            WORK_UPDATE_TOOL,
            &json!({"id":"contrato-agy","status":"completed"})
        )
        .await
        .unwrap()["ok"],
        true
    );
    let emitted = events.lock().unwrap();
    assert_eq!(emitted.len(), 2);
    assert_eq!(emitted[0]["kind"], "work_plan");
    assert_eq!(emitted[0]["data"]["convId"], "conversa-a");
    assert_eq!(emitted[0]["data"]["runId"], run_a);
    assert_eq!(emitted[0]["data"]["tasks"], plan()["tasks"]);
    assert_eq!(emitted[1]["kind"], "work_update");
    assert_eq!(emitted[1]["data"]["convId"], "conversa-b");
    assert_eq!(emitted[1]["data"]["runId"], run_b);
}

#[tokio::test]
async fn encerramento_revoga_socket_e_conexao_que_ainda_nao_enviou_o_pedido() {
    use std::os::unix::fs::PermissionsExt;
    let app = mock_app();
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = events.clone();
    app.listen("work://event", move |event| {
        sink.lock().unwrap().push(event.payload().into());
    });
    let listener = WorkListener::spawn(
        app.handle().clone(),
        run_id(),
        "c".into(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        Arc::new(ProcessRegistry::default()),
        true,
    )
    .unwrap();
    let path = listener.path().to_path_buf();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        request_socket(&path, "work_ready", &json!({}))
            .await
            .unwrap()["result"]["ready"],
        true
    );
    let mut pending = UnixStream::connect(&path).await.unwrap();
    pending.write_all(b"{\"action\":").await.unwrap();
    tokio::task::yield_now().await;
    drop(listener);
    let _ = pending
        .write_all(b"\"work_plan\",\"args\":{\"tasks\":[]}}\n")
        .await;
    assert!(request_socket(&path, WORK_PLAN_TOOL, &plan())
        .await
        .is_none());
    tokio::task::yield_now().await;
    assert!(events.lock().unwrap().is_empty());
    assert!(!path.exists());
}

#[tokio::test]
async fn processo_de_outra_conversa_nao_pode_ser_lido_nem_interrompido() {
    let app = mock_app();
    let registry = Arc::new(ProcessRegistry::default());
    let view = ManagedProcessView {
        id: "outro".into(),
        run_id: "anterior".into(),
        conv_id: "dona".into(),
        label: "Processo encerrado".into(),
        command: "true".into(),
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        pid: 0,
        status: "exited".into(),
        exit_code: Some(0),
        output: "saída privada".into(),
        started_at: 0,
        updated_at: 0,
    };
    registry.processes.lock().unwrap().insert(
        view.id.clone(),
        ProcessRecord {
            view,
            tail: VecDeque::new(),
        },
    );
    let listener = WorkListener::spawn(
        app.handle().clone(),
        run_id(),
        "visitante".into(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        registry.clone(),
        true,
    )
    .unwrap();
    for action in [PROCESS_POLL_TOOL, PROCESS_STOP_TOOL] {
        let result = request_socket(listener.path(), action, &json!({"process_id":"outro"}))
            .await
            .unwrap();
        assert_eq!(result["ok"], false);
        assert!(!result.to_string().contains("saída privada"));
    }
    assert_eq!(registry.view("outro").unwrap().status, "exited");
    let owner = WorkListener::spawn(
        app.handle().clone(),
        run_id(),
        "dona".into(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        registry,
        true,
    )
    .unwrap();
    assert_eq!(
        request_socket(
            owner.path(),
            PROCESS_POLL_TOOL,
            &json!({"process_id":"outro"})
        )
        .await
        .unwrap()["ok"],
        true
    );
}
