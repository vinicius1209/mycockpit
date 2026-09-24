use super::*;
use tauri::{test::mock_app, Listener};

fn run_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

// Payload real publicado via frota-work neste fio em 08/09/2026.
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
    // o título (ADR-246) não é efeito na máquina: vale até no modo restrito
    assert_eq!(names, [WORK_PLAN_TOOL, WORK_UPDATE_TOOL, CONVERSATION_TITLE_TOOL]);
    assert_eq!(
        available_tools(Some(
            &json!({"ok":true,"result":{"ready":true,"processesAllowed":true}})
        ))
        .len(),
        6
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
    assert_eq!(available_tools(Some(&readiness)).len(), 3);
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

// ADR-246: o agente nomeia a conversa no primeiro turno. Vale no modo
// restrito (não é efeito na máquina) e chega à tela com a conversa dona.
#[tokio::test]
async fn titulo_do_agente_chega_a_tela_com_a_conversa_dona() {
    let app = mock_app();
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = events.clone();
    app.listen("work://event", move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    let listener = WorkListener::spawn(
        app.handle().clone(),
        run_id(),
        "conversa-t".into(),
        std::env::temp_dir().to_string_lossy().into_owned(),
        Arc::new(ProcessRegistry::default()),
        false,
    )
    .unwrap();
    let ok = request_socket(listener.path(), CONVERSATION_TITLE_TOOL, &json!({"title":"Barra lateral enxuta"}))
        .await
        .unwrap();
    assert_eq!(ok["ok"], true);
    let vazio = request_socket(listener.path(), CONVERSATION_TITLE_TOOL, &json!({"title":"  "}))
        .await
        .unwrap();
    assert_eq!(vazio["ok"], false);
    let emitted = events.lock().unwrap();
    assert_eq!(emitted.len(), 1, "título recusado não vira evento");
    assert_eq!(emitted[0]["kind"], "conversation_title");
    assert_eq!(emitted[0]["data"]["convId"], "conversa-t");
    assert_eq!(emitted[0]["data"]["title"], "Barra lateral enxuta");
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

#[test]
fn saida_emite_delta_numerado_sem_repetir_o_tail_inteiro() {
    let app = mock_app();
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = events.clone();
    app.listen("work://event", move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    let registry = ProcessRegistry::default();
    let view = ManagedProcessView {
        id: "p1".into(),
        run_id: "r1".into(),
        conv_id: "c1".into(),
        label: "Teste".into(),
        command: "printf oi".into(),
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        pid: 1,
        status: "running".into(),
        exit_code: None,
        output: String::new(),
        output_file: None,
        started_at: 1,
        updated_at: 1,
    };
    registry
        .processes
        .lock()
        .unwrap()
        .insert(view.id.clone(), ProcessRecord::new(view));
    registry.append_output(app.handle(), "p1", "stdout", "primeira".into());
    registry.append_output(app.handle(), "p1", "stderr", "segunda".into());

    let emitted = events.lock().unwrap();
    assert_eq!(emitted[0]["kind"], "process_output");
    assert_eq!(emitted[0]["data"]["processId"], "p1");
    assert_eq!(emitted[0]["data"]["seq"], 1);
    assert_eq!(emitted[1]["data"]["seq"], 2);
    assert!(emitted[0]["data"].get("process").is_none());
    assert_eq!(registry.view("p1").unwrap().output, "primeira\nsegunda");
}

#[test]
fn tail_de_processo_tem_teto_de_linhas_e_bytes() {
    let app = mock_app();
    let registry = ProcessRegistry::default();
    let view = ManagedProcessView {
        id: "p-volume".into(),
        run_id: "r1".into(),
        conv_id: "c1".into(),
        label: "Volume".into(),
        command: "gera saída".into(),
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        pid: 1,
        status: "running".into(),
        exit_code: None,
        output: String::new(),
        output_file: None,
        started_at: 1,
        updated_at: 1,
    };
    registry
        .processes
        .lock()
        .unwrap()
        .insert(view.id.clone(), ProcessRecord::new(view));
    for index in 0..400 {
        registry.append_output(
            app.handle(),
            "p-volume",
            "stdout",
            format!("{index:04} {}", "x".repeat(2_048)),
        );
    }
    let map = registry.processes.lock().unwrap();
    let record = map.get("p-volume").unwrap();
    assert!(record.tail.len() <= TAIL_LINES);
    assert!(record.tail_bytes <= TAIL_BYTES);
    assert!(record.view.output.len() <= TAIL_BYTES);
    assert_eq!(record.output_seq, 400);
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
        output_file: None,
        started_at: 0,
        updated_at: 0,
    };
    registry
        .processes
        .lock()
        .unwrap()
        .insert(view.id.clone(), ProcessRecord::new(view));
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

#[test]
fn direct_to_disk_grava_linhas_no_arquivo_e_informa_output_file() {
    let app = mock_app();
    let registry = ProcessRegistry::default();
    let temp_dir = std::env::temp_dir().join("mycockpit-test-disk");
    let _ = std::fs::create_dir_all(&temp_dir);
    let output_path = temp_dir.join("p-disk.output");
    let _ = std::fs::File::create(&output_path);

    let view = ManagedProcessView {
        id: "p-disk".into(),
        run_id: "r1".into(),
        conv_id: "c1".into(),
        label: "DirectToDisk".into(),
        command: "echo gravando".into(),
        cwd: temp_dir.to_string_lossy().into_owned(),
        pid: 1,
        status: "running".into(),
        exit_code: None,
        output: String::new(),
        output_file: Some(output_path.to_string_lossy().into_owned()),
        started_at: 1,
        updated_at: 1,
    };
    let mut record = ProcessRecord::new(view.clone());
    record.output_path = Some(output_path.clone());
    registry
        .processes
        .lock()
        .unwrap()
        .insert("p-disk".into(), record);

    registry.append_output(app.handle(), "p-disk", "stdout", "linha 1 gravada".into());
    registry.append_output(app.handle(), "p-disk", "stdout", "linha 2 gravada".into());

    let content = std::fs::read_to_string(&output_path).unwrap();
    assert_eq!(content, "linha 1 gravada\nlinha 2 gravada\n");
    let p = registry.view("p-disk").unwrap();
    assert_eq!(p.output_file, Some(output_path.to_string_lossy().into_owned()));

    let _ = std::fs::remove_file(output_path);
}

#[test]
fn stop_by_conv_interrompe_apenas_processos_daquela_conversa() {
    let app = mock_app();
    let registry = ProcessRegistry::default();

    let p1 = ManagedProcessView {
        id: "p1".into(),
        run_id: "r1".into(),
        conv_id: "conv-alvo".into(),
        label: "P1".into(),
        command: "true".into(),
        cwd: ".".into(),
        pid: 1001,
        status: "running".into(),
        exit_code: None,
        output: String::new(),
        output_file: None,
        started_at: 1,
        updated_at: 1,
    };
    let p2 = ManagedProcessView {
        id: "p2".into(),
        run_id: "r2".into(),
        conv_id: "conv-outra".into(),
        label: "P2".into(),
        command: "true".into(),
        cwd: ".".into(),
        pid: 1002,
        status: "running".into(),
        exit_code: None,
        output: String::new(),
        output_file: None,
        started_at: 1,
        updated_at: 1,
    };
    registry
        .processes
        .lock()
        .unwrap()
        .insert("p1".into(), ProcessRecord::new(p1));
    registry
        .processes
        .lock()
        .unwrap()
        .insert("p2".into(), ProcessRecord::new(p2));

    let stopped = registry.stop_by_conv(app.handle(), "conv-alvo");
    assert_eq!(stopped.len(), 1);
    assert_eq!(stopped[0].id, "p1");
    assert_eq!(stopped[0].status, "stopping");

    assert_eq!(registry.view("p1").unwrap().status, "stopping");
    assert_eq!(registry.view("p2").unwrap().status, "running");
}


/// ADR-228: o navegador pode esperar o gesto da pessoa (90 s) e rodar código
/// na página (30 s); o computador digita texto longo. Com o teto único de 6 s,
/// a espera era cortada e voltava como "Frota indisponível".
#[test]
fn cada_acao_tem_o_teto_que_o_seu_trabalho_pede() {
    assert!(teto_do_pedido(crate::browser_gateway::NAVIGATE_TOOL) >= std::time::Duration::from_secs(120));
    assert!(teto_do_pedido(crate::browser_gateway::EVALUATE_TOOL) >= std::time::Duration::from_secs(120));
    assert!(teto_do_pedido(crate::desktop_gateway::TYPE_TOOL) >= std::time::Duration::from_secs(60));
    assert_eq!(teto_do_pedido(PROCESS_START_TOOL), REQUEST_TIMEOUT);
    assert_eq!(teto_do_pedido("work_ready"), REQUEST_TIMEOUT);
}
