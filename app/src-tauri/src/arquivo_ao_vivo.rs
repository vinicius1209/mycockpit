//! `frota-arquivo://`: arquivos do projeto servidos direto à tela, com leitura
//! em partes (ADR-240, mock aprovado em docs/mocks/composer-anexos-fila-video.html).
//!
//! Pedido de 23/09/2026: um mp4 de 30 MB na aba do arquivo dizia
//! "Pré-visualização indisponível". O visualizador lia o arquivo INTEIRO pela
//! ponte (`read_project_file_bytes`, teto de 32 MB) e só sabia texto e imagem.
//! Vídeo precisa de outra coisa: o player pede pedaços (`Range`) conforme toca
//! e conforme a pessoa avança, e nada carrega o arquivo todo de uma vez.
//!
//! O cerco é o MESMO do visualizador (`sources::scoped_file_path`): a raiz do
//! projeto, as pastas extras dele, os anexos e as pastas de artefato que já
//! valiam. Só leitura, só arquivo, sem listar diretório. A leitura do disco
//! roda fora da thread da interface (AGENTS.md do backend, item 8).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::Manager;

pub const ESQUEMA: &str = "frota-arquivo";

/// Pedaço máximo por resposta: o player pede o próximo quando precisa.
const PEDACO: u64 = 2 * 1024 * 1024;

/// Tipo pelo nome: o que a tela sabe tocar ou mostrar. Puro.
pub fn tipo_do_arquivo(caminho: &str) -> &'static str {
    let ext = caminho.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "pdf" => "application/pdf",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// O intervalo pedido em `Range: bytes=a-b`, preso ao tamanho e ao pedaço
/// máximo. `None` = sem Range válido. Puro.
pub fn intervalo(range: Option<&str>, tamanho: u64) -> Option<(u64, u64)> {
    let spec = range?.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if tamanho == 0 {
        return None;
    }
    let (inicio, fim) = if a.is_empty() {
        // sufixo: os últimos N bytes
        let n: u64 = b.parse().ok()?;
        (tamanho.saturating_sub(n), tamanho - 1)
    } else {
        let inicio: u64 = a.parse().ok()?;
        let fim = if b.is_empty() { tamanho - 1 } else { b.parse::<u64>().ok()?.min(tamanho - 1) };
        (inicio, fim)
    };
    if inicio > fim || inicio >= tamanho {
        return None;
    }
    Some((inicio, fim.min(inicio + PEDACO - 1)))
}

fn erro(status: StatusCode, texto: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(texto.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn servir(anexos: Option<&Path>, uri: &str, range: Option<&str>) -> Response<Vec<u8>> {
    let Ok(url) = tauri::Url::parse(uri) else {
        return erro(StatusCode::BAD_REQUEST, "endereço inválido");
    };
    let mut raiz = None;
    let mut caminho = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "raiz" => raiz = Some(v.into_owned()),
            "caminho" => caminho = Some(v.into_owned()),
            _ => {}
        }
    }
    let (Some(raiz), Some(caminho)) = (raiz, caminho) else {
        return erro(StatusCode::BAD_REQUEST, "faltou a raiz ou o caminho");
    };
    let Ok(canon) = crate::sources::scoped_file_path(&raiz, &caminho, anexos) else {
        return erro(StatusCode::FORBIDDEN, "fora do projeto");
    };
    if !canon.is_file() {
        return erro(StatusCode::NOT_FOUND, "não é um arquivo");
    }
    let Ok(mut arquivo) = std::fs::File::open(&canon) else {
        return erro(StatusCode::NOT_FOUND, "não consegui abrir");
    };
    let tamanho = arquivo.metadata().map(|m| m.len()).unwrap_or(0);
    let tipo = tipo_do_arquivo(&caminho);
    // Sem Range: arquivo pequeno vai inteiro; grande vai o primeiro pedaço.
    let (inicio, fim, parcial) = match intervalo(range, tamanho) {
        Some((a, b)) => (a, b, true),
        None if tamanho <= PEDACO => (0, tamanho.saturating_sub(1), false),
        None => (0, PEDACO - 1, true),
    };
    let mut corpo = Vec::with_capacity((fim + 1 - inicio) as usize);
    if tamanho > 0 {
        if arquivo.seek(SeekFrom::Start(inicio)).is_err()
            || (&mut arquivo).take(fim + 1 - inicio).read_to_end(&mut corpo).is_err()
        {
            return erro(StatusCode::INTERNAL_SERVER_ERROR, "falha ao ler");
        }
    }
    let mut resposta = Response::builder()
        .header(header::CONTENT_TYPE, tipo)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, corpo.len().to_string())
        // A tela copia o quadro do vídeo num canvas ("Copiar este quadro"), e o
        // esquema é outra origem: sem isto o canvas fica contaminado e o
        // toBlob recusa. Não abre nada novo: quem pode pedir é só o WebView.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    resposta = if parcial {
        resposta
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {inicio}-{fim}/{tamanho}"))
    } else {
        resposta.status(StatusCode::OK)
    };
    resposta.body(corpo).unwrap_or_else(|_| erro(StatusCode::INTERNAL_SERVER_ERROR, "resposta"))
}

/// O manipulador registrado no `Builder`. Responde em outra thread.
pub fn responder<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    pedido: Request<Vec<u8>>,
    resposta: tauri::UriSchemeResponder,
) {
    let anexos = ctx.app_handle().path().app_data_dir().ok().map(|d| d.join("attachments"));
    let uri = pedido.uri().to_string();
    let range = pedido
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    std::thread::spawn(move || {
        resposta.respond(servir(anexos.as_deref(), &uri, range.as_deref()));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_tipo_vem_do_nome_do_arquivo() {
        assert_eq!(tipo_do_arquivo("docs/visual-reference/winglee-agent-ui/video.mp4"), "video/mp4");
        assert_eq!(tipo_do_arquivo("a/B.MOV"), "video/quicktime");
        assert_eq!(tipo_do_arquivo("manual.pdf"), "application/pdf");
        assert_eq!(tipo_do_arquivo("x.zip"), "application/octet-stream");
    }

    #[test]
    fn range_do_player_e_preso_ao_pedaco_e_ao_tamanho() {
        // o vídeo do pedido: 31.820.580 bytes
        let t = 31_820_580;
        assert_eq!(intervalo(Some("bytes=0-1"), t), Some((0, 1)), "sonda inicial do WebKit");
        assert_eq!(intervalo(Some("bytes=0-"), t), Some((0, PEDACO - 1)));
        assert_eq!(intervalo(Some("bytes=31000000-"), t), Some((31_000_000, t - 1)));
        assert_eq!(intervalo(Some("bytes=-500"), t), Some((t - 500, t - 1)));
        assert_eq!(intervalo(Some("bytes=40000000-"), t), None, "além do fim");
        assert_eq!(intervalo(Some("lixo"), t), None);
        assert_eq!(intervalo(None, t), None);
    }

    fn projeto(conteudo: &[u8]) -> (std::path::PathBuf, String) {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("frota-arquivo-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::write(dir.join("docs/clip.mp4"), conteudo).unwrap();
        let raiz = dir.to_string_lossy().into_owned();
        (dir, raiz)
    }

    fn uri(raiz: &str, caminho: &str) -> String {
        let mut u = tauri::Url::parse("frota-arquivo://localhost/").unwrap();
        u.query_pairs_mut().append_pair("raiz", raiz).append_pair("caminho", caminho);
        u.to_string()
    }

    #[test]
    fn serve_o_pedaco_pedido_com_content_range() {
        let (dir, raiz) = projeto(b"0123456789");
        let r = servir(None, &uri(&raiz, "docs/clip.mp4"), Some("bytes=2-5"));
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body(), b"2345");
        assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
        assert_eq!(r.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(r.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*", "o quadro vai para o canvas");
        let inteiro = servir(None, &uri(&raiz, "docs/clip.mp4"), None);
        assert_eq!(inteiro.status(), StatusCode::OK);
        assert_eq!(inteiro.body(), b"0123456789");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn fora_do_projeto_e_barrado() {
        let (dir, raiz) = projeto(b"x");
        let r = servir(None, &uri(&raiz, "../../../../etc/hosts"), None);
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
        let pasta = servir(None, &uri(&raiz, "docs"), None);
        // o cerco já recusa a pasta antes (403); o que importa: nunca é servida
        assert!(pasta.status().is_client_error(), "diretório não é servido: {}", pasta.status());
        let _ = std::fs::remove_dir_all(dir);
    }
}
