//! Replay de fixtures reais na suíte normal. O probe de CLI é opt-in, exige
//! workspace explícito e `--ignored --exact`; não escreve no banco do aplicativo.
use super::*;
use crate::adapters::{AgentAdapter, AgyAdapter, Permission};
use std::io::Write;
use std::path::PathBuf;

fn textos(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::TextDelta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

/// Captura real do agy 1.2.5 (testdata/agy-1.2.5/README.md): tarefa em
/// background, aviso de espera no stderr, ponte muda, depois os steps segurados.
/// Replay na MESMA ordem medida: stdout até a ferramenta ACTIVE, stderr, e o
/// resto do stdout.
#[test]
fn espera_por_tarefa_em_background_mostra_a_resposta_sem_duplicar() {
    let stdout = include_str!("../testdata/agy-1.2.5/bg-sleep.jsonl");
    let stderr = include_str!("../testdata/agy-1.2.5/bg-sleep.stderr");
    let transcript = include_str!("../testdata/agy-1.2.5/bg-sleep.transcript.jsonl");
    let linhas: Vec<&str> = stdout.lines().collect();
    let mut adapter = AgyAdapter::default();
    // o transcript como estava no aviso de espera: até o step 3 ("PRONTO.")
    adapter.transcript_de_teste = Some(transcript.lines().take(4).collect::<Vec<_>>().join("\n"));
    let mut antes = Vec::new();
    for line in &linhas[..4] {
        antes.extend(adapter.on_stdout_line(line));
    }
    assert_eq!(textos(&antes), "", "a ponte ainda não trouxe resposta");

    let na_espera: Vec<AgentEvent> = stderr.lines().flat_map(|l| adapter.on_stderr_line(l)).collect();
    assert_eq!(textos(&na_espera), "PRONTO.");
    assert!(matches!(na_espera.get(1), Some(AgentEvent::TextStop)));
    let avisos: Vec<&str> = na_espera
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Notice { message } => Some(message.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(avisos.len(), 1);
    assert!(avisos[0].contains("esperando 1 tarefa em segundo plano"));
    assert!(adapter.on_heartbeat().is_empty(), "a batida não repete o que já foi mostrado");

    let mut depois = Vec::new();
    for line in &linhas[4..] {
        depois.extend(adapter.on_stdout_line(line));
    }
    depois.extend(adapter.on_close());
    let texto_depois = textos(&depois);
    assert!(!texto_depois.contains("PRONTO"), "o step 3 já estava na tela: {texto_depois}");
    assert!(texto_depois.contains("terminou-o-sleep"), "o comentário novo do agente chega");
    assert!(depois.iter().any(|e| matches!(e, AgentEvent::ToolResult { ok: true, .. })));
    assert_eq!(
        depois
            .iter()
            .filter(|e| matches!(e, AgentEvent::Result { ok: true, .. }))
            .count(),
        1
    );
}

#[test]
fn aviso_de_espera_antes_do_transcript_gravar_espera_a_batida() {
    let stdout = include_str!("../testdata/agy-1.2.5/bg-sleep.jsonl");
    let stderr = include_str!("../testdata/agy-1.2.5/bg-sleep.stderr");
    let transcript = include_str!("../testdata/agy-1.2.5/bg-sleep.transcript.jsonl");
    let mut adapter = AgyAdapter::default();
    // o histórico ainda sem a resposta (só até o step 2)
    adapter.transcript_de_teste = Some(transcript.lines().take(3).collect::<Vec<_>>().join("\n"));
    for line in stdout.lines().take(4) {
        adapter.on_stdout_line(line);
    }
    let na_espera: Vec<AgentEvent> = stderr.lines().flat_map(|l| adapter.on_stderr_line(l)).collect();
    assert_eq!(textos(&na_espera), "");
    assert_eq!(na_espera.len(), 1, "só a explicação da espera");
    assert!(adapter.on_heartbeat().is_empty());

    adapter.transcript_de_teste = Some(transcript.lines().take(4).collect::<Vec<_>>().join("\n"));
    let na_batida = adapter.on_heartbeat();
    assert_eq!(textos(&na_batida), "PRONTO.");
    assert!(
        !na_batida.iter().any(|e| matches!(e, AgentEvent::Notice { .. })),
        "a explicação sai uma vez só"
    );
    // parar depois disso não repete a resposta
    assert_eq!(textos(&adapter.on_cancel()), "");
}

#[test]
fn stderr_que_nao_e_espera_nao_mexe_no_fio() {
    let mut adapter = AgyAdapter::default();
    assert!(adapter.on_stderr_line("warning: conversation \"x\" not found").is_empty());
    assert!(adapter.on_heartbeat().is_empty());
    assert_eq!(crate::adapters::agy_tarefas_em_espera("root agent idle; waiting for 3 background task(s) (bounded by --print-timeout)"), Some(3));
    assert_eq!(crate::adapters::agy_tarefas_em_espera("root agent idle; waiting for x background task(s)"), None);
}

#[test]
fn captura_real_preserva_resposta_sem_duplicar_result() {
    let root = std::env::var("FROTA_AGY_CAPTURE_DIR")
        .ok()
        .map(PathBuf::from);
    for (case, raw) in [
        ("volume", include_str!("../testdata/agy-1.2.2/volume.jsonl")),
        ("resume", include_str!("../testdata/agy-1.2.2/resume.jsonl")),
    ] {
        let mut adapter = AgyAdapter::default();
        let mut events = Vec::new();
        let mut expected = String::new();
        for line in raw.lines() {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            if let Some(text) = value
                .pointer("/step_update/text_delta")
                .and_then(|v| v.as_str())
            {
                expected.push_str(text);
            }
            events.extend(adapter.on_stdout_line(line));
        }
        events.extend(adapter.on_close());
        let rendered: String = events
            .iter()
            .filter_map(|e| match e {
                AgentEvent::TextDelta { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            !expected.is_empty(),
            "captura sem resposta não prova render"
        );
        assert_eq!(rendered, expected);
        assert!(rendered.contains("FROTA_E2E_VOLUME_DONE"));
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, AgentEvent::Result { ok: true, .. }))
                .count(),
            1
        );
        if let Some(root) = &root {
            std::fs::write(
                root.join(format!("{case}.normalized.json")),
                serde_json::to_vec_pretty(&events).unwrap(),
            )
            .unwrap();
        }
    }
}

#[tokio::test]
#[ignore = "executa Agy real e consome quota; requer autorização e workspace explícitos"]
async fn runner_real_transmite_eventos_e_encerra_processos() {
    let root = PathBuf::from(std::env::var("FROTA_AGY_CAPTURE_DIR").expect("diretório isolado"));
    let case = std::env::var("FROTA_AGY_LIVE_CASE").expect("caso autorizado");
    assert!(case == "runner" || case == "cancel");
    let cwd = root.join("workspace");
    assert!(cwd.join("workload.py").is_file());
    let req = RunRequest {
        prompt: std::fs::read_to_string(root.join(format!("{case}.prompt.txt"))).unwrap(),
        system_prompt: None,
        cwd: cwd.to_str().unwrap().into(),
        resume: std::env::var("FROTA_AGY_RESUME").ok(),
        memory_fallback: None,
        permission: Permission::Liberado,
        model: Some("gemini-3.8-flash-high".into()),
        effort: None,
        attachments: vec![],
        extra_dirs: vec![],
        approval: None,
        context_gateway: None,
        work_gateway: None,
        browser_gateway: None,
        desktop_gateway: None,
        denied_mcp_servers: Vec::new(),
        tool_gateway: None,
        mcp_plan: Default::default(),
        plan_first: false,
        usage_baseline: None,
        cost_baseline: None,
    };
    let mut adapter: Box<dyn AgentAdapter> = Box::new(AgyAdapter::default());
    let mut cmd = adapter.build_validated_command(&req).unwrap();
    for (name, _) in
        std::env::vars().filter(|(k, _)| k.starts_with("MYCOCKPIT_") || k.starts_with("FROTA_"))
    {
        cmd.env_remove(name);
    }
    let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let captured = events.clone();
    let file = Arc::new(Mutex::new(
        std::fs::File::create(root.join(format!("{case}.normalized.jsonl"))).unwrap(),
    ));
    let channel = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(json) = body {
            writeln!(file.lock().unwrap(), "{json}").unwrap();
            captured
                .lock()
                .unwrap()
                .push(serde_json::from_str(&json).unwrap());
        }
        Ok(())
    });
    let notify = Arc::new(Notify::new());
    let cancellation = notify.clone();
    let cancel_case = case == "cancel";
    let deadline = tokio::spawn(async move {
        for _ in 0..180 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if cancel_case && cwd.join("cancel.pid").exists() {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                cancellation.notify_one();
                return;
            }
        }
        cancellation.notify_one();
    });
    let registry = RunRegistry::default();
    let run_id = format!("frota-agy-live-{}-{case}", std::process::id());
    let outcome = run_once(
        cmd,
        req.resume.is_some(),
        &channel,
        &mut adapter,
        &notify,
        &registry,
        &run_id,
        ("agy", "/tmp/frota-teste-inventario"),
    )
    .await
    .unwrap();
    deadline.abort();
    registry.1.lock().unwrap().remove(&run_id);
    let events = events.lock().unwrap();
    let summary = serde_json::json!({"cancelled": outcome.cancelled, "success": outcome.success,
        "code": outcome.code, "session_id": outcome.session_id, "events": events.len(),
        "terminal_incident": outcome.terminal_incident, "stderr": outcome.stderr});
    std::fs::write(
        root.join(format!("{case}.runner-summary.json")),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    assert_eq!(outcome.cancelled, cancel_case, "timeout não é sucesso");
    assert!(events.iter().any(|e| e["type"] == "started"));
    assert!(events.iter().any(|e| e["type"] == "tool"));
    if cancel_case {
        assert!(!events
            .iter()
            .any(|e| e["type"] == "result" && e["ok"] == true));
        let pid = std::fs::read_to_string(root.join("workspace/cancel.pid")).unwrap();
        let alive = std::process::Command::new("ps")
            .args(["-p", pid.trim(), "-o", "pid="])
            .output()
            .unwrap();
        assert!(
            alive.stdout.is_empty(),
            "processo do workload sobreviveu ao cancelamento"
        );
        assert!(!root.join("workspace/unexpected-completion").exists());
    } else {
        assert!(outcome.success && !outcome.terminal_incident);
        assert!(events
            .iter()
            .any(|e| e["type"] == "result" && e["ok"] == true));
        let text: String = events
            .iter()
            .filter(|e| e["type"] == "text_delta")
            .filter_map(|e| e["text"].as_str())
            .collect();
        assert!(text.contains("FROTA_E2E_VOLUME_DONE"));
    }
}

/// Reprodução do incidente de 17/09/2026 (ADR-203) pelo runner de produção: o
/// Agy sobe um servidor de desenvolvimento em background, responde, e o `-p`
/// fica esperando o servidor. A resposta precisa chegar ao fio DURANTE a espera,
/// uma vez só, com a explicação; parar encerra o servidor junto.
///
/// `FROTA_AGY_CAPTURE_DIR` com `workspace/` (projeto Next) e
/// `devserver.prompt.txt`; `FROTA_AGY_DEVSERVER_PORT` é a porta do pedido.
#[tokio::test]
#[ignore = "executa Agy real e consome quota; requer autorização e workspace explícitos"]
async fn runner_real_mostra_a_resposta_enquanto_o_agy_espera_o_dev_server() {
    let root = PathBuf::from(std::env::var("FROTA_AGY_CAPTURE_DIR").expect("diretório isolado"));
    let porta: u16 = std::env::var("FROTA_AGY_DEVSERVER_PORT")
        .expect("porta do pedido")
        .parse()
        .unwrap();
    let cwd = root.join("workspace");
    assert!(cwd.join("package.json").is_file());
    let porta_ocupada = move || {
        !std::process::Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{porta}"), "-sTCP:LISTEN"])
            .output()
            .unwrap()
            .stdout
            .is_empty()
    };
    assert!(!porta_ocupada(), "porta {porta} já estava em uso antes do run");
    let req = RunRequest {
        prompt: std::fs::read_to_string(root.join("devserver.prompt.txt")).unwrap(),
        system_prompt: None,
        cwd: cwd.to_str().unwrap().into(),
        resume: None,
        memory_fallback: None,
        permission: Permission::Liberado,
        model: Some("gemini-3.8-flash-high".into()),
        effort: None,
        attachments: vec![],
        extra_dirs: vec![],
        approval: None,
        context_gateway: None,
        work_gateway: None,
        browser_gateway: None,
        desktop_gateway: None,
        denied_mcp_servers: Vec::new(),
        tool_gateway: None,
        mcp_plan: Default::default(),
        plan_first: false,
        usage_baseline: None,
        cost_baseline: None,
    };
    let mut adapter: Box<dyn AgentAdapter> = Box::new(AgyAdapter::default());
    let mut cmd = adapter.build_validated_command(&req).unwrap();
    for (name, _) in
        std::env::vars().filter(|(k, _)| k.starts_with("MYCOCKPIT_") || k.starts_with("FROTA_"))
    {
        cmd.env_remove(name);
    }
    let inicio = std::time::Instant::now();
    // (segundos desde o início, evento) na ordem em que o Channel recebeu
    let events = Arc::new(Mutex::new(Vec::<(f64, serde_json::Value)>::new()));
    let captured = events.clone();
    let file = Arc::new(Mutex::new(
        std::fs::File::create(root.join("devserver.normalized.jsonl")).unwrap(),
    ));
    let channel = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(json) = body {
            let t = inicio.elapsed().as_secs_f64();
            writeln!(file.lock().unwrap(), "{{\"t\":{t:.1},\"event\":{json}}}").unwrap();
            captured
                .lock()
                .unwrap()
                .push((t, serde_json::from_str(&json).unwrap()));
        }
        Ok(())
    });
    let notify = Arc::new(Notify::new());
    let cancellation = notify.clone();
    let observados = events.clone();
    // Para 30 s depois da explicação da espera (a pessoa lendo a resposta e
    // decidindo parar), ou em 6 min se ela nunca vier.
    let servidor_no_ar_na_espera = Arc::new(Mutex::new(None::<bool>));
    let servidor_visto = servidor_no_ar_na_espera.clone();
    let deadline = tokio::spawn(async move {
        for _ in 0..360 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let explicou = observados.lock().unwrap().iter().any(|(_, e)| {
                e["type"] == "notice"
                    && e["message"].as_str().is_some_and(|m| m.contains("em segundo plano"))
            });
            if explicou {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                *servidor_visto.lock().unwrap() = Some(porta_ocupada());
                cancellation.notify_one();
                return;
            }
        }
        cancellation.notify_one();
    });
    let registry = RunRegistry::default();
    let run_id = format!("frota-agy-live-{}-devserver", std::process::id());
    let outcome = run_once(
        cmd,
        false,
        &channel,
        &mut adapter,
        &notify,
        &registry,
        &run_id,
        ("agy", "/tmp/frota-teste-inventario"),
    )
    .await
    .unwrap();
    let fim = inicio.elapsed().as_secs_f64();
    deadline.abort();
    registry.1.lock().unwrap().remove(&run_id);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let porta_apos_parar = porta_ocupada();
    let events = events.lock().unwrap();
    let texto: String = events
        .iter()
        .filter(|(_, e)| e["type"] == "text_delta")
        .filter_map(|(_, e)| e["text"].as_str())
        .collect();
    let t_texto = events.iter().find(|(_, e)| e["type"] == "text_delta").map(|(t, _)| *t);
    let t_aviso = events
        .iter()
        .find(|(_, e)| e["type"] == "notice" && e["message"].as_str().is_some_and(|m| m.contains("em segundo plano")))
        .map(|(t, _)| *t);
    let summary = serde_json::json!({
        "cancelled": outcome.cancelled, "success": outcome.success, "code": outcome.code,
        "session_id": outcome.session_id, "events": events.len(), "fim_s": fim,
        "primeiro_texto_s": t_texto, "aviso_de_espera_s": t_aviso,
        "servidor_no_ar_durante_a_espera": *servidor_no_ar_na_espera.lock().unwrap(),
        "porta_ocupada_depois_de_parar": porta_apos_parar,
        "texto": texto, "stderr": outcome.stderr,
    });
    std::fs::write(
        root.join("devserver.runner-summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    assert!(t_aviso.is_some(), "a espera nunca foi explicada: {summary}");
    assert!(t_texto.is_some_and(|t| t <= t_aviso.unwrap()), "a resposta não chegou na espera: {summary}");
    assert_eq!(*servidor_no_ar_na_espera.lock().unwrap(), Some(true), "o servidor precisa estar no ar durante a espera");
    assert!(outcome.cancelled, "o turno só termina quando a pessoa para: {summary}");
    assert!(!events.iter().any(|(_, e)| e["type"] == "result" && e["ok"] == true));
    let avisos_de_recuperacao = events
        .iter()
        .filter(|(_, e)| e["type"] == "notice" && e["message"].as_str().is_some_and(|m| m.starts_with("Recuperei")))
        .count();
    assert_eq!(avisos_de_recuperacao, 0, "parar não repete a resposta: {summary}");
    assert!(!porta_apos_parar, "o servidor sobreviveu ao parar: {summary}");
}
