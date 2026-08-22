//! O SANDBOX do Frota — S1 do docs/sandbox-plan.md.
//!
//! POR QUE existe: hoje "Só lê" é um PEDIDO ao motor, e quem decide é o motor.
//! Medido na ADR-061: `agy --mode plan -p "crie o arquivo X"` criou o arquivo.
//! O `ModeSelect` já confessa isso em três frases ("sandbox do sistema", "modo
//! da CLI", "só um pedido no prompt") — mas confessar a fraqueza não a remove:
//! "Só lê" significa três coisas diferentes conforme o motor escolhido.
//!
//! Aqui a garantia passa a ser do SISTEMA OPERACIONAL. O agente pode tentar
//! escrever; o kernel responde "Operation not permitted", e não há flag, prompt
//! nem bug de agente que passe por cima.
//!
//! # A medida que inverteu o desenho (22/08/2026)
//!
//! O instinto — e o que o DeepSeek Harness faz, porque ele é dono do processo —
//! é ALLOWLIST: nega tudo, libera o necessário. Medido com turno real nas três
//! CLIs instaladas:
//!
//! | política                          | claude | codex             | agy                     |
//! |-----------------------------------|--------|-------------------|-------------------------|
//! | negar toda escrita                | ok     | falha explícita   | **`exit 0`, saída VAZIA** |
//! | allowlist + áreas de estado       | ok     | ok                | **ainda vazio**         |
//! | **liberar tudo, negar o projeto** | ok     | ok                | **ok**                  |
//!
//! O agy é o caso que desenha o módulo: ele não falha, **finge que funcionou**.
//! Sem erro, sem `permission denied`, código de saída zero, resposta nenhuma.
//! Uma implementação por allowlist teria entregue um "Só lê" que, no agy,
//! silenciosamente não faz nada — a pior degradação possível, porque é invisível.
//!
//! Então para um ORQUESTRADOR de binário de terceiro a forma que funciona é
//! DENYLIST. É uma troca real, e ela vai na cara do usuário (S4), não escondida:
//! protege o SEU PROJETO, não protege `~/Documents`. É menos que "sandbox
//! total"; é infinitamente mais que hoje, que é nada.
//!
//! # O que este módulo NÃO faz
//!
//! Não lança processo. A política é TEXTO gerado por função pura — dá pra
//! testar sem `sandbox-exec`, sem rede e sem gastar turno de agente. Envolver o
//! spawn é o S2; distinguir "negou" de "quebrou" é o S3.

use crate::adapters::Permission;

/// Modos em que o Frota PROMETE que o agente não escreve. Só eles ganham
/// sandbox: em `Padrao`/`Auto`/`Liberado` o agente DEVE escrever, e confinar ali
/// seria teatro que quebra turno legítimo.
pub fn confina(p: Permission) -> bool {
    matches!(p, Permission::Leitura | Permission::FusionRo)
}

/// O que o perfil protege. Campo a campo porque cada um tem um motivo próprio,
/// e uma lista solta de strings esconderia o motivo na primeira leitura.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Alvo {
    /// Raiz do projeto: o que você está pedindo pro agente NÃO tocar.
    pub raiz: String,
    /// Worktree da conversa, quando ela roda isolada. É um caminho de fora da
    /// raiz (o `mycockpit/<id>` do git), então precisa de linha própria — sem
    /// ela, "Só lê" numa conversa isolada não protegeria nada.
    pub worktree: Option<String>,
}

/// Um caminho é seguro pra entrar no perfil?
///
/// Fail-closed do §9: caminho relativo, vazio ou com aspas NÃO vira regra
/// silenciosamente. Aspas quebrariam o s-expression e poderiam ABRIR o perfil
/// inteiro — um perfil malformado é pior que perfil nenhum, porque parece que
/// está protegendo.
fn utilizavel(p: &str) -> bool {
    !p.is_empty() && p.starts_with('/') && !p.contains('"') && !p.contains('\n')
}

/// Erro de montagem. Existe como tipo (e não `Option`) porque o S2 precisa
/// DIZER o que houve: recusar um turno em silêncio é o mesmo fail-open que o
/// sandbox veio matar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemPerfil {
    /// O modo escreve — não é erro, é ausência legítima de sandbox.
    ModoEscreve,
    /// Nenhum caminho utilizável sobrou. Perfil que não nega nada é perfil que
    /// mente.
    NadaParaProteger,
}

/// Monta o perfil Seatbelt (macOS) para um modo + alvo.
///
/// `(allow default)` seguido de `(deny file-write* ...)` é a DENYLIST que a
/// medida exigiu. A ordem importa no Seatbelt: a última regra que casa vence,
/// então os `deny` vêm depois do `allow default`.
pub fn perfil_macos(p: Permission, alvo: &Alvo) -> Result<String, SemPerfil> {
    if !confina(p) {
        return Err(SemPerfil::ModoEscreve);
    }
    let mut caminhos: Vec<&str> = Vec::new();
    if utilizavel(&alvo.raiz) {
        caminhos.push(&alvo.raiz);
    }
    if let Some(w) = alvo.worktree.as_deref() {
        // Worktree IGUAL à raiz não vira segunda regra: duplicar não protege
        // mais e faz o perfil parecer que cobre dois lugares.
        if utilizavel(w) && w != alvo.raiz {
            caminhos.push(w);
        }
    }
    if caminhos.is_empty() {
        return Err(SemPerfil::NadaParaProteger);
    }

    let mut s = String::from("(version 1)\n(allow default)\n");
    for c in &caminhos {
        s.push_str(&format!("(deny file-write* (subpath \"{c}\"))\n"));
        // O `.git` merece linha própria, e não é redundância: um worktree tem o
        // `.git` como ARQUIVO apontando pro repo principal, que fica fora do
        // subpath acima. "Só lê" que deixa reescrever histórico não é só lê.
        s.push_str(&format!("(deny file-write* (subpath \"{c}/.git\"))\n"));
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alvo(raiz: &str) -> Alvo {
        Alvo { raiz: raiz.into(), worktree: None }
    }

    #[test]
    fn so_os_modos_que_prometem_nao_escrever_sao_confinados() {
        // Sandbox em modo de escrita seria teatro: quebra turno legítimo e não
        // protege nada que o usuário tenha pedido pra proteger.
        assert!(confina(Permission::Leitura));
        assert!(confina(Permission::FusionRo));
        assert!(!confina(Permission::Padrao));
        assert!(!confina(Permission::Auto));
        assert!(!confina(Permission::Liberado));
    }

    #[test]
    fn modo_de_escrita_nao_gera_perfil() {
        assert_eq!(
            perfil_macos(Permission::Padrao, &alvo("/x/y")),
            Err(SemPerfil::ModoEscreve)
        );
    }

    #[test]
    fn o_perfil_e_denylist_nao_allowlist() {
        // A medida mandou: allowlist quebra 2 de 3 motores, e o agy quebra em
        // SILÊNCIO. Se este teste virar allowlist um dia, foi regressão.
        let p = perfil_macos(Permission::Leitura, &alvo("/repo")).unwrap();
        assert!(p.contains("(allow default)"));
        assert!(p.contains("(deny file-write* (subpath \"/repo\"))"));
    }

    #[test]
    fn o_git_ganha_linha_propria() {
        // Num worktree o `.git` é ARQUIVO apontando pro repo principal, fora do
        // subpath da raiz. Sem esta linha, "Só lê" deixaria reescrever histórico.
        let p = perfil_macos(Permission::Leitura, &alvo("/repo")).unwrap();
        assert!(p.contains("(deny file-write* (subpath \"/repo/.git\"))"));
    }

    #[test]
    fn worktree_entra_como_alvo_separado() {
        let a = Alvo {
            raiz: "/repo".into(),
            worktree: Some("/wt/mycockpit/abc".into()),
        };
        let p = perfil_macos(Permission::Leitura, &a).unwrap();
        assert!(p.contains("\"/repo\""));
        assert!(p.contains("\"/wt/mycockpit/abc\""));
    }

    #[test]
    fn worktree_igual_a_raiz_nao_duplica() {
        let a = Alvo { raiz: "/repo".into(), worktree: Some("/repo".into()) };
        let p = perfil_macos(Permission::Leitura, &a).unwrap();
        assert_eq!(p.matches("(subpath \"/repo\")").count(), 1);
    }

    #[test]
    fn caminho_relativo_ou_vazio_nao_vira_regra() {
        // Fail-closed: melhor não ter perfil do que ter um que protege o lugar
        // errado achando que protege o certo.
        assert_eq!(
            perfil_macos(Permission::Leitura, &alvo("")),
            Err(SemPerfil::NadaParaProteger)
        );
        assert_eq!(
            perfil_macos(Permission::Leitura, &alvo("repo/relativo")),
            Err(SemPerfil::NadaParaProteger)
        );
    }

    #[test]
    fn aspas_no_caminho_nao_entram_no_perfil() {
        // Uma aspa fecharia o s-expression e poderia ABRIR o perfil inteiro.
        // Perfil malformado é pior que nenhum: parece que está protegendo.
        assert_eq!(
            perfil_macos(Permission::Leitura, &alvo("/re\"po")),
            Err(SemPerfil::NadaParaProteger)
        );
    }

    #[test]
    fn raiz_invalida_com_worktree_valido_ainda_protege_o_worktree() {
        // Perder um alvo não pode derrubar o outro: a conversa isolada é
        // exatamente onde o agente está trabalhando.
        let a = Alvo { raiz: "".into(), worktree: Some("/wt/x".into()) };
        let p = perfil_macos(Permission::Leitura, &a).unwrap();
        assert!(p.contains("\"/wt/x\""));
    }

    /// A PROVA. Os testes acima garantem que o texto tem a forma certa; só esta
    /// garante que o `sandbox-exec` aceita o texto E que ele de fato bloqueia.
    /// Perfil sintaticamente lindo que não compila protege exatamente nada — e
    /// falharia ABERTO, que é o desfecho que este módulo existe pra impedir.
    ///
    /// `#[ignore]` porque toca o SO desta máquina (mesmo padrão do `modes.rs`):
    /// `cargo test -p app_lib sandbox -- --ignored --nocapture`.
    #[test]
    #[ignore = "toca o sandbox-exec real desta máquina; prova manual do perfil"]
    fn prova_real_o_perfil_bloqueia_e_deixa_ler() {
        use std::io::Write;
        let dir = std::env::temp_dir().join("frota-sandbox-prova");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let raiz = dir.canonicalize().unwrap().to_string_lossy().to_string();
        let alvo_txt = format!("{raiz}/arquivo.txt");
        std::fs::write(&alvo_txt, "original").unwrap();

        let perfil = perfil_macos(Permission::Leitura, &alvo(&raiz)).unwrap();
        let pf = dir.join("perfil.sb");
        let mut f = std::fs::File::create(&pf).unwrap();
        f.write_all(perfil.as_bytes()).unwrap();

        // 1) ESCREVER tem que falhar, e o conteúdo tem que sobreviver.
        let escrita = std::process::Command::new("sandbox-exec")
            .arg("-f")
            .arg(&pf)
            .args(["sh", "-c", &format!("echo ESTRAGADO > {alvo_txt}")])
            .output()
            .expect("sandbox-exec não existe nesta máquina");
        assert!(!escrita.status.success(), "a escrita PASSOU pelo sandbox");
        assert_eq!(
            std::fs::read_to_string(&alvo_txt).unwrap(),
            "original",
            "o arquivo foi alterado apesar do sandbox"
        );

        // 2) LER tem que continuar funcionando — senão "Só lê" não lê.
        let leitura = std::process::Command::new("sandbox-exec")
            .arg("-f")
            .arg(&pf)
            .args(["cat", &alvo_txt])
            .output()
            .unwrap();
        assert!(leitura.status.success(), "o sandbox bloqueou a LEITURA");
        assert_eq!(String::from_utf8_lossy(&leitura.stdout), "original");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn o_perfil_e_um_s_expression_balanceado() {
        let p = perfil_macos(Permission::Leitura, &alvo("/repo")).unwrap();
        assert_eq!(
            p.matches('(').count(),
            p.matches(')').count(),
            "perfil desbalanceado não compila no sandbox-exec:\n{p}"
        );
    }
}
