//! A ÁRVORE DE PROCESSOS, um leitor só (ADR-263).
//!
//! Até 26/09/2026 o app lia a tabela de processos por três caminhos: a
//! memória do turno (`run_resources`, `ps` com pid/pai/memória), os processos
//! de motor soltos (`processos`, `ps` com tempo e comando) e o painel da
//! máquina (`sistema`, pelo `sysinfo`). O terceiro perdia o pai de 272 de 710
//! processos e o painel dizia "Frota 0,7 GB" com um turno de 1,4 GB logo
//! abaixo. Três leitores, três números para a mesma coisa.
//!
//! Agora é uma leitura do `ps` (Mac e Linux, as mesmas colunas), a árvore de
//! um pid e o PAPEL de cada processo para o turno. Tudo o que é puro é testado
//! com a tabela REAL capturada nesta máquina.

use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// As colunas lidas, na ordem do parse. `-A` e estas palavras valem no `ps`
/// do macOS e no do procps (Linux).
pub const COLUNAS_DO_PS: &str = "pid=,ppid=,rss=,pcpu=,etime=,args=";

#[derive(Debug, Clone, PartialEq)]
pub struct Processo {
    pub pid: u32,
    pub ppid: u32,
    pub rss_kb: u64,
    pub cpu_pct: f32,
    pub tempo_s: u64,
    pub args: String,
}

/// `etime` do `ps` → segundos: `MM:SS`, `HH:MM:SS` ou `DD-HH:MM:SS`. PURO.
pub fn segundos_de_etime(etime: &str) -> Option<u64> {
    let (dias, resto) = match etime.split_once('-') {
        Some((d, r)) => (d.trim().parse::<u64>().ok()?, r),
        None => (0, etime),
    };
    let partes = resto
        .split(':')
        .map(|p| p.trim().parse::<u64>().ok())
        .collect::<Option<Vec<u64>>>()?;
    let (h, m, s) = match partes.as_slice() {
        [h, m, s] => (*h, *m, *s),
        [m, s] => (0, *m, *s),
        _ => return None,
    };
    Some(dias * 86_400 + h * 3_600 + m * 60 + s)
}

/// Uma linha de `ps -Ao pid=,ppid=,rss=,pcpu=,etime=,args=`. Linha que não
/// parseia fica de fora (cabeçalho, lixo); nunca derruba a leitura. PURO.
pub fn parse_linha(linha: &str) -> Option<Processo> {
    let mut campos = linha.split_whitespace();
    let pid = campos.next()?.parse().ok()?;
    let ppid = campos.next()?.parse().ok()?;
    let rss_kb = campos.next()?.parse().ok()?;
    let cpu_pct = campos.next()?.replace(',', ".").parse().ok()?;
    let tempo_s = segundos_de_etime(campos.next()?)?;
    let args = campos.collect::<Vec<_>>().join(" ");
    if args.is_empty() {
        return None;
    }
    Some(Processo { pid, ppid, rss_kb, cpu_pct, tempo_s, args })
}

/// A tabela inteira. PURO.
pub fn parse_ps(saida: &str) -> Vec<Processo> {
    saida.lines().filter_map(parse_linha).collect()
}

/// Lê a tabela de processos do sistema. `None` quando o `ps` falha: quem lê
/// decide o que é "não sei" (nunca vira "zero processos").
pub async fn ler() -> Option<Vec<Processo>> {
    #[cfg(unix)]
    {
        let saida = tokio::process::Command::new("ps")
            .args(["-Ao", COLUNAS_DO_PS])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await
            .ok()
            .filter(|s| s.status.success())?;
        Some(parse_ps(&String::from_utf8_lossy(&saida.stdout)))
    }
    #[cfg(not(unix))]
    {
        None
    }
}

/// A árvore de `raiz`, em profundidade (a ordem de desenhar), com a
/// profundidade de cada um. A raiz vem primeiro, com profundidade 0. Raiz que
/// não está na tabela devolve vazio. Laço de pai (pid reciclado) não prende a
/// caminhada. PURO.
pub fn arvore(procs: &[Processo], raiz: u32) -> Vec<(usize, &Processo)> {
    let por_pid: HashMap<u32, &Processo> = procs.iter().map(|p| (p.pid, p)).collect();
    let Some(inicio) = por_pid.get(&raiz) else {
        return Vec::new();
    };
    let mut filhos: HashMap<u32, Vec<&Processo>> = HashMap::new();
    for p in procs {
        if p.pid != p.ppid {
            filhos.entry(p.ppid).or_default().push(p);
        }
    }
    for lista in filhos.values_mut() {
        lista.sort_by_key(|p| p.pid);
    }
    let mut out = Vec::new();
    let mut visto = HashSet::new();
    let mut pilha = vec![(0usize, *inicio)];
    while let Some((prof, p)) = pilha.pop() {
        if !visto.insert(p.pid) {
            continue;
        }
        out.push((prof, p));
        if let Some(fs) = filhos.get(&p.pid) {
            // ao contrário na pilha: o primeiro filho sai primeiro.
            pilha.extend(fs.iter().rev().map(|f| (prof + 1, *f)));
        }
    }
    out
}

/// Memória somada da árvore de `raiz`, em MB. PURO.
pub fn soma_mb(procs: &[Processo], raiz: u32) -> u64 {
    arvore(procs, raiz).iter().map(|(_, p)| p.rss_kb).sum::<u64>() / 1024
}

// ---------------------------------------------------------------------------
// O papel de cada processo para o turno.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Papel {
    /// O CLI do agente: a raiz do turno.
    Motor,
    /// Um comando que o agente mandou rodar (um shell com `-c`).
    Comando,
    /// Um servidor MCP.
    Mcp,
    /// Uma ferramenta do próprio Frota (o binário do app num subcomando).
    Frota,
    Processo,
}

/// Como um processo aparece no painel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Leitura {
    pub papel: Papel,
    /// O nome que importa ("hostinger-api-mcp", "npm test", "claude").
    pub nome: String,
    /// Quem o roda, quando não é ele mesmo ("node", "zsh"). Mostrado apagado.
    pub executor: Option<String>,
}

fn base(caminho: &str) -> &str {
    caminho.rsplit('/').next().unwrap_or(caminho)
}

/// O nome do executável. O `ps` não põe aspas em caminho com espaço, então
/// dentro de um `.app` o nome é o que vem depois de `/Contents/MacOS/` até a
/// primeira opção (`Chromium Helper (Renderer) --type=…`). Fora disso, o
/// primeiro token. PURO.
fn executavel(args: &str) -> String {
    const MACOS: &str = "/Contents/MacOS/";
    if let Some(i) = args.rfind(MACOS) {
        let resto = &args[i + MACOS.len()..];
        let fim = resto.find(" -").unwrap_or(resto.len());
        return resto[..fim].trim().to_string();
    }
    base(args.split_whitespace().next().unwrap_or("")).to_string()
}

/// O comando de verdade dentro de um `-c`. Motores embrulham o comando num
/// preâmbulo (`source <snapshot> && … && eval '<comando>' < /dev/null && …`):
/// quando há um `eval '…'`, é ele que importa. PURO.
fn comando_do_shell(c: &str) -> String {
    if let Some(i) = c.find("eval '") {
        let resto = &c[i + "eval '".len()..];
        if let Some(fim) = resto.find('\'') {
            return resto[..fim].trim().to_string();
        }
    }
    c.trim().to_string()
}

/// O token que nomeia um MCP ("@playwright/mcp", "hostinger-api-mcp"), sem a
/// versão e sem o caminho. PURO.
fn token_de_mcp(args: &str) -> Option<String> {
    args.split_whitespace().skip(1).chain(args.split_whitespace().take(1)).find_map(|t| {
        let t = t.trim_matches(|c| c == '"' || c == '\'');
        let nome = if t.starts_with('@') { t } else { base(t) };
        let sem_versao = match nome.rfind('@') {
            Some(i) if i > 0 => &nome[..i],
            _ => nome,
        };
        let baixo = sem_versao.to_lowercase();
        let tem_mcp = baixo.split(|c: char| !c.is_ascii_alphanumeric()).any(|p| p == "mcp");
        tem_mcp.then(|| sem_versao.to_string())
    })
}

/// O papel de `p` no turno cuja raiz é `raiz`. `exe_do_app` é o caminho do
/// binário do Frota (as ferramentas dele são o mesmo binário num subcomando).
/// PURO.
pub fn ler_processo(p: &Processo, raiz: u32, exe_do_app: &str) -> Leitura {
    let mut tokens = p.args.split_whitespace();
    tokens.next();
    let exe_base = executavel(&p.args);
    if p.pid == raiz {
        return Leitura { papel: Papel::Motor, nome: exe_base, executor: None };
    }
    if !exe_do_app.is_empty() && p.args.starts_with(exe_do_app) {
        let sub = p.args[exe_do_app.len()..].split_whitespace().next().unwrap_or("app");
        return Leitura { papel: Papel::Frota, nome: crate::subcomandos::rotulo(sub), executor: None };
    }
    if matches!(exe_base.as_str(), "sh" | "bash" | "zsh" | "dash" | "fish") {
        if let Some(i) = p.args.find(" -c ") {
            return Leitura {
                papel: Papel::Comando,
                nome: comando_do_shell(&p.args[i + 4..]),
                executor: Some(exe_base),
            };
        }
    }
    if let Some(nome) = token_de_mcp(&p.args) {
        let executor = (nome != exe_base).then(|| {
            // `npm exec @x/mcp` diz mais que só `npm`.
            match tokens.next() {
                Some(sub) if !sub.starts_with('-') && !sub.contains('/') && !sub.contains('@') => {
                    format!("{exe_base} {sub}")
                }
                _ => exe_base.clone(),
            }
        });
        return Leitura { papel: Papel::Mcp, nome, executor };
    }
    // Processo auxiliar de navegador/Electron: `--type=renderer` diz o que é.
    if let Some(tipo) = p.args.split_whitespace().find_map(|t| t.strip_prefix("--type=")) {
        return Leitura { papel: Papel::Processo, nome: format!("{exe_base} ({tipo})"), executor: None };
    }
    Leitura { papel: Papel::Processo, nome: exe_base, executor: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tabela REAL (26/09/2026, `ps -Ao pid=,ppid=,rss=,pcpu=,etime=,args=`
    /// nesta máquina, a árvore do Frota com um turno do agy e um do Claude).
    /// Só o home foi trocado por `/Users/u`.
    const REAL: &str = "\
    1     0  12000   0.0  10-01:02:03 /sbin/launchd
19920     1 141312   1.6      20:41 /Applications/Frota.app/Contents/MacOS/app
20963 19920   2048   0.0      12:39 caffeinate -i -w 19920
24677 19920 300032   0.4      05:47 agy --add-dir /Users/u/Library/Application Support/dev.vinicius.frota/attachments/2bb75f79 -p oi
24735 24677  35840   0.9      05:46 /Users/u/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient
24737 24677   9216   0.0      05:46 /Applications/Frota.app/Contents/MacOS/app desktop-server
24738 24677   9216   0.0      05:46 /Applications/Frota.app/Contents/MacOS/app browser-server
24739 24677  79872   0.0      05:46 npm exec @playwright/mcp@latest
24816 24739  82944   0.0      05:45 node /Users/u/.npm/_npx/9833c18b2d85bc59/node_modules/.bin/playwright-mcp
26535 19920 373760  16.5      01:43 claude --add-dir /Users/u/Library/Application Support/dev.vinicius.frota/attachments/14ff6eb1
26596 26535   9216   0.0      01:43 /Applications/Frota.app/Contents/MacOS/app approval-server
26606 26535  74752   0.0      01:43 node /Users/u/.nvm/versions/node/v24.16.0/bin/hostinger-api-mcp
28452 26535   3072   0.0      00:00 /bin/zsh -c source /Users/u/.claude/shell-snapshots/snapshot-zsh-1790429172541-h9bi7q.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB 2>/dev/null || true && eval 'npm test -- --run' \\< /dev/null && pwd -P >| /var/folders/x/T/claude-a1b2-cwd
28454 28452   2048   0.0      00:00 ps -axo pid=,ppid=,rss=
";
    const APP: &str = "/Applications/Frota.app/Contents/MacOS/app";

    #[test]
    fn a_tabela_real_vira_processos_e_linha_estranha_fica_de_fora() {
        let procs = parse_ps(&format!("  PID  PPID\n{REAL}\nlixo sem numero\n"));
        assert_eq!(procs.len(), 14);
        let claude = procs.iter().find(|p| p.pid == 26535).unwrap();
        assert_eq!(claude.rss_kb, 373_760);
        assert!((claude.cpu_pct - 16.5).abs() < 0.01);
        assert_eq!(claude.tempo_s, 103);
        assert!(claude.args.starts_with("claude --add-dir /Users/u/Library/Application Support"));
        assert_eq!(procs[0].tempo_s, 10 * 86_400 + 3_600 + 2 * 60 + 3);
    }

    #[test]
    fn a_arvore_do_app_tem_os_dois_turnos_e_o_que_eles_abriram_na_ordem_de_desenhar() {
        let procs = parse_ps(REAL);
        let arv = arvore(&procs, 19920);
        assert_eq!(arv.len(), 13);
        assert_eq!(arv[0], (0, procs.iter().find(|p| p.pid == 19920).unwrap()));
        let ordem: Vec<(usize, u32)> = arv.iter().map(|(d, p)| (*d, p.pid)).collect();
        assert_eq!(&ordem[..4], &[(0, 19920), (1, 20963), (1, 24677), (2, 24735)]);
        assert!(ordem.contains(&(3, 24816))); // o node do @playwright/mcp, neto do agy
        // A soma é a do `ps`, a mesma que mede o turno: não há mais dois números.
        assert_eq!(soma_mb(&procs, 26535), (373_760 + 9_216 + 74_752 + 3_072 + 2_048) / 1024);
        assert!(arvore(&procs, 999).is_empty());
    }

    #[test]
    fn pid_reciclado_que_vira_laco_nao_prende_a_caminhada() {
        let procs = parse_ps("1 2 4 0 00:01 a\n2 1 6 0 00:01 b\n");
        assert_eq!(arvore(&procs, 1).len(), 2);
    }

    #[test]
    fn o_papel_de_cada_processo_vem_do_comando_real() {
        let procs = parse_ps(REAL);
        let ler = |pid: u32, raiz: u32| ler_processo(procs.iter().find(|p| p.pid == pid).unwrap(), raiz, APP);
        assert_eq!(ler(26535, 26535), Leitura { papel: Papel::Motor, nome: "claude".into(), executor: None });
        assert_eq!(ler(26596, 26535), Leitura { papel: Papel::Frota, nome: "aprovações".into(), executor: None });
        assert_eq!(ler(24738, 24677).nome, "navegador");
        assert_eq!(
            ler(26606, 26535),
            Leitura { papel: Papel::Mcp, nome: "hostinger-api-mcp".into(), executor: Some("node".into()) }
        );
        assert_eq!(
            ler(24739, 24677),
            Leitura { papel: Papel::Mcp, nome: "@playwright/mcp".into(), executor: Some("npm exec".into()) }
        );
        assert_eq!(ler(24816, 24677).nome, "playwright-mcp");
        // O comando é o que o agente pediu, não o embrulho do shell.
        assert_eq!(
            ler(28452, 26535),
            Leitura { papel: Papel::Comando, nome: "npm test -- --run".into(), executor: Some("zsh".into()) }
        );
        assert_eq!(ler(24735, 24677).nome, "SkyComputerUseClient");
        assert_eq!(ler(28454, 26535).papel, Papel::Processo);
    }

    #[test]
    fn shell_sem_eval_mostra_o_proprio_c_e_auxiliar_de_navegador_diz_o_tipo() {
        let p = parse_linha("5 4 100 0.0 00:03 /bin/bash -c cargo test --lib").unwrap();
        assert_eq!(ler_processo(&p, 4, APP).nome, "cargo test --lib");
        let r = parse_linha("7 4 900 2.0 01:00 /Applications/Chromium.app/Contents/Frameworks/Chromium Helper (Renderer).app/Contents/MacOS/Chromium Helper (Renderer) --type=renderer --lang=pt-BR").unwrap();
        assert!(ler_processo(&r, 4, APP).nome.ends_with("(renderer)"));
    }

    #[test]
    fn etime_nos_tres_formatos_e_lixo_nao_vira_zero() {
        assert_eq!(segundos_de_etime("05:47"), Some(347));
        assert_eq!(segundos_de_etime("01:00:00"), Some(3_600));
        assert_eq!(segundos_de_etime("2-00:00:01"), Some(172_801));
        assert_eq!(segundos_de_etime("abc"), None);
    }
}
