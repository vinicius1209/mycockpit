# MyCockpit

Um **cockpit pessoal de agents de código**. Uma única UI (desktop) para conversar com
modelos e **coordenar agents** (Claude Code agora; Codex / OpenCode / Aider depois)
sem ficar pulando entre janelas de terminal.

> **Status:** planejamento + spike validado. Ainda **não há app** — há o plano
> (`PLAN.md`), a documentação de arquitetura (`docs/`) e o primeiro spike de risco,
> que **já compila** (`spikes/m0-stream-json/`).

---

## A dor que isto resolve

Hoje, usar `claude` / `codex` / `opencode` no terminal cru incomoda: várias abas,
contexto espalhado, nenhuma visão unificada. O MyCockpit é a **única janela** onde
você abre um projeto, pede algo e vê o agent trabalhando — como cartões num chat,
não como scroll de terminal.

A dor **não** é "reexplicar contexto": `CLAUDE.md`, `AGENTS.md` e as memórias do
Claude CLI já resolvem isso. O cockpit só **lê e mostra** esse contexto — ele **não**
constrói um motor de memória novo (pelo menos não no início).

## O princípio: camada fina

O MyCockpit é um **front-end do `claude` CLI que você já tem instalado e autenticado**.
Sem gestão de API key, sem reinventar terminal/git/MCP no v0.1. Reaproveita o que já
funciona; constrói nativo só onde agrega — em etapas.

---

## Mapa do repositório

| Caminho | O que é |
|---|---|
| [`PLAN.md`](./PLAN.md) | **Fonte de verdade.** Visão, escopo, v0.1, marcos, roadmap. Comece aqui. |
| [`docs/architecture.md`](./docs/architecture.md) | Arquitetura do sistema (atual e alvo). |
| [`docs/agent-runner.md`](./docs/agent-runner.md) | **A abstração de runner** — como Claude/Codex/OpenCode/Aider encaixam sem retrabalho (design do v0.2). |
| [`docs/decisions.md`](./docs/decisions.md) | Log de decisões (ADRs) tomadas na fase de planejamento. |
| [`docs/stream-json-notes.md`](./docs/stream-json-notes.md) | O que sabemos do `stream-json` do Claude Code + o que o spike precisa confirmar. |
| [`app/`](./app/) | **O app (M1+)** — Tauri 2 + React + Tailwind v4 + shadcn. Shell de 3 painéis, design system, SQLite. Ver [`app/README.md`](./app/README.md). |
| [`spikes/m0-stream-json/`](./spikes/m0-stream-json/) | **Spike M0** — prova o coração técnico do v0.1. |

## Por onde começar (dev)

1. Leia o **[`PLAN.md`](./PLAN.md)** inteiro.
2. Rode o **spike M0** (`spikes/m0-stream-json/README.md`). Se ele passa no critério de
   sucesso, o coração do v0.1 está provado — anote os achados em `docs/stream-json-notes.md`.
3. Só então comece a UI, seguindo os marcos M1→M6 do `PLAN.md`.

## Pré-requisitos

- **`claude` CLI** instalado e autenticado (`claude --version`).
- **Rust** toolchain (spike + backend Tauri).
- **Node** (front Tauri) — quando o app começar.
- (opcional) `jq` para o smoke test do spike.

## Stack alvo

Tauri · React · TypeScript · Tailwind · shadcn/ui · SQLite · Zustand · TanStack Query.
