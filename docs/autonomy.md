# Autonomia & Auto-aprendizado — o norte do MyCockpit

> Visão: o MyCockpit não é só uma interface pra CLIs de agents — é um
> **cockpit de trabalho autônomo multi-agente** que **fica mais esperto com o
> uso**. Loops, times, modos (Linear/Fusion/Mission/SDD), auto-search e
> auto-aprendizado. Este doc separa as duas dimensões (rodar sozinho ×
> aprender), mapeia o que já existe e propõe um roadmap incremental sobre a
> arquitetura real. Data: 2026-07-13.

## As duas dimensões (não confundir)

1. **AUTONOMIA** — rodar sem babá: loops que não morrem, times de agents,
   aprovação granular, revezamento. É "deixar rodando de madrugada".
2. **APRENDIZADO** — ficar melhor: acumular o que funcionou, destilar lições,
   auto-tunar time/roteamento por custo. É "amanhã ele erra menos que hoje".

São ortogonais e se reforçam: autonomia gera dados (entregas, gates, custo);
aprendizado usa esses dados pra tornar a próxima autonomia mais barata e certeira.

---

## O que já existe (inventário rumo à autonomia)

| Peça | Serve à autonomia | Serve ao aprendizado |
|---|---|---|
| Linear / Fusion / Mission / SDD | orquestração (1 agent / disputa / pipeline / spec) | — |
| Handoff tipado `.mission/*.json` | contexto entre fases | fonte de `open_questions`/decisões (M2) |
| Loop de correção do reviewer (Mission M2) | fecha o ciclo sozinho | diferença reprovado→aprovado = lição (M2) |
| **`stage_runs`** (skill/agent/model/**ok**/**cost_usd**) | — | **o reward já existe** (M1, M3) |
| Custo por entrega (US$/feature) | — | sinal de eficiência (M3) |
| Worktrees git por conversa | isolamento p/ rodar em paralelo | diff = verdade da entrega |
| `.claude/` (CLAUDE.md, skills, commands, memory) | contexto que **só o Claude Code** lê | — (ver `.mycockpit/`) |
| **`.mycockpit/`** (instructions.md, agents/, config.toml) | **contexto que o APP injeta — vale nos três** | doutrina e personas versionadas no git (ADR-025) |
| Helper Haiku pós-turno (sugestões) | — | motor barato p/ destilar/curar (M2/M4/M6) |
| **Auto-revive em rate limit** (entregue 2026-07-13) | não morre à noite | — |

O buraco: **falta o loop de feedback** que transforma *resultado* em
*conhecimento persistido e reusável*. Hoje toda execução começa do zero
cognitivamente.

---

## Dimensão 1 — AUTONOMIA

### Já entregue
- **Auto-revive**: turno que termina em rate limit / "vou tentar depois"
  reagenda sozinho (backoff/cap, opt-in). `lib/autoResume.ts`.

### Próximo tijolo: aprovação GRANULAR sem matar o turno (`--permission-prompt-tool`)
Investigado (doc oficial do Claude Code): é **viável e é o jeito certo**. Fluxo:
```
Claude quer rodar `python script.py`  (em vez de errar "requires approval")
  → claude -p PAUSA e chama a tool approval_prompt de um MCP server local
  → MyCockpit mostra "Aprovar / Negar" (com o comando exato)
  → você decide → a tool devolve {behavior: allow|deny}  → o turno CONTINUA
```
- Bloqueia esperando (turno vivo, sem timeout por padrão); funciona com
  `-p --output-format stream-json`. Aprovar libera **só aquele comando** (não a
  sessão). Pode até sanitizar o input antes de aprovar.
- **Custo**: MyCockpit hospedar um MCP server stdio + IPC pra UI + wire
  `--mcp-config` + `--permission-prompt-tool` no adapter Claude + modal que
  pausa o fio. Complexidade média-alta. Codex headless não tem equivalente
  direto (só sandbox modes) — degradação: no Codex fica no esquema atual.
- **Por que importa**: com aprovação granular + auto-revive + permissões, dá
  pra rodar autônomo à noite com controle FINO do que precisa do seu OK.

### Depois: loops de time (já temos as primitivas)
Fusion (paralelo competitivo) e Mission (pipeline sequencial com papéis) já são
os "times". Evolução: paralelismo de executores no Mission (mailbox à la
team-core) e um líder que delega sozinho — mas só com dados dos modos atuais
(evitar Sisyphus prematuro).

---

## Dimensão 2 — AUTO-APRENDIZADO

### O princípio transversal (do logion + ACE + Voyager) — não negociável
1. **Grave só o que passou no gate** (entrega com `ok=true`), nunca todo turno.
2. **Consulte antes de agir**, com ranking de confiança (HIGH/MED/LOW) — se o
   recall local é forte, nem busca fora (hierarquia do `recall` do logion).
3. **Nunca promova a memória permanente sem revisão** — o app *propõe*, você
   aprova. Aprendizado que você não audita degrada em silêncio.
4. **Artefatos pequenos e destilados** (uma regra, não o transcript) e updates
   **incrementais** (nunca reescrever o arquivo inteiro — o "context collapse"
   que o ACE evita).

Isso mantém o ruído baixo e mata o over-engineering que afunda sistemas
"auto-aprendentes".

### Os mecanismos (ancorados na arquitetura real), do menor risco ao maior

**M1 — Delivery recall (reusar o que já deu certo)** · complexidade BAIXA
- Aprende: pares tarefa→resolução que passaram nos gates.
- Sinal: `ok`/merge no `stage_runs` (já gravado). É o `recall` do logion + AWM,
  sem custo de treino.
- Persiste: tabela `deliveries` (SQLite) ou `.claude/cockpit/recall.md` —
  {keywords/paths da tarefa, plano vencedor, arquivos tocados, custo, agent/modelo}.
- Reuso: antes de um Mission/SDD novo, lookup fuzzy injeta "features similares
  já entregues" no prompt do planner. **Comece por keyword/path overlap, não
  force embeddings no v1.**

**M2 — Lessons learned do handoff `.mission/`** · complexidade BAIXA-MÉDIA
- Aprende: regras acionáveis dos `open_questions` e da diferença reprovado→
  aprovado do reviewer (o loop de correção que já existe).
- Persiste: append em `.claude/cockpit/lessons.md` — que o `context.ts` já
  inventaria → **entra no contexto de todo agent automaticamente**, sem novo
  encanamento. Convenção Claude Code: "promove após recorrer 2-3×".
- Mitigação do inchaço: cap de N lições + dedup pelo Haiku (curador, M6);
  nunca reescreve o arquivo inteiro.

**M3 — Auto-tuning de time/roteamento por custo-por-entrega** · MÉDIA
- Aprende: qual (agent × modelo × persona) entrega dado tipo de tarefa com
  melhor custo/sucesso (ex.: "UI → `agy` executor, 80% aprovação a US$3").
- Sinal: agregado sobre `stage_runs` (success-rate + custo médio por categoria).
  Reward explícito, verificável, já persistido. Alavanca o seu diferencial
  US$/feature.
- Reuso: ao montar um `MissionPreset`, o app sugere o binômio historicamente
  melhor — bandit simples (epsilon-greedy), não RL.
- Honesto: cold-start — só recomenda após ~N entregas por categoria, senão é
  superstição estatística.

**M4 — Auto-search/auto-context antes de agir** · MÉDIA
- Fase 0 "scout": o helper Haiku decide *o que buscar* (grep no módulo X, ler
  doc Y, web Z) e popula `.mission/0-scout.json` antes do planner.
- Gate por confiança: só busca se o recall de M1 vier LOW/NONE (hierarquia do
  logion). Mitiga over-fetch e custo por turno.

**M5 — Skill library evolutiva (promover workflow vencedor a `/command`)** · MÉDIA-ALTA
- Sequências que resolveram uma classe de tarefa (recorrência ≥2-3) viram uma
  skill nomeada em `.claude/commands/` (infra nativa, zero runtime novo).
- **Sempre com aprovação humana** (como o logion: "nunca automática"). Sem
  isso, vira lixo acumulado. Alto risco de over-engineering — por último.

**M6 — Curador de memória (ACE)** · MÉDIA
- Mantém M2/M5 enxutos: dedup, funde, poda lições/skills obsoletas (rebaixa o
  que correlaciona com falha). Roda periódico via Haiku barato, updates
  incrementais. Só depois que M2 inchar (prematuro antes).

### Sequência recomendada
1. **M1 + M2** — baixo custo, reaproveitam SQLite + `.claude/`, sinal já existe. **Começar aqui.**
2. **M3** — quando houver dados; alavanca US$/feature.
3. **M4** — reusa o helper Haiku.
4. **M6** quando M2 inchar; **M5** por último e com aprovação humana.

---

## Dimensão 2b — Aprender no LINEAR (feedback, não gates)

Correção de rumo (pedido do usuário 2026-07-13): o aprendizado NÃO pode ficar
preso aos gates do SDD. O **Linear** é onde é o trabalho do dia a dia, e lá o
sinal não é "passou no teste" — é **o feedback do usuário**. E deve virar
lição/skill no **domínio do MyCockpit**, desacoplado do SDD.

### A arquitetura que resolve: MEMÓRIA (uma) × FONTES DE SINAL (várias)
A camada de aprendizado é do domínio MyCockpit, **mode-agnostic**. Cada modo só
contribui um sinal diferente pra MESMA tabela `lessons` (que já tem `source`):

| Modo | Sinal | Vira |
|---|---|---|
| SDD / Mission | gates + loop do reviewer | `lesson` (source: gate/reviewer) |
| **Linear** | **feedback do usuário** | `lesson` (source: linear) |
| Fusion | qual candidato você escolheu | preferência de time (M3) |

O Linear é só **mais uma fonte** alimentando o cofre. Não é retrabalho — é o
campo `source`/`scope` + a captura de sinal. Zero acoplamento com o SDD.

### Como o Hermes Agent (NousResearch) faz — e onde divergimos
O "Hermes que aprende" é o `NousResearch/hermes-agent` ("the agent that grows
with you") — a versão viva de "Linear + memória", SEM gates de teste:
- **Skill induction**: cria uma skill markdown (padrão agentskills.io) quando
  dispara um gatilho — **≥5 tool calls, recuperação de erro, correção do
  usuário, ou workflow não-óbvio que funcionou**.
- **Patch, não rewrite**: refina a skill só no trecho que mudou (anti
  context-collapse, = ACE).
- **Memória auto-editável via "nudge periódico"**: o agente revê e decide o que
  persistir; `MEMORY.md` tem **cap de 3.575 chars** — força destilar, não acumular.
- **Recall episódico**: sessões em SQLite FTS5, sumarizadas por LLM antes de
  injetar (não despeja a sessão).
- **DIVERGÊNCIA-CHAVE**: o Hermes cria skill **automaticamente, sem aprovação
  humana**. Nós fazemos o OPOSTO (princípio do logion): o app **propõe**, você
  aprova. É escolha de design deliberada — mantém o gate humano.

### O caveat honesto (EMNLP 2025, arxiv 2507.23158)
Feedback IMPLÍCITO é ótimo pra *entender* o usuário, mas **ruidoso como sinal de
aprendizado** (o ganho some em tarefas longas/complexas). Regra de ouro:
**explícito vira lição; implícito vira só ranking/candidato** (sempre confirmado).

### Sinais no Linear (prioridade)
**Explícitos (baixo ruído — v1):**
- 👍/👎 por mensagem do agente (👎 abre "o que estava errado?").
- "Salvar como regra" / "Salvar como skill" (promoção com gate humano).
- Aceitar/Rejeitar/Editar um diff (o sinal mais forte e barato — padrão Copilot).

**Implícitos (só candidato/ranking, nunca lição direta):**
- Reprompt de correção ("na verdade…", "não é isso") → *candidato* (o Haiku
  classifica "foi correção?" antes de propor lição).
- Elogio curto ("perfeito", "isso") → reforço/bump do último turno.
- Abandono vs continuação → sinal fraco.

### Da correção → `lesson` de domínio (reusa a infra da Frente A)
1. Detecta candidato (👎 / "salvar regra" / reprompt-correção).
2. Destila com Haiku → **uma regra imperativa curta** (nunca o transcript).
3. **Gate humano**: o app propõe num toast/inbox; você confirma/edita/descarta.
4. Persiste em `lessons` com `source='linear'` + `scope`.
5. Injeta no início do turno do Linear (top-N por relevância via `recall.ts` +
   `uses`), e faz `bumpLessonUses` nas injetadas.

### Camadas: GLOBAL (app) × PROJETO (Letta/MemGPT)
| Camada | Guarda | Persiste | Injeta em |
|---|---|---|---|
| **GLOBAL** | verdades do domínio ("prefira patch a rewrite", "confirme antes de comando destrutivo") | `lessons` scope='global' (project_id `__global__`) + `~/.claude/cockpit/lessons-global.md` | todo projeto |
| **PROJETO** | preso ao codebase ("testes rodam com `pnpm test`") | `lessons` scope='project' | só aquele projeto |

Mínimo: coluna `scope` via `ALTER TABLE` idempotente; `listLessons` faz
`WHERE scope='global' OR project_id=$1`.

### Funil de LEARNABILITY (não basta o gate humano)
Problema real (feedback do usuário 2026-07-13): 👍/👎 sem inteligência deixa
ruído virar lição — uma resposta de status ("aguardando rate limit, rodo em
3min") não tem NADA a aprender, mas a destilação fabricaria uma regra. O gate
humano sozinho não basta (fardo + o humano deixa passar lixo). Solução:
**o modelo filtra o lixo ANTES; o humano decide no topo do funil.**

| Estágio | O que faz | Fonte | Status |
|---|---|---|---|
| **0 · Juiz de learnability** | antes de propor, o Haiku julga "há algo durável/genérico?" (à la *importance score* do Generative Agents). NENHUMA → avisa "pouco generalizável", mas NÃO bloqueia (o humano pode salvar mesmo assim — caveat EMNLP: o filtro erra nos dois sentidos) | Generative Agents 2304.03442 · EMNLP 2507.23158 | ✅ ENTREGUE (learning.ts `distillCandidate` → `{rule, learnable}`) |
| **1 · Candidato × Ativo** | lição fraca fica candidata (não injeta); "salvar regra" explícito entra ativa | ExpeL 2308.10144 | ⏳ schema depois |
| **2 · Recorrência** | one-off não promove; espera repetir 2-3× | convenção CC / AWM | ⏳ com volume |
| **3 · Curador/decay** | poda lição nunca reusada / que correlaciona com pior resultado | ACE 2510.04618 | ⏳ M6, com volume |

Mínimo-viável = estágio 0 (feito). Estágios 2/3 são **over-engineering agora**
(decidir no ruído com poucas lições) — reservar os campos, implementar com volume.

### Em construção (2026-07-13): CURADOR + SKILLS (decisão: Curador + Skills)
Base compartilhada — **status da lição** (estágio 1): `lessons` ganha
`status TEXT DEFAULT 'active'` ('active'|'candidate'|'archived'),
`last_used_at INTEGER`, `reinforced INTEGER DEFAULT 0` (ALTER TABLE idempotente).
Só `status='active'` é injetado. Save explícito (Linear 👎/salvar) → active;
derivada do loop do Mission → candidate (não injeta até promover). 👍 que reforça
lições injetadas bumpa `reinforced`; injeção bumpa `uses`+`last_used_at`.

- **Curador** (estágio 3): função + botão "Revisar memória" na LearningSection.
  (a) DEDUP de lições ativas quase-iguais (similaridade de token ≥ limiar; reusa
  isNovelRule) → mantém uma, soma uses. (b) REBAIXA ativas com `uses ≥ N` e
  `reinforced = 0` (injetadas muito, nunca reforçadas) → candidate/archived. UI:
  badge de status + promover/rebaixar/excluir + "Revisar memória".
- **Skills (M5)**: promover workflow vencedor a `/command`. Gatilho EXPLÍCITO
  ("Salvar como skill" no ⌘K/CommandMenu). Fluxo: Haiku lê o transcript → rascunha
  `.claude/commands/<name>.md` (nome+descrição+passos) → dialog editável → seu OK
  → comando Rust `write_skill(projectPath, name, content)` grava (fsx atômico,
  nome sanitizado). Aparece no inventário `.claude/` (context.ts já conta). SEMPRE
  aprovação humana (Voyager+logion). Recorrência (auto-detectar workflow) fica p/ depois.
- **Recorrência (estágio 2)**: gancho DORMENTE (campos existem; ativa com volume).

### Sequência Linear (menor risco → maior)
1. **👍/👎 + "salvar como regra"** (explícito → lesson com gate) + coluna
   `scope` — **primeiro tijolo do Linear**, baixo risco.
2. Accept/reject/edit de diff como sinal.
3. Detecção implícita de reprompt-correção (opt-in, sempre confirma).
4. Promover workflow → `/command` skill (M5, humano no gate, por último).

## Estado da arte consultado (fontes)
Reflexion (arxiv 2303.11366), Generative Agents (2304.03442), mem0 (2504.19413),
Letta/MemGPT (2310.08560), ExpeL (2308.10144), Agent Workflow Memory / AWM ICML
2025 (2409.07429), ACE (2510.04618), DSPy (dspy.ai), Promptbreeder (2309.16797),
Voyager (2305.16291), Self-RAG (2310.11511), SWE-RL/SWE-Gym (2502.18449),
Claude Code memory (code.claude.com/docs/en/memory), logion
(github.com/nicolasmelo1/logion — marketplace de capacidades verificáveis,
padrão `recall` + "nunca promover sem revisão").

## Recomendação
Primeiro tijolo: **M1 (delivery recall) + M2 (lessons.md)**. Baratos, o sinal
(`stage_runs.ok` + gates) já existe, persistem em infra nativa (SQLite +
`.claude/`), e alimentam todos os outros mecanismos. Em paralelo, a **aprovação
granular** fecha a autonomia noturna. Fusion/Mission/SDD já são os "times" —
o que falta é o loop de memória por cima.
