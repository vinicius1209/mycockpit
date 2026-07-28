//! `.mycockpit/` — a pasta do PRÓPRIO app no projeto, o análogo de `.claude/`
//! sem depender de fornecedor. Mora aqui:
//!   - `config.toml`   — config por projeto (modo / helper / permissão / dirs);
//!   - `instructions.md` — a DOUTRINA do projeto, que o app injeta no prompt de
//!     qualquer CLI (ver `doctrine.ts`). É o que torna a instrução agnóstica:
//!     `CLAUDE.md` só o Claude Code lê, `AGENTS.md` só o Codex, e o agy não lê
//!     nenhum dos dois — este arquivo vale pros três porque quem injeta é o app;
//!   - `agents/*.md`   — as personas (Onda 3);
//!   - `context/`      — export do fio de conversa (local, descartável).
//!
//! O arquivo é sempre a FONTE DE VERDADE; o SQLite do app vira cache. Edição do
//! TOML via toml_edit preserva comentários/formatação.
//!
//! Git: a pasta nasceu 100% local (`.gitignore` = `*`). Desde a decisão de
//! jul/2026 ela é SELETIVA — doutrina e personas são versionadas (revisáveis em
//! PR, viajam no clone), o resto segue fora. Ver `MYCOCKPIT_GITIGNORE`.

use serde::Serialize;
use std::path::Path;
use toml_edit::{value, DocumentMut};

/// Conteúdo do `.mycockpit/.gitignore`. Ignora tudo e reabre exceções: a ordem
/// importa (git precisa "desingorar" a PASTA antes dos arquivos dentro dela,
/// senão o `*` — que casa em qualquer nível — continua vencendo).
const MYCOCKPIT_GITIGNORE: &str = "\
# Pasta do MyCockpit. Local por padrão: contexto exportado, missões e worktrees
# não vão pro git. As exceções abaixo são VERSIONADAS de propósito — a doutrina
# e as personas do projeto devem viajar no clone e ser revisáveis em PR.
*
!.gitignore
!instructions.md
!agents/
!agents/*.md
";

/// Conteúdo do `.gitignore` legado (a pasta inteira local). Só ele é elegível a
/// upgrade automático — qualquer outro conteúdo é edição AUTORAL e fica de pé.
const LEGACY_GITIGNORE: &str = "*";

/// Cria `dir` e garante o `.gitignore` do `.mycockpit/`: escreve se faltar,
/// faz upgrade se ainda for o `*` legado, e NÃO TOCA se o usuário editou.
fn ensure_mycockpit_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gi = dir.join(".gitignore");
    match std::fs::read_to_string(&gi) {
        Ok(cur) if cur.trim() == LEGACY_GITIGNORE => {
            crate::fsx::write_atomic(&gi, MYCOCKPIT_GITIGNORE)
        }
        Ok(_) => Ok(()), // conteúdo autoral (ou já novo): preservado
        Err(_) => crate::fsx::write_atomic(&gi, MYCOCKPIT_GITIGNORE),
    }
}

#[derive(Serialize, Default)]
pub struct McConfig {
    /// `.mycockpit/config.toml` existe no disco?
    pub exists: bool,
    pub mode: Option<String>,
    /// "haiku" | "off" (None = chave ausente → front aplica default).
    pub helper: Option<String>,
    /// leitura | padrao | liberado
    pub permission: Option<String>,
    /// Pastas extras liberadas ao agent (viram `--add-dir`). Valores CRUS como
    /// escritos no TOML (relativos ou absolutos) — a resolução p/ o spawn é feita
    /// por `resolve_extra_dirs`.
    #[serde(default)]
    pub extra_dirs: Vec<String>,
}

/// Lê um array de strings do doc TOML (vazio se ausente/tipo errado).
fn toml_str_array(doc: &DocumentMut, key: &str) -> Vec<String> {
    doc.get(key)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn read_mycockpit_config(path: String) -> Result<McConfig, String> {
    let cfg = Path::new(&path).join(".mycockpit").join("config.toml");
    let Ok(text) = std::fs::read_to_string(&cfg) else {
        return Ok(McConfig::default()); // exists: false
    };
    // TOML inválido NÃO vira "tudo default" em silêncio: o arquivo é editável à
    // mão; mascarar um typo esconderia a config real (o front loga o warn).
    let doc = text
        .parse::<DocumentMut>()
        .map_err(|e| format!("config.toml inválido: {e}"))?;
    let get = |k: &str| doc.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Ok(McConfig {
        exists: true,
        mode: get("mode"),
        helper: get("helper"),
        permission: get("permission"),
        extra_dirs: toml_str_array(&doc, "extra_dirs"),
    })
}

/// Resolve as pastas extras liberadas para um `cwd` (que pode ser um worktree
/// sob `.mycockpit/worktrees/…`): sobe a árvore até achar `.mycockpit/config.toml`,
/// resolve paths relativos contra a RAIZ do projeto, canoniza e descarta os que
/// não existem. Chamado no spawn (`run_agent`) → vira `--add-dir` em cada adapter.
pub fn resolve_extra_dirs(cwd: &str) -> Vec<String> {
    let mut cur: &Path = Path::new(cwd);
    loop {
        let cfg = cur.join(".mycockpit").join("config.toml");
        if cfg.is_file() {
            return read_and_resolve(&cfg, cur);
        }
        match cur.parent() {
            Some(p) => cur = p,
            None => return Vec::new(),
        }
    }
}

fn read_and_resolve(cfg: &Path, project_root: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(cfg) else {
        return Vec::new();
    };
    let Ok(doc) = text.parse::<DocumentMut>() else {
        return Vec::new();
    };
    toml_str_array(&doc, "extra_dirs")
        .iter()
        .filter_map(|s| {
            let p = Path::new(s);
            let abs = if p.is_absolute() {
                p.to_path_buf()
            } else {
                project_root.join(p)
            };
            std::fs::canonicalize(&abs).ok()
        })
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Escreve as chaves fornecidas em `.mycockpit/config.toml`, criando a pasta
/// (com `.gitignore` = `*`) e o arquivo se não existirem. Round-trip via toml_edit.
#[tauri::command]
pub fn write_mycockpit_config(
    path: String,
    mode: Option<String>,
    helper: Option<String>,
    permission: Option<String>,
    extra_dirs: Option<Vec<String>>,
) -> Result<(), String> {
    let dir = Path::new(&path).join(".mycockpit");
    ensure_mycockpit_dir(&dir)?;

    let cfg = dir.join("config.toml");
    let mut doc = match std::fs::read_to_string(&cfg) {
        // arquivo EXISTE mas não parseia: NÃO sobrescreve o conteúdo autoral
        // (comentários/chaves) com um doc novo; o usuário conserta o TOML antes.
        Ok(t) => t
            .parse::<DocumentMut>()
            .map_err(|e| format!("config.toml inválido, não vou sobrescrever: {e}"))?,
        Err(_) => {
            let mut d = DocumentMut::new();
            d["version"] = value(1);
            d
        }
    };

    if let Some(m) = mode {
        doc["mode"] = value(m);
    }
    if let Some(h) = helper {
        doc["helper"] = value(h);
    }
    if let Some(p) = permission {
        doc["permission"] = value(p);
    }
    if let Some(dirs) = extra_dirs {
        // lista vazia → remove a chave (config limpa); senão grava o array.
        if dirs.is_empty() {
            doc.remove("extra_dirs");
        } else {
            let mut arr = toml_edit::Array::new();
            for d in dirs {
                arr.push(d);
            }
            doc["extra_dirs"] = value(arr);
        }
    }

    crate::fsx::write_atomic(&cfg, &doc.to_string())?;
    Ok(())
}

// ---------------- Doutrina do projeto (.mycockpit/instructions.md) ----------------
//
// O app INJETA este arquivo no prompt (bloco no 1º turno, como a persona), então
// ele vale para claude, codex e agy igualmente. Não confundir com `CLAUDE.md` /
// `AGENTS.md`: aqueles são lidos pela própria CLI, cada um só pelo seu dono, e o
// app nunca os injeta — só os inventaria no painel.

/// Nome do arquivo de doutrina dentro de `.mycockpit/`.
pub const DOCTRINE_FILE: &str = "instructions.md";

#[derive(Serialize, Default)]
pub struct Doctrine {
    pub exists: bool,
    /// Conteúdo INTEGRAL (o editor grava de volta o que leu — truncar aqui
    /// perderia texto do usuário no round-trip). O corte p/ o prompt é no front.
    pub content: String,
    pub bytes: usize,
}

#[tauri::command]
pub fn read_project_doctrine(path: String) -> Result<Doctrine, String> {
    let root = crate::skills::validate_project_path(&path)?;
    let f = root.join(".mycockpit").join(DOCTRINE_FILE);
    match std::fs::read_to_string(&f) {
        Ok(content) => Ok(Doctrine {
            exists: true,
            bytes: content.len(),
            content,
        }),
        // ausente é estado NORMAL (projeto sem doutrina) → exists: false.
        // Erro de leitura real (permissão) também cai aqui; o painel oferece
        // criar, e o write dirá a verdade se o disco estiver bloqueado.
        Err(_) => Ok(Doctrine::default()),
    }
}

/// Nomes aceitos como SEMENTE da doutrina — lista FECHADA: o parâmetro vira
/// caminho, e nome livre aqui seria leitura arbitrária de disco pela UI.
const SEED_FILES: [&str; 2] = ["CLAUDE.md", "AGENTS.md"];

/// Lê INTEGRALMENTE um arquivo de instrução de CLI, p/ semear a 1ª doutrina.
/// Precisa ser um comando próprio: o inventário do painel (read_project_context)
/// trunca em 8k pra preview, e semear com texto cortado perderia regra em
/// silêncio — o pior desfecho possível num arquivo de regras.
#[tauri::command]
pub fn read_doctrine_seed(path: String, name: String) -> Result<String, String> {
    if !SEED_FILES.contains(&name.as_str()) {
        return Err(format!("'{name}' não é um arquivo de instrução conhecido"));
    }
    let root = crate::skills::validate_project_path(&path)?;
    std::fs::read_to_string(root.join(&name)).map_err(|e| e.to_string())
}

/// Grava a doutrina (write atômico). Conteúdo vazio NÃO apaga o arquivo: limpar
/// o texto no editor é reversível, apagar arquivo do usuário não seria — e o
/// bloco de prompt já ignora doutrina em branco.
#[tauri::command]
pub fn write_project_doctrine(path: String, content: String) -> Result<(), String> {
    let root = crate::skills::validate_project_path(&path)?;
    let dir = root.join(".mycockpit");
    ensure_mycockpit_dir(&dir)?;
    crate::fsx::write_atomic(&dir.join(DOCTRINE_FILE), &content)
}

// ---------------- Export do contexto de conversa ----------------
//
// O frontend guarda a conversa (itens JSON) no SQLite e RENDERIZA o markdown;
// aqui só gravamos com segurança em `.mycockpit/context/<conv_id>.md` — arquivo
// legível por qualquer code agent, referenciado pelo caminho relativo no prompt.

/// Máximo de exports retidos em `.mycockpit/context/` (limpeza best-effort).
const MAX_CONTEXT_FILES: usize = 30;

/// conv_id vira NOME DE ARQUIVO: só `[a-zA-Z0-9_-]`, senão Err — nada de
/// traversal, espaço ou ponto (sem `..`, sem extensão disfarçada).
fn safe_conv_id(conv_id: &str) -> Result<&str, String> {
    if conv_id.is_empty() {
        return Err("conv_id vazio".into());
    }
    if !conv_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!(
            "conv_id inválido: '{conv_id}' (use só letras, números, '-' e '_')"
        ));
    }
    Ok(conv_id)
}

/// Garante `dir` existente com um `.gitignore` auto-ignorante (`*`) dentro —
/// mesmo padrão do `.mycockpit/` acima: 100% local, nunca vaza pro git.
fn ensure_ignored_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Se sobrar mais que `keep` arquivos `.md` no dir, apaga os mais ANTIGOS por
/// mtime. Best-effort: qualquer erro (mtime ilegível, remove falhou) é ignorado
/// — limpeza nunca pode falhar o export.
fn trim_old_exports(dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut mds: Vec<(std::time::SystemTime, std::path::PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("md") {
                return None;
            }
            let mtime = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((mtime, p))
        })
        .collect();
    if mds.len() <= keep {
        return;
    }
    mds.sort_by_key(|(t, _)| *t); // mais antigo primeiro
    for (_, p) in mds.iter().take(mds.len() - keep) {
        let _ = std::fs::remove_file(p);
    }
}

/// Exporta o markdown (renderizado pelo front) da conversa pra
/// `.mycockpit/context/<conv_id>.md` (write atômico, sobrescreve re-export).
/// Devolve o caminho RELATIVO — é o que vai pro prompt do agent.
#[tauri::command]
pub fn export_conv_context(
    project_path: String,
    conv_id: String,
    markdown: String,
) -> Result<String, String> {
    let id = safe_conv_id(&conv_id)?;
    let root = crate::skills::validate_project_path(&project_path)?;
    // `.mycockpit/` também ganha o .gitignore (o export pode rodar antes de
    // qualquer config ser escrita — padrão do write_mycockpit_config).
    ensure_mycockpit_dir(&root.join(".mycockpit"))?;
    let dir = root.join(".mycockpit").join("context");
    ensure_ignored_dir(&dir)?;
    crate::fsx::write_atomic(&dir.join(format!("{id}.md")), &markdown)?;
    trim_old_exports(&dir, MAX_CONTEXT_FILES);
    Ok(format!(".mycockpit/context/{id}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pasta de teste com um projeto plausível (validate_project_path exige que
    /// o caminho exista e seja um diretório).
    fn tmp_project(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("mc-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn gitignore_novo_versiona_doutrina_e_personas() {
        let tmp = tmp_project("gi-novo");
        let dir = tmp.join(".mycockpit");
        ensure_mycockpit_dir(&dir).unwrap();
        let gi = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        // ignora tudo…
        assert!(gi.lines().any(|l| l == "*"));
        // …menos a doutrina e as personas (a PASTA precisa vir antes dos .md).
        let pos = |needle: &str| gi.lines().position(|l| l == needle);
        assert!(pos("!instructions.md").is_some());
        assert!(pos("!agents/").unwrap() < pos("!agents/*.md").unwrap());
        // o próprio .gitignore tem que ser rastreável, senão a regra não viaja.
        assert!(pos("!.gitignore").is_some());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn gitignore_legado_ganha_upgrade_mas_edicao_autoral_fica_de_pe() {
        let tmp = tmp_project("gi-upgrade");
        let dir = tmp.join(".mycockpit");
        std::fs::create_dir_all(&dir).unwrap();

        // legado exato ("*") → upgrade (projetos que já rodaram o app antigo).
        std::fs::write(dir.join(".gitignore"), "*\n").unwrap();
        ensure_mycockpit_dir(&dir).unwrap();
        assert!(std::fs::read_to_string(dir.join(".gitignore"))
            .unwrap()
            .contains("!instructions.md"));

        // conteúdo AUTORAL → intocado (não é nosso direito reescrever).
        let autoral = "*\n!minhas-notas.md\n";
        std::fs::write(dir.join(".gitignore"), autoral).unwrap();
        ensure_mycockpit_dir(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join(".gitignore")).unwrap(),
            autoral
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn doutrina_round_trip() {
        let tmp = tmp_project("doutrina");
        let pp = tmp.to_string_lossy().to_string();

        // ausente = estado normal, não erro.
        let d = read_project_doctrine(pp.clone()).unwrap();
        assert!(!d.exists);
        assert_eq!(d.content, "");

        let texto = "# Regras\n\n- Testes em pt-BR.\n";
        write_project_doctrine(pp.clone(), texto.into()).unwrap();
        let d = read_project_doctrine(pp.clone()).unwrap();
        assert!(d.exists);
        assert_eq!(d.content, texto, "round-trip INTEGRAL (nada de truncar)");
        assert_eq!(d.bytes, texto.len());

        // escrever a doutrina também instala o .gitignore seletivo (o arquivo
        // precisa ser rastreável desde o 1º save, senão nasce ignorado).
        assert!(std::fs::read_to_string(tmp.join(".mycockpit").join(".gitignore"))
            .unwrap()
            .contains("!instructions.md"));

        // limpar o texto NÃO apaga o arquivo (limpar é reversível; apagar não).
        write_project_doctrine(pp.clone(), String::new()).unwrap();
        let d = read_project_doctrine(pp).unwrap();
        assert!(d.exists);
        assert_eq!(d.bytes, 0);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn semente_le_integral_e_so_nomes_conhecidos() {
        let tmp = tmp_project("semente");
        let pp = tmp.to_string_lossy().to_string();
        // 20k > os 8k que o inventário do painel trunca pra preview.
        let grande = "r".repeat(20_000);
        std::fs::write(tmp.join("CLAUDE.md"), &grande).unwrap();

        let lido = read_doctrine_seed(pp.clone(), "CLAUDE.md".into()).unwrap();
        assert_eq!(lido.len(), 20_000, "semente NÃO pode vir cortada");

        // nome fora da lista fechada não vira caminho (nem existindo no disco).
        std::fs::write(tmp.join("segredo.md"), "x").unwrap();
        assert!(read_doctrine_seed(pp.clone(), "segredo.md".into()).is_err());
        assert!(read_doctrine_seed(pp.clone(), "../fora.md".into()).is_err());
        // conhecido mas ausente = erro de leitura (a UI só oferece o que existe).
        assert!(read_doctrine_seed(pp, "AGENTS.md".into()).is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn doutrina_rejeita_projeto_invalido() {
        assert!(read_project_doctrine("/nao/existe/mesmo".into()).is_err());
        assert!(write_project_doctrine("/nao/existe/mesmo".into(), "x".into()).is_err());
    }

    #[test]
    fn conv_id_sanitization() {
        assert_eq!(safe_conv_id("abc-123_XYZ").unwrap(), "abc-123_XYZ");
        assert!(safe_conv_id("").is_err());
        assert!(safe_conv_id("../etc/passwd").is_err()); // traversal
        assert!(safe_conv_id("a/b").is_err());
        assert!(safe_conv_id("a\\b").is_err());
        assert!(safe_conv_id("a b").is_err()); // espaço
        assert!(safe_conv_id("a.md").is_err()); // ponto
        assert!(safe_conv_id("é-conv").is_err()); // não-ASCII
    }

    #[test]
    fn export_creates_dir_gitignore_and_overwrites() {
        let tmp = std::env::temp_dir().join(format!("mycockpit-ctx-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let pp = tmp.to_string_lossy().to_string();

        // export cria dir + gitignore + arquivo e devolve o RELATIVO.
        let rel = export_conv_context(pp.clone(), "conv-1".into(), "# Oi\n".into()).unwrap();
        assert_eq!(rel, ".mycockpit/context/conv-1.md");
        let dir = tmp.join(".mycockpit").join("context");
        // o contexto exportado é descartável: a subpasta segue 100% local.
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), "*\n");
        // a pasta-mãe é SELETIVA (doutrina/personas versionadas) — antes era "*".
        assert!(
            std::fs::read_to_string(tmp.join(".mycockpit").join(".gitignore"))
                .unwrap()
                .contains("!instructions.md")
        );
        assert_eq!(std::fs::read_to_string(dir.join("conv-1.md")).unwrap(), "# Oi\n");

        // re-export SOBRESCREVE (last-writer-wins, sem erro).
        let rel2 = export_conv_context(pp.clone(), "conv-1".into(), "# Novo\n".into()).unwrap();
        assert_eq!(rel2, rel);
        assert_eq!(std::fs::read_to_string(dir.join("conv-1.md")).unwrap(), "# Novo\n");

        // conv_id malicioso não escreve nada.
        assert!(export_conv_context(pp, "../fora".into(), "x".into()).is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn trim_keeps_newest() {
        let tmp = std::env::temp_dir().join(format!("mycockpit-ctx-trim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        for i in 0..5 {
            let p = tmp.join(format!("c{i}.md"));
            std::fs::write(&p, "x").unwrap();
            // mtime crescente explícito (granularidade de FS não é confiável).
            let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + i);
            let _ = filetime_set(&p, t);
        }
        std::fs::write(tmp.join(".gitignore"), "*\n").unwrap(); // não pode ser apagado
        trim_old_exports(&tmp, 3);
        assert!(!tmp.join("c0.md").exists(), "mais antigo apagado");
        assert!(!tmp.join("c1.md").exists());
        assert!(tmp.join("c2.md").exists());
        assert!(tmp.join("c4.md").exists(), "mais novo fica");
        assert!(tmp.join(".gitignore").exists(), "só .md entra na limpeza");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Seta o mtime sem dep externa: reabre o arquivo e usa set_modified (Rust 1.75+).
    fn filetime_set(p: &Path, t: std::time::SystemTime) -> std::io::Result<()> {
        let f = std::fs::OpenOptions::new().write(true).open(p)?;
        f.set_modified(t)
    }
}
