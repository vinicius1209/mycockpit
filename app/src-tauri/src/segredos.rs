//! Segredos do projeto no Keychain (F8 do lote 2 do Maestri, ADR-288).
//!
//! O nome mora no banco; o valor, no Keychain (Secret Service no Linux), pelo
//! mesmo `keyring` do login de MCP. No turno o valor entra como variável de
//! ambiente do processo do motor, em qualquer motor (o ambiente é agnóstico),
//! e o agente só conhece o nome, pela doutrina. O valor nunca entra no prompt.
//!
//! Três portas, cada uma num lugar só:
//! - o preflight (`plano_do_run`): segredo que não abre segura o envio com o
//!   motivo, e "Continuar sem" é a recuperação `omit-for-this-run` de sempre;
//! - o ambiente (`aplicar`), chamado de `hook_sessions::correlate_run`, o ponto
//!   por onde passa todo processo de motor;
//! - a máscara (`mascarar`), no leitor de linhas dos motores e no dos
//!   Bastidores: o valor que aparecer na saída não chega ao fio nem ao banco.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::mcp_control::{
    McpPlanDisposition, McpPlanIssue, McpPlanIssueCode, McpPreflightGate, McpRecovery, McpRecoveryKind,
    McpRunOverride, McpRunPlan,
};

const SERVICO: &str = "dev.vinicius.frota.segredos";
/// Valor curto demais mascararia pedaço de palavra comum na saída.
const MINIMO_PARA_MASCARAR: usize = 6;
const VALOR_MAX: usize = 16 * 1024;
const PREFIXO_DA_FONTE: &str = "segredo:";
/// A fonte da recuperação "continuar sem": UMA para o conjunto que falhou,
/// presa à impressão digital dele (dois segredos falhando são um clique só).
pub const FONTE_DOS_SEGREDOS: &str = "segredos";
/// Nomes que o processo do motor precisa com o valor de sempre.
const RESERVADOS: [&str; 9] = ["PATH", "HOME", "USER", "SHELL", "PWD", "TMPDIR", "LANG", "TERM", "LOGNAME"];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segredo {
    pub nome: String,
    pub criado_em: i64,
    pub usado_em: Option<i64>,
}

/// Nome de variável de ambiente, do jeito que o shell aceita, fora dos
/// reservados e do prefixo da própria Frota. Puro.
pub fn nome_valido(nome: &str) -> Result<(), String> {
    let mut chars = nome.chars();
    let ok = matches!(chars.next(), Some(c) if c.is_ascii_uppercase() || c == '_')
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && nome.len() <= 64;
    if !ok {
        return Err("o nome vai em maiúsculas, números e _, começando por letra (ex.: STRIPE_SECRET_KEY)".into());
    }
    if RESERVADOS.contains(&nome) || nome.starts_with("FROTA_") {
        return Err(format!("{nome} é do sistema ou da Frota; escolha outro nome"));
    }
    Ok(())
}

fn agora() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn entry(project_id: &str, nome: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICO, &format!("{project_id}/{nome}")).map_err(|e| format!("Keychain indisponível: {e}"))
}

/// O que já saiu do Keychain neste processo, por `projeto/nome`. Lido uma vez:
/// cada leitura pode virar um pedido de senha (ADR-201). É também a lista do
/// que a máscara procura.
fn valores() -> &'static Mutex<HashMap<String, String>> {
    static V: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    V.get_or_init(Default::default)
}

fn ler_valor(project_id: &str, nome: &str) -> Result<String, String> {
    let chave = format!("{project_id}/{nome}");
    if let Some(v) = valores().lock().ok().and_then(|m| m.get(&chave).cloned()) {
        return Ok(v);
    }
    let valor = match entry(project_id, nome)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Err("o item não existe mais no Keychain".into()),
        Err(e) => return Err(format!("o Keychain recusou: {e}")),
    };
    if let Ok(mut m) = valores().lock() {
        m.insert(chave, valor.clone());
    }
    Ok(valor)
}

pub fn listar(conn: &rusqlite::Connection, project_id: &str) -> Result<Vec<Segredo>, String> {
    let mut st = conn
        .prepare("SELECT nome, created_at, used_at FROM project_secrets WHERE project_id = ?1 ORDER BY nome")
        .map_err(|e| e.to_string())?;
    let linhas = st
        .query_map([project_id], |r| Ok(Segredo { nome: r.get(0)?, criado_em: r.get(1)?, usado_em: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    Ok(linhas.filter_map(Result::ok).collect())
}

#[tauri::command(async)]
pub fn segredos_do_projeto(app: tauri::AppHandle, project_path: String) -> Result<Vec<Segredo>, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    listar(&crate::mcp_control::db(&app)?, &project_id)
}

#[tauri::command(async)]
pub fn salvar_segredo(app: tauri::AppHandle, project_path: String, nome: String, valor: String) -> Result<Vec<Segredo>, String> {
    nome_valido(&nome)?;
    if valor.is_empty() || valor.len() > VALOR_MAX {
        return Err("o valor não pode ficar vazio nem passar de 16 KB".into());
    }
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    entry(&project_id, &nome)?.set_password(&valor).map_err(|e| format!("não gravei no Keychain: {e}"))?;
    if let Ok(mut m) = valores().lock() {
        m.insert(format!("{project_id}/{nome}"), valor);
    }
    let conn = crate::mcp_control::db(&app)?;
    conn.execute(
        "INSERT INTO project_secrets (project_id, nome, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(project_id, nome) DO NOTHING",
        rusqlite::params![project_id, nome, agora()],
    )
    .map_err(|e| e.to_string())?;
    listar(&conn, &project_id)
}

#[tauri::command(async)]
pub fn apagar_segredo(app: tauri::AppHandle, project_path: String, nome: String) -> Result<Vec<Segredo>, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    match entry(&project_id, &nome)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("não apaguei do Keychain: {e}")),
    }
    if let Ok(mut m) = valores().lock() {
        m.remove(&format!("{project_id}/{nome}"));
    }
    let conn = crate::mcp_control::db(&app)?;
    conn.execute("DELETE FROM project_secrets WHERE project_id = ?1 AND nome = ?2", rusqlite::params![project_id, nome])
        .map_err(|e| e.to_string())?;
    listar(&conn, &project_id)
}

// ------------------------------------------------------------------ run ---

fn por_run() -> &'static Mutex<HashMap<String, Vec<(String, String)>>> {
    static R: OnceLock<Mutex<HashMap<String, Vec<(String, String)>>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// O portão quando algum segredo não abriu. A impressão digital sai dos nomes
/// que falharam: o "Continuar sem" do reenvio só vale para a mesma falha.
pub fn portao(falhas: &[(String, String)]) -> McpPreflightGate {
    let mut nomes: Vec<&str> = falhas.iter().map(|(n, _)| n.as_str()).collect();
    nomes.sort();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in format!("segredos\t{}", nomes.join("\t")).bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    McpPreflightGate {
        fingerprint: format!("{hash:016x}"),
        issues: falhas
            .iter()
            .map(|(nome, motivo)| McpPlanIssue {
                source_id: format!("{PREFIXO_DA_FONTE}{nome}"),
                source_label: nome.clone(),
                code: McpPlanIssueCode::SecretUnavailable,
                disposition: McpPlanDisposition::NeedsDecision,
                detail: Some(motivo.clone()),
            })
            .collect(),
        allowed_recoveries: vec![
            McpRecovery { kind: McpRecoveryKind::OmitForThisRun, source_id: Some(FONTE_DOS_SEGREDOS.into()) },
            McpRecovery { kind: McpRecoveryKind::OpenMcpSettings, source_id: None },
        ],
    }
}

/// Os pares do run e as falhas. Com o `omit-for-this-run` da MESMA falha (o
/// mesmo conjunto de nomes), os que falharam ficam de fora sem segurar o
/// envio. Puro sobre o leitor de valor.
pub fn resolver(
    nomes: &[String],
    pulados: &[McpRunOverride],
    ler: impl Fn(&str) -> Result<String, String>,
) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut pares = Vec::new();
    let mut falhas = Vec::new();
    for nome in nomes {
        match ler(nome) {
            Ok(valor) => pares.push((nome.clone(), valor)),
            Err(motivo) => falhas.push((nome.clone(), motivo)),
        }
    }
    let gate = portao(&falhas);
    let pulou = pulados.iter().any(|o| {
        o.gate_fingerprint == gate.fingerprint && o.kind == McpRecoveryKind::OmitForThisRun && o.source_id == FONTE_DOS_SEGREDOS
    });
    if pulou {
        falhas.clear();
    }
    (pares, falhas)
}

/// O plano do run com os segredos: o mesmo `plan_for_run` de MCP, e, se ele
/// passou, o portão dos segredos do projeto da conversa. É a porta que o
/// `run_agent` chama.
pub async fn plano_do_run(
    app: &tauri::AppHandle,
    conv_id: &str,
    run_id: &str,
    agent: &str,
    cwd: &str,
    overrides: &[McpRunOverride],
) -> Result<McpRunPlan, String> {
    let mut plano = crate::mcp_control::plan_for_run(app, conv_id, run_id, agent, cwd, overrides).await?;
    if plano.gate.is_some() {
        return Ok(plano);
    }
    let conn = crate::mcp_control::db(app)?;
    let projeto: Option<String> = conn
        .query_row("SELECT project_id FROM conversations WHERE id = ?1", [conv_id], |r| r.get(0))
        .ok();
    let Some(projeto) = projeto else { return Ok(plano) };
    let nomes: Vec<String> = listar(&conn, &projeto)?.into_iter().map(|s| s.nome).collect();
    if nomes.is_empty() {
        return Ok(plano);
    }
    let (pares, falhas) = resolver(&nomes, overrides, |nome| ler_valor(&projeto, nome));
    if !falhas.is_empty() {
        plano.gate = Some(portao(&falhas));
        return Ok(plano);
    }
    let _ = conn.execute(
        "UPDATE project_secrets SET used_at = ?1 WHERE project_id = ?2",
        rusqlite::params![agora(), projeto],
    );
    if let Ok(mut m) = por_run().lock() {
        // O mapa só guarda runs recentes: um run dura minutos, e o retry do
        // mesmo run reusa a entrada.
        if m.len() > 64 {
            m.clear();
        }
        m.insert(run_id.to_string(), pares);
    }
    Ok(plano)
}

/// Põe os segredos do run no ambiente do processo do motor.
pub fn aplicar(cmd: &mut tokio::process::Command, run_id: &str) {
    if let Some(pares) = por_run().lock().ok().and_then(|m| m.get(run_id).cloned()) {
        cmd.envs(pares);
    }
}

/// Troca cada valor conhecido por `••••••••(NOME)`. Sem segredo carregado,
/// devolve o texto como veio, sem copiar.
pub fn mascarar(texto: String) -> String {
    let Ok(m) = valores().lock() else { return texto };
    if m.is_empty() {
        return texto;
    }
    let mut out = texto;
    for (chave, valor) in m.iter() {
        if valor.len() >= MINIMO_PARA_MASCARAR && out.contains(valor.as_str()) {
            let nome = chave.rsplit('/').next().unwrap_or(chave);
            out = out.replace(valor.as_str(), &format!("••••••••({nome})"));
        }
    }
    out
}

#[cfg(test)]
#[path = "segredos_tests.rs"]
mod tests;
