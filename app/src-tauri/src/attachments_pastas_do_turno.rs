//! As pastas que valem SÓ para um envio (ADR-252).
//!
//! Arquivo solto no composer vindo de fora do projeto: soltar é o gesto, e a
//! pasta dele entra no `extra_dirs` deste run, sem ir para o
//! `.frota/config.toml`. É o mesmo prazo que a pasta de um anexo já tem
//! (ADR-192): vale para o turno em que o arquivo foi citado e acaba com ele.
//!
//! O front manda as pastas; aqui só entra o que é pasta de verdade, absoluta e
//! existente, e nunca a raiz do disco. O que o config já libera não se repete.

use std::path::Path;

/// Junta as pastas do config com as do turno, validando as do turno.
pub fn juntar(mut do_config: Vec<String>, do_turno: Vec<String>) -> Vec<String> {
    for bruta in do_turno {
        let Some(pasta) = pasta_valida(&bruta) else {
            log::warn!("pasta do turno recusada: {bruta}");
            continue;
        };
        if !do_config.contains(&pasta) {
            do_config.push(pasta);
        }
    }
    do_config
}

/// Canônica, absoluta, existente e diferente da raiz; senão, nada.
fn pasta_valida(bruta: &str) -> Option<String> {
    let caminho = Path::new(bruta);
    if !caminho.is_absolute() {
        return None;
    }
    let canon = caminho.canonicalize().ok()?;
    if !canon.is_dir() || canon.parent().is_none() {
        return None;
    }
    Some(canon.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pasta temporária própria de cada teste, apagada ao sair.
    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tmp(tag: &str) -> Tmp {
        let p = std::env::temp_dir().join(format!("frota-pastas-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }

    #[test]
    fn a_pasta_do_turno_entra_depois_das_do_config() {
        let dir = tmp("t1");
        let pasta = dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let juntas = juntar(vec!["/do/config".into()], vec![pasta.clone()]);
        assert_eq!(juntas, vec!["/do/config".to_string(), pasta]);
    }

    #[test]
    fn a_pasta_que_o_config_ja_libera_nao_se_repete() {
        let dir = tmp("t2");
        let pasta = dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(
            juntar(vec![pasta.clone()], vec![pasta.clone()]),
            vec![pasta]
        );
    }

    #[test]
    fn recusa_relativa_inexistente_arquivo_e_raiz() {
        let dir = tmp("t3");
        let arquivo = dir.path().join("eslint.config.js");
        std::fs::write(&arquivo, "export default []").unwrap();
        let recusadas = vec![
            "relativa/pasta".to_string(),
            dir.path().join("sumiu").to_string_lossy().to_string(),
            arquivo.to_string_lossy().to_string(),
            "/".to_string(),
        ];
        assert!(juntar(Vec::new(), recusadas).is_empty());
    }

    #[test]
    fn caminho_com_ponto_ponto_vira_a_pasta_canonica() {
        let dir = tmp("t4");
        std::fs::create_dir(dir.path().join("a")).unwrap();
        let torto = dir
            .path()
            .join("a")
            .join("..")
            .to_string_lossy()
            .to_string();
        let canon = dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(juntar(Vec::new(), vec![torto]), vec![canon]);
    }
}
