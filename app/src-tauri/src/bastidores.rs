//! Bastidores (ADR-200): acompanhar ao vivo o arquivo de saída de um trabalho
//! em segundo plano, sem criar processo nenhum.
//!
//! A fonte é o arquivo que o PRÓPRIO motor escreve (Claude Code 2.1.270:
//! `/tmp/claude-<uid>/<cwd>/<sessão>/tasks/<id>.output`, texto puro que cresce
//! ao vivo). Aqui só se LÊ:
//!
//! - polling com offset, não FSEvents: são poucos arquivos por vez, não entra
//!   crate nova, e o FSEvents tem pegadinhas de permissão no macOS;
//! - teto de bytes por leitura (arquivo que explode pula para o fim e avisa),
//!   teto de caracteres por linha, ANSI e `\r` limpos;
//! - UTF-8 partido entre duas leituras fica guardado até a linha fechar;
//! - intervalo recua quando o arquivo para de crescer;
//! - acaba quando a vista fecha (`bastidor_parar`), quando o canal cai (janela
//!   fechou) ou quando o arquivo some. Nada disso sobrevive ao app.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// Bytes lidos por vez, inclusive na abertura (o fim do arquivo, não o começo).
const LEITURA_MAX: u64 = 256 * 1024;
/// Linha maior que isto é cortada: log com JSON minificado numa linha só não
/// pode travar a vista.
const LINHA_MAX: usize = 4_000;
/// Vistas ao vivo ao mesmo tempo. O mosaico mostra 3; a folga cobre troca.
const SEGUIDORES_MAX: usize = 6;

#[derive(Clone, Copy, Debug)]
pub struct Ritmo {
    pub vivo: Duration,
    pub ocioso: Duration,
    pub ocioso_apos: Duration,
    /// Leituras seguidas sem o arquivo antes de desistir.
    pub sumido_apos: u32,
}

impl Ritmo {
    pub const PADRAO: Ritmo = Ritmo {
        vivo: Duration::from_millis(400),
        ocioso: Duration::from_millis(2_000),
        ocioso_apos: Duration::from_secs(60),
        sumido_apos: 10,
    };
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PedacoDeSaida {
    pub linhas: Vec<String>,
    /// Houve linhas antes destas que não foram lidas (abertura no fim de um
    /// arquivo grande, ou salto por excesso).
    pub descartou_inicio: bool,
    /// O arquivo encolheu: recomeçou do zero.
    pub reiniciou: bool,
    /// O acompanhamento acabou, com o motivo.
    pub fim: Option<String>,
}

// ----------------------------------------------------------------- caminho ----

/// Só arquivo `.output` dentro de uma pasta `tasks/` sob uma raiz permitida.
/// Recebe o caminho JÁ canônico (sem `..` nem link). Puro.
pub fn caminho_permitido(canonico: &Path, raizes: &[PathBuf]) -> bool {
    let e_output = canonico.extension().and_then(|e| e.to_str()) == Some("output");
    let em_tasks = canonico
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        == Some("tasks");
    let sob_raiz = raizes.iter().any(|raiz| {
        canonico.starts_with(raiz)
            && canonico
                .strip_prefix(raiz)
                .ok()
                .and_then(|resto| resto.components().next())
                .and_then(|c| c.as_os_str().to_str())
                .is_some_and(|primeiro| primeiro.starts_with("claude-"))
    });
    e_output && em_tasks && sob_raiz
}

fn raizes_permitidas() -> Vec<PathBuf> {
    let mut raizes = vec![PathBuf::from("/tmp"), PathBuf::from("/private/tmp")];
    if let Ok(tmp) = std::env::temp_dir().canonicalize() {
        raizes.push(tmp);
    }
    raizes
}

fn validar(caminho: &str) -> Result<PathBuf, String> {
    let canonico = Path::new(caminho)
        .canonicalize()
        .map_err(|_| "o arquivo de saída ainda não existe ou já foi apagado".to_string())?;
    if !canonico.is_file() {
        return Err("o caminho de saída não é um arquivo".into());
    }
    if !caminho_permitido(&canonico, &raizes_permitidas()) {
        return Err("este arquivo não é uma saída de trabalho em segundo plano".into());
    }
    Ok(canonico)
}

// ------------------------------------------------------------------- texto ----

/// Uma linha como o terminal mostraria: sem sequência ANSI e, havendo `\r`
/// (barra de progresso), só o que ficou depois do último. Puro.
pub fn limpar_linha(bruta: &str) -> String {
    let bruta = bruta.strip_suffix('\r').unwrap_or(bruta);
    let visivel = bruta.rsplit('\r').next().unwrap_or(bruta);
    let mut out = String::with_capacity(visivel.len());
    let mut chars = visivel.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            if !c.is_control() || c == '\t' {
                out.push(c);
            }
            continue;
        }
        match chars.next() {
            // CSI: parâmetros até o byte final 0x40..=0x7E.
            Some('[') => {
                for f in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&f) {
                        break;
                    }
                }
            }
            // OSC: até BEL ou ESC \.
            Some(']') => {
                while let Some(f) = chars.next() {
                    if f == '\u{7}' {
                        break;
                    }
                    if f == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    if out.chars().count() > LINHA_MAX {
        out = out.chars().take(LINHA_MAX).collect::<String>() + "…";
    }
    out
}

/// Junta pedaços de bytes em linhas completas. O resto sem `\n` (inclusive um
/// caractere UTF-8 partido) espera a próxima leitura.
#[derive(Default)]
pub struct Fatiador {
    resto: Vec<u8>,
}

impl Fatiador {
    pub fn empurrar(&mut self, bytes: &[u8]) -> Vec<String> {
        self.resto.extend_from_slice(bytes);
        let Some(ultima) = self.resto.iter().rposition(|b| *b == b'\n') else {
            // Sem quebra: uma linha só crescendo. Teto para não guardar sem fim.
            if self.resto.len() > LEITURA_MAX as usize {
                let linha = String::from_utf8_lossy(&self.resto).into_owned();
                self.resto.clear();
                return vec![limpar_linha(&linha)];
            }
            return Vec::new();
        };
        let completas: Vec<u8> = self.resto.drain(..=ultima).collect();
        String::from_utf8_lossy(&completas[..completas.len() - 1])
            .split('\n')
            .map(limpar_linha)
            .collect()
    }

    pub fn zerar(&mut self) {
        self.resto.clear();
    }
}

// ------------------------------------------------------------------ leitura ---

async fn ler_trecho(caminho: &Path, de: u64, ate: u64) -> std::io::Result<Vec<u8>> {
    let mut arquivo = tokio::fs::File::open(caminho).await?;
    arquivo.seek(std::io::SeekFrom::Start(de)).await?;
    let mut buf = Vec::with_capacity((ate - de) as usize);
    arquivo.take(ate - de).read_to_end(&mut buf).await?;
    Ok(buf)
}

/// Descarta até a primeira quebra: começar no meio de uma linha mostraria
/// metade dela como se fosse inteira.
fn alinhar_na_linha(bytes: &[u8]) -> &[u8] {
    match bytes.iter().position(|b| *b == b'\n') {
        Some(i) => &bytes[i + 1..],
        None => &[],
    }
}

/// Segue o arquivo e entrega pedaços a `enviar`. Para quando `enviar` devolve
/// false (canal caiu), quando o arquivo some, ou quando a tarefa é abortada.
pub async fn seguir<F>(caminho: PathBuf, ritmo: Ritmo, mut enviar: F)
where
    F: FnMut(PedacoDeSaida) -> bool,
{
    let mut fatiador = Fatiador::default();
    let tamanho = match tokio::fs::metadata(&caminho).await {
        Ok(m) => m.len(),
        Err(_) => {
            enviar(PedacoDeSaida {
                fim: Some("O arquivo de saída não está mais disponível.".into()),
                ..Default::default()
            });
            return;
        }
    };
    let inicio = tamanho.saturating_sub(LEITURA_MAX);
    let mut offset = tamanho;
    if tamanho > 0 {
        let bytes = ler_trecho(&caminho, inicio, tamanho).await.unwrap_or_default();
        let visiveis = if inicio > 0 { alinhar_na_linha(&bytes) } else { &bytes[..] };
        let linhas = fatiador.empurrar(visiveis);
        if !enviar(PedacoDeSaida {
            linhas,
            descartou_inicio: inicio > 0,
            ..Default::default()
        }) {
            return;
        }
    }
    let mut parado_desde = tokio::time::Instant::now();
    let mut sumido = 0u32;
    loop {
        let espera = if parado_desde.elapsed() > ritmo.ocioso_apos {
            ritmo.ocioso
        } else {
            ritmo.vivo
        };
        tokio::time::sleep(espera).await;
        let tamanho = match tokio::fs::metadata(&caminho).await {
            Ok(m) => {
                sumido = 0;
                m.len()
            }
            Err(_) => {
                sumido += 1;
                if sumido >= ritmo.sumido_apos {
                    enviar(PedacoDeSaida {
                        fim: Some("O arquivo de saída foi apagado.".into()),
                        ..Default::default()
                    });
                    return;
                }
                continue;
            }
        };
        if tamanho == offset {
            continue;
        }
        let mut pedaco = PedacoDeSaida::default();
        if tamanho < offset {
            offset = 0;
            fatiador.zerar();
            pedaco.reiniciou = true;
        }
        let mut de = offset;
        if tamanho - de > LEITURA_MAX {
            de = tamanho - LEITURA_MAX;
            fatiador.zerar();
            pedaco.descartou_inicio = true;
        }
        let Ok(bytes) = ler_trecho(&caminho, de, tamanho).await else {
            continue;
        };
        let visiveis = if pedaco.descartou_inicio { alinhar_na_linha(&bytes) } else { &bytes[..] };
        pedaco.linhas = fatiador.empurrar(visiveis);
        offset = tamanho;
        parado_desde = tokio::time::Instant::now();
        if pedaco.linhas.is_empty() && !pedaco.reiniciou && !pedaco.descartou_inicio {
            continue;
        }
        if !enviar(pedaco) {
            return;
        }
    }
}

// ---------------------------------------------------------------- comandos ----

type Seguidores = Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>;

fn seguidores() -> &'static Seguidores {
    static MAPA: OnceLock<Seguidores> = OnceLock::new();
    MAPA.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remover(id: &str) {
    if let Ok(mut mapa) = seguidores().lock() {
        mapa.remove(id);
    }
}

#[tauri::command]
pub async fn bastidor_seguir(
    caminho: String,
    canal: Channel<PedacoDeSaida>,
) -> Result<String, String> {
    let canonico = validar(&caminho)?;
    {
        let mut mapa = seguidores().lock().map_err(|_| "registro de vistas indisponível")?;
        mapa.retain(|_, handle| !handle.inner().is_finished());
        if mapa.len() >= SEGUIDORES_MAX {
            return Err(format!(
                "já há {SEGUIDORES_MAX} saídas ao vivo abertas; feche uma vista"
            ));
        }
    }
    static PROXIMO: AtomicU64 = AtomicU64::new(1);
    let id = format!("bastidor-{}", PROXIMO.fetch_add(1, Ordering::Relaxed));
    let id_da_tarefa = id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        seguir(canonico, Ritmo::PADRAO, |pedaco| canal.send(pedaco).is_ok()).await;
        remover(&id_da_tarefa);
    });
    seguidores()
        .lock()
        .map_err(|_| "registro de vistas indisponível")?
        .insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
pub async fn bastidor_parar(id: String) -> Result<(), String> {
    let handle = seguidores()
        .lock()
        .map_err(|_| "registro de vistas indisponível")?
        .remove(&id);
    if let Some(handle) = handle {
        handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex as StdMutex};

    #[test]
    fn so_output_em_tasks_sob_raiz_claude() {
        let raizes = vec![PathBuf::from("/private/tmp")];
        let ok = Path::new("/private/tmp/claude-501/-proj/sessao/tasks/btirvhvcs.output");
        assert!(caminho_permitido(ok, &raizes));
        for ruim in [
            "/private/tmp/claude-501/-proj/sessao/tasks/segredo.txt",
            "/private/tmp/claude-501/-proj/sessao/outra/x.output",
            "/private/tmp/qualquer/tasks/x.output",
            "/Users/v/.ssh/tasks/id.output",
        ] {
            assert!(!caminho_permitido(Path::new(ruim), &raizes), "{ruim}");
        }
    }

    #[test]
    fn validacao_real_aceita_saida_do_claude_e_recusa_o_resto() {
        let raiz = PathBuf::from(format!("/tmp/claude-frota-teste-{}", std::process::id()));
        let tasks = raiz.join("-proj").join("sessao").join("tasks");
        std::fs::create_dir_all(&tasks).unwrap();
        let saida = tasks.join("btirvhvcs.output");
        let outro = tasks.join("segredo.txt");
        std::fs::write(&saida, "passo 1\n").unwrap();
        std::fs::write(&outro, "x").unwrap();
        let ok = validar(saida.to_str().unwrap()).expect("saída do motor é aceita");
        assert!(ok.ends_with("tasks/btirvhvcs.output"));
        assert!(validar(outro.to_str().unwrap()).is_err());
        assert!(validar(tasks.to_str().unwrap()).is_err(), "pasta não é arquivo");
        let _ = std::fs::remove_dir_all(&raiz);
    }

    #[test]
    fn caminho_com_travessia_e_recusado_depois_de_canonico() {
        assert!(validar("/private/tmp/claude-501/../../etc/passwd").is_err());
        assert!(validar("/nao/existe/tasks/x.output").is_err());
    }

    #[test]
    fn limpa_ansi_osc_e_barra_de_progresso() {
        assert_eq!(limpar_linha("\u{1b}[32m✓ Build\u{1b}[0m  1m12s"), "✓ Build  1m12s");
        assert_eq!(limpar_linha("baixando 10%\rbaixando 55%\rbaixando 100%"), "baixando 100%");
        assert_eq!(limpar_linha("\u{1b}]0;titulo\u{7}texto"), "texto");
        assert_eq!(limpar_linha("linha windows\r"), "linha windows");
        let gigante = "x".repeat(LINHA_MAX + 50);
        assert!(limpar_linha(&gigante).ends_with('…'));
    }

    #[test]
    fn utf8_partido_espera_a_linha_fechar() {
        let mut f = Fatiador::default();
        let bytes = "ação concluída\nsegunda".as_bytes();
        let corte = 2; // no meio do "ç"
        assert!(f.empurrar(&bytes[..corte]).is_empty());
        assert_eq!(f.empurrar(&bytes[corte..]), vec!["ação concluída"]);
        assert_eq!(f.empurrar(b" linha\n"), vec!["segunda linha"]);
    }

    fn ritmo_de_teste() -> Ritmo {
        Ritmo {
            vivo: Duration::from_millis(15),
            ocioso: Duration::from_millis(15),
            ocioso_apos: Duration::from_secs(60),
            sumido_apos: 3,
        }
    }

    #[test]
    fn segue_crescimento_truncamento_e_fim_quando_o_arquivo_some() {
        let dir = std::env::temp_dir().join(format!("frota-bastidores-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let caminho = dir.join("x.output");
        std::fs::write(&caminho, "passo 1\n").unwrap();
        let pedacos: Arc<StdMutex<Vec<PedacoDeSaida>>> = Arc::default();
        let coletor = pedacos.clone();
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let seguidor = tokio::spawn(seguir(caminho.clone(), ritmo_de_teste(), move |p| {
                coletor.lock().unwrap().push(p);
                true
            }));
            tokio::time::sleep(Duration::from_millis(40)).await;
            let mut f = std::fs::OpenOptions::new().append(true).open(&caminho).unwrap();
            f.write_all(b"passo 2\npasso ").unwrap();
            tokio::time::sleep(Duration::from_millis(40)).await;
            f.write_all(b"3\n").unwrap();
            tokio::time::sleep(Duration::from_millis(40)).await;
            std::fs::write(&caminho, "recomeço\n").unwrap();
            tokio::time::sleep(Duration::from_millis(40)).await;
            std::fs::remove_file(&caminho).unwrap();
            tokio::time::timeout(Duration::from_secs(2), seguidor).await.unwrap().unwrap();
        });
        let pedacos = pedacos.lock().unwrap();
        let linhas: Vec<&str> = pedacos.iter().flat_map(|p| p.linhas.iter().map(String::as_str)).collect();
        assert_eq!(linhas, vec!["passo 1", "passo 2", "passo 3", "recomeço"]);
        assert!(pedacos.iter().any(|p| p.reiniciou), "arquivo encolheu");
        assert_eq!(
            pedacos.last().and_then(|p| p.fim.as_deref()),
            Some("O arquivo de saída foi apagado.")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn arquivo_grande_abre_pelo_fim_sem_meia_linha() {
        let dir = std::env::temp_dir().join(format!("frota-bastidores-g-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let caminho = dir.join("g.output");
        let mut conteudo = String::new();
        let mut n = 0;
        while conteudo.len() < (LEITURA_MAX as usize) * 2 {
            conteudo.push_str(&format!("linha {n:06}\n"));
            n += 1;
        }
        std::fs::write(&caminho, &conteudo).unwrap();
        let primeiro: Arc<StdMutex<Option<PedacoDeSaida>>> = Arc::default();
        let coletor = primeiro.clone();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(seguir(caminho.clone(), ritmo_de_teste(), move |p| {
            *coletor.lock().unwrap() = Some(p);
            false
        }));
        let p = primeiro.lock().unwrap().clone().unwrap();
        assert!(p.descartou_inicio);
        assert!(p.linhas.iter().all(|l| l.starts_with("linha ") && l.len() == 12));
        assert_eq!(p.linhas.last().unwrap(), &format!("linha {:06}", n - 1));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
