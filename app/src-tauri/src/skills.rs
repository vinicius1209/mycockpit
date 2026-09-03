//! SKILLS (M5): promover um workflow vencedor a um `/command` reutilizável.
//! Grava `.mycockpit/commands/<slug>.md` — a casa AGNÓSTICA: a skill promovida
//! vale em TODOS os motores (claude/codex/agy) via expansão app-side, não só no
//! Claude Code. `.claude/commands` continua sendo LIDO pela descoberta (nada
//! quebra pra quem já tem arquivos lá); só o writer mudou de endereço. SEMPRE
//! com aprovação humana no front (o dialog só chama isto no clique). Aqui
//! garantimos o resto do contrato: nome SANITIZADO (slug, sem path traversal) e
//! NÃO sobrescreve por padrão (a skill vencedora não pode ser apagada por engano).

use std::path::{Path, PathBuf};

/// Deaccent mínimo p/ nomes em pt-BR virarem slug ASCII (espelha sdd::deaccent).
fn deaccent(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        other => other,
    }
}

/// Sanitiza o nome da skill num slug seguro: minúsculas, ASCII alnum + hífen.
/// REJEITA path traversal explícito (`/`, `\`, `..`) ANTES de limpar — não
/// silenciamos um nome malicioso, erramos alto. Retorna Err se o nome ficar
/// vazio depois de limpar (ex.: só símbolos).
pub fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("o nome da skill não pode ser vazio".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("nome inválido: sem barras, contrabarras ou '..'".into());
    }
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in trimmed.chars() {
        for lc in ch.to_lowercase() {
            let a = deaccent(lc);
            if a.is_ascii_alphanumeric() {
                out.push(a);
                prev_dash = false;
            } else if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        }
    }
    let slug: String = out
        .trim_matches('-')
        .split('-')
        .filter(|w| !w.is_empty())
        .take(6)
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        return Err("nome inválido: use letras ou números".into());
    }
    Ok(slug)
}

/// Valida o `project_path` recebido do front (M3): tem que EXISTIR, ser um
/// DIRETÓRIO, e não pode ser uma raiz larga demais ("/" ou o próprio HOME) —
/// senão o comando vira uma primitiva de escrita arbitrária no filesystem.
/// Devolve o caminho CANÔNICO (symlinks resolvidos) p/ compor o destino.
/// `pub(crate)`: mycockpit::export_conv_context reusa a MESMA validação.
pub(crate) fn validate_project_path(project_path: &str) -> Result<PathBuf, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("project_path vazio: informe o diretório do projeto".into());
    }
    let canon = std::fs::canonicalize(trimmed)
        .map_err(|_| format!("project_path inválido: '{trimmed}' não existe"))?;
    if !canon.is_dir() {
        return Err(format!(
            "project_path inválido: '{trimmed}' não é um diretório"
        ));
    }
    if canon == Path::new("/") {
        return Err(
            "project_path inválido: '/' é largo demais — aponte pro diretório do projeto".into(),
        );
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home_canon = std::fs::canonicalize(&home).unwrap_or_else(|_| PathBuf::from(&home));
        if canon == home_canon {
            return Err(
                "project_path inválido: o HOME é largo demais — aponte pro diretório do projeto"
                    .into(),
            );
        }
    }
    Ok(canon)
}

/// Grava uma skill em `<project_path>/.mycockpit/commands/<slug>.md` (atômico).
/// Por padrão NÃO sobrescreve (`overwrite=false`): se já existir, erra claro —
/// a skill promovida é um artefato humano, não some por acidente. Devolve o
/// caminho RELATIVO (`.mycockpit/commands/<slug>.md`) p/ o toast do front.
#[tauri::command]
pub fn write_skill(
    project_path: String,
    name: String,
    content: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let slug = sanitize_name(&name)?;
    let root = validate_project_path(&project_path)?;
    // garante o .mycockpit/ com o .gitignore da casa (commands/ é versionado:
    // a skill promovida deve viajar no clone, como a doutrina e as personas).
    crate::mycockpit::ensure_mycockpit_dir(&root.join(".mycockpit"))?;
    let dir = root.join(".mycockpit").join("commands");
    let file = dir.join(format!("{slug}.md"));
    if file.exists() && !overwrite.unwrap_or(false) {
        return Err(format!(
            "já existe uma skill com o slug '{slug}' (nomes parecidos podem resolver pro mesmo slug)"
        ));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("não criei .mycockpit/commands: {e}"))?;
    let body = if content.ends_with('\n') {
        content
    } else {
        format!("{content}\n")
    };
    crate::fsx::write_atomic(&file, &body)?;
    Ok(format!(".mycockpit/commands/{slug}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_basic() {
        assert_eq!(sanitize_name("Deploy no Repo").unwrap(), "deploy-no-repo");
        assert_eq!(sanitize_name("  Fix   Bug  ").unwrap(), "fix-bug");
        assert_eq!(sanitize_name("Já-Feito!").unwrap(), "ja-feito");
    }

    #[test]
    fn slug_rejects_traversal() {
        assert!(sanitize_name("../etc/passwd").is_err());
        assert!(sanitize_name("a/b").is_err());
        assert!(sanitize_name("a\\b").is_err());
        assert!(sanitize_name("foo..bar").is_err());
    }

    #[test]
    fn slug_rejects_empty() {
        assert!(sanitize_name("").is_err());
        assert!(sanitize_name("   ").is_err());
        assert!(sanitize_name("!!!").is_err());
    }

    #[test]
    fn project_path_validation() {
        // não existe → erro claro.
        let err = write_skill(
            "/caminho/que/nao/existe".into(),
            "Skill".into(),
            "x".into(),
            None,
        )
        .unwrap_err();
        assert!(err.contains("não existe"), "erro: {err}");

        // raiz "/" → largo demais.
        let err = write_skill("/".into(), "Skill".into(), "x".into(), None).unwrap_err();
        assert!(err.contains("largo demais"), "erro: {err}");

        // HOME em si → largo demais.
        if let Some(home) = std::env::var_os("HOME") {
            let err = write_skill(
                home.to_string_lossy().to_string(),
                "Skill".into(),
                "x".into(),
                None,
            )
            .unwrap_err();
            assert!(err.contains("largo demais"), "erro: {err}");
        }

        // vazio → erro claro.
        let err = write_skill("  ".into(), "Skill".into(), "x".into(), None).unwrap_err();
        assert!(err.contains("vazio"), "erro: {err}");
    }

    #[test]
    fn write_then_no_overwrite() {
        let tmp = std::env::temp_dir().join(format!("mc-skill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        // project_path agora precisa EXISTIR (validação M3).
        std::fs::create_dir_all(&tmp).unwrap();
        let pp = tmp.to_string_lossy().to_string();

        let rel = write_skill(pp.clone(), "Minha Skill".into(), "# passos".into(), None).unwrap();
        assert_eq!(rel, ".mycockpit/commands/minha-skill.md");
        assert!(tmp.join(".mycockpit/commands/minha-skill.md").exists());
        // a casa nasce com o .gitignore que VERSIONA commands/ (a skill viaja no clone)
        let gi = std::fs::read_to_string(tmp.join(".mycockpit/.gitignore")).unwrap();
        assert!(
            gi.contains("!commands/"),
            "gitignore sem exceção de commands/: {gi}"
        );

        // segunda gravação sem overwrite → erro claro.
        let err = write_skill(pp.clone(), "Minha Skill".into(), "outro".into(), None).unwrap_err();
        assert!(err.contains("já existe"), "erro: {err}");

        // com overwrite=true → grava.
        let rel2 = write_skill(pp, "Minha Skill".into(), "novo".into(), Some(true)).unwrap();
        assert_eq!(rel2, ".mycockpit/commands/minha-skill.md");
        let got = std::fs::read_to_string(tmp.join(".mycockpit/commands/minha-skill.md")).unwrap();
        assert_eq!(got, "novo\n");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
