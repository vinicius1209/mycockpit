//! Notificação do SO por `osascript` — o fallback que REALMENTE chega.
//!
//! POR QUE existe: o `tauri-plugin-notification` nunca conseguiu autorização
//! nesta máquina. Verificado: o `com.apple.ncprefs` lista 17 apps de terceiro
//! (inclusive indies pequenos), mas o `dev.vinicius.mycockpit` não está lá —
//! nem o build de teste nem o de /Applications. A causa provável é a assinatura
//! (`Signature=adhoc`, `TeamIdentifier=not set`): o macOS recusa registrar um app
//! sem identidade real no Notification Center. Resultado: TODA notificação nativa
//! morria em silêncio desde sempre, e o sintoma era "o app não me avisa".
//!
//! O `osascript` usa a autorização do Script Editor (que ESTÁ concedida — provado
//! na máquina), então a notificação chega. Preço: sai atribuída ao Script Editor,
//! não ao Frota. É feio e é honesto; o conserto definitivo é assinar o app.
//!
//! ⚠️ SEGURANÇA — a razão da forma `on run argv`: título e corpo vêm de nome de
//! conversa e de comando de agente, ou seja entrada NÃO CONFIÁVEL. Interpolar o
//! texto no fonte do AppleScript seria injeção de código: um título como
//! `" & (do shell script "rm -rf ~") & "` executaria. Passando como ARGV, o texto
//! nunca é compilado como código — só lido como dado. Provado na máquina: a
//! tentativa de injeção acima não criou o arquivo alvo. NUNCA trocar por
//! `format!()` dentro do `-e`.

use tokio::process::Command;

/// Dispara uma notificação via `osascript`. Best-effort: erro vira `Err` com a
/// causa (o front decide se avisa), nunca panic e nunca derruba um turno.
#[tauri::command]
pub async fn notify_via_osascript(title: String, body: String) -> Result<(), String> {
    let out = build_command(&title, &body)
        .output()
        .await
        .map_err(|e| format!("osascript não executou: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if err.is_empty() {
        format!("osascript saiu com {}", out.status)
    } else {
        err
    })
}

/// Monta o comando. Separado p/ o teste poder auditar o argv SEM disparar
/// notificação — é a fronteira de segurança do módulo.
fn build_command(title: &str, body: &str) -> Command {
    let mut cmd = Command::new("osascript");
    cmd.arg("-e")
        .arg("on run argv")
        // `item 1 of argv` = corpo, `item 2` = título. Os dois entram como DADO.
        .arg("-e")
        .arg("display notification (item 1 of argv) with title (item 2 of argv)")
        .arg("-e")
        .arg("end run")
        // `--` fecha as opções: título/corpo começando com "-" não viram flag.
        .arg("--")
        .arg(body)
        .arg(title);
    cmd
}

#[cfg(test)]
mod tests {
    use super::build_command;

    fn argv(cmd: &Command) -> Vec<String> {
        cmd.as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }
    use tokio::process::Command;

    /// A garantia que importa: o payload aparece como ARGUMENTO, jamais dentro
    /// dos fragmentos `-e` (que são o código). Se alguém "simplificar" isso para
    /// um `format!` no script, este teste cai.
    #[test]
    fn payload_vai_como_argv_nunca_no_fonte_do_script() {
        let hostil = r#"" & (do shell script "touch /tmp/x") & ""#;
        let args = argv(&build_command("Título", hostil));
        // os 3 fragmentos de código são FIXOS
        let script: Vec<&String> = args
            .iter()
            .enumerate()
            .filter(|(i, _)| *i % 2 == 1 && *i < 6)
            .map(|(_, a)| a)
            .collect();
        assert_eq!(script[0], "on run argv");
        assert_eq!(
            script[1],
            "display notification (item 1 of argv) with title (item 2 of argv)"
        );
        assert_eq!(script[2], "end run");
        // nenhum fragmento de código contém o payload
        for s in &script {
            assert!(!s.contains("do shell script"), "payload vazou pro script: {s}");
        }
        // e o payload está depois do `--`, como dado
        let sep = args.iter().position(|a| a == "--").expect("faltou --");
        assert_eq!(args[sep + 1], hostil);
        assert_eq!(args[sep + 2], "Título");
    }

    /// Título/corpo começando com "-" não podem virar flag do osascript.
    #[test]
    fn texto_com_hifen_nao_vira_flag() {
        let args = argv(&build_command("-e", "--version"));
        let sep = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(args[sep + 1], "--version");
        assert_eq!(args[sep + 2], "-e");
    }
}
