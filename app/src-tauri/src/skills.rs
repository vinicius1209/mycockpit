//! SKILLS (M5): promover um workflow vencedor a um `/command` reutilizável.
//! Grava `.claude/commands/<slug>.md` (infra nativa do Claude Code: o context.ts
//! já inventaria `.claude/commands`, então a skill aparece sozinha). SEMPRE com
//! aprovação humana no front (o dialog só chama isto no clique). Aqui garantimos
//! o resto do contrato: nome SANITIZADO (slug, sem path traversal) e NÃO
//! sobrescreve por padrão (a skill vencedora não pode ser apagada por engano).

use std::path::Path;

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

/// Grava uma skill em `<project_path>/.claude/commands/<slug>.md` (atômico).
/// Por padrão NÃO sobrescreve (`overwrite=false`): se já existir, erra claro —
/// a skill promovida é um artefato humano, não some por acidente. Devolve o
/// caminho RELATIVO (`.claude/commands/<slug>.md`) p/ o toast do front.
#[tauri::command]
pub fn write_skill(
    project_path: String,
    name: String,
    content: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let slug = sanitize_name(&name)?;
    let dir = Path::new(&project_path).join(".claude").join("commands");
    let file = dir.join(format!("{slug}.md"));
    if file.exists() && !overwrite.unwrap_or(false) {
        return Err(format!("já existe uma skill com esse nome ({slug})"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("não criei .claude/commands: {e}"))?;
    let body = if content.ends_with('\n') {
        content
    } else {
        format!("{content}\n")
    };
    crate::fsx::write_atomic(&file, &body)?;
    Ok(format!(".claude/commands/{slug}.md"))
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
    fn write_then_no_overwrite() {
        let tmp = std::env::temp_dir().join(format!("mc-skill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let pp = tmp.to_string_lossy().to_string();

        let rel = write_skill(pp.clone(), "Minha Skill".into(), "# passos".into(), None).unwrap();
        assert_eq!(rel, ".claude/commands/minha-skill.md");
        assert!(tmp.join(".claude/commands/minha-skill.md").exists());

        // segunda gravação sem overwrite → erro claro.
        let err = write_skill(pp.clone(), "Minha Skill".into(), "outro".into(), None).unwrap_err();
        assert!(err.contains("já existe"), "erro: {err}");

        // com overwrite=true → grava.
        let rel2 = write_skill(pp, "Minha Skill".into(), "novo".into(), Some(true)).unwrap();
        assert_eq!(rel2, ".claude/commands/minha-skill.md");
        let got = std::fs::read_to_string(tmp.join(".claude/commands/minha-skill.md")).unwrap();
        assert_eq!(got, "novo\n");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
