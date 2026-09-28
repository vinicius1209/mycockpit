//! "[imagem N]" no texto do pedido é a referência pública a uma imagem anexada
//! (G3): N é a posição dela entre as IMAGENS anexadas, na ordem do envio. É o
//! mesmo texto em todo lugar (fio, busca, revezamento), e cada motor recebe a
//! imagem do jeito que sabe: o Codex no app-server intercalada no ponto exato;
//! quem lê caminho (Claude, Antigravity) ganha o rótulo na lista; quem recebe
//! por flag (OpenCode, Codex exec) ganha uma legenda da ordem.
//!
//! O nome original do arquivo nunca entra no prompt (ver `Attachment::name`):
//! a legenda diz a ORDEM, não o nome.

use crate::attachments::{Attachment, AttachmentKind};
use serde_json::{json, Value};

/// Uma referência "[imagem N]" válida (1 ≤ N ≤ total), em bytes do texto.
#[derive(Debug, PartialEq, Eq)]
pub struct Referencia {
    pub n: usize,
    pub inicio: usize,
    pub fim: usize,
}

const ABRE: &str = "[imagem ";

/// Referências válidas do texto, na ordem. Número fora do total é texto comum.
pub fn referencias(texto: &str, total: usize) -> Vec<Referencia> {
    let mut out = Vec::new();
    let mut desde = 0;
    while let Some(rel) = texto[desde..].find(ABRE) {
        let inicio = desde + rel;
        let digitos_ini = inicio + ABRE.len();
        let digitos: String = texto[digitos_ini..].chars().take_while(|c| c.is_ascii_digit()).collect();
        let fecha = digitos_ini + digitos.len();
        if !digitos.is_empty() && texto[fecha..].starts_with(']') {
            if let Ok(n) = digitos.parse::<usize>() {
                if (1..=total).contains(&n) {
                    out.push(Referencia { n, inicio, fim: fecha + 1 });
                }
            }
            desde = fecha + 1;
        } else {
            desde = digitos_ini;
        }
    }
    out
}

/// As imagens anexadas, na ordem do envio: a 1ª é a "[imagem 1]".
pub fn imagens(atts: &[Attachment]) -> Vec<&Attachment> {
    atts.iter().filter(|a| a.kind == AttachmentKind::Image).collect()
}

/// A entrada do `turn/start` do Codex: texto e imagem intercalados, cada
/// imagem logo depois da primeira referência a ela. Imagem sem referência e
/// anexo que não é imagem vão no fim, na ordem do envio, como antes.
pub fn entrada_do_codex(prompt: &str, atts: &[Attachment]) -> Vec<Value> {
    let imgs = imagens(atts);
    let mut entrada = Vec::new();
    let mut usadas = vec![false; imgs.len()];
    let mut desde = 0;
    for r in referencias(prompt, imgs.len()) {
        if usadas[r.n - 1] {
            continue;
        }
        usadas[r.n - 1] = true;
        entrada.push(json!({ "type": "text", "text": &prompt[desde..r.fim] }));
        entrada.push(json!({ "type": "localImage", "path": imgs[r.n - 1].path }));
        desde = r.fim;
    }
    if desde < prompt.len() || entrada.is_empty() {
        entrada.push(json!({ "type": "text", "text": &prompt[desde..] }));
    }
    let mut n_img = 0;
    for a in atts {
        let citada = a.kind == AttachmentKind::Image && {
            n_img += 1;
            usadas[n_img - 1]
        };
        if !citada {
            entrada.push(json!({ "type": "localImage", "path": a.path }));
        }
    }
    entrada
}

/// Rótulo de cada anexo na lista de caminhos ("[imagem 2] "), na ordem de
/// `atts`: vazio para o que não é imagem.
pub fn rotulos(atts: &[Attachment]) -> Vec<String> {
    let mut n = 0;
    atts.iter()
        .map(|a| {
            if a.kind == AttachmentKind::Image {
                n += 1;
                format!("[imagem {n}] ")
            } else {
                String::new()
            }
        })
        .collect()
}

/// Legenda para quem recebe as imagens por flag, fora do texto. Só existe
/// quando o texto cita alguma imagem: sem citação, nada muda no prompt.
pub fn legenda(prompt: &str, atts: &[Attachment]) -> Option<String> {
    let total = imagens(atts).len();
    if referencias(prompt, total).is_empty() {
        return None;
    }
    let ordem: Vec<String> = (1..=total).map(|n| format!("[imagem {n}] é a {n}ª")).collect();
    Some(format!(
        "\n\nImagens anexadas, na ordem em que foram passadas: {}.",
        ordem.join(", ")
    ))
}

/// O texto contra o que de fato foi enviado. A imagem que caiu no caminho
/// (expirou, ou o motor não aceita) vira "[imagem N não enviada]" e as
/// seguintes descem um número, para cada referência continuar apontando a
/// mesma imagem. `enviados` é subsequência de `originais` (a ordem não muda) e
/// o caminho enviado termina no relativo original, que tem o hash do conteúdo.
pub fn ao_enviado(prompt: &str, originais: &[Attachment], enviados: &[Attachment]) -> String {
    let orig = imagens(originais);
    let env = imagens(enviados);
    let mut novo = Vec::with_capacity(orig.len());
    let mut j = 0;
    for o in &orig {
        if j < env.len() && env[j].path.ends_with(o.path.as_str()) {
            j += 1;
            novo.push(Some(j));
        } else {
            novo.push(None);
        }
    }
    if novo.iter().enumerate().all(|(i, n)| *n == Some(i + 1)) {
        return prompt.to_string();
    }
    let mut out = prompt.to_string();
    for r in referencias(prompt, orig.len()).into_iter().rev() {
        let troca = match novo[r.n - 1] {
            Some(k) => format!("[imagem {k}]"),
            None => format!("[imagem {} não enviada]", r.n),
        };
        out.replace_range(r.inicio..r.fim, &troca);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(path: &str) -> Attachment {
        Attachment { path: path.into(), name: "print.png".into(), kind: AttachmentKind::Image, mime: "image/png".into(), bytes: 42 }
    }
    fn pdf(path: &str) -> Attachment {
        Attachment { path: path.into(), name: "fatura.pdf".into(), kind: AttachmentKind::Pdf, mime: "application/pdf".into(), bytes: 42 }
    }

    // O pedido do spike G3.0 (27/09/2026): mandado ao Codex assim, ele
    // respondeu "Imagem 1: azul; imagem 2: vermelho", pela posição.
    const PEDIDO: &str = "Compare o card de faturas de hoje [imagem 1] com a referência [imagem 2] e diga o que falta.";

    #[test]
    fn acha_so_as_referencias_validas() {
        let t = "a [imagem 1] b [imagem 3] c [imagem x] d [imagem 2]";
        let ns: Vec<usize> = referencias(t, 2).into_iter().map(|r| r.n).collect();
        assert_eq!(ns, [1, 2]);
    }

    #[test]
    fn codex_recebe_cada_imagem_no_ponto_da_referencia() {
        let atts = [img("/a/azul.png"), img("/a/vermelho.png")];
        let e = entrada_do_codex(PEDIDO, &atts);
        let tipos: Vec<&str> = e.iter().map(|v| v["type"].as_str().unwrap()).collect();
        assert_eq!(tipos, ["text", "localImage", "text", "localImage", "text"]);
        assert_eq!(e[0]["text"], "Compare o card de faturas de hoje [imagem 1]");
        assert_eq!(e[1]["path"], "/a/azul.png");
        assert_eq!(e[3]["path"], "/a/vermelho.png");
        assert_eq!(e[4]["text"], " e diga o que falta.");
    }

    #[test]
    fn sem_referencia_o_codex_recebe_como_antes() {
        let atts = [img("/a/1.png"), pdf("/a/f.pdf")];
        let e = entrada_do_codex("olha isso", &atts);
        let tipos: Vec<&str> = e.iter().map(|v| v["type"].as_str().unwrap()).collect();
        assert_eq!(tipos, ["text", "localImage", "localImage"]);
        assert_eq!(e[0]["text"], "olha isso");
    }

    #[test]
    fn imagem_citada_duas_vezes_entra_uma_vez_e_a_nao_citada_vai_no_fim() {
        let atts = [img("/a/1.png"), img("/a/2.png")];
        let e = entrada_do_codex("[imagem 1] e de novo [imagem 1]", &atts);
        let caminhos: Vec<&str> = e.iter().filter_map(|v| v["path"].as_str()).collect();
        assert_eq!(caminhos, ["/a/1.png", "/a/2.png"]);
    }

    #[test]
    fn a_lista_de_caminhos_numera_so_as_imagens() {
        let atts = [img("/a/1.png"), pdf("/a/f.pdf"), img("/a/2.png")];
        assert_eq!(rotulos(&atts), ["[imagem 1] ", "", "[imagem 2] "]);
    }

    #[test]
    fn a_legenda_diz_a_ordem_sem_o_nome_do_arquivo() {
        let atts = [img("/a/azul.png"), img("/a/vermelho.png")];
        let l = legenda(PEDIDO, &atts).unwrap();
        assert!(l.contains("[imagem 1] é a 1ª, [imagem 2] é a 2ª"), "{l}");
        assert!(!l.contains("print.png"));
        assert_eq!(legenda("sem citação", &atts), None);
    }

    #[test]
    fn imagem_que_caiu_no_caminho_nao_desloca_as_outras() {
        let originais = [img("attachments/c1/aaa.png"), img("attachments/c1/bbb.png"), img("attachments/c1/ccc.png")];
        // a 1ª expirou: o Rust entrega só a 2ª e a 3ª, com caminho absoluto
        let enviados = [img("/Users/v/Library/app/attachments/c1/bbb.png"), img("/Users/v/Library/app/attachments/c1/ccc.png")];
        let t = ao_enviado("veja [imagem 1], [imagem 2] e [imagem 3]", &originais, &enviados);
        assert_eq!(t, "veja [imagem 1 não enviada], [imagem 1] e [imagem 2]");
    }

    #[test]
    fn tudo_enviado_o_texto_fica_igual() {
        let originais = [img("attachments/c1/aaa.png")];
        let enviados = [img("/abs/attachments/c1/aaa.png")];
        assert_eq!(ao_enviado("veja [imagem 1]", &originais, &enviados), "veja [imagem 1]");
    }
}
