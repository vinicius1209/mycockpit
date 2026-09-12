//! O SANDBOX do Frota — S1 do docs/sandbox-plan.md.
//!
//! POR QUE existe: hoje "Só lê" é um PEDIDO ao motor, e quem decide é o motor.
//! Medido na ADR-061: `agy --mode plan -p "crie o arquivo X"` criou o arquivo.
//! O `ModeSelect` já confessa isso em três frases ("sandbox do sistema", "modo
//! da CLI", "só um pedido no prompt") — mas confessar a fraqueza não a remove:
//! "Só lê" significa três coisas diferentes conforme o motor escolhido.
//!
//! Aqui a garantia passa a ser do SISTEMA OPERACIONAL. O agente pode tentar
//! escrever; o kernel responde "Operation not permitted", e não há flag, prompt
//! nem bug de agente que passe por cima.
//!
//! # A medida que inverteu o desenho (22/08/2026)
//!
//! O instinto — e o que o DeepSeek Harness faz, porque ele é dono do processo —
//! é ALLOWLIST: nega tudo, libera o necessário. Medido com turno real nas três
//! CLIs instaladas:
//!
//! | política                          | claude | codex             | agy                     |
//! |-----------------------------------|--------|-------------------|-------------------------|
//! | negar toda escrita                | ok     | falha explícita   | **`exit 0`, saída VAZIA** |
//! | allowlist + áreas de estado       | ok     | ok                | **ainda vazio**         |
//! | **liberar tudo, negar o projeto** | ok     | ok                | **ok**                  |
//!
//! O agy é o caso que desenha o módulo: ele não falha, **finge que funcionou**.
//! Sem erro, sem `permission denied`, código de saída zero, resposta nenhuma.
//! Uma implementação por allowlist teria entregue um "Só lê" que, no agy,
//! silenciosamente não faz nada — a pior degradação possível, porque é invisível.
//!
//! Então para um ORQUESTRADOR de binário de terceiro a forma que funciona é
//! DENYLIST. É uma troca real, e ela vai na cara do usuário (S4), não escondida:
//! protege o SEU PROJETO, não protege `~/Documents`. É menos que "sandbox
//! total"; é infinitamente mais que hoje, que é nada.
//!
//! # O que este módulo NÃO faz
//!
//! Não lança processo. A política é TEXTO gerado por função pura — dá pra
//! testar sem `sandbox-exec`, sem rede e sem gastar turno de agente. Envolver o
//! spawn é o S2; distinguir "negou" de "quebrou" é o S3.

use crate::adapters::{Permission, SandboxProprio};
use tokio::process::Command;

/// Modos em que o Frota PROMETE que o agente não escreve. Só eles ganham
/// sandbox: em `Padrao`/`Auto`/`Liberado` o agente DEVE escrever, e confinar ali
/// seria teatro que quebra turno legítimo.
///
/// **`plan_first` entra, e a primeira versão disto esquecia dele.** O plano é
/// promessa de não editar — e é EXATAMENTE o caso da ADR-061, onde
/// `agy --mode plan -p "crie o arquivo X"` criou o arquivo. Deixar o turno de
/// plano fora do confinamento seria blindar tudo menos o incidente que motivou
/// o trabalho inteiro.
///
/// Vale mesmo com permissão de escrita (`Liberado` + plano): planejar VENCE a
/// permissão neste turno — é o que o `adapters.rs` já faz ao substituir o
/// `--permission-mode`, e o que o `modeFromConversation` do front já devolve.
///
/// # Por que o motor entra nesta decisão (11/09/2026)
///
/// A primeira versão só perguntava do MODO, e isso quebrou o Codex por
/// completo: ele aplica o sandbox dele por dentro, `(deny default)` a cada
/// comando, e macOS recusa perfil restritivo dentro de perfil já aplicado. O
/// de dentro é o que executa, então TODO comando morria com
/// `sandbox_apply: Operation not permitted` (exit 71) — inclusive `pwd` e
/// `cat`. "Só lê" com Codex virou "não lê", e a automação agendada gastou
/// US$ 1,16 em três execuções cegas gravadas como `ok`.
///
/// Dispensar o envelope onde o motor já confina APERTA: medido turno a turno, o
/// `read-only` do Codex barra mais que a nossa denylist (disco inteiro, não só
/// o projeto, e sem rede). E em Linux `disponivel()` já é `false`, então lá esse
/// sempre foi o comportamento — o macOS é que tinha a regressão.
pub fn confina(p: Permission, plan_first: bool, proprio: SandboxProprio) -> bool {
    if proprio.dispensa_envelope() {
        return false;
    }
    plan_first || matches!(p, Permission::Leitura | Permission::FusionRo)
}

/// O que o perfil protege. Campo a campo porque cada um tem um motivo próprio,
/// e uma lista solta de strings esconderia o motivo na primeira leitura.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Alvo {
    /// Raiz do projeto: o que você está pedindo pro agente NÃO tocar.
    pub raiz: String,
    /// Worktree da conversa, quando ela roda isolada. É um caminho de fora da
    /// raiz (o `mycockpit/<id>` do git), então precisa de linha própria — sem
    /// ela, "Só lê" numa conversa isolada não protegeria nada.
    pub worktree: Option<String>,
    /// Pastas extras que o usuário LIBEROU pro agente (`--add-dir`). Entram no
    /// perfil pelo motivo mais direto possível: ele pediu "Só lê", não "só lê o
    /// projeto principal". Proteger a raiz e deixar a pasta irmã aberta seria um
    /// buraco exatamente onde ele concedeu acesso de propósito.
    pub extras: Vec<String>,
}

/// Um caminho é seguro pra entrar no perfil?
///
/// Fail-closed do §9: caminho relativo, vazio ou com aspas NÃO vira regra
/// silenciosamente. Aspas quebrariam o s-expression e poderiam ABRIR o perfil
/// inteiro — um perfil malformado é pior que perfil nenhum, porque parece que
/// está protegendo.
fn utilizavel(p: &str) -> bool {
    !p.is_empty() && p.starts_with('/') && !p.contains('"') && !p.contains('\n')
}

/// Resolve symlinks. `None` = o caminho não existe ou não resolve.
///
/// # O perfil decorativo (medido 10/09/2026)
///
/// Seatbelt casa `subpath` pelo caminho REAL, não pelo que você escreveu. Com
/// `(deny file-write* (subpath "/tmp/projeto"))` e `/tmp` sendo symlink de
/// `/private/tmp`, a regra não casa com nada: o agente escreveu no arquivo e o
/// conteúdo foi destruído, com o perfil aplicado e sem erro nenhum. Perfil que
/// parece proteger e não protege é o pior desfecho possível deste módulo.
///
/// Mora aqui, e não no `perfil_macos`, porque este toca o disco e aquele é
/// função PURA de propósito (testável sem `sandbox-exec`, sem rede e sem gastar
/// turno). Quem monta o alvo canonicaliza; quem gera o texto continua puro.
pub fn canonicaliza(p: &str) -> Option<String> {
    std::fs::canonicalize(p)
        .ok()
        .map(|c| c.to_string_lossy().into_owned())
}

impl Alvo {
    /// O alvo como a PRODUÇÃO deve montá-lo: todo caminho resolvido antes de
    /// virar regra. Caminho que não resolve é DESCARTADO (fail-closed: melhor
    /// não ter a regra do que ter uma que protege o lugar errado).
    pub fn canonicalizado(raiz: &str, worktree: Option<&str>, extras: &[String]) -> Self {
        Alvo {
            raiz: canonicaliza(raiz).unwrap_or_default(),
            worktree: worktree.and_then(canonicaliza),
            extras: extras.iter().filter_map(|e| canonicaliza(e)).collect(),
        }
    }
}

/// Erro de montagem. Existe como tipo (e não `Option`) porque o S2 precisa
/// DIZER o que houve: recusar um turno em silêncio é o mesmo fail-open que o
/// sandbox veio matar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemPerfil {
    /// O modo escreve — não é erro, é ausência legítima de sandbox.
    ModoEscreve,
    /// O MOTOR já confina por conta própria, com garantia medida. Ausência
    /// legítima e DESEJADA: envelopar aqui não soma, colide (dois perfis
    /// Seatbelt aninhados fazem o de dentro falhar). Separado do `ModoEscreve`
    /// porque o usuário precisa ouvir coisas diferentes: lá não há escrita pra
    /// barrar, aqui há garantia e ela é de outro dono.
    MotorConfina,
    /// Nenhum caminho utilizável sobrou. Perfil que não nega nada é perfil que
    /// mente.
    NadaParaProteger,
}

/// Monta o perfil Seatbelt (macOS) para um modo + alvo.
///
/// `(allow default)` seguido de `(deny file-write* ...)` é a DENYLIST que a
/// medida exigiu. A ordem importa no Seatbelt: a última regra que casa vence,
/// então os `deny` vêm depois do `allow default`.
pub fn perfil_macos(
    p: Permission,
    plan_first: bool,
    proprio: SandboxProprio,
    alvo: &Alvo,
) -> Result<String, SemPerfil> {
    // A ordem importa: o motor que já confina vence a leitura do modo, senão um
    // Codex em "Só lê" cairia em `ModoEscreve` e a frase diria o contrário do
    // que está acontecendo.
    if proprio.dispensa_envelope() {
        return Err(SemPerfil::MotorConfina);
    }
    if !confina(p, plan_first, proprio) {
        return Err(SemPerfil::ModoEscreve);
    }
    let mut caminhos: Vec<&str> = Vec::new();
    if utilizavel(&alvo.raiz) {
        caminhos.push(&alvo.raiz);
    }
    if let Some(w) = alvo.worktree.as_deref() {
        // Worktree IGUAL à raiz não vira segunda regra: duplicar não protege
        // mais e faz o perfil parecer que cobre dois lugares.
        if utilizavel(w) && w != alvo.raiz {
            caminhos.push(w);
        }
    }
    for e in &alvo.extras {
        if utilizavel(e) && !caminhos.contains(&e.as_str()) {
            caminhos.push(e);
        }
    }
    if caminhos.is_empty() {
        return Err(SemPerfil::NadaParaProteger);
    }

    let mut s = String::from("(version 1)\n(allow default)\n");
    for c in &caminhos {
        s.push_str(&format!("(deny file-write* (subpath \"{c}\"))\n"));
        // O `.git` merece linha própria, e não é redundância: um worktree tem o
        // `.git` como ARQUIVO apontando pro repo principal, que fica fora do
        // subpath acima. "Só lê" que deixa reescrever histórico não é só lê.
        s.push_str(&format!("(deny file-write* (subpath \"{c}/.git\"))\n"));
    }
    Ok(s)
}

/// Este SO tem como confinar? `false` = a garantia não existe aqui, e quem
/// chama precisa DIZER isso (S4) em vez de fingir que confinou.
pub fn disponivel() -> bool {
    cfg!(target_os = "macos") && std::path::Path::new("/usr/bin/sandbox-exec").exists()
}

/// Reescreve o comando como `sandbox-exec -f <perfil> <programa> <args…>`.
///
/// Reconstrói em vez de mutar porque `Command` não deixa trocar o programa. O
/// que é preservado — e a lista é o contrato: **programa, argumentos, cwd e
/// variáveis de ambiente**. O stdio NÃO entra aqui de propósito: quem configura
/// pipe é o `run_once`, DEPOIS do `build_command`, então envolver neste ponto
/// não tem como perder o que ainda não foi posto.
///
/// A ordem `-f perfil` antes do programa importa: tudo que vem depois do perfil
/// é o comando confinado, inclusive as flags dele.
pub fn envelopa(cmd: Command, perfil: &std::path::Path) -> Command {
    let base = cmd.as_std();
    let mut novo = Command::new("sandbox-exec");
    novo.arg("-f").arg(perfil).arg(base.get_program());
    for a in base.get_args() {
        novo.arg(a);
    }
    if let Some(d) = base.get_current_dir() {
        novo.current_dir(d);
    }
    for (k, v) in base.get_envs() {
        match v {
            Some(v) => {
                novo.env(k, v);
            }
            // `None` = o adapter REMOVEU a variável. Copiar como remoção mantém
            // a decisão dele; ignorar aqui a desfaria pelas costas.
            None => {
                novo.env_remove(k);
            }
        }
    }
    novo
}

// ─────────────────────────────────────────── S4: o selo honesto do que garante

/// O que o confinamento REALMENTE garante nesta máquina.
///
/// Existe porque a alternativa é a tela prometer o que a denylist não entrega.
/// O `ModeSelect` diz "sandbox do sistema" para o Codex desde sempre — se o
/// Frota passasse a dizer a mesma coisa sem qualificar, estaria repetindo o
/// problema que veio consertar, só que com a nossa assinatura.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Selo {
    /// Não há confinamento do Frota aqui. Quem segura é o motor, como antes.
    Ausente,
    /// O sistema barra escrita no PROJETO. Parcial de propósito, e a palavra é
    /// exata: a denylist não cobre o resto do disco. Chamar isto de "completa"
    /// seria a mentira confortável.
    Parcial,
    /// O MOTOR aplica sandbox de SO, e ele barra MAIS que a nossa denylist:
    /// disco inteiro em vez de só o projeto, e sem rede.
    ///
    /// Existe porque a rota B fez o selo deixar de ser fato da máquina e virar
    /// máquina × motor. Sem esta variante o card diria "parcial" para o Codex
    /// enquanto a garantia dele é total para escrita — subestimar a proteção é
    /// tão mentiroso quanto exagerá-la, e o S4 existe pra nenhuma das duas.
    Motor,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Confinamento {
    pub selo: Selo,
    /// Frase curta pro seletor. Vazia quando `Ausente` — quem não garante nada
    /// não ganha linha na tela.
    pub nota: &'static str,
}

/// Estado do confinamento nesta máquina PARA UM MOTOR.
///
/// O motor entra na conta porque a garantia depende dele: quem confina sozinho
/// não recebe o envelope (e não poderia — os dois colidem), então dizer "o
/// sistema barra escrita no projeto" ali descreveria um perfil que não foi
/// aplicado.
pub fn confinamento(proprio: SandboxProprio) -> Confinamento {
    // O motor vence a máquina: a garantia dele não depende do `sandbox-exec`
    // existir aqui (em Linux ele nem existe, e o Codex confina igual).
    if proprio.dispensa_envelope() {
        return Confinamento {
            selo: Selo::Motor,
            // Sem repetir "o motor": quem consome prefixa o dono da garantia
            // ("confinamento do motor: …"), e a linha do quadro usa a frase crua.
            nota: "barra escrita no disco inteiro e corta a rede",
        };
    }
    if disponivel() {
        Confinamento {
            selo: Selo::Parcial,
            nota: "o sistema barra escrita no projeto",
        }
    } else {
        Confinamento {
            selo: Selo::Ausente,
            nota: "",
        }
    }
}

/// `agent` decide a resposta, e ele é resolvido pelo REGISTRY — nunca comparado
/// por nome aqui. Agent desconhecido cai no fail-closed (`Nenhum`), que é a
/// resposta mais conservadora: assume que só o envelope protege.
#[tauri::command]
pub fn sandbox_confinamento(agent: Option<String>) -> Confinamento {
    let proprio = agent
        .as_deref()
        .and_then(|a| crate::adapters::resolve(a).ok())
        .map(|ad| ad.capabilities().sandbox_proprio)
        .unwrap_or(SandboxProprio::Nenhum);
    confinamento(proprio)
}

// ───────────────────────────────── S3: "o sandbox negou" × "o agente quebrou"

/// O que aconteceu com um turno confinado.
///
/// Existe porque sem isto TODO bloqueio parece bug do Frota: o usuário pede
/// "Só lê", o agente tenta escrever, o sistema recusa, o turno morre — e a tela
/// diz "turno falhou". A frase certa não é um enfeite; é a diferença entre a
/// funcionalidade ser boa e ser irritante.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Veredito {
    /// Nada aqui é do sandbox. A falha (se houve) é de outra natureza.
    Irrelevante,
    /// O `sandbox-exec` falhou ANTES de rodar o comando (perfil não compilou,
    /// arquivo sumiu). Isto é defeito NOSSO, não do agente, e não pode ser
    /// contado como "o agente foi barrado" — seria culpar o inocente.
    RunnerFalhou,
    /// O sandbox rodou e NEGOU uma operação. O confinamento funcionou.
    Negou,
    /// Confinado, saiu com SUCESSO e não produziu nada.
    ///
    /// É o caso do agy, medido na fase 0: `exit 0`, stdout vazio, stderr sem
    /// assinatura nenhuma. Ele não falha — finge que funcionou. Tratar isso como
    /// sucesso seria entregar um "Só lê" que silenciosamente não faz nada, que é
    /// a pior degradação possível porque é invisível.
    SilencioSuspeito,
}

/// Assinaturas do SEATBELT (macOS). Por backend, não uma união genérica: o
/// Landlock do S5 fala outro dialeto, e uma lista só passaria a "reconhecer"
/// no macOS frases que só existem no Linux — reconhecimento falso é pior que
/// nenhum, porque a frase que o usuário lê fica errada com confiança.
const SEATBELT_RUNNER: &[&str] = &[
    "sandbox-exec:",
    "sandbox_apply",
    "failed to compile",
    "unable to open profile",
];
const SEATBELT_NEGOU: &[&str] = &["operation not permitted", "os error 1"];

/// Assinaturas seguras de reconhecer no STREAM, que é conteúdo do AGENTE.
///
/// # Por que esta lista é menor que a do stderr
///
/// O stderr é canal do NOSSO wrapper: ali "failed to compile" só pode ser o
/// perfil não compilando. No stream é texto do agente, e um agente de código
/// dizendo "the build failed to compile" é rotina — reconhecer aquela frase ali
/// faria o app anunciar "não consegui aplicar o confinamento" num turno que
/// compilou mal um Rust qualquer. Aviso falso recorrente é pior que aviso
/// nenhum: ensina a pessoa a ignorar o aviso verdadeiro.
///
/// Só ficam as duas que NENHUM agente escreve por conta própria, porque são
/// saída literal do binário `sandbox-exec`.
const SEATBELT_RUNNER_NO_STREAM: &[&str] = &["sandbox-exec:", "sandbox_apply"];

fn contem(hay: &str, agulhas: &[&str]) -> bool {
    let h = hay.to_lowercase();
    agulhas.iter().any(|a| h.contains(a))
}

/// Teto do trecho guardado: o hint vai pra classificação e pra uma frase, não
/// pra tela inteira. Linha de stream pode ter megabytes de JSON.
const HINT_MAX: usize = 300;

/// Esta linha CRUA do stream carrega assinatura de falha do runner?
///
/// # Por que o stderr não bastava (incidente de 04–09/09/2026)
///
/// A falha do `sandbox-exec` aninhado não sai no stderr do motor: ela sai
/// DENTRO do stdout estruturado, no `exec_command_output` de cada comando que o
/// Codex tentou rodar. O `classifica` só olhava stderr, então o
/// `RunnerFalhou` nunca disparou: a automação rodou cega três vezes, gravou
/// `ok`, e a frase "Falha do Frota, não do agente" nunca apareceu.
///
/// A rota B tirou o Codex da colisão, mas isto FICA como detector de
/// regressão: o próximo motor que ganhar sandbox próprio sem alguém atualizar a
/// capability reproduz o mesmo incidente, e este é o único sintoma que ele dá.
pub fn assinatura_de_runner(linha: &str) -> Option<String> {
    // Lista ESTREITA de propósito (ver `SEATBELT_RUNNER_NO_STREAM`): aqui a
    // linha é conteúdo do agente, não do nosso wrapper.
    if !contem(linha, SEATBELT_RUNNER_NO_STREAM) {
        return None;
    }
    let limpa = linha.trim();
    Some(match limpa.char_indices().nth(HINT_MAX) {
        Some((corte, _)) => format!("{}…", &limpa[..corte]),
        None => limpa.to_string(),
    })
}

/// Classifica o fim de um turno.
///
/// `confinado` vem de quem lançou: sem sandbox, nada aqui se aplica — e checar
/// isso PRIMEIRO evita que um "operation not permitted" vindo do próprio
/// trabalho do agente (tentar escrever em `/etc`, por exemplo) seja lido como
/// bloqueio nosso.
pub fn classifica(
    confinado: bool,
    stderr: &str,
    // Assinatura de runner colhida do STREAM (`assinatura_de_runner`). Existe
    // porque o stderr não é a única superfície: no sandbox aninhado a falha sai
    // no stdout estruturado, e foi por isso que o incidente passou batido.
    hint_do_stream: Option<&str>,
    sucesso: bool,
    emitiu_saida: bool,
) -> Veredito {
    if !confinado {
        return Veredito::Irrelevante;
    }
    // Falha do runner ANTES da negação: as duas podem aparecer na mesma saída,
    // e a do runner é mais específica (e é nossa culpa).
    if hint_do_stream.is_some() || contem(stderr, SEATBELT_RUNNER) {
        return Veredito::RunnerFalhou;
    }
    if contem(stderr, SEATBELT_NEGOU) {
        return Veredito::Negou;
    }
    if sucesso && !emitiu_saida {
        return Veredito::SilencioSuspeito;
    }
    Veredito::Irrelevante
}

/// A frase que o usuário lê. `None` = não há nada a dizer sobre sandbox.
pub fn frase(v: Veredito) -> Option<&'static str> {
    match v {
        Veredito::Irrelevante => None,
        Veredito::RunnerFalhou => Some(
            "Não consegui aplicar o confinamento neste turno: ele rodou sem proteção. Falha do Frota, não do agente.",
        ),
        Veredito::Negou => Some(
            "O agente tentou escrever e o sistema barrou: este turno está em somente-leitura.",
        ),
        Veredito::SilencioSuspeito => Some(
            "Terminou sem erro e sem produzir nada, rodando confinado. Desconfie: costuma ser o motor engolindo um bloqueio.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alvo(raiz: &str) -> Alvo {
        Alvo {
            raiz: raiz.into(),
            ..Default::default()
        }
    }

    #[test]
    fn so_os_modos_que_prometem_nao_escrever_sao_confinados() {
        // Sandbox em modo de escrita seria teatro: quebra turno legítimo e não
        // protege nada que o usuário tenha pedido pra proteger.
        assert!(confina(Permission::Leitura, false, SandboxProprio::Nenhum));
        assert!(confina(Permission::FusionRo, false, SandboxProprio::Nenhum));
        assert!(!confina(Permission::Padrao, false, SandboxProprio::Nenhum));
        assert!(!confina(Permission::Auto, false, SandboxProprio::Nenhum));
        assert!(!confina(Permission::Liberado, false, SandboxProprio::Nenhum));
    }

    #[test]
    fn o_TURNO_DE_PLANO_e_confinado__foi_ele_que_motivou_tudo() {
        // ADR-061: `agy --mode plan -p "crie o arquivo X"` CRIOU o arquivo. Se o
        // plano ficasse de fora, o sandbox blindaria tudo menos o incidente que
        // originou o trabalho. A primeira versão do `confina` esquecia disto.
        assert!(confina(Permission::Padrao, true, SandboxProprio::Nenhum));
        // e vale mesmo com permissão de escrita: planejar VENCE a permissão no
        // turno, que é o que o adapters.rs já faz com o --permission-mode.
        assert!(confina(Permission::Liberado, true, SandboxProprio::Nenhum));
        assert!(confina(Permission::Auto, true, SandboxProprio::Nenhum));
    }

    // ── R1: a colisão de sandbox (incidente de 04–09/09/2026)

    #[test]
    fn motor_que_confina_sozinho_NAO_e_envelopado() {
        // O bug inteiro em uma asserção. Envelopar quem já aplica Seatbelt faz o
        // perfil de DENTRO falhar (`sandbox_apply: Operation not permitted`), e
        // o de dentro é o que executa os comandos: `pwd` e `cat` morriam com
        // exit 71. Se esta linha virar `assert!` um dia, o Codex fica cego de
        // novo e a automação agendada volta a gravar `ok` sem ter feito nada.
        assert!(!confina(
            Permission::Leitura,
            false,
            SandboxProprio::SistemaOperacional
        ));
        // E o plano também: era ele que sobrescrevia o modo pra read-only, então
        // "Planejar primeiro" + Codex tinha o mesmo defeito no chat inteiro.
        assert!(!confina(
            Permission::Liberado,
            true,
            SandboxProprio::SistemaOperacional
        ));
    }

    #[test]
    fn melhor_esforco_NAO_dispensa_o_envelope() {
        // O agy DIZ confinar e na verdade emudece (fase 0: exit 0, stdout
        // vazio). Tratá-lo como garantia entregaria um "Só lê" que
        // silenciosamente não faz nada — a degradação invisível que este módulo
        // existe pra impedir. Ele é exatamente quem PRECISA do envelope.
        assert!(confina(
            Permission::Leitura,
            false,
            SandboxProprio::MelhorEsforco
        ));
        assert!(confina(
            Permission::Padrao,
            true,
            SandboxProprio::MelhorEsforco
        ));
    }

    #[test]
    fn o_motor_que_confina_tem_ausencia_PROPRIA_nao_ModoEscreve() {
        // Duas ausências legítimas, motivos opostos, e o usuário ouve frases
        // diferentes: em `ModoEscreve` não há escrita pra barrar; aqui há
        // garantia e ela é de outro dono. Colapsar as duas faria o Codex em
        // "Só lê" ser descrito como modo de escrita.
        assert_eq!(
            perfil_macos(
                Permission::Leitura,
                false,
                SandboxProprio::SistemaOperacional,
                &alvo("/repo")
            ),
            Err(SemPerfil::MotorConfina)
        );
    }

    // ── R2: o perfil decorativo do symlink (medido 10/09/2026)

    #[test]
    fn caminho_com_symlink_entra_no_perfil_JA_RESOLVIDO() {
        // A medida: com `/tmp` sendo symlink de `/private/tmp`, a regra
        // `(subpath "/tmp/...")` não casa com nada. O agente escreveu, o
        // conteúdo foi destruído, o perfil estava aplicado e não houve erro.
        // Perfil que parece proteger é pior que perfil nenhum.
        //
        // Toca o disco de propósito: a canonicalização é justamente o passo que
        // consulta o SO, e um teste que a simulasse não provaria nada.
        let base = std::env::temp_dir().join("frota-sb-canon");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("real")).unwrap();
        let link = base.join("link");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(base.join("real"), &link).unwrap();

        let real = std::fs::canonicalize(base.join("real")).unwrap();
        let a = Alvo::canonicalizado(&link.to_string_lossy(), None, &[]);
        assert_eq!(a.raiz, real.to_string_lossy());

        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &a).unwrap();
        assert!(
            p.contains(&format!("(subpath \"{}\")", real.to_string_lossy())),
            "o perfil guardou o caminho do symlink em vez do real:\n{p}"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn caminho_que_nao_resolve_e_DESCARTADO_do_alvo() {
        // Fail-closed: melhor não ter a regra do que ter uma que protege o lugar
        // errado achando que protege o certo. É o mesmo critério do
        // `utilizavel`, agora aplicado ao que o disco desmente.
        let a = Alvo::canonicalizado(
            "/caminho/que/nao/existe/mesmo",
            None,
            &["/outro/inexistente".to_string()],
        );
        assert_eq!(a.raiz, "");
        assert!(a.extras.is_empty());
        assert_eq!(
            perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &a),
            Err(SemPerfil::NadaParaProteger)
        );
    }

    // ── R3: a assinatura que sai no STREAM, não no stderr

    #[test]
    fn assinatura_do_incidente_e_reconhecida_na_linha_crua() {
        // Fixture REAL: a linha que o Codex devolveu dentro do
        // `exec_command_output` nos três runs de 04–09/09/2026. Era ela que
        // ninguém via, porque o classificador só olhava stderr.
        let linha = r#"{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"sandbox-exec: sandbox_apply: Operation not permitted\n","exit_code":71}}"#;
        assert!(assinatura_de_runner(linha).is_some());
        // Linha normal de stream não pode virar falso positivo: um aviso a cada
        // turno ensinaria o usuário a ignorar o aviso.
        assert!(assinatura_de_runner(r#"{"type":"item.completed","item":{"type":"agent_message","text":"tudo certo"}}"#).is_none());
    }

    #[test]
    fn o_hint_do_stream_sozinho_JA_acusa_falha_do_runner() {
        // O caso Maclan exato: stderr VAZIO, turno com exit 0, e a falha só
        // existindo no stdout estruturado. Antes disto o veredito era
        // `Irrelevante` e a automação gravava `ok`.
        assert_eq!(
            classifica(
                true,
                "",
                Some("sandbox-exec: sandbox_apply: Operation not permitted"),
                true,
                true
            ),
            Veredito::RunnerFalhou
        );
    }

    #[test]
    fn agente_falando_de_compilacao_NAO_vira_falha_de_sandbox() {
        // A lista do stderr tem "failed to compile" porque ali o canal é do
        // NOSSO wrapper. No stream é texto do agente, e um agente de código
        // dizendo isso é rotina. Se as duas listas virarem uma só, este turno
        // passa a anunciar "não consegui aplicar o confinamento" por causa de um
        // erro de build — e aviso falso recorrente ensina a ignorar o aviso
        // verdadeiro.
        assert!(assinatura_de_runner("error: the crate failed to compile").is_none());
        assert!(assinatura_de_runner("unable to open profile file for the user").is_none());
        // …mas no STDERR elas continuam valendo, porque lá são inequívocas.
        assert_eq!(
            classifica(true, "sandbox-exec: failed to compile profile", None, false, false),
            Veredito::RunnerFalhou
        );
    }

    #[test]
    fn hint_grande_e_cortado_para_nao_despejar_o_stream() {
        // Linha de stream tem megabytes de JSON; o hint vai pra classificação e
        // pra uma frase, não pra tela inteira.
        let gigante = format!("sandbox_apply: {}", "x".repeat(5_000));
        let h = assinatura_de_runner(&gigante).unwrap();
        assert!(h.chars().count() <= HINT_MAX + 1, "hint não foi cortado");
        assert!(h.ends_with('…'));
    }

    #[test]
    fn o_selo_diz_quem_segura_e_nao_subestima_o_motor() {
        // Com a rota B o selo deixou de ser fato da MÁQUINA e virou máquina ×
        // motor. Sem a variante `Motor`, o card diria "parcial" (barra escrita
        // no projeto) sobre um motor que barra o disco inteiro — subestimar a
        // proteção mente tanto quanto exagerá-la.
        assert_eq!(
            confinamento(SandboxProprio::SistemaOperacional).selo,
            Selo::Motor
        );
        // A garantia do motor NÃO depende do sandbox-exec existir aqui: em
        // Linux ele nem existe e o Codex confina igual.
        assert!(!confinamento(SandboxProprio::SistemaOperacional)
            .nota
            .is_empty());
        // Quem não confina sozinho segue dependendo da máquina.
        let sem_motor = confinamento(SandboxProprio::Nenhum).selo;
        assert_eq!(
            sem_motor,
            if disponivel() {
                Selo::Parcial
            } else {
                Selo::Ausente
            }
        );
    }

    #[test]
    fn plano_gera_perfil_de_verdade_e_nao_so_uma_flag() {
        let p = perfil_macos(Permission::Padrao, true, SandboxProprio::Nenhum, &alvo("/repo")).unwrap();
        assert!(p.contains("(deny file-write* (subpath \"/repo\"))"));
    }

    #[test]
    fn modo_de_escrita_nao_gera_perfil() {
        assert_eq!(
            perfil_macos(Permission::Padrao, false, SandboxProprio::Nenhum, &alvo("/x/y")),
            Err(SemPerfil::ModoEscreve)
        );
    }

    #[test]
    fn o_perfil_e_denylist_nao_allowlist() {
        // A medida mandou: allowlist quebra 2 de 3 motores, e o agy quebra em
        // SILÊNCIO. Se este teste virar allowlist um dia, foi regressão.
        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo("/repo")).unwrap();
        assert!(p.contains("(allow default)"));
        assert!(p.contains("(deny file-write* (subpath \"/repo\"))"));
    }

    #[test]
    fn o_git_ganha_linha_propria() {
        // Num worktree o `.git` é ARQUIVO apontando pro repo principal, fora do
        // subpath da raiz. Sem esta linha, "Só lê" deixaria reescrever histórico.
        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo("/repo")).unwrap();
        assert!(p.contains("(deny file-write* (subpath \"/repo/.git\"))"));
    }

    #[test]
    fn worktree_entra_como_alvo_separado() {
        let a = Alvo {
            raiz: "/repo".into(),
            worktree: Some("/wt/mycockpit/abc".into()),
            ..Default::default()
        };
        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &a).unwrap();
        assert!(p.contains("\"/repo\""));
        assert!(p.contains("\"/wt/mycockpit/abc\""));
    }

    #[test]
    fn worktree_igual_a_raiz_nao_duplica() {
        let a = Alvo {
            raiz: "/repo".into(),
            worktree: Some("/repo".into()),
            ..Default::default()
        };
        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &a).unwrap();
        assert_eq!(p.matches("(subpath \"/repo\")").count(), 1);
    }

    #[test]
    fn caminho_relativo_ou_vazio_nao_vira_regra() {
        // Fail-closed: melhor não ter perfil do que ter um que protege o lugar
        // errado achando que protege o certo.
        assert_eq!(
            perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo("")),
            Err(SemPerfil::NadaParaProteger)
        );
        assert_eq!(
            perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo("repo/relativo")),
            Err(SemPerfil::NadaParaProteger)
        );
    }

    #[test]
    fn aspas_no_caminho_nao_entram_no_perfil() {
        // Uma aspa fecharia o s-expression e poderia ABRIR o perfil inteiro.
        // Perfil malformado é pior que nenhum: parece que está protegendo.
        assert_eq!(
            perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo("/re\"po")),
            Err(SemPerfil::NadaParaProteger)
        );
    }

    #[test]
    fn raiz_invalida_com_worktree_valido_ainda_protege_o_worktree() {
        // Perder um alvo não pode derrubar o outro: a conversa isolada é
        // exatamente onde o agente está trabalhando.
        let a = Alvo {
            raiz: "".into(),
            worktree: Some("/wt/x".into()),
            ..Default::default()
        };
        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &a).unwrap();
        assert!(p.contains("\"/wt/x\""));
    }

    /// A PROVA. Os testes acima garantem que o texto tem a forma certa; só esta
    /// garante que o `sandbox-exec` aceita o texto E que ele de fato bloqueia.
    /// Perfil sintaticamente lindo que não compila protege exatamente nada — e
    /// falharia ABERTO, que é o desfecho que este módulo existe pra impedir.
    ///
    /// `#[ignore]` porque toca o SO desta máquina (mesmo padrão do `modes.rs`):
    /// `cargo test -p app_lib sandbox -- --ignored --nocapture`.
    #[test]
    #[ignore = "toca o sandbox-exec real desta máquina; prova manual do perfil"]
    fn prova_real_o_perfil_bloqueia_e_deixa_ler() {
        use std::io::Write;
        let dir = std::env::temp_dir().join("frota-sandbox-prova");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let raiz = dir.canonicalize().unwrap().to_string_lossy().to_string();
        let alvo_txt = format!("{raiz}/arquivo.txt");
        std::fs::write(&alvo_txt, "original").unwrap();

        let perfil = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo(&raiz)).unwrap();
        let pf = dir.join("perfil.sb");
        let mut f = std::fs::File::create(&pf).unwrap();
        f.write_all(perfil.as_bytes()).unwrap();

        // 1) ESCREVER tem que falhar, e o conteúdo tem que sobreviver.
        let escrita = std::process::Command::new("sandbox-exec")
            .arg("-f")
            .arg(&pf)
            .args(["sh", "-c", &format!("echo ESTRAGADO > {alvo_txt}")])
            .output()
            .expect("sandbox-exec não existe nesta máquina");
        assert!(!escrita.status.success(), "a escrita PASSOU pelo sandbox");
        assert_eq!(
            std::fs::read_to_string(&alvo_txt).unwrap(),
            "original",
            "o arquivo foi alterado apesar do sandbox"
        );

        // 2) LER tem que continuar funcionando — senão "Só lê" não lê.
        let leitura = std::process::Command::new("sandbox-exec")
            .arg("-f")
            .arg(&pf)
            .args(["cat", &alvo_txt])
            .output()
            .unwrap();
        assert!(leitura.status.success(), "o sandbox bloqueou a LEITURA");
        assert_eq!(String::from_utf8_lossy(&leitura.stdout), "original");

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn argv(c: &Command) -> Vec<String> {
        let std = c.as_std();
        std::iter::once(std.get_program().to_string_lossy().to_string())
            .chain(std.get_args().map(|a| a.to_string_lossy().to_string()))
            .collect()
    }

    #[test]
    fn o_envelope_poe_o_perfil_ANTES_do_programa() {
        // Tudo que vem depois do `-f <perfil>` é o comando confinado, flags
        // inclusive. Inverter a ordem faria o sandbox-exec ler a flag do agente
        // como se fosse dele.
        let mut c = Command::new("claude");
        c.args(["-p", "oi"]);
        let e = envelopa(c, std::path::Path::new("/tmp/p.sb"));
        assert_eq!(
            argv(&e),
            vec!["sandbox-exec", "-f", "/tmp/p.sb", "claude", "-p", "oi"]
        );
    }

    #[test]
    fn o_envelope_preserva_o_cwd() {
        // Perder o cwd mandaria o agente trabalhar no diretório errado — falha
        // muito pior que a que o sandbox veio evitar.
        let mut c = Command::new("codex");
        c.current_dir("/repo");
        let e = envelopa(c, std::path::Path::new("/tmp/p.sb"));
        assert_eq!(
            e.as_std()
                .get_current_dir()
                .map(|p| p.to_string_lossy().to_string()),
            Some("/repo".to_string())
        );
    }

    #[test]
    fn o_envelope_preserva_env_E_a_REMOCAO_de_env() {
        // Variável removida pelo adapter é decisão dele (ex.: apagar um token do
        // ambiente). Copiar só as presentes desfaria a remoção pelas costas.
        let mut c = Command::new("agy");
        c.env("FROTA_X", "1");
        c.env_remove("NODE_OPTIONS");
        let e = envelopa(c, std::path::Path::new("/tmp/p.sb"));
        let envs: Vec<_> = e
            .as_std()
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().to_string(),
                    v.map(|x| x.to_string_lossy().to_string()),
                )
            })
            .collect();
        assert!(envs.contains(&("FROTA_X".to_string(), Some("1".to_string()))));
        assert!(envs.contains(&("NODE_OPTIONS".to_string(), None)));
    }

    /// A prova de PONTA do S2: o perfil que o Frota monta pro cwd real de um
    /// projeto barra um agente de verdade tentando escrever.
    ///
    /// Vale mais que a prova do S1 porque usa o caminho de produção inteiro:
    /// `Alvo` montado como o `agent.rs` monta, `perfil_macos`, `envelopa`, e um
    /// binário de agente instalado. Se algum elo mentir, aqui aparece.
    ///
    /// `cargo test -p app_lib sandbox -- --ignored --nocapture`
    #[test]
    #[ignore = "roda um agente real desta máquina; prova de ponta do S2"]
    fn prova_real_o_agente_nao_escreve_no_projeto() {
        let dir = std::env::temp_dir().join("frota-sandbox-ponta");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let raiz = dir.canonicalize().unwrap().to_string_lossy().to_string();
        std::fs::write(format!("{raiz}/alvo.txt"), "original").unwrap();

        let perfil = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo(&raiz)).unwrap();
        let pf = dir.join("p.sb");
        std::fs::write(&pf, &perfil).unwrap();

        // O mesmo envelope da produção, com o agente instalado mais barato de
        // rodar: um `sh` fazendo o que um agente desobediente faria.
        let mut c = Command::new("sh");
        c.args(["-c", &format!("echo ESTRAGADO > {raiz}/alvo.txt")]);
        c.current_dir(&raiz);
        let envelopado = envelopa(c, &pf);

        let saida = std::process::Command::new(envelopado.as_std().get_program())
            .args(envelopado.as_std().get_args())
            .current_dir(&raiz)
            .output()
            .unwrap();

        assert!(!saida.status.success(), "a escrita passou pelo envelope");
        assert_eq!(
            std::fs::read_to_string(format!("{raiz}/alvo.txt")).unwrap(),
            "original"
        );
        println!(
            "stderr do bloqueio (insumo do S3): {}",
            String::from_utf8_lossy(&saida.stderr).trim()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── S3: distinguir quem falhou

    #[test]
    fn sem_confinamento_nada_e_do_sandbox() {
        // Um "operation not permitted" pode vir do trabalho do próprio agente
        // (tentar escrever em /etc). Sem sandbox, ler isso como bloqueio NOSSO
        // poria uma frase errada com toda a confiança.
        assert_eq!(
            classifica(false, "Operation not permitted", None, false, true),
            Veredito::Irrelevante
        );
    }

    #[test]
    fn negacao_do_sandbox_e_reconhecida() {
        assert_eq!(
            classifica(
                true,
                "sh: /repo/x.txt: Operation not permitted",
                None,
                false,
                false
            ),
            Veredito::Negou
        );
    }

    #[test]
    fn falha_do_RUNNER_vence_a_negacao() {
        // As duas assinaturas podem estar no mesmo stderr. A do runner é mais
        // específica E é culpa NOSSA — contá-la como "o agente foi barrado"
        // culparia o inocente e esconderia um defeito do Frota.
        let mix = "sandbox-exec: failed to compile profile\nOperation not permitted";
        assert_eq!(classifica(true, mix, None, false, false), Veredito::RunnerFalhou);
    }

    #[test]
    fn o_silencio_do_agy_e_SUSPEITO_nao_sucesso() {
        // Medido na fase 0: exit 0, stdout vazio, stderr sem assinatura. Tratar
        // como sucesso entregaria um "Só lê" que silenciosamente não faz nada.
        assert_eq!(
            classifica(true, "", None, true, false),
            Veredito::SilencioSuspeito
        );
    }

    #[test]
    fn turno_confinado_que_PRODUZIU_nao_e_suspeito() {
        // O caminho feliz do "Só lê": leu, respondeu, não escreveu. Se este caso
        // virasse aviso, a funcionalidade viraria ruído em todo turno.
        assert_eq!(classifica(true, "", None, true, true), Veredito::Irrelevante);
    }

    #[test]
    fn falha_comum_confinada_nao_vira_sandbox() {
        // Agente que morreu por erro de rede não pode ganhar a frase do bloqueio.
        assert_eq!(
            classifica(true, "error: connection reset by peer", None, false, true),
            Veredito::Irrelevante
        );
    }

    #[test]
    fn toda_causa_de_sandbox_TEM_frase() {
        // Veredito sem frase seria diagnóstico que morre no log — o oposto do
        // que o S3 existe pra fazer.
        for v in [
            Veredito::RunnerFalhou,
            Veredito::Negou,
            Veredito::SilencioSuspeito,
        ] {
            assert!(frase(v).is_some(), "{v:?} sem frase");
        }
        assert!(frase(Veredito::Irrelevante).is_none());
    }

    #[test]
    fn o_claude_barrado_NARRA_em_vez_de_vazar_stderr() {
        // MEDIDO em 22/08/2026 com turno real: mandei o claude editar um arquivo
        // (em `acceptEdits`, modo de ESCRITA) sob o perfil de produção. O
        // arquivo não mudou, o stderr veio VAZIO, e ele mesmo explicou na
        // resposta ("assim que a escrita for liberada, aplico na hora").
        //
        // Então o veredito CERTO aqui é `Irrelevante`: o usuário já foi
        // informado pelo próprio agente, e uma segunda frase nossa seria eco.
        // Este teste existe pra impedir que alguém "melhore" o classificador
        // fazendo `Negou` disparar aqui — não é omissão, é medida.
        assert_eq!(classifica(true, "", None, true, true), Veredito::Irrelevante);
    }

    #[test]
    fn o_agy_barrado_NAO_narra_e_NAO_vaza__so_emudece() {
        // MEDIDO no mesmo dia, mesmo perfil, mesma tarefa de escrita:
        //   arquivo intacto · stdout VAZIO · stderr sem assinatura · exit 0
        // E na tarefa de LEITURA, sob o mesmo sandbox, ele produz normalmente
        // (3 bytes pra "diga apenas OK"). Ou seja: o emudecimento é o sintoma do
        // bloqueio, e é o ÚNICO sintoma que ele dá.
        assert_eq!(
            classifica(true, "", None, true, false),
            Veredito::SilencioSuspeito
        );
        assert_eq!(classifica(true, "", None, true, true), Veredito::Irrelevante);
    }

    #[test]
    fn as_assinaturas_sao_case_insensitive() {
        assert_eq!(
            classifica(true, "OPERATION NOT PERMITTED", None, false, false),
            Veredito::Negou
        );
    }

    #[test]
    fn o_perfil_e_um_s_expression_balanceado() {
        let p = perfil_macos(Permission::Leitura, false, SandboxProprio::Nenhum, &alvo("/repo")).unwrap();
        assert_eq!(
            p.matches('(').count(),
            p.matches(')').count(),
            "perfil desbalanceado não compila no sandbox-exec:\n{p}"
        );
    }
}
