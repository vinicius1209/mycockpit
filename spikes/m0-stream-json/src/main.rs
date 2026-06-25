//! Spike M0 — MyCockpit
//!
//! Objetivo: provar que dá para (1) executar o `claude` CLI em modo headless,
//! (2) ler o stream-json (JSONL) linha a linha e (3) classificar/renderizar os
//! eventos que o app vai mostrar como cartões no chat — TUDO de forma defensiva,
//! sem `unwrap` em dado externo e sem quebrar em eventos desconhecidos.
//!
//! Este é o coração técnico do v0.1. Se isto roda, o resto é UI.
//!
//! Uso:
//!   cargo run -- [PROMPT] [--cwd <dir>] [--resume <session_id>]
//!
//! Segurança: o spike usa `--disallowedTools` para REMOVER as tools que modificam
//! (Bash/Edit/Write/...), que é o gate real. (`--allowedTools` NÃO sandboxa — achado do M0.)

use std::collections::BTreeMap;
use std::env;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;

use serde_json::Value;

fn main() {
    let mut prompt: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut resume: Option<String> = None;

    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--cwd" => {
                cwd = args.get(i + 1).cloned();
                i += 2;
            }
            "--resume" => {
                resume = args.get(i + 1).cloned();
                i += 2;
            }
            "-h" | "--help" => {
                print_help();
                return;
            }
            other => {
                if prompt.is_none() {
                    prompt = Some(other.to_string());
                }
                i += 1;
            }
        }
    }

    let prompt = prompt.unwrap_or_else(|| {
        "List the files in this directory and briefly summarize what this project is.".to_string()
    });

    println!("▶ Claude Code headless (stream-json)");
    println!("  prompt : {prompt}");
    if let Some(d) = &cwd {
        println!("  cwd    : {d}");
    }
    if let Some(r) = &resume {
        println!("  resume : {r}");
    }
    println!("  guard  : --disallowedTools Bash,Edit,Write,MultiEdit,NotebookEdit (read-only real)");
    println!("{}", "─".repeat(64));

    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        // SEGURANÇA (achado do M0): --disallowedTools é o gate REAL — remove a tool do
        // conjunto. --allowedTools é só AUTO-APROVAÇÃO e NÃO impede a tool de rodar.
        .arg("--disallowedTools")
        .arg("Bash,Edit,Write,MultiEdit,NotebookEdit");
    if let Some(r) = &resume {
        cmd.arg("--resume").arg(r);
    }
    if let Some(d) = &cwd {
        cmd.current_dir(d);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("✗ Não consegui executar `claude`: {e}");
            eprintln!("  → O CLI está instalado e no PATH? Teste:  claude --version");
            std::process::exit(127);
        }
    };

    // Drena stderr numa thread separada para não travar o pipe (deadlock clássico).
    let stderr = child.stderr.take().expect("stderr piped");
    let stderr_handle = thread::spawn(move || {
        BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
            .collect::<Vec<_>>()
    });

    let stdout = child.stdout.take().expect("stdout piped");
    let reader = BufReader::new(stdout);

    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut session_id: Option<String> = None;
    let mut partial_text = String::new();

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(v) => handle_event(&v, &mut counts, &mut session_id, &mut partial_text),
            Err(_) => {
                bump(&mut counts, "[non-json]");
                println!("│ [linha não-JSON] {}", truncate(&line, 200));
            }
        }
    }

    if !partial_text.trim().is_empty() {
        println!("│ 💬 (texto acumulado dos deltas) {}", partial_text.trim());
    }

    let status = child.wait().ok();
    let errs = stderr_handle.join().unwrap_or_default();

    println!("{}", "─".repeat(64));
    println!("■ Fim. exit = {:?}", status.and_then(|s| s.code()));
    match &session_id {
        Some(sid) => {
            println!("  session_id = {sid}");
            println!("  → teste o resume:  cargo run -- --resume {sid} \"e agora liste os TODOs\"");
        }
        None => println!("  (nenhum session_id capturado — ver docs/stream-json-notes.md)"),
    }
    println!("  eventos vistos:");
    for (k, n) in &counts {
        println!("    {n:>4}  {k}");
    }
    if !errs.is_empty() {
        println!("  stderr ({} linhas, primeiras 20):", errs.len());
        for l in errs.iter().take(20) {
            println!("    {l}");
        }
    }
}

/// Classifica um evento JSON e imprime uma renderização legível
/// (simulando o que o chat do MyCockpit mostraria como cartão).
fn handle_event(
    v: &Value,
    counts: &mut BTreeMap<String, u32>,
    session_id: &mut Option<String>,
    partial_text: &mut String,
) {
    let ty = v.get("type").and_then(Value::as_str).unwrap_or("?");
    let subtype = v.get("subtype").and_then(Value::as_str);
    let label = match subtype {
        Some(s) => format!("{ty}/{s}"),
        None => ty.to_string(),
    };
    bump(counts, &label);

    // session_id pode aparecer em vários eventos; captura o primeiro.
    if session_id.is_none() {
        if let Some(sid) = v.get("session_id").and_then(Value::as_str) {
            *session_id = Some(sid.to_string());
        }
    }

    match ty {
        "system" => {
            let model = v.get("model").and_then(Value::as_str).unwrap_or("?");
            let tools = v
                .get("tools")
                .and_then(Value::as_array)
                .map(|a| a.len())
                .unwrap_or(0);
            println!(
                "│ ⚙  system/{}  model={model}  tools={tools}",
                subtype.unwrap_or("init")
            );
        }
        "assistant" => {
            // Mensagem completa do assistant (quando NÃO se usa --include-partial-messages).
            if let Some(content) = v.pointer("/message/content").and_then(Value::as_array) {
                for block in content {
                    match block.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(Value::as_str) {
                                println!("│ 💬 {}", t.trim());
                            }
                        }
                        Some("tool_use") => {
                            let name = block.get("name").and_then(Value::as_str).unwrap_or("?");
                            let input = block.get("input").map(compact).unwrap_or_default();
                            println!("│ 🔧 tool_use {name}  {}", truncate(&input, 160));
                        }
                        _ => {}
                    }
                }
            }
        }
        "stream_event" => {
            // Deltas em tempo real (quando se usa --include-partial-messages).
            if let Some(t) = v.pointer("/event/delta/text").and_then(Value::as_str) {
                partial_text.push_str(t);
            }
        }
        "user" => {
            println!("│ ↩  tool_result devolvido ao modelo");
        }
        "result" => {
            let is_err = v.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let cost = v.get("total_cost_usd").and_then(Value::as_f64);
            let result = v.get("result").and_then(Value::as_str).unwrap_or("");
            println!("│ ✅ result  is_error={is_err}  cost_usd={cost:?}");
            if !result.is_empty() {
                println!("│    {}", truncate(result, 400));
            }
        }
        _ => {
            // Nunca dropar: eventos desconhecidos viram log para fechar lacunas do adapter.
            println!("│ ❓ [tipo desconhecido: {label}] {}", truncate(&compact(v), 160));
        }
    }
}

fn bump(counts: &mut BTreeMap<String, u32>, key: &str) {
    *counts.entry(key.to_string()).or_insert(0) += 1;
}

fn compact(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

fn print_help() {
    println!("m0 — spike: dirige `claude` headless e parseia o stream-json");
    println!();
    println!("USO:");
    println!("  cargo run -- [PROMPT] [--cwd <dir>] [--resume <session_id>]");
    println!();
    println!("EXEMPLOS:");
    println!("  cargo run -- \"summarize this project\" --cwd ~/projetos/prime/prime-sales-hub");
    println!("  cargo run -- --resume 1234-abcd \"agora liste os TODOs\"");
}
