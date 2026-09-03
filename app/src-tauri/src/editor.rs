//! Abrir arquivo (e LINHA) no editor do usuário — M1 do estudo do Maestri.
//!
//! O cockpit é cockpit de decisão, não IDE: nem o Maestri, 100% nativo,
//! construiu editor embutido. Fez o atalho. Isto é o atalho.
//!
//! Duas escolhas que valem o comentário:
//!
//! 1. **Probe por BUNDLE, não por PATH.** Medido nesta máquina em 20/08/2026:
//!    `zed` existia só como ALIAS do shell, e `command -v zed` num processo
//!    filho não vê alias nenhum — o editor instalado ficaria invisível. O que
//!    sempre existe é o `.app`. No Linux, aí sim, é o binário no PATH.
//! 2. **CLI DE DENTRO do bundle, não URL scheme.** O `code`/`cursor` do shell
//!    depende de o usuário ter instalado o comando; o scheme depende de
//!    registro no SO e não tem como ser conferido antes de tentar. O binário
//!    dentro do `.app` está lá sempre que o app está, aceita número de linha
//!    documentado, e a falha vira mensagem em vez de silêncio.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Como cada CLI recebe a linha. O estilo é do EDITOR, não do sistema.
#[derive(Clone, Copy, PartialEq)]
enum LineArg {
    /// `-g <arquivo>:<linha>` (família VS Code).
    Goto,
    /// `<arquivo>:<linha>` como argumento posicional (Zed).
    Suffix,
    /// `xed --line <n> <arquivo>` (Xcode; o `xed` só funciona com o Xcode
    /// completo instalado, que é justamente o que o probe confere).
    Xed,
}

struct EditorDef {
    id: &'static str,
    label: &'static str,
    /// Nome do bundle no macOS, sem `.app`.
    mac_app: &'static str,
    /// CLI dentro do bundle, relativa à raiz do `.app`. Vazio = usa `bin`.
    mac_cli: &'static str,
    /// Binário no PATH (Linux; e macOS como segunda chance).
    bin: &'static str,
    line: LineArg,
}

/// Ordem = preferência quando o usuário ainda não escolheu.
const EDITORS: &[EditorDef] = &[
    EditorDef {
        id: "vscode",
        label: "VS Code",
        mac_app: "Visual Studio Code",
        mac_cli: "Contents/Resources/app/bin/code",
        bin: "code",
        line: LineArg::Goto,
    },
    EditorDef {
        id: "cursor",
        label: "Cursor",
        mac_app: "Cursor",
        mac_cli: "Contents/Resources/app/bin/cursor",
        bin: "cursor",
        line: LineArg::Goto,
    },
    EditorDef {
        id: "zed",
        label: "Zed",
        mac_app: "Zed",
        mac_cli: "Contents/MacOS/cli",
        bin: "zed",
        line: LineArg::Suffix,
    },
    EditorDef {
        id: "xcode",
        label: "Xcode",
        mac_app: "Xcode",
        mac_cli: "",
        bin: "xed",
        line: LineArg::Xed,
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    pub id: String,
    pub label: String,
}

/// Onde um `.app` pode morar. `~/Applications` é comum em Mac gerenciado, onde
/// o usuário não tem escrita em `/Applications`.
#[cfg(target_os = "macos")]
fn mac_bundle(name: &str) -> Option<PathBuf> {
    let mut bases = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        bases.push(PathBuf::from(home).join("Applications"));
    }
    bases
        .into_iter()
        .map(|b| b.join(format!("{name}.app")))
        .find(|p| p.exists())
}

#[cfg(not(target_os = "macos"))]
fn mac_bundle(_name: &str) -> Option<PathBuf> {
    None
}

/// Binário no PATH. Usa `which`: o PATH já foi hidratado no startup (path.rs),
/// e `which` respeita ele sem inventar diretório.
fn on_path(bin: &str) -> bool {
    !bin.is_empty() && crate::proc::run_ok("which", &[bin], None).is_some()
}

/// O executável que abre este editor, se ele existir nesta máquina.
fn launcher(def: &EditorDef) -> Option<String> {
    if let Some(bundle) = mac_bundle(def.mac_app) {
        if def.mac_cli.is_empty() {
            // Xcode não traz CLI própria no bundle; quem abre é o `xed` das
            // command line tools, que exige o Xcode completo — presente, já que
            // o bundle está aí.
            return on_path(def.bin).then(|| def.bin.to_string());
        }
        let cli = bundle.join(def.mac_cli);
        if cli.exists() {
            return Some(cli.to_string_lossy().to_string());
        }
    }
    on_path(def.bin).then(|| def.bin.to_string())
}

/// Editores presentes nesta máquina, na ordem de preferência do registro.
#[tauri::command]
pub async fn detect_editors() -> Vec<DetectedEditor> {
    tauri::async_runtime::spawn_blocking(|| {
        EDITORS
            .iter()
            .filter(|d| launcher(d).is_some())
            .map(|d| DetectedEditor {
                id: d.id.to_string(),
                label: d.label.to_string(),
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Caminho ABSOLUTO e contido no projeto.
///
/// O front manda `project_path` + um caminho RELATIVO (o que o diff e o handoff
/// já falam), nunca um absoluto arbitrário. A canonicalização fecha o `..`: sem
/// isto, um `rel` de `../../.ssh/id_rsa` abriria a chave do usuário no editor.
/// Mesmo espírito do `contained` de evidence.rs.
fn contained(project_path: &str, rel: &str) -> Result<PathBuf, String> {
    let base = Path::new(project_path)
        .canonicalize()
        .map_err(|_| "projeto não encontrado no disco".to_string())?;
    let alvo = if rel.is_empty() {
        base.clone()
    } else {
        base.join(rel)
            .canonicalize()
            .map_err(|_| format!("não achei {rel} no projeto"))?
    };
    if !alvo.starts_with(&base) {
        return Err("esse caminho está fora do projeto".into());
    }
    Ok(alvo)
}

/// Abre o PROJETO no editor — e, opcionalmente, foca um arquivo dele.
///
/// A raiz vai SEMPRE junto, e isso é o conserto de um erro real (20/08/2026):
/// mandando só o arquivo, Zed e VS Code abrem uma janela órfã com aquele
/// arquivo e mais nada — sem árvore, sem language server, sem busca. Fica
/// inútil, que foi exatamente o relato. Medido no Zed: `cli <dir> <arq>:<n>`
/// abre o projeto na barra lateral E pula pra linha; `cli <arq>:<n>` sozinho
/// não abre projeto nenhum.
///
/// Não espera o editor: `spawn` e pronto. Aguardar a saída prenderia o comando
/// pelo tempo que a janela ficasse aberta.
#[tauri::command]
pub async fn open_in_editor(
    editor: String,
    project_path: String,
    rel: String,
    line: Option<u32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let def = EDITORS
            .iter()
            .find(|d| d.id == editor)
            .ok_or_else(|| format!("editor desconhecido: {editor}"))?;
        let prog = launcher(def).ok_or_else(|| format!("{} não está instalado", def.label))?;
        let raiz = contained(&project_path, "")?.to_string_lossy().to_string();
        let alvo = if rel.is_empty() {
            None
        } else {
            Some(
                contained(&project_path, &rel)?
                    .to_string_lossy()
                    .to_string(),
            )
        };

        let mut args: Vec<String> = vec![raiz];
        if let Some(arq) = alvo {
            match (def.line, line) {
                (LineArg::Goto, Some(n)) => {
                    args.push("-g".into());
                    args.push(format!("{arq}:{n}"));
                }
                (LineArg::Suffix, Some(n)) => args.push(format!("{arq}:{n}")),
                (LineArg::Xed, Some(n)) => {
                    args.push("--line".into());
                    args.push(n.to_string());
                    args.push(arq);
                }
                (_, None) => args.push(arq),
            }
        }
        std::process::Command::new(&prog)
            .args(&args)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("não consegui abrir o {}: {e}", def.label))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caminho_relativo_sobe_e_e_barrado() {
        // O erro caro: `..` escapando do projeto abriria arquivo QUALQUER da
        // máquina no editor, a partir de uma string vinda do front.
        let tmp = std::env::temp_dir();
        let erro = contained(&tmp.to_string_lossy(), "../etc/hosts").unwrap_err();
        assert!(erro.contains("fora do projeto") || erro.contains("não achei"));
    }

    #[test]
    fn rel_vazio_e_a_raiz_do_projeto() {
        let tmp = std::env::temp_dir();
        let raiz = contained(&tmp.to_string_lossy(), "").unwrap();
        assert_eq!(raiz, tmp.canonicalize().unwrap());
    }

    #[test]
    fn projeto_inexistente_falha_antes_de_qualquer_spawn() {
        assert!(contained("/caminho/que/nao/existe/mesmo", "x.ts").is_err());
    }

    #[test]
    fn todo_editor_do_registro_tem_id_e_rotulo() {
        for d in EDITORS {
            assert!(!d.id.is_empty() && !d.label.is_empty());
            // sem bundle E sem binário, o editor nunca seria detectável —
            // entrada morta no registro.
            assert!(!d.mac_app.is_empty() || !d.bin.is_empty());
        }
    }
}
