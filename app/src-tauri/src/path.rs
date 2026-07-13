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

#[cfg(not(unix))]
pub fn hydrate_path() {}
