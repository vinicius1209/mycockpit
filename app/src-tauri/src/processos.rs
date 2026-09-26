//! O que está rodando nesta máquina e NÃO é nosso.
//!
//! O app já cuida bem do que ele mesmo spawna: `RunRegistry` guarda
//! `run_id → pid`, o `kill_all` roda na saída (Cmd-Q no meio de um run deixaria
//! claude/codex editando o repo headless) e o `RunGuard` é um `Drop`, então
//! limpa em erro e panic também.
//!
//! O buraco não é de gestão — é de VISÃO. Medido em 28/08/2026 na máquina do
//! autor: três sessões de CLI esquecidas somavam ~500 MB parados, uma delas com
//! `tmux` órfão (`ppid=1`) há 17 dias segurando um worktree, e outra reverteu um
//! arquivo no meio do trabalho. Nenhuma queimava CPU. O cockpit, que existe pra
//! dizer o que está acontecendo, não dizia nada disso.
//!
//! **A fronteira, e ela é o desenho todo:** aqui só se OLHA. Matar é gesto
//! humano, um a um, com o alvo dito na cara — processo alheio pode ser trabalho
//! de alguém, e adivinhar isso não é papel de app. Por isso não existe limpeza
//! no boot: app que mata processo sozinho ao abrir é pior que o problema.

use crate::arvore_de_processos::Processo;
use serde::Serialize;
use std::process::Command;

/// Os motores que o app conhece. Nome do EXECUTÁVEL, não substring solta em
/// linha de comando: `grep claude` não é uma sessão do Claude.
const MOTORES: [&str; 4] = ["claude", "codex", "agy", "opencode"];

/// A partir de quando "parado" vira sinal. Um dia é o corte honesto: sessão de
/// ontem que você vai retomar hoje não é lixo; a de uma semana é.
#[allow(dead_code)]
pub const PARADO_SEGUNDOS: u64 = 24 * 60 * 60;

#[derive(Debug, Serialize, PartialEq, Clone)]
pub struct ProcessoDeMotor {
    pub pid: u32,
    pub ppid: u32,
    /// Qual motor (nome do executável).
    pub motor: String,
    pub rss_mb: u64,
    pub idade_s: u64,
    /// `ppid == 1`: o pai morreu e deixou isto para trás.
    pub orfao: bool,
}

/// O motor de uma linha de comando, ou `None` se não é motor conhecido.
///
/// Olha o BASENAME do executável (primeiro token). `/usr/local/bin/claude`
/// conta; `grep claude` não, porque o executável é o grep. Sem isso, a própria
/// varredura apareceria na lista que ela produz.
pub fn motor_de(args: &str) -> Option<String> {
    let exe = args.split_whitespace().next()?;
    let base = exe.rsplit('/').next()?;
    MOTORES
        .iter()
        .find(|m| base == **m)
        .map(|m| (*m).to_string())
}

/// Um processo da tabela → processo de motor, ou `None` se não é motor.
pub fn de_processo(p: &Processo) -> Option<ProcessoDeMotor> {
    Some(ProcessoDeMotor {
        pid: p.pid,
        ppid: p.ppid,
        motor: motor_de(&p.args)?,
        rss_mb: p.rss_kb / 1024,
        idade_s: p.tempo_s,
        orfao: p.ppid == 1,
    })
}

/// Uma linha do `ps` (colunas do leitor único) → processo de motor. Só os
/// testes leem linha a linha; o app lê a tabela pelo `varrer`.
#[cfg(test)]
fn parse_linha(linha: &str) -> Option<ProcessoDeMotor> {
    crate::arvore_de_processos::parse_linha(linha).as_ref().and_then(de_processo)
}

/// Filtra o que é NOSSO: os pids que o `RunRegistry` está tocando agora.
///
/// Um run vivo do app aparece no `ps` como qualquer outro `claude` — mas ele
/// tem dono, tem cara na tela e morre com o app. Listá-lo aqui seria o cockpit
/// denunciando a si mesmo, e a primeira reação de quem lesse seria matar o
/// próprio turno.
pub fn sem_os_nossos(todos: Vec<ProcessoDeMotor>, nossos: &[u32]) -> Vec<ProcessoDeMotor> {
    todos
        .into_iter()
        .filter(|p| !nossos.contains(&p.pid))
        .collect()
}

/// A tabela vem do leitor único (ADR-263), o mesmo da memória do turno e do
/// painel da máquina.
async fn varrer() -> Result<Vec<ProcessoDeMotor>, String> {
    let procs = crate::arvore_de_processos::ler()
        .await
        .ok_or("não consegui listar processos")?;
    Ok(procs.iter().filter_map(de_processo).collect())
}

#[tauri::command]
pub async fn listar_processos_de_motor(
    registry: tauri::State<'_, crate::agent::RunRegistry>,
) -> Result<Vec<ProcessoDeMotor>, String> {
    let nossos: Vec<u32> = registry
        .1
        .lock()
        .map(|m| m.values().copied().collect())
        .unwrap_or_default();
    Ok(sem_os_nossos(varrer().await?, &nossos))
}

/// Mata UM processo, e só se ele estiver na lista que acabamos de varrer.
///
/// A revarredura não é paranoia: entre a tela e o clique o pid pode ter morrido
/// e sido reciclado pelo sistema. Sem ela, um clique atrasado mataria um
/// processo QUALQUER que herdou o número — e o usuário teria pedido pra matar
/// uma sessão parada, não o que estivesse no lugar dela.
#[tauri::command]
pub async fn matar_processo_de_motor(
    pid: u32,
    registry: tauri::State<'_, crate::agent::RunRegistry>,
) -> Result<(), String> {
    let nossos: Vec<u32> = registry
        .1
        .lock()
        .map(|m| m.values().copied().collect())
        .unwrap_or_default();
    let vivos = sem_os_nossos(varrer().await?, &nossos);
    if !vivos.iter().any(|p| p.pid == pid) {
        return Err("esse processo não está mais na lista".into());
    }
    // TERM, não KILL: o CLI tem chance de fechar sessão e soltar o arquivo.
    let ok = Command::new("kill")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("não consegui encerrar: {e}"))?;
    if ok.success() {
        Ok(())
    } else {
        Err("o processo recusou o encerramento".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasta_que_existe_e_ok_e_o_resto_nao() {
        let dir = std::env::temp_dir();
        assert_eq!(estado_de(dir.to_str().unwrap()), EstadoDaPasta::Ok);
        assert_eq!(
            estado_de("/caminho/que/nao/existe/aqui"),
            EstadoDaPasta::Sumiu
        );

        // Arquivo no lugar de pasta: o projeto aponta pra algo que EXISTE e
        // ainda assim não serve de `cwd`. Dizer "sumiu" seria mentira, e o
        // usuário procuraria a pasta que está bem ali.
        let arq = dir.join(format!("mc-teste-{}.txt", std::process::id()));
        std::fs::write(&arq, b"x").unwrap();
        assert_eq!(estado_de(arq.to_str().unwrap()), EstadoDaPasta::NaoEPasta);
        let _ = std::fs::remove_file(&arq);
    }

    #[test]
    fn etime_nos_tres_formatos_do_ps() {
        use crate::arvore_de_processos::segundos_de_etime;
        assert_eq!(segundos_de_etime("00:42"), Some(42));
        assert_eq!(segundos_de_etime("01:00:00"), Some(3_600));
        assert_eq!(segundos_de_etime("17-05:16:10"), Some(17 * 86_400 + 18_970));
        assert_eq!(segundos_de_etime("lixo"), None);
    }

    #[test]
    fn motor_e_o_executavel_nao_uma_palavra_na_linha() {
        // Sem isto, a própria varredura entraria na lista que ela produz.
        assert_eq!(
            motor_de("/usr/local/bin/claude --resume x"),
            Some("claude".into())
        );
        assert_eq!(motor_de("claude"), Some("claude".into()));
        assert_eq!(motor_de("grep claude"), None);
        assert_eq!(motor_de("node /Applications/Xirp.app/x.js claude"), None);
        assert_eq!(motor_de("vim opencode.json"), None);
    }

    #[test]
    fn linha_do_ps_vira_processo() {
        let p = parse_linha("21633 32926 305664 0.0 11-11:49:23 claude --resume abc").unwrap();
        assert_eq!(p.pid, 21633);
        assert_eq!(p.motor, "claude");
        assert_eq!(p.rss_mb, 298);
        assert!(!p.orfao);
        assert!(p.idade_s > PARADO_SEGUNDOS);
    }

    #[test]
    fn ppid_1_e_orfao() {
        let p = parse_linha("18338 1 0 0.0 17-05:16:10 codex serve").unwrap();
        assert!(p.orfao, "pai morto deixou isto pra trás");
    }

    #[test]
    fn o_que_nao_e_motor_nao_entra() {
        assert!(parse_linha("999 1 100 0.0 00:10 /bin/zsh -c ls").is_none());
        assert!(parse_linha("cabeçalho inválido").is_none());
    }

    #[test]
    fn o_run_do_proprio_app_nao_aparece_na_lista() {
        // Ele tem dono, tem cara na tela e morre com o app. Aparecer aqui faria
        // o cockpit denunciar a si mesmo — e a reação seria matar o turno vivo.
        let meu = parse_linha("100 2 1024 0.0 00:30 claude -p oi").unwrap();
        let alheio = parse_linha("200 1 1024 0.0 05-00:00:00 claude --resume x").unwrap();
        let fora = sem_os_nossos(vec![meu.clone(), alheio.clone()], &[100]);
        assert_eq!(fora, vec![alheio]);
    }
}

// ---------------- a pasta do projeto ainda está lá? ----------------
//
// Um projeto aponta pra uma pasta que o usuário pode mover, renomear ou apagar
// pelo Finder — sem o app saber. Até aqui ele continuava na lista como se
// estivesse tudo bem, e o erro só aparecia quando alguém tentava RODAR algo
// ali: o agent nascia num `cwd` que não existe e morria com uma mensagem do
// CLI, longe da causa.
//
// A régua do §5 é clara sobre isto: **não-configurado esconde; configurado com
// ERRO fica visível, com o erro dito.** Um projeto cuja pasta sumiu é o segundo
// caso — some da lista seria pior, porque quem o cadastrou merece saber por que
// ele parou de funcionar.

#[derive(Debug, Serialize, PartialEq)]
pub enum EstadoDaPasta {
    /// A pasta está lá e é uma pasta.
    Ok,
    /// Não existe nada nesse caminho.
    Sumiu,
    /// Existe, mas não é pasta (viraram um arquivo, um alias quebrado).
    NaoEPasta,
}

pub fn estado_de(caminho: &str) -> EstadoDaPasta {
    let p = std::path::Path::new(caminho);
    match std::fs::metadata(p) {
        Ok(m) if m.is_dir() => EstadoDaPasta::Ok,
        Ok(_) => EstadoDaPasta::NaoEPasta,
        Err(_) => EstadoDaPasta::Sumiu,
    }
}

/// Confere VÁRIOS caminhos numa chamada.
///
/// Em lote de propósito: são `stat`s baratos, e uma chamada por projeto no boot
/// seria N idas ao backend pra responder a mesma pergunta. Devolve só os que
/// NÃO estão ok — lista vazia é a resposta normal, e a normal não deve custar
/// tráfego.
#[tauri::command]
pub async fn conferir_pastas(caminhos: Vec<String>) -> Vec<(String, EstadoDaPasta)> {
    caminhos
        .into_iter()
        .map(|c| {
            let e = estado_de(&c);
            (c, e)
        })
        .filter(|(_, e)| *e != EstadoDaPasta::Ok)
        .collect()
}
