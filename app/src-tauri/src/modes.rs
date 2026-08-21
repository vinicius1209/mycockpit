//! Sonda de MODOS DE SESSÃO — M0.5 do docs/modos-de-sessao-plan.md.
//!
//! POR QUE existe: a lista de modos era estática no app, e as três CLIs mudaram
//! debaixo dela sem ninguém perceber. Medido em 21/08/2026, com o que estava
//! instalado na máquina:
//!
//! | CLI    | instalada | `--help` diz                                              | o app dizia            |
//! |--------|-----------|-----------------------------------------------------------|------------------------|
//! | claude | 2.1.220   | acceptEdits, auto, bypassPermissions, **manual, dontAsk**, plan | "validado 2.1.209"|
//! | codex  | 0.147.0   | read-only, workspace-write, danger-full-access             | "validado 0.144.4"     |
//! | agy    | 1.1.17    | `--mode (accept-edits, **plan**)`                          | "não usamos --mode plan" (teste de 2026-07) |
//!
//! O Claude ganhou DOIS modos que o app nunca ofereceu, e o agy ganhou o
//! `--mode plan` que a gente decidiu não usar quando ele ainda não existia. A
//! defasagem não deu sintoma nenhum — é isso que esta sonda conserta.
//!
//! Mesmo padrão da sonda de MODELOS (`model_list.rs`), pelo mesmo motivo: dado
//! que muda do lado de fora não pode viver numa constante.
//!
//! O que a sonda NÃO faz: dizer o que cada id SIGNIFICA. Descoberta dá o nome,
//! não o risco — e este é o eixo de segurança. A curadoria (o quanto cada modo
//! libera) fica no registry do front; id descoberto sem curadoria vira AVISO,
//! nunca opção.

use serde::Serialize;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// `--help` é instantâneo; este teto existe só pra que um binário travado não
/// pendure a sonda (mesma régua do PROBE_TIMEOUT do detect.rs).
const HELP_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedModes {
    pub agent: String,
    /// Ids que o binário ANUNCIA. Vazio só quando a sonda falhou — e aí
    /// `known` é false, pra não confundir "não tem modo" com "não consegui ver".
    pub ids: Vec<String>,
    /// A sonda conseguiu ler? `false` = binário ausente, travado ou formato de
    /// ajuda que mudou. O front trata como "desconhecido", nunca como vazio.
    pub known: bool,
}

/// Recorta o miolo entre o primeiro `abre` DEPOIS de `ancora` e o `fecha`
/// correspondente. Trabalha no texto INTEIRO, e não linha a linha, porque a
/// ajuda do Claude quebra a lista de escolhas em três linhas.
fn trecho_apos<'a>(help: &'a str, ancora: &str, abre: &str, fecha: char) -> Option<&'a str> {
    let base = help.find(ancora)? + ancora.len();
    let ini = help[base..].find(abre)? + base + abre.len();
    let fim = help[ini..].find(fecha)? + ini;
    Some(&help[ini..fim])
}

/// Ids soltos numa lista: aceita vírgula, aspas e quebra de linha como ruído.
fn ids_da_lista(lista: &str) -> Vec<String> {
    lista
        .split(',')
        .map(|s| s.trim().trim_matches(['"', '\'', ' ', '\n', '\t']).to_string())
        .filter(|s| !s.is_empty() && !s.contains(' '))
        .collect()
}

/// `--permission-mode <mode>  … (choices: "acceptEdits", "auto", …)`
pub fn parse_claude_modes(help: &str) -> Vec<String> {
    trecho_apos(help, "--permission-mode", "(choices:", ')')
        .map(ids_da_lista)
        .unwrap_or_default()
}

/// `-s, --sandbox <SANDBOX_MODE>  … [possible values: read-only, …]`
pub fn parse_codex_modes(help: &str) -> Vec<String> {
    trecho_apos(help, "--sandbox", "[possible values:", ']')
        .map(ids_da_lista)
        .unwrap_or_default()
}

/// `--mode  Set the agent execution mode for this session (accept-edits, plan)`
///
/// O agy não marca a lista com palavra nenhuma ("choices"/"possible values"),
/// só põe entre parênteses no fim da descrição — por isso a âncora é o próprio
/// `(`. Frase entre parênteses vira ruído com espaço e o filtro derruba.
pub fn parse_agy_modes(help: &str) -> Vec<String> {
    trecho_apos(help, "--mode", "(", ')')
        .map(ids_da_lista)
        .unwrap_or_default()
}

/// Comando de ajuda por motor. O `--sandbox` do Codex vive no subcomando `exec`,
/// não na raiz — perguntar no lugar errado devolveria lista vazia, que é o
/// desfecho que mais engana.
fn help_cmd(agent: &str) -> Option<(&'static str, Vec<&'static str>)> {
    match agent {
        "claude-code" => Some(("claude", vec!["--help"])),
        "codex" => Some(("codex", vec!["exec", "--help"])),
        "agy" => Some(("agy", vec!["--help"])),
        _ => None,
    }
}

fn parse_por_motor(agent: &str, help: &str) -> Vec<String> {
    match agent {
        "claude-code" => parse_claude_modes(help),
        "codex" => parse_codex_modes(help),
        "agy" => parse_agy_modes(help),
        _ => Vec::new(),
    }
}

/// Pergunta ao binário quais modos ele aceita. Nunca falha: sem resposta, volta
/// `known: false`.
#[tauri::command]
pub async fn detect_modes(agent: String) -> DetectedModes {
    let vazio = |known: bool| DetectedModes {
        agent: agent.clone(),
        ids: Vec::new(),
        known,
    };
    let Some((bin, args)) = help_cmd(&agent) else {
        return vazio(false);
    };
    let saida = timeout(HELP_TIMEOUT, Command::new(bin).args(&args).output()).await;
    let Ok(Ok(out)) = saida else {
        return vazio(false);
    };
    // Algumas CLIs escrevem a ajuda no stderr; juntar as duas evita depender de
    // qual delas o motor escolheu nesta versão.
    let help = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let ids = parse_por_motor(&agent, &help);
    if ids.is_empty() {
        return vazio(false); // formato mudou: "não sei" é mais honesto que "não tem"
    }
    DetectedModes {
        agent,
        ids,
        known: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Copiado do `claude --help` real (2.1.220): a lista QUEBRA em três linhas.
    const CLAUDE_HELP: &str = r#"
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
  --model <model>                       Model for the session
"#;

    const CODEX_HELP: &str = r#"
  -s, --sandbox <SANDBOX_MODE>
          Select the sandbox policy to use when executing model-generated shell commands

          [possible values: read-only, workspace-write, danger-full-access]
"#;

    const AGY_HELP: &str = r#"
  --model                         Model for the current CLI session
  --mode                          Set the agent execution mode for this session (accept-edits, plan)
  --sandbox                       Run in a sandbox with terminal restrictions enabled
"#;

    #[test]
    fn claude_le_a_lista_mesmo_quebrada_em_tres_linhas() {
        // O erro óbvio seria varrer linha a linha e achar só "acceptEdits".
        assert_eq!(
            parse_claude_modes(CLAUDE_HELP),
            vec![
                "acceptEdits",
                "auto",
                "bypassPermissions",
                "manual",
                "dontAsk",
                "plan"
            ]
        );
    }

    #[test]
    fn claude_2_1_220_tem_modos_que_o_app_nao_conhecia() {
        // A prova viva de por que a lista não podia ser estática.
        let ids = parse_claude_modes(CLAUDE_HELP);
        assert!(ids.contains(&"manual".to_string()));
        assert!(ids.contains(&"dontAsk".to_string()));
    }

    #[test]
    fn codex_le_possible_values() {
        assert_eq!(
            parse_codex_modes(CODEX_HELP),
            vec!["read-only", "workspace-write", "danger-full-access"]
        );
    }

    #[test]
    fn agy_le_a_lista_entre_parenteses_do_mode() {
        // E hoje ele TEM `plan` — a decisão de não usar é de julho, com o
        // binário anterior.
        assert_eq!(parse_agy_modes(AGY_HELP), vec!["accept-edits", "plan"]);
    }

    #[test]
    fn ajuda_de_outro_formato_devolve_vazio_e_nao_lixo() {
        // Vazio aqui vira `known: false` no comando: "não sei" é mais honesto
        // que "não tem modo", e é o que impede a UI de esconder o seletor.
        assert!(parse_claude_modes("nada aqui").is_empty());
        assert!(parse_codex_modes("--sandbox sem lista").is_empty());
        assert!(parse_agy_modes("--mode sem parenteses").is_empty());
    }

    /// PROVA REAL contra os binários DESTA máquina. `ignore` pelo mesmo motivo
    /// do `hooks_install::prova_real`: depende do que está instalado aqui, então
    /// é gate manual (`cargo test -- --ignored modes`), não CI.
    ///
    /// É este teste que mantém a sonda honesta: se o formato da ajuda mudar em
    /// qualquer uma das três, ele cai antes de o usuário descobrir sozinho.
    #[tokio::test]
    #[ignore = "toca os binários reais desta máquina; prova manual da sonda"]
    async fn prova_real_nesta_maquina() {
        for agent in ["claude-code", "codex", "agy"] {
            let m = detect_modes(agent.to_string()).await;
            println!("{agent}: known={} ids={:?}", m.known, m.ids);
            assert!(m.known, "{agent}: a sonda não leu os modos");
            assert!(!m.ids.is_empty());
        }
    }

    #[test]
    fn frase_entre_parenteses_nao_vira_id() {
        // `--mode` cuja descrição tem parênteses de prosa antes da lista.
        let help = "  --mode  Set the mode (only in print mode) for this session";
        assert!(parse_agy_modes(help).is_empty());
    }
}
