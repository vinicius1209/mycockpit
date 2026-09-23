//! `.frota/` — a pasta do PRÓPRIO app no projeto, o análogo de `.claude/`
//! sem depender de fornecedor. Mora aqui:
//!   - `config.toml`   — config por projeto (modo / helper / permissão / dirs);
//!   - `instructions.md` — a DOUTRINA do projeto, que o app injeta no prompt de
//!     qualquer CLI (ver `doctrine.ts`). É o que torna a instrução agnóstica:
//!     `CLAUDE.md` só o Claude Code lê, `AGENTS.md` só o Codex, e o agy não lê
//!     nenhum dos dois — este arquivo vale pros três porque quem injeta é o app;
//!   - `agents/*.md`   — as personas (Onda 3);
//!   - `commands/*.md` — comandos "/" da CASA (agnósticos: valem em qualquer
//!     motor via expansão app-side; é onde skills.rs grava a skill promovida);
//!   - `context/`      — export do fio de conversa (local, descartável).
//!
//! O arquivo é sempre a FONTE DE VERDADE; o SQLite do app vira cache. Edição do
//! TOML via toml_edit preserva comentários/formatação.
//!
//! Git: a pasta nasceu 100% local (`.gitignore` = `*`). Desde a decisão de
//! jul/2026 ela é SELETIVA — doutrina e personas são versionadas (revisáveis em
//! PR, viajam no clone), o resto segue fora. Ver `FROTA_GITIGNORE`.

use serde::Serialize;
use std::path::{Path, PathBuf};
use toml_edit::{value, DocumentMut};

/// Nome da pasta da Frota num projeto.
pub const PASTA: &str = ".frota";

/// O nome LEGADO, que ainda se lê durante a janela do rename (ADR-222). A
/// pasta existe em todo projeto aberto antes de 21/09/2026, e nesses projetos
/// `instructions.md`, `agents/` e `commands/` estão COMMITADOS: o app não
/// renomeia diretório de repositório de terceiro sem gesto humano.
pub const PASTA_LEGADA: &str = ".mycockpit";

/// A pasta da Frota neste projeto, em UM lugar só.
///
/// `.frota/` quando ela existe; `.mycockpit/` quando só a legada existe; e
/// `.frota/` quando nenhuma existe, que é o que se CRIA daqui pra frente.
///
/// Isto é o trabalho do rename. Antes, 26 pontos montavam esse caminho na mão,
/// e era isso que fazia trocar o nome doer: a decisão de onde a pasta mora
/// estava espalhada em vez de ter dono. Quem precisa do caminho pergunta aqui.
pub fn nome_da_pasta(base: &Path) -> &str {
    base.file_name().and_then(|n| n.to_str()).unwrap_or(PASTA)
}

pub fn pasta_da_frota(root: &Path) -> PathBuf {
    let nova = root.join(PASTA);
    if nova.is_dir() {
        return nova;
    }
    let legada = root.join(PASTA_LEGADA);
    if legada.is_dir() {
        return legada;
    }
    nova
}

/// Conteúdo do `.frota/.gitignore`. Ignora tudo e reabre exceções: a ordem
/// importa (git precisa "desingorar" a PASTA antes dos arquivos dentro dela,
/// senão o `*` — que casa em qualquer nível — continua vencendo).
const FROTA_GITIGNORE: &str = "\
# Pasta da Frota. Local por padrão: contexto exportado, missões e worktrees
# não vão pro git. As exceções abaixo são VERSIONADAS de propósito — a doutrina,
# as personas e os comandos do projeto devem viajar no clone e ser revisáveis em PR.
*
!.gitignore
!instructions.md
!agents/
!agents/*.md
!commands/
!commands/*.md
";

/// Conteúdo do `.gitignore` legado (a pasta inteira local). Só ele é elegível a
/// upgrade automático — qualquer outro conteúdo é edição AUTORAL e fica de pé.
const LEGACY_GITIGNORE: &str = "*";

/// Versão jul/2026 do `.gitignore` (antes de `commands/` existir). Também
/// elegível a upgrade automático: foi o APP que a escreveu, não o usuário.
const GITIGNORE_JUL2026: &str = "\
# Pasta da Frota. Local por padrão: contexto exportado, missões e worktrees
# não vão pro git. As exceções abaixo são VERSIONADAS de propósito — a doutrina
# e as personas do projeto devem viajar no clone e ser revisáveis em PR.
*
!.gitignore
!instructions.md
!agents/
!agents/*.md
";

/// Cria `dir` e garante o `.gitignore` do `.frota/`: escreve se faltar,
/// faz upgrade se for uma versão que o PRÓPRIO app escreveu (o `*` legado ou a
/// versão jul/2026 sem `commands/`), e NÃO TOCA se o usuário editou.
/// `pub(crate)`: skills.rs grava `.frota/commands/` sob o mesmo contrato.
pub(crate) fn ensure_frota_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gi = dir.join(".gitignore");
    match std::fs::read_to_string(&gi) {
        Ok(cur) if cur.trim() == LEGACY_GITIGNORE || cur == GITIGNORE_JUL2026 => {
            crate::fsx::write_atomic(&gi, FROTA_GITIGNORE)
        }
        Ok(_) => Ok(()), // conteúdo autoral (ou já novo): preservado
        Err(_) => crate::fsx::write_atomic(&gi, FROTA_GITIGNORE),
    }
}

#[derive(Serialize, Default)]
pub struct ProjectConfig {
    /// `.frota/config.toml` existe no disco?
    pub exists: bool,
    /// O NOME da pasta da Frota neste projeto: `.frota` normalmente, `.mycockpit`
    /// num projeto que ainda não migrou.
    ///
    /// Vai para a tela ("salvo em …/config.toml", a lista de comandos e a de
    /// personas). Um literal no front mentiria no projeto legado, e a lei da
    /// casa é estado real, nunca teatro (ADR-222).
    pub pasta: String,
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
pub fn read_project_config(path: String) -> Result<ProjectConfig, String> {
    let base = pasta_da_frota(Path::new(&path));
    let pasta = nome_da_pasta(&base).to_string();
    let cfg = base.join("config.toml");
    let Ok(text) = std::fs::read_to_string(&cfg) else {
        // Sem arquivo ainda: o nome da pasta vai mesmo assim, é onde ele NASCERIA.
        return Ok(ProjectConfig {
            pasta,
            ..Default::default()
        });
    };
    // TOML inválido NÃO vira "tudo default" em silêncio: o arquivo é editável à
    // mão; mascarar um typo esconderia a config real (o front loga o warn).
    let doc = text
        .parse::<DocumentMut>()
        .map_err(|e| format!("config.toml inválido: {e}"))?;
    let get = |k: &str| doc.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Ok(ProjectConfig {
        exists: true,
        pasta,
        mode: get("mode"),
        helper: get("helper"),
        permission: get("permission"),
        extra_dirs: toml_str_array(&doc, "extra_dirs"),
    })
}

/// Resolve as pastas extras liberadas para um `cwd` (que pode ser um worktree
/// sob `.frota/worktrees/…`): sobe a árvore até achar `.frota/config.toml`,
/// resolve paths relativos contra a RAIZ do projeto, canoniza e descarta os que
/// não existem. Chamado no spawn (`run_agent`) → vira `--add-dir` em cada adapter.
pub fn resolve_extra_dirs(cwd: &str) -> Vec<String> {
    let mut cur: &Path = Path::new(cwd);
    loop {
        let cfg = pasta_da_frota(cur).join("config.toml");
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

/// Escreve as chaves fornecidas em `.frota/config.toml`, criando a pasta
/// (com `.gitignore` = `*`) e o arquivo se não existirem. Round-trip via toml_edit.
#[tauri::command]
pub fn write_project_config(
    path: String,
    mode: Option<String>,
    helper: Option<String>,
    permission: Option<String>,
    extra_dirs: Option<Vec<String>>,
) -> Result<(), String> {
    let dir = pasta_da_frota(Path::new(&path));
    ensure_frota_dir(&dir)?;

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

// ---------------- Doutrina do projeto (.frota/instructions.md) ----------------
//
// O app INJETA este arquivo no prompt (bloco no 1º turno, como a persona), então
// ele vale para claude, codex e agy igualmente. Não confundir com `CLAUDE.md` /
// `AGENTS.md`: aqueles são lidos pela própria CLI, cada um só pelo seu dono, e o
// app nunca os injeta — só os inventaria no painel.

/// Nome do arquivo de doutrina dentro de `.frota/`.
pub const DOCTRINE_FILE: &str = "instructions.md";

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Doctrine {
    pub exists: bool,
    /// Conteúdo INTEGRAL (o editor grava de volta o que leu — truncar aqui
    /// perderia texto do usuário no round-trip). O corte p/ o prompt é no front.
    pub content: String,
    pub bytes: usize,
    /// Caminho RELATIVO de onde a doutrina foi lida: `.frota/instructions.md`,
    /// ou o da pasta antiga em projeto que ainda não migrou.
    ///
    /// Não é enfeite: este rótulo entra NO PROMPT (`<doutrina fonte=...>` em
    /// `doctrine.ts`). Uma constante no front cravaria o nome novo e mandaria o
    /// agente ler um arquivo que não existe no projeto legado, que é
    /// exatamente o "estado real, nunca teatro" que a casa proíbe.
    pub path: String,
}

#[tauri::command]
pub fn read_project_doctrine(path: String) -> Result<Doctrine, String> {
    let root = crate::skills::validate_project_path(&path)?;
    let base = pasta_da_frota(&root);
    let rel = format!("{}/{DOCTRINE_FILE}", nome_da_pasta(&base));
    let f = base.join(DOCTRINE_FILE);
    match std::fs::read_to_string(&f) {
        Ok(content) => Ok(Doctrine {
            exists: true,
            bytes: content.len(),
            content,
            path: rel,
        }),
        // ausente é estado NORMAL (projeto sem doutrina) → exists: false.
        // Erro de leitura real (permissão) também cai aqui; o painel oferece
        // criar, e o write dirá a verdade se o disco estiver bloqueado.
        // O path vai mesmo assim: é onde a doutrina SERIA criada.
        Err(_) => Ok(Doctrine {
            path: rel,
            ..Default::default()
        }),
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
    let dir = pasta_da_frota(&root);
    ensure_frota_dir(&dir)?;
    crate::fsx::write_atomic(&dir.join(DOCTRINE_FILE), &content)
}

// ---------------- Personas (.frota/agents/*.md) ----------------
//
// Arquivo é a FONTE (mesmo padrão do config.toml). Dois escopos, como o
// `.claude/commands`: do PROJETO (`<projeto>/.frota/agents/`) e GLOBAL do
// usuário (`~/.frota/agents/`), com o do projeto vencendo no mesmo slug —
// o desempate é feito no front, que é onde tem teste barato.
//
// O Rust aqui é deliberadamente burro: lista, lê e grava texto. Frontmatter,
// digest e versão são do TS (lib/agentDefs.ts), junto com o resto da máquina de
// preset que já existia.

#[derive(Serialize)]
pub struct AgentDefFile {
    pub slug: String,
    /// "projeto" | "global"
    pub scope: String,
    pub path: String,
    pub content: String,
    /// mtime em ms (epoch). 0 quando o FS não sabe informar.
    pub updated_at: i64,
}

/// Slug vira NOME DE ARQUIVO: minúsculas, dígitos, '-' e '_'. Mesma disciplina
/// do safe_conv_id — nada de traversal, espaço ou ponto.
fn safe_slug(slug: &str) -> Result<&str, String> {
    if slug.is_empty() {
        return Err("slug vazio".into());
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(format!(
            "slug inválido: '{slug}' (use minúsculas, números, '-' e '_')"
        ));
    }
    Ok(slug)
}

/// Pasta de personas do escopo. `global` mora em ~/.frota/agents (não é
/// repositório: não leva .gitignore).
fn agents_dir(scope: &str, project_path: Option<&str>) -> Result<std::path::PathBuf, String> {
    match scope {
        "global" => {
            let home = std::env::var("HOME").map_err(|_| "sem HOME".to_string())?;
            Ok(pasta_da_frota(Path::new(&home)).join("agents"))
        }
        "projeto" => {
            let p = project_path.ok_or_else(|| "escopo de projeto sem projeto".to_string())?;
            let root = crate::skills::validate_project_path(p)?;
            Ok(pasta_da_frota(&root).join("agents"))
        }
        other => Err(format!("escopo desconhecido: '{other}'")),
    }
}

fn mtime_ms(md: &std::fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn collect_defs(dir: &Path, scope: &str, out: &mut Vec<AgentDefFile>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.extension().is_none_or(|x| x != "md") {
            continue;
        }
        let Some(slug) = p.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // arquivo com nome fora da disciplina é IGNORADO, não corrigido: o app
        // não renomeia arquivo do usuário pelas costas.
        if safe_slug(slug).is_err() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&p) else {
            continue;
        };
        out.push(AgentDefFile {
            slug: slug.to_string(),
            scope: scope.to_string(),
            path: p.to_string_lossy().to_string(),
            content,
            updated_at: e.metadata().map(|m| mtime_ms(&m)).unwrap_or(0),
        });
    }
}

/// Lista as personas dos dois escopos. Pasta ausente = lista vazia (estado
/// normal), nunca erro — persona é opcional.
#[tauri::command]
pub fn read_agent_defs(project_path: Option<String>) -> Vec<AgentDefFile> {
    let mut out = Vec::new();
    if let Ok(d) = agents_dir("global", None) {
        collect_defs(&d, "global", &mut out);
    }
    if let Some(pp) = project_path.as_deref() {
        if let Ok(d) = agents_dir("projeto", Some(pp)) {
            collect_defs(&d, "projeto", &mut out);
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Grava uma persona e devolve o caminho absoluto. Escopo de projeto também
/// instala o `.gitignore` seletivo (a pasta agents/ é versionada).
#[tauri::command]
pub fn write_agent_def(
    project_path: Option<String>,
    scope: String,
    slug: String,
    content: String,
) -> Result<String, String> {
    let s = safe_slug(&slug)?;
    let dir = agents_dir(&scope, project_path.as_deref())?;
    if scope == "projeto" {
        if let Some(parent) = dir.parent() {
            ensure_frota_dir(parent)?;
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let f = dir.join(format!("{s}.md"));
    crate::fsx::write_atomic(&f, &content)?;
    Ok(f.to_string_lossy().to_string())
}

/// Apaga uma persona. Ausente é sucesso (idempotente): a UI é otimista e o
/// estado final desejado — "não existe" — foi alcançado de qualquer forma.
#[tauri::command]
pub fn delete_agent_def(
    project_path: Option<String>,
    scope: String,
    slug: String,
) -> Result<(), String> {
    let s = safe_slug(&slug)?;
    let f = agents_dir(&scope, project_path.as_deref())?.join(format!("{s}.md"));
    match std::fs::remove_file(&f) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------- Export do contexto de conversa ----------------
//
// O frontend guarda a conversa (itens JSON) no SQLite e RENDERIZA o markdown;
// aqui só gravamos com segurança em `.frota/context/<conv_id>.md` — arquivo
// legível por qualquer code agent, referenciado pelo caminho relativo no prompt.

/// Máximo de exports retidos em `.frota/context/` (limpeza best-effort).
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
/// mesmo padrão do `.frota/` acima: 100% local, nunca vaza pro git.
fn ensure_ignored_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Se sobrar mais que `keep` transcripts `.md` no dir, apaga os mais ANTIGOS e
/// o manifesto irmão `<id>.handoff.json`. Best-effort: qualquer erro (mtime
/// ilegível, remove falhou) é ignorado — limpeza nunca pode falhar o export.
fn trim_old_exports(dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
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
        if let Some(stem) = p.file_stem().and_then(|x| x.to_str()) {
            let _ = std::fs::remove_file(dir.join(format!("{stem}.handoff.json")));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundlePaths {
    pub transcript_path: String,
    pub manifest_path: String,
}

/// Exporta o markdown (renderizado pelo front) da conversa pra
/// `.frota/context/<conv_id>.md` (write atômico, sobrescreve re-export).
/// Devolve o caminho RELATIVO — é o que vai pro prompt do agent.
///
/// `command(async)` NÃO é enfeite: comando Tauri SEM `async` roda na THREAD
/// PRINCIPAL, que no macOS é a thread da UI. Este aqui escreve o transcript
/// inteiro (1,66 MB na maior conversa medida em 07/09/2026) e ainda varre o
/// diretório no `trim_old_exports` — sincronamente, a CADA envio. Não era
/// "lentidão": era a janela congelando. A função continua síncrona de propósito
/// (o corpo é I/O de bloqueio, e é exatamente por isso que ele não pode morar na
/// thread da UI); o atributo é que a tira de lá. Ver `app/src-tauri/src/AGENTS.md`.
#[tauri::command(async)]
pub fn export_conv_context(
    project_path: String,
    conv_id: String,
    markdown: String,
) -> Result<String, String> {
    let id = safe_conv_id(&conv_id)?;
    let root = crate::skills::validate_project_path(&project_path)?;
    // A pasta da Frota também ganha o .gitignore (o export pode rodar antes de
    // qualquer config ser escrita, padrão do write_project_config).
    let base = pasta_da_frota(&root);
    ensure_frota_dir(&base)?;
    let dir = base.join("context");
    ensure_ignored_dir(&dir)?;
    crate::fsx::write_atomic(&dir.join(format!("{id}.md")), &markdown)?;
    trim_old_exports(&dir, MAX_CONTEXT_FILES);
    Ok(format!("{}/context/{id}.md", nome_da_pasta(&base)))
}

/// Exporta, numa única fronteira validada, as duas camadas da memória híbrida:
/// - `<conv>.md`: transcript humano, completo e legível por qualquer agent;
/// - `<conv>.handoff.json`: índice estruturado/compacto, lido pelo prompt ou
///   pelas tools do MCP `frota-context`.
///
/// O JSON é validado antes de qualquer write e recebe um teto generoso, mas
/// finito: o manifesto é índice, nunca um segundo transcript disfarçado.
///
/// `command(async)` pelo mesmo motivo do `export_conv_context`: escreve o
/// transcript inteiro e não pode fazer isso na thread da UI.
#[tauri::command(async)]
pub fn export_context_bundle(
    project_path: String,
    conv_id: String,
    markdown: String,
    manifest: String,
) -> Result<ContextBundlePaths, String> {
    const MAX_MANIFEST_BYTES: usize = 256 * 1024;
    if manifest.len() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "manifesto de contexto excede {} KiB",
            MAX_MANIFEST_BYTES / 1024
        ));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&manifest).map_err(|e| format!("manifesto inválido: {e}"))?;
    if !parsed.is_object() {
        return Err("manifesto de contexto precisa ser um objeto JSON".into());
    }

    let id = safe_conv_id(&conv_id)?;
    let root = crate::skills::validate_project_path(&project_path)?;
    let base = pasta_da_frota(&root);
    ensure_frota_dir(&base)?;
    let dir = base.join("context");
    ensure_ignored_dir(&dir)?;

    let transcript_name = format!("{id}.md");
    let manifest_name = format!("{id}.handoff.json");
    crate::fsx::write_atomic(&dir.join(&transcript_name), &markdown)?;
    crate::fsx::write_atomic(&dir.join(&manifest_name), &manifest)?;
    trim_old_exports(&dir, MAX_CONTEXT_FILES);

    Ok(ContextBundlePaths {
        transcript_path: format!("{}/context/{transcript_name}", nome_da_pasta(&base)),
        manifest_path: format!("{}/context/{manifest_name}", nome_da_pasta(&base)),
    })
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
        let dir = tmp.join(PASTA);
        ensure_frota_dir(&dir).unwrap();
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
        let dir = tmp.join(PASTA);
        std::fs::create_dir_all(&dir).unwrap();

        // legado exato ("*") → upgrade (projetos que já rodaram o app antigo).
        std::fs::write(dir.join(".gitignore"), "*\n").unwrap();
        ensure_frota_dir(&dir).unwrap();
        assert!(std::fs::read_to_string(dir.join(".gitignore"))
            .unwrap()
            .contains("!instructions.md"));

        // conteúdo AUTORAL → intocado (não é nosso direito reescrever).
        let autoral = "*\n!minhas-notas.md\n";
        std::fs::write(dir.join(".gitignore"), autoral).unwrap();
        ensure_frota_dir(&dir).unwrap();
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
        assert!(
            std::fs::read_to_string(tmp.join(PASTA).join(".gitignore"))
                .unwrap()
                .contains("!instructions.md")
        );

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
    fn personas_round_trip_no_escopo_do_projeto() {
        let tmp = tmp_project("agents");
        let pp = tmp.to_string_lossy().to_string();

        // Pasta de PROJETO ausente = escopo vazio. A leitura também agrega
        // personas globais reais; o teste não pode depender do HOME da máquina.
        assert!(read_agent_defs(Some(pp.clone()))
            .iter()
            .all(|d| d.scope != "projeto"));

        let md = "---\nname: Revisor\n---\n\nSeja cético.\n";
        let escrito = write_agent_def(
            Some(pp.clone()),
            "projeto".into(),
            "revisor".into(),
            md.into(),
        )
        .unwrap();
        assert!(escrito.ends_with(&format!("{PASTA}/agents/revisor.md")));

        let defs: Vec<_> = read_agent_defs(Some(pp.clone()))
            .into_iter()
            .filter(|d| d.scope == "projeto")
            .collect();
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].slug, "revisor");
        assert_eq!(defs[0].scope, "projeto");
        assert_eq!(defs[0].content, md);
        assert!(defs[0].updated_at > 0);

        // gravar persona instala o .gitignore seletivo: a pasta é VERSIONADA,
        // então ela não pode nascer ignorada pelo `*` legado.
        assert!(
            std::fs::read_to_string(tmp.join(PASTA).join(".gitignore"))
                .unwrap()
                .contains("!agents/")
        );

        // apagar é idempotente (a UI é otimista).
        delete_agent_def(Some(pp.clone()), "projeto".into(), "revisor".into()).unwrap();
        delete_agent_def(Some(pp.clone()), "projeto".into(), "revisor".into()).unwrap();
        assert!(read_agent_defs(Some(pp))
            .iter()
            .all(|d| d.scope != "projeto"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn slug_e_escopo_sao_validados() {
        let tmp = tmp_project("agents-slug");
        let pp = tmp.to_string_lossy().to_string();
        let w = |slug: &str| {
            write_agent_def(Some(pp.clone()), "projeto".into(), slug.into(), "x".into())
        };
        assert!(w("../fora").is_err()); // traversal
        assert!(w("com espaco").is_err());
        assert!(w("MAIUSCULA").is_err()); // caso do FS varia entre plataformas
        assert!(w("a.md").is_err());
        assert!(w("").is_err());
        assert!(w("revisor-2_x").is_ok());
        // escopo desconhecido não vira pasta nenhuma.
        assert!(
            write_agent_def(Some(pp.clone()), "sei-la".into(), "x".into(), "y".into()).is_err()
        );
        // escopo de projeto SEM projeto é erro (não cai em global por engano).
        assert!(write_agent_def(None, "projeto".into(), "x".into(), "y".into()).is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn arquivo_com_nome_fora_da_disciplina_e_ignorado_nao_renomeado() {
        let tmp = tmp_project("agents-estranho");
        let pp = tmp.to_string_lossy().to_string();
        let dir = tmp.join(PASTA).join("agents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Nome Estranho.md"), "x").unwrap();
        std::fs::write(dir.join("ok.md"), "y").unwrap();
        std::fs::write(dir.join("leia-me.txt"), "z").unwrap();
        let defs: Vec<_> = read_agent_defs(Some(pp))
            .into_iter()
            .filter(|d| d.scope == "projeto")
            .collect();
        assert_eq!(defs.len(), 1, "só o .md com slug válido entra");
        assert_eq!(defs[0].slug, "ok");
        // e o arquivo estranho continua no disco, intacto.
        assert!(dir.join("Nome Estranho.md").is_file());
        let _ = std::fs::remove_dir_all(&tmp);
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
        assert_eq!(rel, format!("{PASTA}/context/conv-1.md"));
        let dir = tmp.join(PASTA).join("context");
        // o contexto exportado é descartável: a subpasta segue 100% local.
        assert_eq!(
            std::fs::read_to_string(dir.join(".gitignore")).unwrap(),
            "*\n"
        );
        // a pasta-mãe é SELETIVA (doutrina/personas versionadas) — antes era "*".
        assert!(
            std::fs::read_to_string(tmp.join(PASTA).join(".gitignore"))
                .unwrap()
                .contains("!instructions.md")
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("conv-1.md")).unwrap(),
            "# Oi\n"
        );

        // re-export SOBRESCREVE (last-writer-wins, sem erro).
        let rel2 = export_conv_context(pp.clone(), "conv-1".into(), "# Novo\n".into()).unwrap();
        assert_eq!(rel2, rel);
        assert_eq!(
            std::fs::read_to_string(dir.join("conv-1.md")).unwrap(),
            "# Novo\n"
        );

        // conv_id malicioso não escreve nada.
        assert!(export_conv_context(pp, "../fora".into(), "x".into()).is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn bundle_exporta_transcript_e_manifesto_validados() {
        let tmp =
            std::env::temp_dir().join(format!("mycockpit-bundle-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let pp = tmp.to_string_lossy().to_string();

        let paths = export_context_bundle(
            pp.clone(),
            "conv-2".into(),
            "# Memória\n".into(),
            r#"{"version":1,"pending_request":"continue"}"#.into(),
        )
        .unwrap();
        assert_eq!(paths.transcript_path, format!("{PASTA}/context/conv-2.md"));
        assert_eq!(
            paths.manifest_path,
            format!("{PASTA}/context/conv-2.handoff.json")
        );
        let dir = tmp.join(PASTA).join("context");
        assert_eq!(
            std::fs::read_to_string(dir.join("conv-2.md")).unwrap(),
            "# Memória\n"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(dir.join("conv-2.handoff.json")).unwrap()
            )
            .unwrap()["pending_request"],
            "continue"
        );
        // inválido falha antes de sobrescrever o par íntegro.
        assert!(
            export_context_bundle(pp, "conv-2".into(), "# Quebrado\n".into(), "{".into()).is_err()
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("conv-2.md")).unwrap(),
            "# Memória\n"
        );
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

#[cfg(test)]
mod testes_pasta_da_frota {
    use super::{pasta_da_frota, PASTA, PASTA_LEGADA};

    fn tmp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("frota-pasta-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn projeto_sem_nenhuma_das_duas_nasce_em_frota() {
        let root = tmp("nova");
        assert_eq!(pasta_da_frota(&root), root.join(PASTA));
    }

    #[test]
    fn projeto_ja_migrado_usa_frota() {
        let root = tmp("migrado");
        std::fs::create_dir_all(root.join(PASTA)).unwrap();
        assert_eq!(pasta_da_frota(&root), root.join(PASTA));
    }

    #[test]
    fn projeto_legado_continua_lendo_mycockpit() {
        // A janela do rename: projeto aberto antes de 21/09/2026 tem doutrina,
        // personas e comandos COMMITADOS em `.frota/`. Quebrar a leitura
        // deles seria o app decidindo renomear repositório de terceiro sozinho.
        let root = tmp("legado");
        std::fs::create_dir_all(root.join(PASTA_LEGADA)).unwrap();
        assert_eq!(pasta_da_frota(&root), root.join(PASTA_LEGADA));
    }

    #[test]
    fn com_as_duas_a_nova_ganha() {
        // Durante a migração as duas coexistem por um instante. A nova manda,
        // senão o app escreveria na pasta que está saindo.
        let root = tmp("ambas");
        std::fs::create_dir_all(root.join(PASTA)).unwrap();
        std::fs::create_dir_all(root.join(PASTA_LEGADA)).unwrap();
        assert_eq!(pasta_da_frota(&root), root.join(PASTA));
    }

    #[test]
    fn arquivo_com_o_nome_da_pasta_nao_engana() {
        // `.frota` como ARQUIVO não é a pasta: cai para a legada.
        let root = tmp("arquivo");
        std::fs::write(root.join(PASTA), "nao sou pasta").unwrap();
        std::fs::create_dir_all(root.join(PASTA_LEGADA)).unwrap();
        assert_eq!(pasta_da_frota(&root), root.join(PASTA_LEGADA));
    }
}
