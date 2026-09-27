use super::*;
use std::path::PathBuf;

/// Resposta HTTP colhida no spike de MCP (spikes/mcp-auth), CRLF de verdade.
const CRLF_REAL: &[u8] = include_bytes!("../testdata/edicao/crlf-resposta-http.txt");
/// As quatro primeiras linhas reais de `app/src/lib/db/schema.ts`, LF.
const LF_REAL: &str = "import type Database from \"@tauri-apps/plugin-sql\"\n\n/** ALTER idempotente: engole só a coluna já existente; erro real propaga. */\nexport async function addColumn(db: Database, sql: string): Promise<void> {\n";

struct Fixture {
    base: PathBuf,
    raiz: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

fn fixture(tag: &str) -> Fixture {
    let base = std::env::temp_dir().join(format!("frota-edicao-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let raiz = base.join("projeto");
    std::fs::create_dir_all(&raiz).unwrap();
    let base = std::fs::canonicalize(&base).unwrap();
    let raiz = std::fs::canonicalize(&raiz).unwrap();
    Fixture { base, raiz }
}

fn raiz(f: &Fixture) -> &str {
    f.raiz.to_str().unwrap()
}

fn escrever(f: &Fixture, rel: &str, bytes: &[u8]) -> PathBuf {
    let p = f.raiz.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, bytes).unwrap();
    p
}

fn sobras_tmp(pasta: &Path) -> Vec<String> {
    std::fs::read_dir(pasta)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".frota-") && n.ends_with(".tmp"))
        .collect()
}

#[test]
fn abre_lf_inteiro_com_versao_dos_bytes_crus() {
    let f = fixture("lf");
    escrever(&f, "src/schema.ts", LF_REAL.as_bytes());
    let a = abrir_em(raiz(&f), "src/schema.ts", None).unwrap();
    assert_eq!(a.conteudo, LF_REAL);
    assert_eq!(a.fim_de_linha, FimDeLinha::Lf);
    assert!(!a.bom);
    assert!(a.gravavel);
    assert_eq!(a.motivo, None);
    assert_eq!(a.versao, blake3::hash(LF_REAL.as_bytes()).to_hex().to_string());
    assert!(a.caminho_absoluto.ends_with("projeto/src/schema.ts"));
}

#[test]
fn abre_crlf_real_como_crlf() {
    let f = fixture("crlf");
    escrever(&f, "resposta.txt", CRLF_REAL);
    let a = abrir_em(raiz(&f), "resposta.txt", None).unwrap();
    assert_eq!(a.fim_de_linha, FimDeLinha::Crlf);
    assert!(a.gravavel);
    assert_eq!(a.conteudo.as_bytes(), CRLF_REAL);
}

#[test]
fn bom_sai_do_conteudo_mas_entra_na_versao() {
    let f = fixture("bom");
    let mut bytes = BOM.to_vec();
    bytes.extend_from_slice(LF_REAL.as_bytes());
    escrever(&f, "com-bom.ts", &bytes);
    let a = abrir_em(raiz(&f), "com-bom.ts", None).unwrap();
    assert!(a.bom);
    assert_eq!(a.conteudo, LF_REAL);
    assert_eq!(a.versao, blake3::hash(&bytes).to_hex().to_string());
}

#[test]
fn arquivo_sem_quebra_e_lf() {
    let f = fixture("sem-quebra");
    escrever(&f, "um.txt", b"uma linha so");
    let a = abrir_em(raiz(&f), "um.txt", None).unwrap();
    assert_eq!(a.fim_de_linha, FimDeLinha::Lf);
    assert!(a.gravavel);
}

#[test]
fn fins_misturados_ou_cr_solto_abrem_so_leitura() {
    let f = fixture("misturado");
    escrever(&f, "misto.txt", b"a\r\nb\nc\r\n");
    escrever(&f, "mac.txt", b"a\rb\r");
    for rel in ["misto.txt", "mac.txt"] {
        let a = abrir_em(raiz(&f), rel, None).unwrap();
        assert!(!a.gravavel, "{rel}");
        assert_eq!(a.motivo.as_deref(), Some(MISTURADOS), "{rel}");
    }
}

#[test]
fn acima_do_limite_abre_so_leitura_com_o_tamanho() {
    let f = fixture("grande");
    let grande = vec![b'x'; (LIMITE_EDITAVEL + 1) as usize];
    escrever(&f, "grande.txt", &grande);
    let a = abrir_em(raiz(&f), "grande.txt", None).unwrap();
    assert!(!a.gravavel);
    assert_eq!(a.motivo.as_deref(), Some("Grande demais para editar aqui (2,0 MB)"));
    assert_eq!(a.versao, blake3::hash(&grande).to_hex().to_string());
}

#[test]
fn legivel_fora_das_pastas_abre_so_leitura_e_nao_salva() {
    // Os anexos são legíveis (scoped_file_path) e NÃO graváveis: é o mesmo caso
    // de `~/.claude` e do brain, sem mexer no HOME do processo de teste.
    let f = fixture("anexos");
    let anexos = f.base.join("attachments");
    std::fs::create_dir_all(&anexos).unwrap();
    let alvo = anexos.join("nota.md");
    std::fs::write(&alvo, LF_REAL).unwrap();
    let p = alvo.to_str().unwrap();
    let a = abrir_em(raiz(&f), p, Some(&anexos)).unwrap();
    assert!(!a.gravavel);
    assert_eq!(a.motivo.as_deref(), Some(FORA_DAS_PASTAS));
    let r = salvar_em(raiz(&f), p, "x", &a.versao, FimDeLinha::Lf, false, Some(&anexos));
    assert_eq!(r, Err(ErroAoSalvar::ForaDasPastas));
    assert_eq!(std::fs::read_to_string(&alvo).unwrap(), LF_REAL);
}

#[test]
fn extra_dir_vinculado_e_gravavel() {
    let f = fixture("extra");
    let extra = f.base.join("vizinho");
    std::fs::create_dir_all(&extra).unwrap();
    escrever(&f, ".frota/config.toml", b"extra_dirs = [\"../vizinho\"]\n");
    let alvo = extra.join("leia.md");
    std::fs::write(&alvo, LF_REAL).unwrap();
    let p = alvo.to_str().unwrap();
    let a = abrir_em(raiz(&f), p, None).unwrap();
    assert!(a.gravavel, "{:?}", a.motivo);
    let nova = salvar_em(raiz(&f), p, "novo\n", &a.versao, FimDeLinha::Lf, false, None).unwrap();
    assert_eq!(std::fs::read_to_string(&alvo).unwrap(), "novo\n");
    assert_eq!(nova, blake3::hash(b"novo\n").to_hex().to_string());
}

#[test]
fn salvar_sem_editar_devolve_o_arquivo_byte_a_byte() {
    let f = fixture("ida-e-volta");
    let mut com_bom = BOM.to_vec();
    com_bom.extend_from_slice(CRLF_REAL);
    let p = escrever(&f, "resposta.txt", &com_bom);
    let a = abrir_em(raiz(&f), "resposta.txt", None).unwrap();
    let v = salvar_em(raiz(&f), "resposta.txt", &a.conteudo, &a.versao, a.fim_de_linha, a.bom, None)
        .unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), com_bom);
    assert_eq!(v, a.versao);
}

#[test]
fn salvar_crlf_editado_muda_so_a_linha() {
    let f = fixture("crlf-editado");
    let p = escrever(&f, "resposta.txt", CRLF_REAL);
    let a = abrir_em(raiz(&f), "resposta.txt", None).unwrap();
    let novo = a.conteudo.replacen("HTTP/2 401", "HTTP/2 403", 1);
    salvar_em(raiz(&f), "resposta.txt", &novo, &a.versao, FimDeLinha::Crlf, false, None).unwrap();
    let depois = std::fs::read(&p).unwrap();
    assert_eq!(depois.len(), CRLF_REAL.len());
    let diferentes = depois.iter().zip(CRLF_REAL).filter(|(a, b)| a != b).count();
    assert_eq!(diferentes, 1);
}

#[test]
fn versao_velha_da_conflito_e_nao_toca_no_disco() {
    let f = fixture("conflito");
    let p = escrever(&f, "a.ts", LF_REAL.as_bytes());
    let a = abrir_em(raiz(&f), "a.ts", None).unwrap();
    // o agente grava no meio
    std::fs::write(&p, b"do agente\n").unwrap();
    let r = salvar_em(raiz(&f), "a.ts", "meu\n", &a.versao, FimDeLinha::Lf, false, None);
    let esperado = blake3::hash(b"do agente\n").to_hex().to_string();
    assert_eq!(r, Err(ErroAoSalvar::Conflito { versao: esperado }));
    assert_eq!(std::fs::read(&p).unwrap(), b"do agente\n");
    assert!(sobras_tmp(&f.raiz).is_empty());
}

#[test]
fn escape_da_raiz_e_symlink_para_fora_sao_barrados() {
    let f = fixture("escape");
    let fora = f.base.join("fora.txt");
    std::fs::write(&fora, b"fora\n").unwrap();
    let versao = blake3::hash(b"fora\n").to_hex().to_string();
    let r = salvar_em(raiz(&f), "../fora.txt", "x", &versao, FimDeLinha::Lf, false, None);
    assert_eq!(r, Err(ErroAoSalvar::ForaDasPastas));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&fora, f.raiz.join("link.txt")).unwrap();
        let r = salvar_em(raiz(&f), "link.txt", "x", &versao, FimDeLinha::Lf, false, None);
        assert_eq!(r, Err(ErroAoSalvar::ForaDasPastas));
    }
    assert_eq!(std::fs::read(&fora).unwrap(), b"fora\n");
}

#[test]
fn arquivo_apagado_da_sumiu_e_versao_none() {
    let f = fixture("sumiu");
    let p = escrever(&f, "a.ts", b"a\n");
    let a = abrir_em(raiz(&f), "a.ts", None).unwrap();
    std::fs::remove_file(&p).unwrap();
    let r = salvar_em(raiz(&f), "a.ts", "b\n", &a.versao, FimDeLinha::Lf, false, None);
    assert_eq!(r, Err(ErroAoSalvar::Sumiu));
    assert_eq!(versao_em(raiz(&f), "a.ts", None), Ok(None));
}

#[test]
fn versao_no_disco_acompanha_a_mudanca() {
    let f = fixture("versao");
    let p = escrever(&f, "a.ts", b"a\n");
    let antes = versao_em(raiz(&f), "a.ts", None).unwrap().unwrap();
    std::fs::write(&p, b"b\n").unwrap();
    let depois = versao_em(raiz(&f), "a.ts", None).unwrap().unwrap();
    assert_ne!(antes, depois);
    assert_eq!(depois, blake3::hash(b"b\n").to_hex().to_string());
}

#[test]
fn fins_inconsistentes_sao_recusados_sem_tocar_no_disco() {
    let f = fixture("inconsistente");
    let p = escrever(&f, "a.ts", b"a\n");
    let a = abrir_em(raiz(&f), "a.ts", None).unwrap();
    let r = salvar_em(raiz(&f), "a.ts", "a\r\nb\n", &a.versao, FimDeLinha::Lf, false, None);
    assert!(matches!(r, Err(ErroAoSalvar::Falhou { .. })));
    let r = salvar_em(raiz(&f), "a.ts", "a\nb\r\n", &a.versao, FimDeLinha::Crlf, false, None);
    assert!(matches!(r, Err(ErroAoSalvar::Falhou { .. })));
    assert_eq!(std::fs::read(&p).unwrap(), b"a\n");
}

#[cfg(unix)]
#[test]
fn permissao_do_arquivo_sobrevive_ao_salvar() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture("permissao");
    let p = escrever(&f, "rodar.sh", b"#!/bin/sh\necho oi\n");
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    let a = abrir_em(raiz(&f), "rodar.sh", None).unwrap();
    salvar_em(raiz(&f), "rodar.sh", "#!/bin/sh\necho ola\n", &a.versao, FimDeLinha::Lf, false, None)
        .unwrap();
    let modo = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
    assert_eq!(modo, 0o755);
}

#[cfg(unix)]
#[test]
fn arquivo_protegido_abre_so_leitura() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture("protegido");
    let p = escrever(&f, "trava.txt", b"x\n");
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o444)).unwrap();
    let a = abrir_em(raiz(&f), "trava.txt", None).unwrap();
    assert!(!a.gravavel);
    assert_eq!(a.motivo.as_deref(), Some(PROTEGIDO));
    let r = salvar_em(raiz(&f), "trava.txt", "y\n", &a.versao, FimDeLinha::Lf, false, None);
    assert_eq!(r, Err(ErroAoSalvar::SoLeitura { motivo: PROTEGIDO.into() }));
}

#[cfg(unix)]
#[test]
fn erro_de_escrita_nao_deixa_temporario() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture("pasta-trancada");
    let p = escrever(&f, "trancada/a.txt", b"a\n");
    let pasta = p.parent().unwrap().to_path_buf();
    let a = abrir_em(raiz(&f), "trancada/a.txt", None).unwrap();
    std::fs::set_permissions(&pasta, std::fs::Permissions::from_mode(0o555)).unwrap();
    let r = salvar_em(raiz(&f), "trancada/a.txt", "b\n", &a.versao, FimDeLinha::Lf, false, None);
    std::fs::set_permissions(&pasta, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(matches!(r, Err(ErroAoSalvar::Falhou { .. })), "{r:?}");
    assert_eq!(std::fs::read(&p).unwrap(), b"a\n");
    assert!(sobras_tmp(&pasta).is_empty());
}

#[test]
fn erro_serializa_com_o_tipo_que_o_front_le() {
    let j = |e: ErroAoSalvar| serde_json::to_value(e).unwrap();
    assert_eq!(j(ErroAoSalvar::Sumiu), serde_json::json!({ "tipo": "sumiu" }));
    assert_eq!(j(ErroAoSalvar::ForaDasPastas), serde_json::json!({ "tipo": "fora-das-pastas" }));
    assert_eq!(
        j(ErroAoSalvar::Conflito { versao: "v".into() }),
        serde_json::json!({ "tipo": "conflito", "versao": "v" })
    );
    assert_eq!(
        j(ErroAoSalvar::SoLeitura { motivo: "m".into() }),
        serde_json::json!({ "tipo": "so-leitura", "motivo": "m" })
    );
}
