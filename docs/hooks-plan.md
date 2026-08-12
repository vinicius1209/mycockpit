# Hooks de status/permissão nos três motores — pesquisa + plano

> Status: **pesquisa concluída (12/08/2026), nada implementado.**
> Pergunta que originou: "sem pensar exclusivamente no Claude Code — como hooks
> funcionam no Codex e no Antigravity?". Método: empírico > docs > blog, nesta
> máquina (claude 2.1.220 · codex-cli 0.146.0 · agy 1.1.12), usando as
> instalações VIVAS do Xirp (ADR-016, só leitura) e do Orca como fixtures reais,
> mais `strings` nos binários e a doc embarcada do agy. Complementa
> `competitors-xirp.md` (a mecânica) e o watchdog (`lib/watchdog.ts`), que
> continua existindo pra todos os motores.

## 0. O resultado em uma frase

**Os três CLIs têm hooks de verdade** — inclusive o Antigravity, que a memória
da casa dava como "quase tudo false". Claude e Codex falam o MESMO dialeto
(settings/hooks.json com eventos PascalCase, stdin JSON, stdout JSON com
`hookSpecificOutput`); o agy fala um dialeto próprio (grupos nomeados,
payload camelCase/protojson) mas com poder equivalente — e em alguns pontos
maior (reescrever args da tool, injetar steps).

## 1. Tabela de capability por CLI (com a evidência de cada célula)

| Capability | Claude Code 2.1.220 | Codex 0.146.0 | Antigravity (agy) 1.1.12 |
|---|---|---|---|
| **Arquivo de config (user)** | `~/.claude/settings.json` chave `hooks` [E1] | `~/.codex/hooks.json` (arquivo dedicado; `"hooks": "./hooks.json"` no binário) [E4][E7] | `~/.gemini/config/hooks.json` [E8] |
| **Escopo projeto** | `.claude/settings.json` + `.local.json` (merge documentado) [E3] | **não verificado** (só user + plugin provados) | `<workspace>/.agents/hooks.json` (changelog 1.1.1) [E10] |
| **Escopo plugin** | `hooks/hooks.json` do plugin [E3] | ✅ provado: `warp@claude-code-warp:hooks/hooks.json` no `hooks.state` [E5] | plugins têm hooks (changelog 1.1.7: "disabled plugins still running their hooks") [E10] |
| **Eventos de status (fire-and-forget)** | 25+: SessionStart/End, UserPromptSubmit, Pre/PostToolUse(+Failure), Notification, Stop/StopFailure, SubagentStart/Stop, Pre/PostCompact, TaskCreated/Completed… [E3] | registrados e trusted nesta máquina: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart/Stop; no binário também: `session_end`, `notification`, `pre_compact`, `task_started/complete` (não testados) [E4][E5][E7] | PreInvocation, PostInvocation, PreToolUse, PostToolUse (matcher regex), Stop. **Sem** SessionStart/Notification — sessão detectável pelo 1º PreInvocation [E8][E9] |
| **Hook de permissão SÍNCRONO** | ✅ evento `PermissionRequest`; stdout `hookSpecificOutput.decision.behavior: allow\|deny\|ask\|escalate` (+`updatedPermissions`) [E2][E3] | ✅ evento `PermissionRequest`; binário embute `PermissionRequestHookSpecificOutputWire` e `PreToolUsePermissionDecisionWire` (`permissionDecision`/`permissionDecisionReason`) — mesmo protocolo do Claude; Xirp instalou o MESMO script síncrono de 30s e o Codex trusted-hashou [E4][E6][E7] | ✅ **via PreToolUse** (não há evento separado): stdout `{"decision": "allow\|deny\|ask\|force_ask", "reason", "permissionOverrides", "overwrite"}` — pode até reescrever os args da tool [E9] |
| **Transporte** | stdin JSON (snake_case: `session_id`, `transcript_path`, `cwd`, `hook_event_name`…) → exit code (0 ok / 2 bloqueia) + stdout JSON. Tipos: command, http, mcp_tool, prompt, agent [E2][E3] | idem Claude (schema wire no binário); tipo `command` nos fixtures; app-server emite `hook/started`/`hook/completed` [E6][E7] | stdin JSON **camelCase** (`conversationId`, `workspacePaths`, `transcriptPath`, `toolCall{name,args}`, `stepIdx`) → stdout JSON. Só `type: "command"`; síncrono, bloqueia o loop [E9] |
| **Timeout default** | 600s (command/http); configurável por hook [E2] | campo `timeout` por hook (fixtures usam 10) [E4] | 30s default; `timeout` em segundos; cwd = dir do hooks.json [E9] |
| **Coexistência de entradas** | ✅ provado: afplay do usuário + thaytool + Xirp + Orca convivem no mesmo settings.json [E1] | ✅ provado: som + Xirp + Orca no mesmo hooks.json [E4] | ✅ formato de GRUPOS NOMEADOS torna natural (`"orca-status": {...}` ao lado de um futuro `"mycockpit-status"`) [E8] |
| **Modelo de confiança** | nenhum além do arquivo ser do usuário | **trust por hook**: `[hooks.state."<arquivo>:<evento>:<i>:<j>"] trusted_hash = sha256:…` no config.toml — hook novo/alterado exige re-trust (prompt na próxima sessão) [E5] | pasta precisa estar trusted (`trustedFolders.json`); reload de hooks ao trocar workspace (changelog 1.1.1) [E10] |
| **Env vars propagadas ao hook** | ✅ empírico: correlação do Xirp (`CHIRP_NOTIFICATION_ID`) e do Orca (`ORCA_*`) vive disso — hook `command` herda o env do processo do CLI [E1][E11] | ✅ idem (mesmos fixtures) [E4][E11] | ✅ Orca injeta `ORCA_ANTIGRAVITY_EVENT` no próprio comando e lê `ORCA_*` do env herdado [E8][E11] |
| **Mecanismo legado paralelo** | statusline (Xirp usa como triangulação) | `notify` no config.toml (`turn-ended` apenas) — coexiste com hooks.json [E5] | — |
| **Versão mínima** | hooks maduros há muitas versões; contrato auditado em 2.1.220 [E3] | feature `hooks` = **stable/true** em 0.146.0 (`codex features list`); mínimo exato não determinado [E7] | hooks existem desde ≤1.0.8, MAS: PostToolUse com matcher confiável só ≥1.1.9 e **Stop hooks só funcionam ≥1.1.10** ("lets Stop hooks run at all") → **exigir agy ≥1.1.10** [E10] |

### Evidências

- **[E1]** `~/.claude/settings.json` — entradas vivas de 4 origens convivendo
  (usuário, thaytool, Xirp com `matcher: ".*"`, Orca), incluindo
  `PermissionRequest`, `PostToolUseFailure`, `StopFailure`, `TeammateIdle`.
- **[E2]** Scripts do Xirp em `~/Library/Application Support/Xirp/xirp-external/
  hook-scripts/claude/*.cjs`: fire-and-forget com socket-timeout 1s e
  `process.exit(0)` em erro; `permissionRequest.cjs` com timeout 30s **pipando a
  resposta HTTP do daemon direto pro stdout** (o round-trip síncrono).
- **[E3]** Docs oficiais (verificadas 12/08/2026 pelo agente-guia):
  code.claude.com/docs/en/hooks.md, hooks-guide.md, settings.md — lista de ~25
  eventos, payload stdin, exit codes, `hookSpecificOutput`, precedência
  managed > CLI args > local > project > user, `CLAUDE_PROJECT_DIR`.
- **[E4]** `~/.codex/hooks.json` — **schema idêntico ao do Claude** (eventos
  PascalCase, matcher, `hooks: [{type: "command", command, timeout}]`), com
  entradas de som, Xirp (incl. `PermissionRequest`) e Orca. Existe
  `hooks.json.bak` ao lado (o padrão de backup do Xirp, funcionando).
- **[E5]** `~/.codex/config.toml` — seção `[hooks.state]` com `trusted_hash`
  sha256 por hook, chaveado por `arquivo:evento:índice`, cobrindo hooks.json do
  usuário E hooks de plugin (`warp@claude-code-warp`); `notify = [...,
  "turn-ended"]` na linha 4 (o mecanismo legado, só fim-de-turno).
- **[E6]** `strings` no binário codex: JSON-schema embutido com
  `PermissionRequestHookSpecificOutputWire`, `PreToolUsePermissionDecisionWire`,
  `permissionDecision`, `permissionDecisionReason`, `hookSpecificOutput`,
  `SessionStart/SubagentStart/UserPromptSubmit…HookSpecificOutputWire`;
  notificações `hook/started`/`hook/completed`; `"hooks": "./hooks.json"`.
- **[E7]** `codex features list` → `hooks  stable  true` (e `plugin_hooks
  removed` — absorvido no mecanismo estável). Ids de evento no binário:
  `session_start`, `session_end`, `user_prompt_submit`, `pre_tool_use`,
  `post_tool_use`, `permission_request`, `notification`, `stop`,
  `subagent_start/stop`, `pre_compact`, `task_started`, `task_complete`.
- **[E8]** `~/.gemini/config/hooks.json` — grupo nomeado `"orca-status"` com
  PreInvocation/PostInvocation/PostToolUse/Stop vivos HOJE; `agy -p "/hooks"
  --output-format json` lista os hooks com `source`, `enabled`, `event`,
  `matcher`, `timeout_seconds` (testado 12/08/2026).
- **[E9]** Doc oficial embarcada:
  `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md` —
  contrato completo por evento (payloads camelCase, `decision:
  allow|deny|ask|force_ask`, `overwrite` de args, `injectSteps`,
  `terminationBehavior: force_continue|terminate`, Stop com `decision:
  "continue"` pra segurar o agente, limitações: só command, síncrono).
- **[E10]** `agy changelog`: 1.0.8 (hooks.json compartilhado em
  `~/.gemini/config/`), 1.0.16 (fix "unknown pre-tool hook decision"), 1.1.1
  (workspace `.agents/hooks.json`), 1.1.7 (hooks de plugin), 1.1.9 (PostToolUse
  matcher), 1.1.10 (ordem: Stop hooks passam a rodar).
- **[E11]** `~/.orca/agent-hooks/{claude,codex,antigravity,cursor}-hook.sh` —
  segunda implementação independente do MESMO padrão: correlação 100% por env
  var (`ORCA_AGENT_HOOK_PORT/TOKEN/PANE_KEY`), curl com `--connect-timeout 0.5
  --max-time 1.5`, `exit 0` sempre — e no agy, o Stop responde
  `{"decision":""}` no stdout ANTES de postar (respeita o contrato síncrono).

### Achados que contradisseram expectativas

1. **agy tem hooks — e tem `--output-format json`.** A memória da casa
   ("Tier A bloqueado, v1.0.16") está desatualizada: 1.1.12 tem
   `--output-format json|stream-json`, `--json-schema`, e um sistema de hooks
   documentado pelo próprio produto. "Não tem" NÃO foi o resultado.
2. **`~/.codex/hooks.json` não é "só notify"**: é um sistema de hooks completo,
   Claude-compatível no schema e no protocolo de resposta, com feature flag
   estável — o `notify` legado coexiste, mas está superado.
3. **Codex tem um modelo de confiança que os outros não têm** (trusted_hash por
   hook). Consequência de design: o que vai no `command` do hooks.json tem que
   ser ESTÁVEL (path do script), e tudo que rotaciona (token) vai DENTRO do
   script gerado — exatamente o que o Xirp faz, e agora sabemos por quê.
4. **O hook de permissão do agy é o PreToolUse** — dispara pra TODO tool call
   casado no matcher, não só quando haveria prompt. O receptor precisa
   responder rápido e devolver `"ask"` como default neutro (é o que preserva o
   comportamento nativo, incluindo o cache de "Always Allow"; `force_ask`
   ignora o cache).

## 2. Desenho agnóstico: capability no registry

Regra da casa: comportamento deriva de `Capabilities` (adapters.rs + espelho em
`lib/agents.ts`), nunca de comparação por nome. Hooks entram como DUAS
capabilities + um enum de dialeto (mesmo padrão do precedente
`command_sources: &'static [CommandSource]` — o enum confina o "como", a
capability decide o "se"):

```rust
/// Dialeto de instalação/protocolo de hooks de um motor. Consumido SÓ pelo
/// instalador e pelo receptor (parse do payload); o resto do app decide por
/// hooks_status/hooks_permission.
pub enum HookDialect {
    /// settings.json chave "hooks", eventos PascalCase, stdin snake_case,
    /// resposta stdout hookSpecificOutput. (claude)
    ClaudeSettings,
    /// ~/.codex/hooks.json, MESMO schema/protocolo do ClaudeSettings, mas com
    /// trust por hook (trusted_hash) e arquivo dedicado. (codex)
    CodexHooksJson,
    /// ~/.gemini/config/hooks.json, grupos nomeados, payload camelCase,
    /// permissão via PreToolUse.decision. (agy)
    AgyConfigHooks,
}

pub struct Capabilities {
    // ...
    /// Emite eventos de ciclo de vida a scripts externos (fire-and-forget):
    /// dá visibilidade de sessões EXTERNAS e status push sem polling.
    pub hooks_status: bool,
    /// O prompt de permissão pode ser decidido por um hook SÍNCRONO
    /// (responder allow/deny/ask de fora do terminal).
    pub hooks_permission: bool,
    /// Como instalar/falar com os hooks deste motor. None = sem hooks.
    pub hook_dialect: Option<HookDialect>,
}
```

Valores por versão auditada (§7.1 — verdade provada, na dúvida `false`):

| | claude 2.1.220 | codex 0.146.0 | agy 1.1.12 |
|---|---|---|---|
| `hooks_status` | ✅ | ✅ | ✅ (exigir ≥1.1.10 no gate de versão do boot; abaixo disso, declarar false) |
| `hooks_permission` | ✅ | ✅ | ✅ (dialeto: PreToolUse.decision) |
| `hook_dialect` | `ClaudeSettings` | `CodexHooksJson` | `AgyConfigHooks` |

Regras de consumo:

- **O app só oferece/instala hooks em quem declara a capability.** Motor novo
  sem `hook_dialect` ⇒ o card de Configurações nem mostra a opção.
- **Quem não tem (ou não instalou) degrada honestamente pro watchdog** — que
  continua existindo pra TODOS: o vigia de turno mudo, cards e missões
  (`lib/watchdog.ts`) não depende de hooks e não é substituído por eles.
  Hooks são push barato; watchdog é a rede de segurança pull.
- **Hooks ≠ stream-json.** Para runs que o PRÓPRIO app spawna, o adapter já
  tem eventos estruturados melhores (messageNodes, custo, evidência). A síntese
  do estudo do Xirp continua valendo: hooks complementam, não substituem.
  O valor único dos hooks é o que o adapter NÃO vê: sessões abertas no
  terminal e o prompt de permissão de qualquer sessão.
- Espelho TS: `lib/agents.ts` ganha os mesmos campos; teste de contrato
  (`agents.caps.test.ts` + `contrato_capabilities_x_comportamento_por_agent`)
  cobra Rust ↔ TS ↔ comportamento.
- Normalização no receptor: o payload de cada dialeto vira UM evento interno
  (`hook_event`: engine, kind, session, cwd, ts, raw) — mapa de status:
  - ClaudeSettings/CodexHooksJson: SessionStart→ativa · UserPromptSubmit/
    PreToolUse→working · Notification (só claude)→waiting ·
    PermissionRequest→blocked · Stop→idle · SessionEnd (a testar no codex)→fim.
  - AgyConfigHooks: PreInvocation→working (1º da conversa = sessão nova) ·
    PostToolUse→heartbeat · PreToolUse com decision pendente→blocked ·
    Stop→idle. Sem sinal "waiting" — a UI não inventa (degradação honesta).

## 3. O que os hooks habilitam no MyCockpit (fases)

**H0 — Receptor (fundação, sem instalar nada nos CLIs).** Endpoint HTTP
localhost no app (porta efêmera + token bearer), rota por dialeto
(`/hook/<engine>`), normalização acima, e o arquivo de estado
`hook-endpoint` que os scripts leem (padrão Orca: script funciona mesmo com o
app fechado — não acha endpoint, sai 0). Nada de UI ainda.

> **H0 ENTREGUE (12/08/2026)** pela frente do medidor de janela de uso:
> `app/src-tauri/src/hook_gateway.rs` — loopback + porta efêmera, token
> rotacionado por boot em `hook-endpoint.json` (0600 desde a criação, variante
> privada do fsx), rota `POST /hook/{engine}` com bearer em tempo constante,
> limite de corpo explícito (64 KB) e payload desconhecido = **204
> aceito-e-ignorado** (fail-open do lado do script). Consumidor atual: a
> statusline do claude (`rate_limits` → `usage_window.rs`, capability
> `usage_window` — ADR-038). A normalização de eventos de status/permissão
> (`hook_event`) continua pendente e entra com H1/H2, plugando NESTA rota sem
> mudar o contrato do script.

> **H1 + H2 ENTREGUES (12/08/2026).** Capabilities `hooks_status`/
> `hooks_permission` + `HookDialect` no registry (adapters.rs ↔ lib/agents.ts,
> matriz-gêmea `matriz_de_hooks_por_agent` ↔ agents.hooks.test.ts). Instalador
> respeitoso por dialeto em `hooks_install.rs` (entrada AO LADO das
> existentes, backup .bak-mycockpit, script fail-open com evento em $1 e
> comando estável pro trusted_hash do codex, gate agy ≥1.1.10, permissão como
> opt-in separado — agy escopado a `run_command`). Presença de sessões
> externas em `hook_sessions.rs` (memória, replay-safe, correlação
> `MYCOCKPIT_RUN_ID` via header) → Painel ("No terminal, observando") + tray/
> popover + Configurações. Permissão síncrona: round-trip no hook_gateway
> segura a resposta HTTP até a decisão humana (fila única de interações →
> card global/Companion/sino), timeout 30s ⇒ `ask` (fail-safe: prompt nativo
> no terminal; card resolvido — sem teatro), sessão fica `blocked` sticky até
> o evento correlacionado. Fixtures REAIS do claude 2.1.220 capturadas nesta
> máquina; PermissionRequest não dispara em `-p` (auto-deny, verificado) — a
> fixture dele vem do contrato documentado + script vivo do Xirp.
>
> **Decisão de cor (revisão):** o brief pedia sessão externa "cinza/neutra",
> mas cinza ficou SÓ pra `idle` — sessão viva pintada de cinza pareceria
> morta, e "está trabalhando" é informação verdadeira. `working` herda o azul
> de vivo (`st-running`) e `waiting`/`blocked` o âmbar de "precisa de você"
> (`st-warning`); o que distingue a sessão externa da do app é o RÓTULO ("No
> terminal · observando") + a ausência de controles, não o tom. Registrado em
> `statusTone` (externalSessions.ts) e no `external_status_pt` do tray.
>
> **Correlação (ressalva fechada):** todo spawn de CLI passa por
> `hook_sessions::correlate_run` (run_once, codex app-server e as meta-tarefas
> `claude -p` do juiz/sugestões, com a sentinela `"oneshot"`), o ponto único
> que impede a meta-tarefa do app de virar sessão externa fantasma no Painel.

**H1 — Status de sessões EXTERNAS no Painel/tray.** O usuário abre `claude`/
`codex`/`agy` no terminal e o MyCockpit mostra a sessão (projeto, estado
working/waiting/blocked/idle, último evento) no Painel e no tray — coisa que o
watchdog nunca viu, porque só observa runs do app. Correlação: sessões
spawnadas pelo app carregam `MYCOCKPIT_RUN_ID` no env (herdado pelo hook,
[E11]); sessão sem env = externa, identificada por `session_id`/
`conversationId` + cwd. Todos os três motores entram já em H1.

**H2 — Permissão respondível na UI/Companion (o síncrono).** O prompt de
permissão do CLI é decidido no app: claude/codex via `PermissionRequest`
(stdout `decision.behavior`), agy via `PreToolUse` (`decision`). Round-trip com
teto (30s como o Xirp) e **default fail-open pro CLI**: sem resposta do app ⇒
`ask` (claude/codex: behavior "ask"; agy: decision "ask") — o prompt nativo
aparece no terminal como sempre, nunca um deny fantasma por timeout nosso.
(Não confundir com a guarda fail-closed dos runs desassistidos DO APP, que é
outra camada e continua no watchdog.) H2 é onde o Companion vira aprovador de
QUALQUER sessão da máquina, não só das nossas.

**H3 — Alertas/outputs mais profissionais.** Com o push do H1: notificação
nativa "sessão X esperando você" (Notification/blocked), resumo de fim de
sessão (Stop + terminationReason do agy: `model_stop`/`max_steps_exceeded`/
`error`), falha destacada (StopFailure/PostToolUseFailure no claude;
`error` no PostToolUse do agy), e o tray parando de mostrar só o que o app
spawnou. Aqui entram os "outputs e alertas mais profissionais" pedidos — os
eventos já carregam o motivo, não precisa inferir.

Fora de escopo (registrado pra não voltar): usar PreInvocation/injectSteps do
agy pra injetar contexto (é canal de sistema disfarçado — avaliar no
prompt-hygiene-plan, não aqui); Stop com `force_continue`/`decision:continue`
pra segurar agente (é político demais pra um orquestrador supervisionado);
hooks tipo http do claude (menos uniforme entre motores; o script gerado dá o
mesmo resultado com fail-open sob NOSSO controle).

## 4. Padrão de instalação respeitosa (as regras do Xirp que adotamos)

1. **Entrada própria AO LADO das existentes, nunca substituindo.** Claude/
   Codex: append de entrada com nosso comando nos arrays de cada evento
   (coexistência provada em [E1][E4]); agy: grupo nomeado
   `"mycockpit"` (coexistência é a forma natural do formato, [E8]).
2. **Script gerado com header "não edite"**: `# Generated by MyCockpit —
   DO NOT EDIT (regenerado a cada instalação)` + schema versionado no header,
   um script por motor/evento em diretório NOSSO
   (`~/Library/Application Support/mycockpit/hook-scripts/<engine>/`).
3. **Token local com rotação DENTRO do script, nunca no config** — regra nova,
   aprendida do trust model do Codex [E5]: o `command` no hooks.json referencia
   só o path estável; rotacionar o token regenera o script sem mudar o
   comando ⇒ o `trusted_hash` continua válido e o usuário não é re-perguntado.
   (Mudar o COMANDO de propósito ⇒ aceitar que o Codex vai pedir re-trust —
   é feature do Codex, avisar na UI, não contornar.)
4. **Backup antes de mexer**: `<arquivo>.bak-mycockpit-<timestamp>` (precedente
   nosso: `config.toml.bak-cockpit-remove-…`; precedente deles:
   `hooks.json.bak`). JSON editado por parse→merge→write atômico, nunca regex.
5. **Desinstalação limpa**: remover SÓ as nossas entradas (identificáveis pelo
   path do nosso script / nome do nosso grupo) + nossos scripts; o resto do
   arquivo fica byte-a-byte como estava.
6. **Fail-open por construção**: fire-and-forget com connect-timeout ~1s e erro
   engolido (`exit 0` sempre); síncrono com teto de 30s e default neutro
   (`ask`) — app fechado/travado = CLI se comporta como se não houvesse hook.
   Os DOIS perfis já existem prontos como referência nos fixtures [E2][E11].
7. **Correlação por env var** (`MYCOCKPIT_RUN_ID`, setada só nos runs que o app
   spawna): inofensiva fora do app — env vazia não muda nada no script, que
   posta mesmo assim (é isso que dá o H1 de sessões externas).

## 5. Guardas

- **Nada instalado sem gesto do usuário.** A instalação é um botão em
  Configurações (e, no futuro, um passo de onboarding no estilo "instalação de
  capacidades" do Xirp: cada passo diz o benefício na frase e é opcional —
  "highly recommended", nunca obrigatório). Sem gesto, o app funciona como
  hoje: adapter + watchdog.
- **O config do usuário é DELE**: mostrar exatamente o que será escrito e onde
  ANTES de escrever (diff na UI), backup automático, botão de desfazer que
  restaura, e a seção de Configurações com escopo explícito na cara (regra da
  casa de escopo em Configurações).
- **Reversível e transparente**: desinstalar deixa os arquivos como estavam;
  o estado "hooks instalados/desatualizados/ausentes" é visível por motor
  (hash do script esperado vs presente), com "reinstalar" idempotente.
- **Fail-open sempre no caminho do CLI** (o CLI do usuário nunca pode piorar
  porque o nosso app morreu); fail-closed continua sendo regra só das nossas
  automações desassistidas, no watchdog, como já é.
- **Gate de versão honesto**: capability declarada por versão auditada (§7.1);
  agy <1.1.10 ⇒ `hooks_status:false` (Stop não roda) e a UI explica o porquê
  em vez de instalar algo que não funciona.
- **Nunca responder permissão automaticamente por default**: H2 responde o que
  o HUMANO tocou na UI/Companion; timeout ⇒ `ask` (prompt nativo no terminal).
  Auto-regras, se um dia existirem, são outro plano e outra guarda.
