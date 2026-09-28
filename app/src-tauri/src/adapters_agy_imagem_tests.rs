//! O `generate_image` do agy (1.2.12). Stream e transcript REAIS de 28/09/2026
//! (`testdata/agy-1.2.12/`): o stream diz a ferramenta e o prompt, mas não onde
//! salvou; o caminho mora no `media` do step de mesmo índice, no transcript.
use super::*;
use super::tests::agy_linha;

const STREAM: &str = include_str!("../testdata/agy-1.2.12/generate-image-stream.jsonl");
const TRANSCRIPT: &str = include_str!("../testdata/agy-1.2.12/generate-image-transcript.jsonl");

#[test]
fn generate_image_do_agy_entra_no_contrato_com_o_prompt() {
    let mut a = AgyAdapter::default();
    let eventos: Vec<AgentEvent> = STREAM.lines().flat_map(|l| agy_linha(&mut a, l)).collect();
    let tool = eventos.iter().find_map(|e| match e {
        AgentEvent::Tool { name, input, .. } if name == "GenerateImage" => Some(input.clone()),
        _ => None,
    });
    assert_eq!(
        tool.expect("GenerateImage no stream")["prompt"],
        "A blue piggy bank, flat icon style, minimalist vector design, solid white background"
    );
    assert!(eventos.iter().any(|e| matches!(e, AgentEvent::ToolResult { id, ok: true, .. } if id == "agy-step-2")));
}

#[test]
fn o_arquivo_da_imagem_sai_do_media_do_mesmo_step_no_transcript() {
    let arquivos = crate::agy_recovery::midias_do_passo_em(TRANSCRIPT, 2);
    assert_eq!(arquivos.len(), 1);
    assert!(arquivos[0].ends_with("/brain/a8400b20-362e-4f75-af83-b429684dbe6f/blue_piggy_bank_1790596494263.jpg"), "{arquivos:?}");
    assert!(crate::agy_recovery::midias_do_passo_em(TRANSCRIPT, 1).is_empty());
}

#[test]
fn o_arquivo_salvo_vira_evidencia() {
    let dir = std::env::temp_dir().join(format!("frota-agy-img-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let origem = dir.join("blue_piggy_bank.jpg");
    std::fs::write(&origem, [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]).unwrap();
    let sink = crate::evidence::EvidenceSink::new(dir.join("ev"), "evidence/conv-1".into());
    let paths = crate::evidence::store_image_files(Some(&sink), "agy-step-2", &[origem.to_string_lossy().into_owned()]);
    assert_eq!(paths, ["evidence/conv-1/agy-step-2-0.jpg"]);
}

/// Ao vivo: a conversa real de 28/09 no disco desta máquina. Ignorado na
/// suíte (depende do HOME); `cargo test agy_imagem -- --ignored` para rodar.
#[test]
#[ignore]
fn ao_vivo_o_passo_concluido_vira_evidencia_pelo_transcript_real() {
    let dir = std::env::temp_dir().join(format!("frota-agy-vivo-{}", std::process::id()));
    let sink = crate::evidence::EvidenceSink::new(dir.clone(), "evidence/conv-1".into());
    let conversa = "a8400b20-362e-4f75-af83-b429684dbe6f";
    let imgs = agy_ferramentas::ImagensPendentes::default().do_passo(
        Some(&sink),
        "agy-step-2",
        "generate_image",
        None,
        true,
        Some(2),
        |i| agy_ferramentas::midias(Some(conversa), i),
    );
    assert_eq!(imgs, ["evidence/conv-1/agy-step-2-0.jpg"]);
    assert!(dir.join("agy-step-2-0.jpg").metadata().unwrap().len() > 100_000);
}

#[test]
fn transcript_atrasado_vira_resultado_tardio_sem_esperar() {
    let dir = std::env::temp_dir().join(format!("frota-agy-tardio-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let jpg = dir.join("blue_piggy_bank.jpg");
    std::fs::write(&jpg, [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]).unwrap();
    let sink = crate::evidence::EvidenceSink::new(dir.join("ev"), "evidence/conv-1".into());
    let mut pendentes = agy_ferramentas::ImagensPendentes::default();
    // Quando o passo fecha, o transcript ainda não tem o step: nada, e pendente.
    let agora = pendentes.do_passo(Some(&sink), "agy-step-2", "generate_image", None, true, Some(2), |_| Vec::new());
    assert!(agora.is_empty());
    // Na linha seguinte ainda não: continua pendente, sem evento.
    assert!(pendentes.tentar(Some(&sink), |_| Vec::new()).is_empty());
    // Chegou: vira o resultado tardio só com a imagem, e sai da fila.
    let arquivo = jpg.to_string_lossy().into_owned();
    let evs = pendentes.tentar(Some(&sink), |_| vec![arquivo.clone()]);
    match &evs[..] {
        [AgentEvent::ToolResult { id, ok: true, images, .. }] => {
            assert_eq!(id, "agy-step-2");
            assert_eq!(images, &vec!["evidence/conv-1/agy-step-2-0.jpg".to_string()]);
        }
        outro => panic!("esperava um resultado tardio, veio {}", outro.len()),
    }
    assert!(pendentes.tentar(Some(&sink), |_| vec![arquivo.clone()]).is_empty());
}

#[test]
fn outra_ferramenta_ou_falha_nunca_fica_pendente() {
    let mut p = agy_ferramentas::ImagensPendentes::default();
    let sink = crate::evidence::EvidenceSink::new(std::env::temp_dir().join("frota-agy-nada"), "evidence/c".into());
    p.do_passo(Some(&sink), "agy-step-3", "run_command", None, true, Some(3), |_| Vec::new());
    p.do_passo(Some(&sink), "agy-step-4", "generate_image", None, false, Some(4), |_| Vec::new());
    assert!(p.tentar(Some(&sink), |_| vec!["/x.jpg".into()]).is_empty());
}
