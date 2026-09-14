//! Replay de fixtures reais na suíte normal. O probe de CLI é opt-in, exige
//! workspace explícito e `--ignored --exact`; não escreve no banco do aplicativo.
use super::*;
use crate::adapters::{AgentAdapter, AgyAdapter, Permission};
use std::io::Write;
use std::path::PathBuf;

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
        tool_gateway: None,
        mcp_plan: Default::default(),
        plan_first: false,
        usage_baseline: None,
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
