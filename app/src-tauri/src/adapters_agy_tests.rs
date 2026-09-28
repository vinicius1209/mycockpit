//! Testes do `adapters.rs`: Antigravity (texto e comando). Os auxiliares moram em `adapters_tests.rs`.

use super::*;
use super::tests::*;

// ---- agy ----

#[test]
fn agy_plan_first_prefixa_prompt_e_liga_sandbox() {
    let mut a = AgyAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Padrao, true)).unwrap());
    // prompt é o arg logo após o -p
    let i = args.iter().position(|x| x == "-p").unwrap();
    assert!(args[i + 1].starts_with("MODO PLANEJAMENTO:"));
    assert!(args[i + 1].contains("Tarefa: faça X"));
    assert!(args.contains(&"--sandbox".to_string()));
    // emulação NÃO usa --mode plan (consultivo; furou o gate em 2026-07)
    assert!(!args.contains(&"--mode".to_string()));
}

#[test]
fn agy_sandbox_nao_duplica_em_leitura_com_plan_first() {
    let mut a = AgyAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Leitura, true)).unwrap());
    assert_eq!(args.iter().filter(|x| *x == "--sandbox").count(), 1);
}

#[test]
fn agy_sem_plan_first_prompt_intacto() {
    let mut a = AgyAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Padrao, false)).unwrap());
    let i = args.iter().position(|x| x == "-p").unwrap();
    assert_eq!(args[i + 1], "faça X");
    assert!(!args.contains(&"--sandbox".to_string()));
}

/// Anexo do composer e anexo de nota moram em pastas diferentes; o agente
/// precisa de leitura nas duas. Paths no formato real de app_data.
#[test]
fn anexos_de_pastas_diferentes_liberam_cada_pasta() {
    let base = "/Users/x/Library/Application Support/dev.vinicius.frota/attachments";
    let mut r = req_com_anexo(AttachmentKind::Image, &format!("{base}/conv-1/a.png"), "image/png");
    for path in [format!("{base}/notes/nota-1/b.png"), format!("{base}/conv-1/c.png")] {
        r.attachments.push(Attachment {
            path,
            name: "anexo".into(),
            kind: AttachmentKind::Image,
            mime: "image/png".into(),
            bytes: 10,
        });
    }
    let dirs_de = |args: Vec<String>| -> Vec<String> {
        args.windows(2)
            .filter(|w| w[0] == "--add-dir")
            .map(|w| w[1].clone())
            .filter(|d| d.starts_with(base))
            .collect()
    };
    let esperado = vec![format!("{base}/conv-1"), format!("{base}/notes/nota-1")];
    let claude = argv(&ClaudeAdapter::default().build_command(&r).unwrap());
    assert_eq!(dirs_de(claude), esperado, "claude");
    let agy = argv(&AgyAdapter::default().build_command(&r).unwrap());
    assert_eq!(dirs_de(agy), esperado, "agy");
}

/// O agy LÊ imagem e PDF (provado na máquina via `view_file`). Ficava em
/// `false` só porque não há flag de imagem — "sem flag" ≠ "não vê".
#[test]
fn agy_aceita_imagem_e_pdf() {
    let a = AgyAdapter::default();
    assert!(a.supports_attachment(&AttachmentKind::Image));
    assert!(a.supports_attachment(&AttachmentKind::Pdf));
}
