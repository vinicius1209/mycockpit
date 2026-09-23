//! Levar a pasta do projeto do nome antigo para `.frota/`, por gesto da pessoa
//! (ADR-236, passo 3 do `docs/frota-rename-plan.md`: "repo próprio por
//! `git mv`, repo de terceiro por gesto").
//!
//! Em 23/09/2026, 7 dos 11 projetos da pessoa ainda tinham só a pasta antiga.
//! O app lê as duas (`frota_dir::pasta_da_frota`), então nada quebrava, mas o
//! nome antigo aparecia na tela e o projeto ficava para sempre na janela de
//! compatibilidade.
//!
//! As regras:
//!  - sem `.frota/`: a pasta inteira muda de nome (`git mv` se o git a
//!    acompanha, senão renomeação comum);
//!  - com as duas: cada entrada da antiga que não existe na nova vai para lá;
//!    a que existe nas duas FICA na antiga e volta como conflito. Nada é
//!    sobrescrito: a pessoa decide o que fazer com ele;
//!  - a pasta antiga só some se ficar vazia.
//!
//! Não roda com o agente trabalhando no projeto: quem chama confere antes, e
//! a tela desliga o botão enquanto houver turno rodando.

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

use crate::frota_dir::{PASTA, PASTA_LEGADA};

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoDaMigracao {
    /// Entradas que foram para `.frota/` (ou `["*"]` quando a pasta inteira mudou de nome).
    pub movidos: Vec<String>,
    /// Entradas que existem nas duas pastas e ficaram na antiga.
    pub conflitos: Vec<String>,
    pub via_git: bool,
}

/// O git acompanha algo dentro da pasta antiga?
async fn rastreada_pelo_git(root: &Path) -> bool {
    let saida = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["ls-files", "-z", "--", PASTA_LEGADA])
            .kill_on_drop(true)
            .output(),
    )
    .await;
    matches!(saida, Ok(Ok(out)) if out.status.success() && !out.stdout.is_empty())
}

async fn git_mv(root: &Path, de: &str, para: &str) -> Result<(), String> {
    let saida = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["mv", "--", de, para])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "o git não respondeu a tempo".to_string())?
    .map_err(|e| format!("não consegui rodar o git: {e}"))?;
    if saida.status.success() {
        Ok(())
    } else {
        Err(format!("git mv falhou: {}", String::from_utf8_lossy(&saida.stderr).trim()))
    }
}

/// Move `de` → `para` (relativos à raiz), pelo git quando ele acompanha.
async fn mover(root: &Path, de: &str, para: &str, via_git: bool) -> Result<(), String> {
    if via_git {
        return git_mv(root, de, para).await;
    }
    std::fs::rename(root.join(de), root.join(para)).map_err(|e| format!("não consegui mover {de}: {e}"))
}

pub async fn migrar(root: &Path) -> Result<ResultadoDaMigracao, String> {
    let antiga = root.join(PASTA_LEGADA);
    if !antiga.is_dir() {
        return Ok(ResultadoDaMigracao::default());
    }
    let via_git = rastreada_pelo_git(root).await;
    let nova = root.join(PASTA);
    if !nova.exists() {
        mover(root, PASTA_LEGADA, PASTA, via_git).await?;
        return Ok(ResultadoDaMigracao { movidos: vec!["*".into()], conflitos: vec![], via_git });
    }
    let mut nomes: Vec<String> = std::fs::read_dir(&antiga)
        .map_err(|e| format!("não consegui ler {PASTA_LEGADA}: {e}"))?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .collect();
    nomes.sort();
    let mut resultado = ResultadoDaMigracao { via_git, ..Default::default() };
    for nome in nomes {
        if nova.join(&nome).exists() {
            resultado.conflitos.push(nome);
            continue;
        }
        mover(root, &format!("{PASTA_LEGADA}/{nome}"), &format!("{PASTA}/{nome}"), via_git).await?;
        resultado.movidos.push(nome);
    }
    // Só some vazia: conflito fica onde a pessoa possa ver.
    let _ = std::fs::remove_dir(&antiga);
    Ok(resultado)
}

#[tauri::command]
pub async fn migrar_pasta_do_projeto(path: String) -> Result<ResultadoDaMigracao, String> {
    let root = crate::skills::validate_project_path(&path)?;
    migrar(&root).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Caminho dentro da pasta antiga: o nome vem da constante, não do texto.
    fn antiga(rel: &str) -> String {
        format!("{PASTA_LEGADA}/{rel}")
    }

    struct Projeto(std::path::PathBuf);
    impl Projeto {
        fn novo(nome: &str) -> Self {
            let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let dir = std::env::temp_dir().join(format!("frota-migrar-{nome}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Projeto(dir)
        }
        fn escrever(&self, rel: &str, texto: &str) {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, texto).unwrap();
        }
        fn ler(&self, rel: &str) -> String {
            std::fs::read_to_string(self.0.join(rel)).unwrap()
        }
    }
    impl Drop for Projeto {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // O estado real de 7 projetos em 23/09/2026: só a pasta antiga, fora do git.
    #[tokio::test]
    async fn so_a_pasta_antiga_muda_de_nome_inteira() {
        let p = Projeto::novo("so-antiga");
        p.escrever(&antiga("instructions.md"), "- Mocks em docs/mocks/.");
        p.escrever(&antiga("config.toml"), "mode = \"padrao\"");
        p.escrever(&antiga("context/c1.md"), "fio");
        let r = migrar(&p.0).await.unwrap();
        assert_eq!(r.movidos, ["*"]);
        assert!(!p.0.join(PASTA_LEGADA).exists());
        assert_eq!(p.ler(".frota/instructions.md"), "- Mocks em docs/mocks/.");
        assert_eq!(p.ler(".frota/context/c1.md"), "fio");
    }

    #[tokio::test]
    async fn com_as_duas_nada_e_sobrescrito_e_o_conflito_fica_a_vista() {
        let p = Projeto::novo("duas");
        p.escrever(".frota/config.toml", "novo");
        p.escrever(&antiga("config.toml"), "antigo");
        p.escrever(&antiga("instructions.md"), "regras");
        let r = migrar(&p.0).await.unwrap();
        assert_eq!(r.movidos, ["instructions.md"]);
        assert_eq!(r.conflitos, ["config.toml"]);
        assert_eq!(p.ler(".frota/config.toml"), "novo");
        assert_eq!(p.ler(&antiga("config.toml")), "antigo");
        assert_eq!(p.ler(".frota/instructions.md"), "regras");
    }

    #[tokio::test]
    async fn sem_pasta_antiga_nao_faz_nada() {
        let p = Projeto::novo("nova");
        p.escrever(".frota/config.toml", "x");
        assert_eq!(migrar(&p.0).await.unwrap(), ResultadoDaMigracao::default());
    }

    #[tokio::test]
    async fn pasta_no_git_muda_pelo_git_e_o_historico_acompanha() {
        let p = Projeto::novo("git");
        let git = |args: &[&str]| {
            std::process::Command::new("git").arg("-C").arg(&p.0).args(args).output().unwrap()
        };
        git(&["init", "-q"]);
        p.escrever(&antiga("instructions.md"), "regras");
        git(&["add", "."]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "doutrina"]);
        let r = migrar(&p.0).await.unwrap();
        assert!(r.via_git);
        let status = String::from_utf8(git(&["status", "--porcelain"]).stdout).unwrap();
        assert!(status.contains(&format!("R  {} -> .frota/instructions.md", antiga("instructions.md"))), "{status}");
    }
}
