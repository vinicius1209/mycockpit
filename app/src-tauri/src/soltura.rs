//! Arquivos soltos no composer (capricho PRD R6). O evento de arrastar do Tauri
//! entrega só caminhos; decidir entre anexo e menção pede saber se cada um é
//! pasta e quanto pesa. Só leitura de metadados, nada de conteúdo.

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaminhoSolto {
    pub path: String,
    pub pasta: bool,
    pub bytes: u64,
}

/// Teto de itens por gesto: arrastar a pasta inteira de fotos não vira 3 mil
/// consultas.
const TETO_DE_ITENS: usize = 64;

pub fn descrever(paths: &[String]) -> Vec<CaminhoSolto> {
    paths
        .iter()
        .take(TETO_DE_ITENS)
        .filter_map(|path| {
            let meta = std::fs::metadata(path).ok()?;
            Some(CaminhoSolto {
                path: path.clone(),
                pasta: meta.is_dir(),
                bytes: if meta.is_dir() { 0 } else { meta.len() },
            })
        })
        .collect()
}

#[tauri::command]
pub fn caminhos_soltos(paths: Vec<String>) -> Vec<CaminhoSolto> {
    descrever(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diz_pasta_arquivo_e_tamanho_e_ignora_o_que_sumiu() {
        let dir = std::env::temp_dir().join(format!("frota-soltura-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("print.png"), [0u8; 42]).unwrap();
        let paths = vec![
            dir.join("print.png").to_string_lossy().to_string(),
            dir.join("src").to_string_lossy().to_string(),
            dir.join("nao-existe.txt").to_string_lossy().to_string(),
        ];
        let achados = descrever(&paths);
        assert_eq!(achados.len(), 2);
        assert_eq!((achados[0].pasta, achados[0].bytes), (false, 42));
        assert!(achados[1].pasta);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn teto_de_itens_por_gesto() {
        let muitos: Vec<String> = (0..200).map(|_| std::env::temp_dir().to_string_lossy().to_string()).collect();
        assert_eq!(descrever(&muitos).len(), TETO_DE_ITENS);
    }
}
