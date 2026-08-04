#!/usr/bin/env python3
"""Spike D0 — trabalho diferido do provider (docs/deferred-work-plan.md).

Mede o ciclo de vida do `claude -p` quando o modelo lança um Workflow em
background e encerra o turno:

  run1 (oneshot): -p one-shot. Perguntas: o processo segue vivo após o
    `result`? Emite eventos novos (segundo `result`?) quando o workflow
    conclui? Quanto tempo entre `result` e EOF?
  run3 (bidi): -p --input-format stream-json (stdin aberto). Pergunta: a
    task-notification chega como turno novo no mesmo processo?

Uso: python3 driver.py oneshot|bidi <outdir>
Cada linha do stdout é registrada com timestamp monotônico relativo ao spawn
em <outdir>/<mode>.log.jsonl; o resumo vai para <outdir>/<mode>.summary.json.
"""
import json
import os
import subprocess
import sys
import threading
import time

WORKFLOW_SCRIPT = """export const meta = {
  name: 'spike-ping',
  description: 'spike D0: dois agentes triviais',
  phases: [{ title: 'Ping' }],
}
phase('Ping')
const a = await agent("Responda apenas com a palavra: ping")
const b = await agent("Responda apenas com a palavra: pong")
return { a, b }"""

# Variante lenta: garante que o turno TERMINA antes do workflow (a ordem do
# incidente) — queremos ver o processo esperar pós-`result` e ser re-invocado.
WORKFLOW_SCRIPT_SLOW = """export const meta = {
  name: 'spike-slow',
  description: 'spike D0: agente lento pos-turno',
  phases: [{ title: 'Lento' }],
}
phase('Lento')
const a = await agent("Escreva um ensaio de 600 palavras sobre a historia da aviacao brasileira, em paragrafos completos.")
const b = await agent("Resuma em uma frase: " + a.slice(0, 400))
return { resumo: b }"""

def build_prompt(script: str) -> str:
    return (
        "use a workflow. Chame a tool Workflow passando EXATAMENTE este "
        "script no campo `script`:\n\n" + script + "\n\n"
        "A tool retorna imediatamente (o workflow roda em background). Assim "
        "que ela retornar, encerre seu turno respondendo apenas: lancei. "
        "NAO espere o resultado do workflow, NAO use outras tools."
    )

BASE_ARGS = [
    "claude", "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", "sonnet",
    "--dangerously-skip-permissions",
]

HARD_TIMEOUT_S = 360  # nunca esperar mais que 6 min pelo EOF


def main() -> None:
    mode, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    log_path = os.path.join(outdir, f"{mode}.log.jsonl")
    summary_path = os.path.join(outdir, f"{mode}.summary.json")

    prompt = build_prompt(
        WORKFLOW_SCRIPT_SLOW if "slow" in mode else WORKFLOW_SCRIPT)
    args = list(BASE_ARGS)
    stdin: int | None = subprocess.DEVNULL
    if mode.startswith("bidi"):
        args += ["--input-format", "stream-json"]
        stdin = subprocess.PIPE
    else:
        args += ["--", prompt]

    t0 = time.monotonic()
    proc = subprocess.Popen(
        args, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, cwd=outdir,
    )

    stderr_lines: list[str] = []
    threading.Thread(
        target=lambda: stderr_lines.extend(proc.stderr), daemon=True
    ).start()

    if mode.startswith("bidi"):
        msg = {
            "type": "user",
            "message": {"role": "user",
                        "content": [{"type": "text", "text": prompt}]},
        }
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        # stdin fica ABERTO de propósito: queremos ver se a notificação de
        # conclusão do workflow re-invoca o modelo no mesmo processo.

    summary = {
        "mode": mode, "args": args, "spawned_at": time.time(),
        "result_events": [], "post_result_types": [], "eof_s": None,
        "timed_out": False, "exit_code": None, "session_id": None,
    }
    first_result_s = None

    log = open(log_path, "w")

    def watchdog() -> None:
        time.sleep(HARD_TIMEOUT_S)
        if proc.poll() is None:
            summary["timed_out"] = True
            proc.kill()

    threading.Thread(target=watchdog, daemon=True).start()

    for line in proc.stdout:
        t = round(time.monotonic() - t0, 2)
        log.write(json.dumps({"t": t, "line": line.rstrip("\n")}) + "\n")
        log.flush()
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = ev.get("type")
        if etype == "system" and ev.get("subtype") == "init":
            summary["session_id"] = ev.get("session_id")
        if etype == "result":
            summary["result_events"].append(
                {"t": t, "subtype": ev.get("subtype"),
                 "cost": ev.get("total_cost_usd"),
                 "text": str(ev.get("result", ""))[:200]})
            if first_result_s is None:
                first_result_s = t
        elif first_result_s is not None:
            summary["post_result_types"].append({"t": t, "type": etype})
        print(f"[{t:7.2f}s] {etype}/{ev.get('subtype', '')}", flush=True)

    summary["eof_s"] = round(time.monotonic() - t0, 2)
    summary["exit_code"] = proc.wait()
    summary["stderr_tail"] = stderr_lines[-5:]
    log.close()
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
