//! Diretrizes de escopo de diretórios e navegação para agentes.
//!
//! Reduz varreduras recursivas cegas a partir da raiz da Home (`~`),
//! o que aciona o TCC do macOS (Desktop, Documents, Downloads), sem limitar artificialmente
//! a autonomia do agente em tarefas legítimas.

/// Formata o bloco de diretrizes de escopo e navegação.
pub fn format_scope_guidance(
    cwd: &str,
    extra_dirs: &[String],
    has_inline_question: bool,
) -> String {
    let mut s = format!(
        "[DIRETRIZES DE ESCOPO E NAVEGAÇÃO]\n\
         - Workspace principal: {cwd}\n"
    );

    if extra_dirs.is_empty() {
        s.push_str("- Diretórios extras vinculados: nenhum\n\n");
    } else {
        s.push_str("- Diretórios extras vinculados:\n");
        for d in extra_dirs {
            s.push_str(&format!("  • {d}\n"));
        }
        s.push('\n');
    }

    s.push_str(
        "Regras operacionais:\n\
         1. Prioridade: Concentre a busca de arquivos, referências e dependências prioritariamente no workspace principal e nos diretórios extras vinculados.\n\
         2. Higiene no macOS: NUNCA execute buscas recursivas amplas (como find_by_name ou grep_search com profundidade aberta) iniciando na raiz da Home (~). Isso aciona travas de privacidade do macOS (Desktop, Documents, Downloads) e interrompe a sessão com alertas de segurança do sistema.\n\
         3. Acesso externo e dúvidas:\n\
            • Você tem permissão para inspecionar caminhos específicos conhecidos fora do workspace quando necessário.\n"
    );

    if has_inline_question {
        s.push_str(
            "            • Se você não souber onde um projeto ou arquivo externo está localizado, utilize a ferramenta ask_user para perguntar a localização ao usuário em vez de varrer o disco.\n"
        );
    } else {
        s.push_str(
            "            • Se você não souber onde um projeto ou arquivo externo está localizado, pergunte a localização diretamente ao usuário na sua resposta em vez de tentar varrer o disco.\n"
        );
    }

    // Visto em 22/09/2026: "o `AGENTS.md` do backend" num repositório com 4
    // AGENTS.md. A Frota transforma a citação em link, e nome solto não diz
    // qual abrir.
    s.push_str(
        "4. Citar arquivos: na resposta, escreva o caminho relativo ao workspace (ex.: `src/lib/x.ts`), não só o nome. A Frota transforma a citação em link, e um nome solto pode existir em várias pastas.\n"
    );

    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formata_sem_extra_dirs_e_com_pergunta_inline() {
        let out = format_scope_guidance("/Users/dev/projeto", &[], true);
        assert!(out.contains("- Workspace principal: /Users/dev/projeto"));
        assert!(out.contains("- Diretórios extras vinculados: nenhum"));
        assert!(out.contains("ferramenta ask_user"));
        assert!(out.contains("Higiene no macOS"));
        assert!(out.contains("caminho relativo ao workspace"));
    }

    #[test]
    fn formata_com_extra_dirs_e_sem_pergunta_inline() {
        let extras = vec![
            "/Users/dev/projetos/backend".to_string(),
            "/Users/dev/projetos/docs".to_string(),
        ];
        let out = format_scope_guidance("/Users/dev/projetos/frontend", &extras, false);
        assert!(out.contains("- Workspace principal: /Users/dev/projetos/frontend"));
        assert!(out.contains("  • /Users/dev/projetos/backend"));
        assert!(out.contains("  • /Users/dev/projetos/docs"));
        assert!(out.contains("pergunte a localização diretamente ao usuário"));
    }
}
