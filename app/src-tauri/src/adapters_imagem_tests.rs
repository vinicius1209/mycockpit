//! "[imagem N]" no pedido (G3): o que cada motor recebe. O pedido é o do spike
//! de 27/09/2026, em que o Codex respondeu pela posição ("Imagem 1: azul;
//! imagem 2: vermelho").
use super::*;
use super::tests::{argv, req};

const PEDIDO: &str = "Compare o card de faturas de hoje [imagem 1] com a referência [imagem 2] e diga o que falta.";

fn com_duas_imagens() -> RunRequest {
    let mut r = req(Permission::Padrao, false);
    r.prompt = PEDIDO.to_string();
    r.attachments = ["/tmp/anexos/c1/azul.png", "/tmp/anexos/c1/vermelho.png"]
        .iter()
        .map(|p| Attachment {
            path: p.to_string(),
            name: "print.png".to_string(),
            kind: AttachmentKind::Image,
            mime: "image/png".to_string(),
            bytes: 10,
        })
        .collect();
    r
}

#[test]
fn claude_le_a_lista_com_o_numero_de_cada_imagem() {
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_validated_command(&com_duas_imagens()).unwrap());
    let prompt = args.last().unwrap();
    assert!(prompt.contains("- [imagem 1] `/tmp/anexos/c1/azul.png` (image/png)"), "{prompt}");
    assert!(prompt.contains("- [imagem 2] `/tmp/anexos/c1/vermelho.png` (image/png)"), "{prompt}");
    assert!(!prompt.contains("print.png"), "o nome original nunca vai ao prompt");
}

#[test]
fn codex_exec_recebe_as_imagens_na_ordem_e_a_legenda() {
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_validated_command(&com_duas_imagens()).unwrap());
    let i: Vec<&String> = args.iter().enumerate().filter(|(k, _)| k > &0 && args[k - 1] == "-i").map(|(_, v)| v).collect();
    assert_eq!(i, ["/tmp/anexos/c1/azul.png", "/tmp/anexos/c1/vermelho.png"]);
    let prompt = args.iter().find(|a| a.contains(PEDIDO)).expect("prompt no argv");
    assert!(prompt.ends_with("Imagens anexadas, na ordem em que foram passadas: [imagem 1] é a 1ª, [imagem 2] é a 2ª."), "{prompt}");
}

#[test]
fn sem_citar_imagem_no_texto_o_prompt_do_codex_nao_muda() {
    let mut r = com_duas_imagens();
    r.prompt = "olha esses prints".to_string();
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_validated_command(&r).unwrap());
    assert!(!args.iter().any(|a| a.contains("Imagens anexadas")));
}

#[test]
fn codex_app_server_intercala_no_ponto_da_referencia() {
    let r = com_duas_imagens();
    let p = crate::codex_appserver::turn_params("t1", &r, &r.prompt);
    let tipos: Vec<&str> = p["input"].as_array().unwrap().iter().map(|v| v["type"].as_str().unwrap()).collect();
    assert_eq!(tipos, ["text", "localImage", "text", "localImage", "text"]);
    assert_eq!(p["input"][1]["path"], "/tmp/anexos/c1/azul.png");
}
