//! Hidrata o PATH do processo no startup. Apps macOS abertos pela GUI (Finder/
//! Dock) herdam um PATH MÍNIMO (`/usr/bin:/bin:/usr/sbin:/sbin`) — sem
//! `~/.local/bin`, `/opt/homebrew/bin` nem os bins do node — então `claude`/
//! `codex`/`agy` não são encontrados (`No such file or directory`, os error 2).
//! Só acontece no build empacotado (o `tauri dev` herda o PATH rico do terminal).
//! Aqui recuperamos o PATH do LOGIN SHELL do usuário + garantimos dirs comuns.

#[cfg(unix)]
pub fn hydrate_path() {
    use std::collections::HashSet;
    use std::path::Path;

    let mut parts: Vec<String> = Vec::new();
    let push_split = |s: &str, parts: &mut Vec<String>| {
        for seg in s.split(':') {
            if !seg.is_empty() {
                parts.push(seg.to_string());
            }
        }
    };

    // 1) PATH do login shell: carrega ~/.zprofile / ~/.bash_profile, onde o
    //    usuário exporta os paths das ferramentas. `printf %s` não imprime nada
    //    além do próprio PATH (evita capturar banner/MOTD).
    if let Ok(shell) = std::env::var("SHELL") {
        if let Ok(out) = std::process::Command::new(&shell)
            .args(["-l", "-c", "printf %s \"$PATH\""])
            .output()
        {
            if out.status.success() {
                push_split(&String::from_utf8_lossy(&out.stdout), &mut parts);
            }
        }
    }

    // 2) PATH já herdado por cima (não perde nada que o SO tenha dado).
    if let Ok(cur) = std::env::var("PATH") {
        push_split(&cur, &mut parts);
    }

    // 3) dirs comuns de instalação de CLIs (belt-and-suspenders).
    if let Ok(home) = std::env::var("HOME") {
        for suffix in [
            ".local/bin",
            ".bun/bin",
            ".cargo/bin",
            ".npm-global/bin",
            ".volta/bin",
            ".deno/bin",
        ] {
            parts.push(format!("{home}/{suffix}"));
        }
        // 3b) nvm: o passo 1 roda o login shell NÃO-interativo, que lê
        // ~/.zprofile mas NÃO lê ~/.zshrc — e é no .zshrc que o nvm costuma
        // inicializar. Sem isso o app não enxergava os bins do node do nvm
        // (`claude` instalado via npm-global do nvm) e resolvia/atualizava uma
        // CÓPIA diferente da que o shell do usuário usa ("atualizei e não
        // mudou nada"). Mesclamos o bin da versão MAIS ALTA achada no disco,
        // ANTES dos dirs fixos do brew abaixo (ordem: login-shell primeiro,
        // depois nvm detectado, depois brew/fixos).
        if let Some(nvm_bin) = best_nvm_bin(&home) {
            parts.push(nvm_bin);
        }
    }
    for fixed in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        parts.push(fixed.to_string());
    }

    // dedup preservando a ordem + descarta os que não existem no disco.
    let mut seen = HashSet::new();
    let joined: Vec<String> = parts
        .into_iter()
        .filter(|p| seen.insert(p.clone()) && Path::new(p).is_dir())
        .collect();

    if !joined.is_empty() {
        std::env::set_var("PATH", joined.join(":"));
    }
}

/// Bin da versão de node MAIS ALTA instalada pelo nvm
/// (`~/.nvm/versions/node/vX.Y.Z/bin`). None = sem nvm/sem versões.
#[cfg(unix)]
fn best_nvm_bin(home: &str) -> Option<String> {
    let base = format!("{home}/.nvm/versions/node");
    let names: Vec<String> = std::fs::read_dir(&base)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    let best = pick_highest_version(&names)?;
    Some(format!("{base}/{best}/bin"))
}

/// Maior versão por ordenação semver SIMPLES: segmentos numéricos comparados
/// como números ("v9.0.0" < "v10.0.0", coisa que a ordenação lexicográfica
/// erraria). Segmento não-numérico conta como 0. Pura, testável.
#[cfg(unix)]
fn pick_highest_version(names: &[String]) -> Option<String> {
    fn key(name: &str) -> Vec<u64> {
        name.trim_start_matches('v')
            .split('.')
            .map(|seg| seg.parse::<u64>().unwrap_or(0))
            .collect()
    }
    names
        .iter()
        .max_by(|a, b| key(a).cmp(&key(b)))
        .cloned()
}

#[cfg(not(unix))]
pub fn hydrate_path() {}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn v(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn maior_versao_e_numerica_nao_lexicografica() {
        // lexicográfico diria "v9..." > "v24..."; a comparação certa é numérica.
        assert_eq!(
            pick_highest_version(&v(&["v9.11.2", "v24.16.0", "v22.14.0"])),
            Some("v24.16.0".to_string())
        );
    }

    #[test]
    fn maior_versao_compara_todos_os_segmentos() {
        assert_eq!(
            pick_highest_version(&v(&["v24.2.0", "v24.16.0", "v24.16.1"])),
            Some("v24.16.1".to_string())
        );
    }

    #[test]
    fn maior_versao_lista_vazia_e_none() {
        assert_eq!(pick_highest_version(&[]), None);
    }

    #[test]
    fn maior_versao_tolera_nome_sem_numero() {
        // dir estranho no meio (".DS_Store"-like) não quebra nem vence.
        assert_eq!(
            pick_highest_version(&v(&["lixo", "v22.14.0"])),
            Some("v22.14.0".to_string())
        );
    }
}
