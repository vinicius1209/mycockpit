//! Executar JavaScript e enviar arquivo no navegador do projeto: as duas
//! coisas que o `frota-browser` não sabia fazer e que levaram o agente ao
//! Playwright de terceiro (ADR-224, correção de 22/09/2026).
//!
//! Visto no projeto sicredi: para testar a junção de imagens em PDF (que usa
//! `canvas`, só existe em navegador de verdade) o agente precisava rodar código
//! na página, e em 18/09 enviou comprovante por `setInputFiles`. Sem isso aqui,
//! o Playwright era o ÚNICO caminho que funcionava, e ele abria um Chrome fora
//! da Frota. Aviso no prompt não compete com ferramenta que falta.
//!
//! As duas são efeito: exigem a lease de piloto e um modo que aja (o mesmo
//! `processes_allowed` dos processos gerenciados). O upload só lê arquivo do
//! projeto ou da pasta temporária: navegador de projeto não é porta para
//! mandar qualquer arquivo do disco a uma página.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

/// Código de sondagem espera recarga e timers (o do sicredi esperava 3 s).
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(30);
/// Teto do código enviado e do resultado devolvido ao modelo.
pub const MAX_SCRIPT_CHARS: usize = 50_000;
pub const MAX_RESULT_CHARS: usize = 20_000;
pub const MAX_FILES: usize = 20;

/// Envolve o que o agente mandou: expressão ou função (`async () => {...}`,
/// o formato do Playwright). Função é chamada; promessa é aguardada.
pub fn envolver(expressao: &str) -> String {
    format!(
        "(async () => {{ const __frota = ({expressao}\n); return typeof __frota === 'function' ? await __frota() : await __frota; }})()"
    )
}

/// Corta o resultado serializado no teto, dizendo que cortou.
pub fn resultado_para_o_modelo(valor: &Value) -> Value {
    let texto = match valor {
        Value::String(s) => s.clone(),
        outro => outro.to_string(),
    };
    let total = texto.chars().count();
    if total <= MAX_RESULT_CHARS {
        return json!({ "result": valor, "truncated": false });
    }
    let trecho: String = texto.chars().take(MAX_RESULT_CHARS).collect();
    json!({ "result": trecho, "truncated": true, "total_chars": total })
}

/// Onde um arquivo pode morar para subir à página: dentro do projeto ou da
/// pasta temporária (onde o agente gera o arquivo de teste). Caminho relativo
/// é relativo ao projeto. Symlink é resolvido ANTES de conferir.
pub fn arquivos_permitidos(
    caminhos: &[String],
    raiz_do_projeto: &Path,
    temporarias: &[PathBuf],
) -> Result<Vec<String>, String> {
    if caminhos.is_empty() {
        return Err("paths ausente: informe ao menos um arquivo".into());
    }
    if caminhos.len() > MAX_FILES {
        return Err(format!("no máximo {MAX_FILES} arquivos por envio"));
    }
    let raiz = raiz_do_projeto
        .canonicalize()
        .map_err(|_| "não consegui resolver a pasta do projeto".to_string())?;
    let bases: Vec<PathBuf> = std::iter::once(raiz.clone())
        .chain(temporarias.iter().filter_map(|t| t.canonicalize().ok()))
        .collect();
    caminhos
        .iter()
        .map(|caminho| {
            let bruto = Path::new(caminho);
            let completo = if bruto.is_absolute() { bruto.to_path_buf() } else { raiz.join(bruto) };
            let real = completo
                .canonicalize()
                .map_err(|_| format!("arquivo não encontrado: {caminho}"))?;
            if !real.is_file() {
                return Err(format!("não é um arquivo: {caminho}"));
            }
            if !bases.iter().any(|base| real.starts_with(base)) {
                return Err(format!(
                    "{caminho} está fora do projeto e da pasta temporária; copie o arquivo para uma delas antes de enviar"
                ));
            }
            Ok(real.to_string_lossy().into_owned())
        })
        .collect()
}

/// As pastas temporárias desta máquina (a do processo e o `/tmp` clássico).
pub fn pastas_temporarias() -> Vec<PathBuf> {
    vec![std::env::temp_dir(), PathBuf::from("/tmp")]
}

async fn conectar(
    websocket_url: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    String,
> {
    tokio_tungstenite::connect_async(websocket_url)
        .await
        .map(|(socket, _)| socket)
        .map_err(|error| format!("não consegui falar com a página: {error}"))
}

/// Manda um comando CDP e espera a resposta DAQUELE id.
async fn pedir<S>(socket: &mut S, id: u64, method: &str, params: Value) -> Result<Value, String>
where
    S: SinkExt<Message> + StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let pedido = json!({ "id": id, "method": method, "params": params });
    socket
        .send(Message::Text(pedido.to_string().into()))
        .await
        .map_err(|_| format!("{method} não foi enviado"))?;
    loop {
        let message = socket
            .next()
            .await
            .ok_or("a página encerrou o canal")?
            .map_err(|error| format!("canal interrompido: {error}"))?;
        let Message::Text(text) = message else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
        if value.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(format!("o navegador recusou {method}: {error}"));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
}

/// Exceção do JavaScript vira erro legível para o agente, não `null` mudo.
fn erro_do_script(resultado: &Value) -> Option<String> {
    let detalhe = resultado.get("exceptionDetails")?;
    let texto = detalhe
        .pointer("/exception/description")
        .and_then(Value::as_str)
        .or_else(|| detalhe.get("text").and_then(Value::as_str))
        .unwrap_or("exceção sem descrição");
    Some(format!("o código lançou uma exceção na página: {}", texto.chars().take(2_000).collect::<String>()))
}

/// Roda o código na página e devolve o valor (serializável) que ele retornar.
pub async fn executar(websocket_url: &str, expressao: &str) -> Result<Value, String> {
    if expressao.trim().is_empty() {
        return Err("expression ausente".into());
    }
    if expressao.chars().count() > MAX_SCRIPT_CHARS {
        return Err(format!("código grande demais (teto de {MAX_SCRIPT_CHARS} caracteres)"));
    }
    timeout(SCRIPT_TIMEOUT, async {
        let mut socket = conectar(websocket_url).await?;
        let resultado = pedir(
            &mut socket,
            1,
            "Runtime.evaluate",
            json!({
                "expression": envolver(expressao),
                "awaitPromise": true,
                "returnByValue": true,
                "userGesture": true,
            }),
        )
        .await?;
        if let Some(erro) = erro_do_script(&resultado) {
            return Err(erro);
        }
        Ok(resultado.pointer("/result/value").cloned().unwrap_or(Value::Null))
    })
    .await
    .map_err(|_| format!("o código passou de {} s sem terminar", SCRIPT_TIMEOUT.as_secs()))?
}

/// Coloca arquivos num `<input type="file">` (dispara `input`/`change` como
/// uma escolha de verdade).
pub async fn enviar_arquivos(websocket_url: &str, seletor: &str, arquivos: Vec<String>) -> Result<(), String> {
    timeout(SCRIPT_TIMEOUT, async {
        let mut socket = conectar(websocket_url).await?;
        let alvo = pedir(
            &mut socket,
            1,
            "Runtime.evaluate",
            json!({
                "expression": format!(
                    "(() => {{ const el = document.querySelector({}); return el && el.tagName === 'INPUT' && el.type === 'file' ? el : null; }})()",
                    serde_json::to_string(seletor).unwrap_or_else(|_| "\"\"".into())
                ),
                "returnByValue": false,
            }),
        )
        .await?;
        if let Some(erro) = erro_do_script(&alvo) {
            return Err(erro);
        }
        let object_id = alvo
            .pointer("/result/objectId")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("nenhum <input type=\"file\"> encontrado com o seletor {seletor}"))?
            .to_string();
        pedir(
            &mut socket,
            2,
            "DOM.setFileInputFiles",
            json!({ "files": arquivos, "objectId": object_id }),
        )
        .await?;
        Ok(())
    })
    .await
    .map_err(|_| "o envio de arquivo excedeu o tempo limite".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn funcao_no_formato_do_playwright_e_chamada_e_expressao_e_devolvida() {
        let f = envolver("async () => { return 1 }");
        assert!(f.contains("typeof __frota === 'function' ? await __frota()"));
        // Comentário de linha no fim do código não engole o fechamento.
        assert!(envolver("document.title // fim").contains("// fim\n)"));
    }

    #[test]
    fn resultado_grande_e_cortado_e_diz_que_cortou() {
        let pequeno = resultado_para_o_modelo(&json!({ "paginas": 6 }));
        assert_eq!(pequeno["truncated"], false);
        assert_eq!(pequeno["result"]["paginas"], 6);
        let grande = resultado_para_o_modelo(&json!("x".repeat(MAX_RESULT_CHARS + 10)));
        assert_eq!(grande["truncated"], true);
        assert_eq!(grande["total_chars"], MAX_RESULT_CHARS + 10);
    }

    #[test]
    fn upload_so_aceita_arquivo_do_projeto_ou_da_pasta_temporaria() {
        let base = std::env::temp_dir().join(format!("frota-upload-{}", std::process::id()));
        let projeto = base.join("projeto");
        let fora = base.join("fora");
        std::fs::create_dir_all(projeto.join("docs")).unwrap();
        std::fs::create_dir_all(&fora).unwrap();
        std::fs::write(projeto.join("docs/comprovante.pdf"), b"%PDF").unwrap();
        std::fs::write(fora.join("segredo.txt"), b"x").unwrap();
        // Sem a pasta temporária na lista, "fora" é fora de verdade.
        let sem_temp: Vec<PathBuf> = Vec::new();

        let ok = arquivos_permitidos(&["docs/comprovante.pdf".into()], &projeto, &sem_temp).unwrap();
        assert!(ok[0].ends_with("docs/comprovante.pdf"));
        let recusa = arquivos_permitidos(&[fora.join("segredo.txt").to_string_lossy().into()], &projeto, &sem_temp)
            .unwrap_err();
        assert!(recusa.contains("fora do projeto"));
        // Escapar por `..` também é fora.
        assert!(arquivos_permitidos(&["../fora/segredo.txt".into()], &projeto, &sem_temp).is_err());
        // A pasta temporária entra quando declarada.
        assert!(arquivos_permitidos(&[fora.join("segredo.txt").to_string_lossy().into()], &projeto, &[fora.clone()]).is_ok());
        assert!(arquivos_permitidos(&[], &projeto, &sem_temp).is_err());
        assert!(arquivos_permitidos(&["docs".into()], &projeto, &sem_temp).unwrap_err().contains("não é um arquivo"));
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Prova em Chromium DE VERDADE (fora da suíte): `FROTA_CDP_WS` é o
    /// websocket de uma página com `<input type=file id=f>`. Roda com
    /// `cargo test -- --ignored cdp_de_verdade`.
    #[tokio::test]
    #[ignore]
    async fn cdp_de_verdade_executa_codigo_e_envia_arquivo() {
        let ws = std::env::var("FROTA_CDP_WS").expect("FROTA_CDP_WS");
        // Função assíncrona no formato do Playwright, com canvas (o motivo do sicredi).
        let v = executar(&ws, "async () => { const c = document.createElement('canvas'); c.width = 3; await new Promise(r => setTimeout(r, 50)); return { largura: c.width, tipo: typeof c.getContext('2d') } }").await.unwrap();
        assert_eq!(v["largura"], 3);
        assert_eq!(v["tipo"], "object");
        assert_eq!(executar(&ws, "1 + 1").await.unwrap(), 2);
        assert!(executar(&ws, "() => { throw new TypeError('quebrou') }").await.unwrap_err().contains("TypeError: quebrou"));
        let arquivo = std::env::temp_dir().join("frota-upload-cdp.pdf");
        std::fs::write(&arquivo, b"%PDF-1.4 teste").unwrap();
        executar(&ws, "() => { window.__mudou = 0; document.getElementById('f').addEventListener('change', () => window.__mudou++) }").await.unwrap();
        enviar_arquivos(&ws, "#f", vec![arquivo.to_string_lossy().into()]).await.unwrap();
        let depois = executar(&ws, "() => ({ nome: document.getElementById('f').files[0]?.name, tamanho: document.getElementById('f').files[0]?.size, change: window.__mudou })").await.unwrap();
        assert_eq!(depois["nome"], "frota-upload-cdp.pdf");
        assert_eq!(depois["tamanho"], 14);
        assert_eq!(depois["change"], 1, "o change dispara como numa escolha de verdade");
        assert!(enviar_arquivos(&ws, "#nao-existe", vec![arquivo.to_string_lossy().into()]).await.unwrap_err().contains("nenhum <input"));
    }

    #[test]
    fn excecao_do_script_vira_erro_legivel() {
        let r = json!({ "exceptionDetails": { "text": "Uncaught", "exception": { "description": "TypeError: x is not a function" } } });
        assert!(erro_do_script(&r).unwrap().contains("TypeError: x is not a function"));
        assert!(erro_do_script(&json!({ "result": { "value": 1 } })).is_none());
    }
}
