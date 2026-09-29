use super::*;
use std::fs;
use std::path::PathBuf;

/// Um remoto bare e clones dele, numa pasta temporária que some no fim.
struct Cenario {
    raiz: PathBuf,
}

impl Cenario {
    fn new(tag: &str) -> Self {
        let unico = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let raiz = std::env::temp_dir().join(format!("frota-sync-{tag}-{}-{unico}", std::process::id()));
        fs::create_dir_all(&raiz).unwrap();
        let remoto = raiz.join("remoto.git");
        run_git(&raiz.to_string_lossy(), &["init", "-q", "--bare", "-b", "main", &remoto.to_string_lossy()]).unwrap();
        Self { raiz }
    }

    /// Clona o remoto em `nome`, com identidade local para os commits.
    fn clone(&self, nome: &str) -> String {
        let destino = self.raiz.join(nome);
        let remoto = format!("file://{}", self.raiz.join("remoto.git").to_string_lossy());
        run_git(&self.raiz.to_string_lossy(), &["clone", "-q", &remoto, &destino.to_string_lossy()]).unwrap();
        let cwd = destino.to_string_lossy().into_owned();
        run_git(&cwd, &["config", "user.email", "teste@frota.local"]).unwrap();
        run_git(&cwd, &["config", "user.name", "Teste"]).unwrap();
        run_git(&cwd, &["checkout", "-q", "-B", "main"]).unwrap();
        cwd
    }
}

impl Drop for Cenario {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.raiz);
    }
}

fn commit(cwd: &str, arquivo: &str, conteudo: &str, msg: &str) {
    fs::write(Path::new(cwd).join(arquivo), conteudo).unwrap();
    run_git(cwd, &["add", arquivo]).unwrap();
    run_git(cwd, &["commit", "-q", "-m", msg]).unwrap();
}

fn cabeca(cwd: &str) -> String {
    git(cwd, &["rev-parse", "HEAD"]).unwrap().trim().to_string()
}

#[test]
fn classifica_o_acesso_negado_do_github_pela_frase_real() {
    // Saída real de um push com a conta errada ativa no gh.
    let stderr = "remote: Repository not found.\nfatal: repository 'https://github.com/vinicius1209/frota.git/' not found";
    assert_eq!(classificar(stderr), "acesso");
}

/// Saídas reais do git 2.x com `LC_ALL=C`, colhidas de um remoto `file://`.
const PUSH_RECUSADO: &str = " ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'file:///tmp/frota-cap/r.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to";
const PULL_DIVERGIU: &str = "From file:///tmp/frota-cap/r
   cd6507c..77f4b56  main       -> origin/main
hint: Diverging branches can't be fast-forwarded, you need to either:
fatal: Not possible to fast-forward, aborting.";

#[test]
fn classifica_recusa_e_divergencia_pelas_saidas_reais() {
    assert_eq!(classificar(PUSH_RECUSADO), "recusado");
    assert_eq!(classificar(PULL_DIVERGIU), "divergiu");
    // Um hash com "403" no meio não é recusa de acesso.
    assert_eq!(classificar("From x\n   a403b12..77f4b56  main -> origin/main\nfatal: algo"), "outro");
    assert_eq!(classificar("fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403"), "acesso");
}

#[test]
fn o_dono_sai_da_url_do_github_em_https_e_ssh() {
    assert_eq!(dono_no_github("https://github.com/vinicius1209/frota.git").as_deref(), Some("vinicius1209"));
    assert_eq!(dono_no_github("git@github.com:vinicius1209/frota.git").as_deref(), Some("vinicius1209"));
    assert_eq!(dono_no_github("file:///tmp/remoto.git"), None);
}

#[test]
fn publicar_cria_a_branch_no_remoto_e_enviar_leva_os_commits() {
    let c = Cenario::new("publicar");
    let a = c.clone("a");
    commit(&a, "x.txt", "1\n", "primeiro");
    enviar_sync(&a, true).unwrap();
    commit(&a, "x.txt", "2\n", "segundo");
    enviar_sync(&a, false).unwrap();

    let b = c.clone("b");
    assert_eq!(cabeca(&b), cabeca(&a));
}

#[test]
fn push_recusado_por_commit_novo_no_remoto_vira_recusado_e_nunca_forca() {
    let c = Cenario::new("recusado");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    enviar_sync(&a, true).unwrap();
    let b = c.clone("b");
    commit(&b, "y.txt", "de b\n", "de b");
    enviar_sync(&b, false).unwrap();

    commit(&a, "z.txt", "de a\n", "de a");
    let erro = enviar_sync(&a, false).unwrap_err();
    assert_eq!(erro.tipo, "recusado", "{}", erro.detalhe);
    let c2 = c.clone("c");
    assert!(fs::read_to_string(Path::new(&c2).join("y.txt")).is_ok(), "o commit de b segue no remoto");
}

#[test]
fn trazer_so_avanca_e_divergencia_vira_divergiu_sem_mexer_em_nada() {
    let c = Cenario::new("divergiu");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    enviar_sync(&a, true).unwrap();
    let b = c.clone("b");
    commit(&b, "y.txt", "de b\n", "de b");
    enviar_sync(&b, false).unwrap();

    let antes = cabeca(&a);
    trazer_sync(&a, false).unwrap();
    assert_ne!(cabeca(&a), antes, "avançou");

    commit(&b, "y.txt", "de b 2\n", "de b 2");
    enviar_sync(&b, false).unwrap();
    commit(&a, "z.txt", "de a\n", "de a");
    let local = cabeca(&a);
    let erro = trazer_sync(&a, false).unwrap_err();
    assert_eq!(erro.tipo, "divergiu", "{}", erro.detalhe);
    assert_eq!(cabeca(&a), local);

    trazer_sync(&a, true).unwrap();
    enviar_sync(&a, false).unwrap();
}

#[test]
fn rebase_em_conflito_para_no_meio_mostra_os_arquivos_e_abortar_devolve() {
    let c = Cenario::new("conflito");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    enviar_sync(&a, true).unwrap();
    let b = c.clone("b");
    commit(&b, "x.txt", "de b\n", "de b");
    enviar_sync(&b, false).unwrap();
    commit(&a, "x.txt", "de a\n", "de a");
    let local = cabeca(&a);

    let erro = trazer_sync(&a, true).unwrap_err();
    assert_eq!(erro.tipo, "conflito", "{}", erro.detalhe);
    let estado = estado_sync(&a).unwrap();
    assert_eq!(estado.operacao.as_ref().map(|o| o.tipo.as_str()), Some("rebase"));
    assert_eq!(estado.conflitos, vec!["x.txt".to_string()]);

    operacao_sync(&a, false).unwrap();
    let estado = estado_sync(&a).unwrap();
    assert!(estado.operacao.is_none());
    assert_eq!(cabeca(&a), local);
}

#[test]
fn continuar_o_rebase_depois_de_resolver_termina_sem_abrir_editor() {
    let c = Cenario::new("continuar");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    enviar_sync(&a, true).unwrap();
    let b = c.clone("b");
    commit(&b, "x.txt", "de b\n", "de b");
    enviar_sync(&b, false).unwrap();
    commit(&a, "x.txt", "de a\n", "de a");
    assert!(trazer_sync(&a, true).is_err());

    fs::write(Path::new(&a).join("x.txt"), "resolvido\n").unwrap();
    run_git(&a, &["add", "x.txt"]).unwrap();
    operacao_sync(&a, true).unwrap();
    assert!(estado_sync(&a).unwrap().operacao.is_none());
    assert_eq!(fs::read_to_string(Path::new(&a).join("x.txt")).unwrap(), "resolvido\n");
}

#[test]
fn estado_sabe_quando_o_remoto_foi_buscado() {
    let c = Cenario::new("busca");
    let a = c.clone("a");
    commit(&a, "x.txt", "1\n", "um");
    enviar_sync(&a, true).unwrap();
    buscar_sync(&a).unwrap();
    let estado = estado_sync(&a).unwrap();
    assert!(estado.ultima_busca.is_some());
    assert!(estado.tem_remoto);
    assert!(!estado.remoto_github);
}

#[test]
fn trocar_guardando_leva_as_alteracoes_para_o_stash_com_o_destino_no_nome() {
    let c = Cenario::new("trocar");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    trocar_sync(&a, "outra", true, false).unwrap();
    trocar_sync(&a, "main", false, false).unwrap();
    fs::write(Path::new(&a).join("x.txt"), "mexido\n").unwrap();
    fs::write(Path::new(&a).join("novo.txt"), "novo\n").unwrap();

    trocar_sync(&a, "outra", false, true).unwrap();
    assert_eq!(fs::read_to_string(Path::new(&a).join("x.txt")).unwrap(), "base\n");
    assert!(!Path::new(&a).join("novo.txt").exists(), "o não rastreado foi junto");
    let guardadas = guardadas_sync(&a).unwrap();
    assert_eq!(guardadas.len(), 1);
    assert!(guardadas[0].mensagem.contains("main ao trocar para outra"), "{}", guardadas[0].mensagem);
    assert_eq!(estado_sync(&a).unwrap().guardadas, 1);

    trocar_sync(&a, "main", false, false).unwrap();
    recuperar_sync(&a, "stash@{0}", false).unwrap();
    assert_eq!(fs::read_to_string(Path::new(&a).join("x.txt")).unwrap(), "mexido\n");
    assert!(guardadas_sync(&a).unwrap().is_empty());
}

#[test]
fn trocar_levando_alteracao_que_conflita_e_recusado_sem_perder_nada() {
    let c = Cenario::new("levar");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    trocar_sync(&a, "outra", true, false).unwrap();
    commit(&a, "x.txt", "na outra\n", "na outra");
    trocar_sync(&a, "main", false, false).unwrap();
    fs::write(Path::new(&a).join("x.txt"), "mexido\n").unwrap();

    let erro = trocar_sync(&a, "outra", false, false).unwrap_err();
    assert_eq!(erro.tipo, "alteracoes-locais", "{}", erro.detalhe);
    assert_eq!(fs::read_to_string(Path::new(&a).join("x.txt")).unwrap(), "mexido\n");
}

#[test]
fn nome_de_branch_que_parece_opcao_e_recusado() {
    let c = Cenario::new("nome");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    assert!(trocar_sync(&a, "--orphan", true, false).is_err());
    assert!(trocar_sync(&a, "com espaço", true, false).is_err());
}

#[test]
fn branches_vem_da_mais_recente_e_marcam_a_atual() {
    let c = Cenario::new("branches");
    let a = c.clone("a");
    commit(&a, "x.txt", "base\n", "base");
    trocar_sync(&a, "outra", true, false).unwrap();
    let lista = branches_sync(&a).unwrap();
    let nomes: Vec<_> = lista.iter().map(|b| b.nome.as_str()).collect();
    assert!(nomes.contains(&"main") && nomes.contains(&"outra"));
    assert_eq!(lista.iter().filter(|b| b.atual).map(|b| b.nome.as_str()).collect::<Vec<_>>(), vec!["outra"]);
}

#[test]
fn historico_marca_o_que_nao_foi_enviado_e_desfazer_so_vale_para_ele() {
    let c = Cenario::new("historico");
    let a = c.clone("a");
    assert!(historico_sync(&a, 20).unwrap().is_empty(), "repositório sem commit tem histórico vazio");
    commit(&a, "x.txt", "1\n", "enviado");
    enviar_sync(&a, true).unwrap();
    commit(&a, "x.txt", "2\n", "local");

    let h = historico_sync(&a, 20).unwrap();
    assert_eq!(h.iter().map(|c| (c.mensagem.as_str(), c.nao_enviado)).collect::<Vec<_>>(), vec![("local", true), ("enviado", false)]);

    desfazer_sync(&a).unwrap();
    assert_eq!(fs::read_to_string(Path::new(&a).join("x.txt")).unwrap(), "2\n", "a alteração volta para a área de trabalho");
    assert_eq!(historico_sync(&a, 20).unwrap().len(), 1);

    let erro = desfazer_sync(&a).unwrap_err();
    assert!(erro.detalhe.contains("já foi enviado"), "{}", erro.detalhe);
}

#[test]
fn referencia_de_stash_so_aceita_o_formato_do_git() {
    assert!(referencia_valida("stash@{0}"));
    assert!(referencia_valida("stash@{12}"));
    assert!(!referencia_valida("stash@{0}; rm"));
    assert!(!referencia_valida("--all"));
    assert!(!referencia_valida("stash@{}"));
}

#[test]
fn detalhes_e_diff_do_commit_leem_metadados_arquivos_e_patch() {
    let c = Cenario::new("detalhes-diff");
    let a = c.clone("a");
    commit(&a, "x.txt", "linha 1\nlinha 2\n", "primeiro commit\n\nEste é o corpo detalhado.");
    commit(&a, "novo.txt", "adicionado\n", "segundo commit");

    let h = historico_sync(&a, 10).unwrap();
    assert_eq!(h.len(), 2);
    let primeiro_hash = &h[1].hash;
    let segundo_hash = &h[0].hash;

    // Detalhes do primeiro commit
    let det = detalhes_do_commit_sync(&a, primeiro_hash).unwrap();
    assert_eq!(det.mensagem, "primeiro commit");
    assert_eq!(det.corpo, "Este é o corpo detalhado.");
    assert_eq!(det.autor, "Teste");
    assert_eq!(det.autor_email, "teste@frota.local");
    assert_eq!(det.arquivos.len(), 1);
    assert_eq!(det.arquivos[0].caminho, "x.txt");
    assert_eq!(det.arquivos[0].status, "added");
    assert_eq!(det.arquivos[0].additions, 2);
    assert_eq!(det.arquivos[0].deletions, 0);

    // Diff do segundo commit
    let patch = diff_do_commit_sync(&a, segundo_hash).unwrap();
    assert!(patch.contains("diff --git a/novo.txt b/novo.txt"));
    assert!(patch.contains("+adicionado"));

    // Hash inválido retorna erro
    assert!(detalhes_do_commit_sync(&a, "invalido").is_err());
    assert!(diff_do_commit_sync(&a, "invalido").is_err());
}
