//! Manter o Mac acordado enquanto um agente trabalha.
//!
//! O caso real: missão de 4 fases às 3h da manhã que morre porque a máquina
//! dormiu. É falha que o app pode evitar, e o trabalho perdido não volta — o
//! turno já foi pago.
//!
//! ── DUAS DECISÕES QUE VALE EXPLICAR ────────────────────────────────────────
//!
//! 1. O MECANISMO É `caffeinate -i -w <nosso pid>`, NÃO uma asserção IOKit.
//!
//!    `IOPMAssertionCreateWithName` daria a mesma coisa sem subprocesso, mas
//!    com um risco que esta casa já conhece: a asserção vive no `powerd` e só
//!    morre se ALGUÉM lembrar de liberá-la. App morto a `kill -9` deixaria o
//!    Mac sem dormir para sempre, e o usuário não teria como ligar isso ao
//!    Frota. É a mesma família do processo órfão do incidente da carga
//!    fantasma.
//!
//!    O `-w <pid>` é o "relógio de morte próprio": o `caffeinate` observa o
//!    NOSSO processo e sai sozinho quando ele morre, de qualquer jeito que
//!    morra. A trava não pode sobreviver a quem a pediu.
//!
//! 2. A TRAVA SEGUE O MESMO CICLO DE VIDA DO RUN, no `RunGuard`.
//!
//!    Ela é reavaliada onde o run entra no registry e onde o `RunGuard` (RAII)
//!    o tira — que é TODA saída, inclusive os early-return do `?`, o cancel e
//!    o erro. Trava de energia solta só no caminho feliz é trava vazada.

use serde::Serialize;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Só o macOS tem o `caffeinate` com relógio de morte (`-w <pid>`). No Linux o
/// `systemd-inhibit` não morre com o nosso processo, e trava que sobrevive ao
/// app é pior que trava nenhuma: lá a preferência fica sem efeito, e a tela
/// diz isso em vez de fingir.
const SUPORTADO: bool = cfg!(target_os = "macos");

/// `on` = sempre acordado enquanto o app vive. `agent` = só enquanto há run
/// vivo (o meio-termo, e o único que interessa). `off` = nunca.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Modo {
    Sempre,
    ComAgente,
    Nunca,
}

impl Modo {
    /// O valor da preferência (`settings.keepAwake`) que escolhe este modo.
    pub fn como_str(self) -> &'static str {
        match self {
            Modo::Sempre => "on",
            Modo::ComAgente => "agent",
            Modo::Nunca => "off",
        }
    }

    /// Valor desconhecido cai em `ComAgente` — o default. Nunca entra em
    /// `Sempre` por engano: um valor corrompido não pode virar a opção mais
    /// custosa (bateria) sem alguém ter pedido.
    pub fn de_str(s: &str) -> Modo {
        match s {
            "on" => Modo::Sempre,
            "off" => Modo::Nunca,
            _ => Modo::ComAgente,
        }
    }
}

/// Decide se a trava deve existir. Pura e testável de propósito: é a única
/// regra do módulo, e o resto é subprocesso.
pub fn precisa_segurar(modo: Modo, runs_ativos: usize) -> bool {
    match modo {
        Modo::Sempre => true,
        Modo::ComAgente => runs_ativos > 0,
        Modo::Nunca => false,
    }
}

#[derive(Default)]
pub struct Despertador {
    modo: Mutex<Option<Modo>>,
    trava: Mutex<Option<Child>>,
    /// A regra pediu a trava e o `caffeinate` não abriu. Fica até a próxima
    /// reavaliação conseguir (ou deixar de precisar).
    falhou: Mutex<bool>,
}

/// O sono da máquina como ele ESTÁ, para a faixa, a bandeja e o notch. Nunca
/// é a preferência sozinha: `acordado` quer dizer que a trava existe agora.
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EstadoDoSono {
    pub acordado: bool,
    /// `on` | `agent` | `off`, o mesmo valor da preferência.
    pub modo: String,
    /// Pediu a trava e não conseguiu: o Mac pode dormir no meio de um turno.
    pub falhou: bool,
    /// Este sistema sabe segurar o sono (só o macOS, ver `SUPORTADO`).
    pub suportado: bool,
    pub turnos: usize,
}

/// Aplica a preferência salva. Chamado pela UI no boot e a cada troca.
#[tauri::command]
pub fn set_keep_awake(modo: String, registry: tauri::State<'_, crate::agent::RunRegistry>) {
    let ativos = registry.ativos();
    registry.2.definir_modo(Modo::de_str(&modo), ativos);
}

impl Despertador {
    fn modo_atual(&self) -> Modo {
        self.modo
            .lock()
            .ok()
            .and_then(|m| *m)
            .unwrap_or(Modo::ComAgente)
    }

    pub fn definir_modo(&self, modo: Modo, runs_ativos: usize) {
        if let Ok(mut m) = self.modo.lock() {
            *m = Some(modo);
        }
        self.reavalia(runs_ativos);
    }

    /// Liga ou desliga a trava conforme a regra. Idempotente: chamar duas vezes
    /// com o mesmo estado não abre dois `caffeinate`.
    pub fn reavalia(&self, runs_ativos: usize) {
        let precisa = SUPORTADO && precisa_segurar(self.modo_atual(), runs_ativos);
        let Ok(mut trava) = self.trava.lock() else {
            return;
        };
        // Um `caffeinate` que morreu por fora (encerrado no Monitor de
        // Atividade) deixava `Some` para sempre: o app jurava segurar o sono e
        // nunca reabria. Colher o filho morto antes de decidir fecha isso.
        if trava
            .as_mut()
            .is_some_and(|c| !matches!(c.try_wait(), Ok(None)))
        {
            *trava = None;
        }
        match (precisa, trava.is_some()) {
            (true, false) => {
                // Falha ao abrir não vira toast (seria ruído por turno): vira
                // estado, que a faixa e a bandeja mostram (`EstadoDoSono`).
                match Command::new("caffeinate")
                    .arg("-i")
                    .arg("-w")
                    .arg(std::process::id().to_string())
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                {
                    Ok(c) => {
                        *trava = Some(c);
                        self.marcar_falha(false);
                    }
                    Err(e) => {
                        log::warn!("não consegui segurar o sono (caffeinate): {e}");
                        self.marcar_falha(true);
                    }
                }
            }
            (false, true) => {
                if let Some(mut c) = trava.take() {
                    let _ = c.kill();
                    // `wait` sem isto deixaria um zumbi por trava liberada.
                    let _ = c.wait();
                }
            }
            _ => {}
        }
        if !precisa {
            self.marcar_falha(false);
        }
    }

    fn marcar_falha(&self, falhou: bool) {
        if let Ok(mut f) = self.falhou.lock() {
            *f = falhou;
        }
    }

    /// O estado AGORA. Reavalia antes de responder: é também o que colhe um
    /// `caffeinate` morto e o reabre, na cadência de quem pergunta (a amostra
    /// de 2 s da faixa e cada snapshot da bandeja).
    pub fn estado(&self, runs_ativos: usize) -> EstadoDoSono {
        self.reavalia(runs_ativos);
        EstadoDoSono {
            acordado: self.trava.lock().map(|t| t.is_some()).unwrap_or(false),
            modo: self.modo_atual().como_str().to_string(),
            falhou: self.falhou.lock().map(|f| *f).unwrap_or(false),
            suportado: SUPORTADO,
            turnos: runs_ativos,
        }
    }

    /// Solta a trava na saída do app. Síncrono, como o `kill_all` do registry:
    /// no exit o runtime async pode não rodar mais.
    pub fn solta(&self) {
        if let Ok(mut trava) = self.trava.lock() {
            if let Some(mut c) = trava.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn com_agente_segura_so_enquanto_ha_run() {
        assert!(!precisa_segurar(Modo::ComAgente, 0));
        assert!(precisa_segurar(Modo::ComAgente, 1));
        assert!(precisa_segurar(Modo::ComAgente, 7));
    }

    #[test]
    fn sempre_ignora_a_contagem_e_nunca_tambem() {
        assert!(precisa_segurar(Modo::Sempre, 0));
        assert!(precisa_segurar(Modo::Sempre, 3));
        assert!(!precisa_segurar(Modo::Nunca, 0));
        // O ponto do "off": nem com trabalho rodando ele segura. Se segurasse,
        // a opção não seria uma opção.
        assert!(!precisa_segurar(Modo::Nunca, 3));
    }

    #[test]
    fn valor_desconhecido_cai_no_default_e_nunca_no_mais_custoso() {
        assert_eq!(Modo::de_str("agent"), Modo::ComAgente);
        assert_eq!(Modo::de_str(""), Modo::ComAgente);
        assert_eq!(Modo::de_str("lixo"), Modo::ComAgente);
        // Corrompido não pode virar "Sempre": gastar bateria do usuário é
        // decisão dele, não de um parse que falhou.
        assert_ne!(Modo::de_str("lixo"), Modo::Sempre);
    }

    #[test]
    fn os_tres_rotulos_da_ui_mapeiam_pro_que_prometem() {
        assert_eq!(Modo::de_str("on"), Modo::Sempre);
        assert_eq!(Modo::de_str("agent"), Modo::ComAgente);
        assert_eq!(Modo::de_str("off"), Modo::Nunca);
    }

    #[test]
    fn trava_que_morreu_por_fora_nao_finge_que_segura() {
        let d = Despertador::default();
        d.definir_modo(Modo::Nunca, 0);
        // Um filho que sai na hora faz o papel do `caffeinate` encerrado no
        // Monitor de Atividade.
        let mut morto = Command::new("true").spawn().unwrap();
        let _ = morto.wait();
        *d.trava.lock().unwrap() = Some(morto);
        let e = d.estado(0);
        assert!(!e.acordado, "o filho morto é colhido, não conta como trava");
        assert_eq!(e.modo, "off");
        assert!(!e.falhou);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn trava_morta_reabre_quando_ainda_precisa() {
        let d = Despertador::default();
        d.definir_modo(Modo::Nunca, 0);
        let mut morto = Command::new("true").spawn().unwrap();
        let _ = morto.wait();
        *d.trava.lock().unwrap() = Some(morto);
        d.definir_modo(Modo::Sempre, 0);
        let e = d.estado(0);
        assert!(e.acordado && e.suportado && !e.falhou);
        d.solta();
        d.definir_modo(Modo::Nunca, 0);
        assert!(!d.estado(0).acordado);
    }

    #[test]
    fn o_estado_diz_o_modo_no_valor_da_preferencia() {
        for v in ["on", "agent", "off"] {
            assert_eq!(Modo::de_str(v).como_str(), v);
        }
    }

    #[test]
    fn reavaliar_duas_vezes_nao_abre_duas_travas() {
        let d = Despertador::default();
        d.definir_modo(Modo::Nunca, 0);
        d.reavalia(0);
        d.reavalia(0);
        assert!(d.trava.lock().unwrap().is_none());
    }
}
