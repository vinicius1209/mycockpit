# Concorrente: Xirp (Spotify) — anatomia e lições

> Estudo de 11/08/2026, por inspeção LOCAL do app instalado (bundle, hooks,
> tmux, worktrees no nosso próprio repo) + web. Só leitura; nada foi copiado
> literalmente — o que se absorve são REGRAS. Fontes primárias: o bundle em
> `/Applications/Xirp.app`, `~/Library/Application Support/Xirp/`, os hooks em
> `~/.claude`, e o blog do Spotify Portal.

## Stack real

Electron (474 MB; nome interno "Chirp", 36k+ sessões internas antes do beta).
Três camadas: **main fino** (janela/updater) · **daemon** Node como
utilityProcess servindo HTTP+WS em `127.0.0.1:64905` (hooks receiver, PTY/tmux,
file index com rg+fs.watch, parse de JSONL, **PGlite** — Postgres embarcado
in-process — com drizzle) · **renderer** React estático (xterm.js + Monaco +
Shiki + Mermaid) falando WS com o daemon. Login Auth0 obrigatório, macOS only,
grátis no beta; monetização via Spotify Portal (B2B).

## A mecânica dos hooks de status (a lição mais valiosa)

Scripts Node de ~1,8 KB gerados em
`hook-scripts/{claude,codex}/*.cjs` ("DO NOT EDIT — regenerated"), que POSTam o
payload do hook pro daemon com bearer token (64 hex, rotacionado a cada
reinstalação de hooks). Correlação sessão-CLI ↔ sessão-app via env
(`CHIRP_NOTIFICATION_ID`) injetada pelo tmux — o hook global é inofensivo fora
do app (env vazia).

**Dois perfis, e a distinção é a regra:**
- **Fire-and-forget** (sessionStart/preToolUse/notification/stop): timeout 1s,
  erro engolido, `unref()` — daemon morto = hook silencioso, o CLI nem sente.
  **Fail-open por construção.**
- **Round-trip síncrono** (`permissionRequest`): timeout 30s, resposta do
  daemon volta pelo stdout — **o prompt de permissão do CLI é decidido na UI
  do app**, sem screen-scraping.

Status derivado: preToolUse→working · stop→idle · notification→waiting ·
permissionRequest→blocked. Triangulado com um wrapper de statusline (que
PRESERVA e executa a statusline original do usuário — chaining respeitoso) e
com parse dos JSONL de `~/.claude/projects/`.

**Instalação respeitosa de config alheia (regra copiável hoje):** entradas com
matcher próprio ao lado das existentes (convivem com os hooks do usuário),
header "DO NOT EDIT", backups antes de mexer, wrapper que preserva o original.

## Terminal (tmux+squab) vs nosso headless

`tmux new-session -d -s xirp-<uuid>` no socket default, 120x30,
`remain-on-exit on`, env injetada, rodando o **squab** (supervisor node-pty com
máquina de estados explícita, capaz de **trocar de agente no meio da sessão**
— fase "Translating" de handoff). Renderer desenha via xterm.js; "Open in
Terminal" = `tmux attach`. Orquestração dirigida pelo agente via
`--append-system-prompt` ensinando a criar sessões-irmãs pela CLI
(`chirp session new --depends-on --project`) — CLI, não MCP.

**Trade-offs honestos:** eles ganham fidelidade de TUI, escape hatch (attach),
sobrevivência a crash da UI e agnosticismo dia-1; pagam com terminal opaco
(precisaram de TRÊS canais laterais — hooks + statusline + JSONL, com parses
de 29 MB repetidos e lentos no log) e UI de terminal, não de produto. Nós
ganhamos eventos estruturados (messageNodes/custo/evidência); pagamos com
adapter por agente e sem /comandos interativos. **Síntese: hooks complementam
nosso watchdog (push barato fail-open); não substituem o stream-json.**

## Browser embedded: NÃO existe no Xirp

Evidência negativa conclusiva: `setWindowOpenHandler → deny` + `openExternal`
pra todo http(s), zero BrowserView/WebContentsView/webview no bundle. Em
Electron, onde embutir seria trivial, o Spotify LANÇOU SEM browser embutido.
O que embutem é Monaco (arquivos/diff) + xterm. **Valida o corte do nosso
browser-plan**: evidência visual no fio primeiro; painel vivo só se a demanda
provar.

## Onboarding (4-5 passos) traduzido em regras

1. Onboarding = **instalação de capacidades**, não tour: cada passo desbloqueia
   algo mecânico e diz o benefício na frase ("so Xirp can tell when…").
2. Config alheia: cirúrgica, reversível, assinada (ver acima).
3. **Workspace vs projeto**: escanear a pasta-mãe e propor repos em lote,
   em vez de pedir projeto por projeto.
4. Degradar com honestidade: hooks "highly recommended", nunca obrigatórios.
5. Defaults de permissão por agente explícitos e versionados (espelha nossa
   regra de escopo explícito em Configurações).

## Worktrees por sessão

Worktree IRMÃO do repo (`<repo>-worktree-session-<nome>`), branch com
namespace `session/<nome-memorável>`, config git POR PROJETO (branch base,
auto-run, carregar dirs ignorados), ciclo completo na UI (create/fork/delete
pareado com a sessão, checkout de PR em worktree, conflitos tratados).

## Top 5 lições pro MyCockpit (valor/custo)

1. **Hooks fail-open como canal push de status** — endpoint nosso + scripts
   gerados com bearer/timeout 1s/erro engolido; `permissionRequest` síncrono
   daria aprovação na UI. Complementa o watchdog. (altíssimo/baixo)
2. **Worktree por sessão/tarefa** — encaixa no deferred-work: paralelismo sem
   pisar no mesmo checkout. (alto/médio)
3. **Formato canônico de sessão + handoff entre agentes** — regras do canonical
   deles (linkage preservado, handoff propaga permissionMode, erros nomeados,
   manifest antes de deletar fonte) alimentam nosso context-handoff.md.
   (alto/médio-alto)
4. **Onboarding instalador de capacidades** — detectar CLIs, oferecer hooks
   com benefício explícito, workspace scan, agente default, tour curto.
   (alto/baixo)
5. **Daemon separado da UI** + agente orquestrando via CLI com `--depends-on`
   — direcional; conversa com nosso work_gateway. (médio-alto/alto)

Reconhecimento: PGlite+drizzle como alternativa ao SQLite se um dia houver
sync; adapters deles aguentam agente "degenerado" remoto — bom teste de
estresse pro nosso agnosticismo por capability.
