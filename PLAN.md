# Frota — Plano (fonte de verdade)

> Documento vivo. Capturado a partir de uma entrevista de discovery em **junho/2026**.
> Decisões com rationale completo estão em [`docs/decisions.md`](./docs/decisions.md).

---

## 1. Visão

Um **cockpit pessoal** onde humano e agents trabalham juntos numa única interface
simples: você abre um chat, pede algo e tem seu "time" de agents trabalhando e dando
feedback — sem abrir terminais.

Posicionamento de longo prazo (se um dia virar produto): **"Agent OS"** — *"seu
computador ganhou uma equipe de agentes"*. Não competir para ter o melhor chat;
ser o **lugar onde se conversa, programa e coordena agents**.

> **Mas o foco atual é pessoal.** Ver escopo abaixo.

## 2. Escopo e não-objetivos

**Escopo (v0.x):** ferramenta **pessoal** do Vinícius. Otimiza por *resolver a dor
rápido* e *uso diário*, não por mercado. Arquitetura não fecha portas para "produto",
mas isso só se decide **depois** de usar diariamente.

**Não-objetivos (agora):**
- ❌ Cloud / sync / multi-usuário / auth (Fase 12 original) — adiado.
- ❌ Testes A/B/C de interface (Fase 4 original) — é coisa de produto.
- ❌ Motor de memória próprio (Fase 2 original) — `CLAUDE.md`/`AGENTS.md`/memórias do
  CLI já cobrem; só **ler e mostrar**.
- ❌ Terminal embutido, Git UI, MCP client próprios **no v0.1** — adiados.
- ❌ Virar uma cópia do Conductor/IDE pesado. A UI tem que ser **simples**.

## 3. A dor (o problema real)

Usar `claude` / `codex` / `opencode` **no terminal cru** incomoda: várias abas,
sem visão unificada, sem coordenação. Quero **uma janela** para disparar e acompanhar
agents por projeto.

> Reexplicar contexto **não** é a dor central — os arquivos locais já ajudam.

## 4. Princípio de arquitetura: camada fina

A Frota é, no v0.1, um **front-end do `claude` CLI já instalado e autenticado**.
Reaproveita auth/assinatura, não gerencia API key, não reimplementa terminal/git/MCP.
Constrói nativo só onde agrega — **em etapas**. Detalhes em
[`docs/architecture.md`](./docs/architecture.md).

---

## 5. v0.1 — "Claude Code num chat que entende o projeto"

### 5.1 Definição

| Peça | O que faz |
|---|---|
| **Shell** | Tauri + React + TS + Tailwind/shadcn, janela única |
| **Abrir projeto** | aponta para uma pasta → lê `CLAUDE.md`/`AGENTS.md`/`.claude` → painel "o que o sistema sabe" |
| **Superfície de comando** | input estilo shadcn `@blocks-so/ai-02`: seletor **destino+modelo**, anexo, *chips* de ação cientes do projeto |
| **Destino = Claude Code** | backend Rust faz `spawn` do `claude -p --output-format stream-json --verbose` na pasta do projeto; parseia o JSONL → **cartões no chat** (texto, tool_use, result) |
| **Sessão** | captura `session_id`; follow-ups via `--resume` |
| **Permissões** | política **por projeto** (`allowedTools` + `permission-mode`); aprovação in-app quando o modo pedir |
| **Persistência** | SQLite (projetos, conversas, sessões, políticas) |

> Sutileza do seletor: o "destino" pode ser um **Agent** (Claude Code) ou, no futuro,
> um **Modelo direto** (chat puro). No v0.1 só existe Claude Code; "modelo direto"
> aparece como *"em breve"*.

### 5.2 Fora do v0.1 (adiado)

PTY/terminal embutido, tmux, paralelismo de agents, memory engine, MCP, Git UI, cloud,
múltiplos providers de chat. Tudo no roadmap (§7).

### 5.3 Por que NÃO tem terminal embutido no v0.1

Como o Claude Code roda headless e seus eventos (incluindo chamadas de `Bash` e o output
delas) viram **cartões no chat**, não é preciso renderizar um terminal. Ele volta no v0.2,
quando entrarem agents sem saída estruturada e/ou um terminal interativo de verdade.

---

## 6. Marcos de construção (ordem importa)

> Cada marco tem um critério de aceite. **Status: v0.1 COMPLETO (jun/2026) — M0→M6 todos ✅.** Falta só o teste E2E manual no `tauri dev` com o `claude` real.

| Marco | Entrega | Aceite |
|---|---|---|
| **M0 · Spike de risco** ✅ | Provar `spawn` do `claude -p --output-format stream-json` + parse robusto do JSONL (em `spikes/m0-stream-json/`) | **Feito** — validado contra prime-sales-hub (claude 2.1.187); achados em `docs/stream-json-notes.md` |
| **M1 · Esqueleto** ✅ | Tauri+React+shadcn, SQLite ligado, layout: *sidebar projetos │ chat │ painel de contexto* | **Feito** — em `app/`. Design system "cockpit", console ai-02, SQLite + seleção de pasta. Ver `app/README.md` |
| **M2 · Abrir projeto** ✅ | seletor de pasta → lê `CLAUDE.md`/`AGENTS.md`/`.claude` → painel "o que o sistema sabe"; projeto salvo no SQLite | **Feito** — `read_project_context` lê do disco + preview expansível no painel |
| **M3 · Dispatch (coração)** ✅ | chat dispara Claude Code na pasta → `text`/`tool_use`/`result` viram cartões (reusa M0) | **Feito** — `run_claude` (tokio + `ipc::Channel`) → cartões no chat. Falta o teste E2E no `tauri dev` |
| **M4 · Sessão contínua** ✅ | captura `session_id`, follow-up via `--resume`, conversa persistida no SQLite (tabela `conversations`) | **Feito** — conversa carrega/salva por projeto; resume sobrevive a restart |
| **M5 · Permissões por projeto** ✅ | modo por projeto (Leitura/Padrão/Liberado) → flags (`--disallowedTools`/`--permission-mode`) | **Feito** — seletor no painel de contexto, persistido. ⚠️ Aprovação interativa mid-run fica pra quando usarmos o Agent SDK (limite do CLI subprocess) |
| **M6 · Superfície** ✅ | input `ai-02` (seletor, anexo, chips), **markdown** nos cartões (react-markdown), **diffs de `Edit`** expansíveis | **Feito** — conversa rica e legível |

### Caminho feliz (aceite do v0.1)

> Abro a Frota → escolho a pasta `prime-sales-hub` → vejo o contexto do projeto →
> digito *"adicione o campo X na tabela Y seguindo as regras do projeto"* com destino
> **Claude Code** → vejo o agent **ler, editar e rodar o lint como cartões no chat** →
> reviso → respondo *"agora roda os testes"* e ele segue **na mesma sessão** →
> **sem abrir um terminal nenhum.**

Se esse roteiro roda ponta a ponta, o v0.1 está pronto e a dor original está resolvida.

---

## 7. Roadmap pós-v0.1 (12 fases originais, reordenadas e enxutas)

| Versão | Entrega | Funde fases originais |
|---|---|---|
| **v0.2 — Mais agents + terminal real** | 2º/3º agents (Codex `exec --json`, OpenCode `run --format json`) validando a abstração de runner; entra PTY/xterm.js + tmux *control mode* (persistência) onde precisar de terminal | 3 (Code Agents) + 5 (Terminal) |
| **v0.3 — Coordenação + Git** | várias sessões, *worktrees*, diffs/review UI, comparar o mesmo prompt em N agents | 4 + 6 + 11 (enxutas) |
| **v0.4 — Memória de volta** | capturar aprendizado da sessão → `CLAUDE.md`/memórias (sem engine novo) | 2 + 10 (enxutas) |
| **v0.5 — MCP** | MCP client (FileSystem, github, supabase, notion, etc.) | 7 |
| **Talvez** | Workflows/SDD (8 — havia dúvida), agents persistentes (9), orquestração pesada (11), cloud (12) | 8, 9, 11, 12 |

> A regra: só avançar de versão depois do nível anterior estar **em uso diário**.

A abstração que permite o v0.2 sem retrabalho está desenhada em
[`docs/agent-runner.md`](./docs/agent-runner.md) — e deve ser respeitada já no v0.1
(o Claude Code é o primeiro adapter dela).

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Parsing do `stream-json`** (eventos parciais, `tool_use` aninhado, retries) | Spike M0 + camada *adapter* + **pin** de versão testada do CLI; parser defensivo (nunca dropar evento desconhecido) |
| **Formato do CLI muda entre versões** | Adapter isola o formato; `docs/stream-json-notes.md` registra a versão validada |
| **Disciplina de escopo** (tentação de adicionar agent/terminal/memória cedo) | Só avançar após o caminho feliz rodar e ~1 semana de uso |
| **Dependência do `claude` instalado/autenticado** | `detect()` no runner avisa cedo; documentado nos pré-requisitos |
| **Prior art** (Conductor, TmuxCC, Crystal) cobre pedaços | OK para uso pessoal. Se virar produto, o diferencial é *chat-centro + contexto do projeto + multi-agent em UI simples* — não o multiplexing |
| **Agents sem callback de permissão** (PTY/Aider) não dá pra interceptar ação perigosa | Rodar em *worktree* (v0.3) e/ou restringir via config nativa do agent; documentar o limite |

## 9. Stack

Tauri · React · TypeScript · Tailwind · shadcn/ui · SQLite · Zustand · TanStack Query ·
Rust (backend: `spawn`/parse; futuramente `portable-pty`, tmux control mode).

## 10. Glossário rápido

- **Destino**: para onde o chat manda a mensagem (um Agent ou um Modelo direto).
- **Adapter / Runner**: módulo que traduz a saída nativa de um agent para os
  *eventos normalizados* que a UI entende (ver `docs/agent-runner.md`).
- **Política de permissão**: configuração por projeto do quanto o agent pode fazer
  sozinho antes de perguntar.
