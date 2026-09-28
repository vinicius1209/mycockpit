//! O detalhe de um caminho da árvore para o cartão de hover
//! (docs/explorador-de-arquivos-prd.md, D2): tipo, tamanho, quando mudou,
//! linhas de texto pequeno e o destino do link. Leve e sob demanda: só roda
//! quando o cartão abre, e as linhas só são contadas até 1 MB.

use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_PARA_LINHAS: u64 = 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetalheDoCaminho {
    /// "arquivo" | "pasta"
    pub tipo: String,
    pub bytes: u64,
    /// ms desde a época.
    pub alterado_em: Option<i64>,
    /// Só para texto até 1 MB.
    pub linhas: Option<u64>,
    /// O destino, quando é link.
    pub link: Option<String>,
}

fn rel_valido(rel: &str) -> Result<&Path, String> {
    let p = Path::new(rel);
    if rel.is_empty() || p.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err("caminho inválido".into());
    }
    Ok(p)
}

fn contar_linhas(caminho: &Path, bytes: u64) -> Option<u64> {
    if bytes > MAX_PARA_LINHAS {
        return None;
    }
    let mut conteudo = Vec::with_capacity(bytes as usize);
    std::fs::File::open(caminho).ok()?.read_to_end(&mut conteudo).ok()?;
    // Binário não tem linhas que valha contar.
    if conteudo.iter().take(8192).any(|&b| b == 0) {
        return None;
    }
    let quebras = conteudo.iter().filter(|&&b| b == b'\n').count() as u64;
    Some(if conteudo.last().is_some_and(|&b| b != b'\n') { quebras + 1 } else { quebras })
}

pub(crate) fn detalhe_sync(root: &str, rel: &str) -> Result<DetalheDoCaminho, String> {
    let raiz = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let caminho: PathBuf = raiz.join(rel_valido(rel)?);
    // O link em si mora na árvore; o que ele aponta pode estar fora.
    let pai = caminho.parent().and_then(|p| std::fs::canonicalize(p).ok());
    if !pai.is_some_and(|p| p.starts_with(&raiz)) {
        return Err("caminho fora da raiz do projeto".into());
    }
    let do_link = std::fs::symlink_metadata(&caminho).map_err(|e| e.to_string())?;
    let link = do_link
        .file_type()
        .is_symlink()
        .then(|| std::fs::read_link(&caminho).ok().map(|d| d.to_string_lossy().into_owned()))
        .flatten();
    // Stat do destino só se ele mora dentro da raiz; senão, o do próprio link.
    let destino = std::fs::canonicalize(&caminho).ok().filter(|d| d.starts_with(&raiz));
    let (meta, alvo) = match (&link, destino) {
        (Some(_), Some(d)) => (std::fs::metadata(&d).map_err(|e| e.to_string())?, Some(d)),
        (Some(_), None) => (do_link, None),
        (None, _) => (do_link, Some(caminho.clone())),
    };
    let pasta = meta.is_dir();
    let bytes = if pasta { 0 } else { meta.len() };
    Ok(DetalheDoCaminho {
        tipo: if pasta { "pasta" } else { "arquivo" }.into(),
        bytes,
        alterado_em: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64),
        linhas: match alvo {
            Some(a) if !pasta => contar_linhas(&a, bytes),
            _ => None,
        },
        link,
    })
}

#[tauri::command]
pub async fn detalhe_do_caminho(root: String, rel: String) -> Result<DetalheDoCaminho, String> {
    tauri::async_runtime::spawn_blocking(move || detalhe_sync(&root, &rel))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raiz(tag: &str) -> PathBuf {
        let unico = std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("frota-detalhe-{tag}-{}-{unico}", std::process::id()));
        std::fs::create_dir_all(base.join("projeto/docs")).unwrap();
        base
    }

    #[test]
    fn arquivo_de_texto_diz_tamanho_linhas_e_quando_mudou() {
        let base = raiz("arquivo");
        let r = base.join("projeto");
        std::fs::write(r.join("docs/PLAN.md"), "# Plano\n\numa\nduas").unwrap();
        let d = detalhe_sync(&r.to_string_lossy(), "docs/PLAN.md").unwrap();
        assert_eq!((d.tipo.as_str(), d.bytes, d.linhas, d.link), ("arquivo", 17, Some(4), None));
        assert!(d.alterado_em.is_some());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn pasta_nao_tem_linhas_e_binario_tambem_nao() {
        let base = raiz("pasta");
        let r = base.join("projeto");
        std::fs::write(r.join("imagem.png"), [0x89, b'P', b'N', b'G', 0, 0, 1]).unwrap();
        let s = r.to_string_lossy();
        let pasta = detalhe_sync(&s, "docs").unwrap();
        assert_eq!((pasta.tipo.as_str(), pasta.linhas), ("pasta", None));
        assert_eq!(detalhe_sync(&s, "imagem.png").unwrap().linhas, None);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn link_mostra_o_destino_mesmo_quando_ele_mora_fora() {
        let base = raiz("link");
        let r = base.join("projeto");
        std::fs::write(base.join("fora.md"), "segredo\n").unwrap();
        std::os::unix::fs::symlink(base.join("fora.md"), r.join("CLAUDE.md")).unwrap();
        let d = detalhe_sync(&r.to_string_lossy(), "CLAUDE.md").unwrap();
        assert!(d.link.as_deref().is_some_and(|l| l.ends_with("fora.md")));
        assert_eq!(d.linhas, None, "o conteúdo de fora da raiz não é lido");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn fora_da_raiz_e_recusado() {
        let base = raiz("fora");
        let s = base.join("projeto").to_string_lossy().into_owned();
        assert!(detalhe_sync(&s, "../fora.md").is_err());
        assert!(detalhe_sync(&s, "/etc/hosts").is_err());
        assert!(detalhe_sync(&s, "").is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
