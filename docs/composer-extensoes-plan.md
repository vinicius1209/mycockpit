# Composer que conhece o motor: comandos, skills e plugins por agent

> **Status (14/09/2026):** F1 e F3 implementados; F2 e F4 em parte (ADR-189,
> que manda sobre o texto abaixo onde divergir). F5 é frente separada.
> Feito: inventário do `init` do Claude, `skills/list` do Codex, plugins e skills
> em disco como fallback, 4 builtins auditados, popover com seções, busca na
> descrição, chip único e rodapé de procedência. Os nomes finais são
> `CommandInventory::{ClaudeRunInit, CodexSkillsList}` e `providerPlugin`.
> Falta: sonda de `$nome`/item `skill` no Codex (hoje expande o SKILL.md),
> `argument-hint` como texto-fantasma, contagem por plugin, aviso de `/comando`
> inexistente ao trocar de motor, builtins do Codex e do agy, e a marca de MCP
> de plugin cortado no run gerenciado. Payloads em
> `docs/evidence/composer-inventario/` e fixtures em `app/src-tauri/testdata/`.

## O sintoma

Com Claude Code numa conversa do mycockpit, o "/" oferece **dois** itens:
`/compactar` (builtin da Frota) e `/build` (skill do projeto). No mesmo instante,
o `system/init` do Claude Code 2.1.270 anuncia **57 comandos, 22 skills e 7
plugins** (vercel, paper-desktop, frontend-design, supabase…). O Codex 0.154
anuncia 18 skills e 17 plugins instalados. O composer não vê nenhum deles.

## Por que o popover é pobre (causas medidas)

1. **A descoberta é por pasta, não pelo motor.** `sources.rs::collect_agent_commands_with_plugins`
   lê `.mycockpit/commands`, os plugins da Frota e a `CommandSource` do adapter
   (`ClaudeDirs` = `.claude/commands|skills`; `CodexPrompts` = `~/.codex/prompts`).
   Nada lê `~/.claude/plugins/**`, `~/.codex/plugins/**`, `~/.codex/skills` nem os
   builtins dos CLIs.
2. **As 6 skills globais do Claude são symlinks quebrados.**
   `~/.claude/skills/* → ~/.agents/skills/*`, e `~/.agents/skills` está vazio.
   `collect_skills` exige `is_dir()` e as descarta em silêncio. (Isto é da máquina,
   não do app; mas o app deveria dizer "6 skills com link quebrado" em vez de sumir.)
3. **Codex mudou de convenção.** `~/.codex/prompts` foi o mecanismo antigo; hoje o
   Codex tem skills (`$nome`) e plugins, e a Frota só lê `prompts`.
4. **Plugins da Frota não têm porta de entrada.** O runtime v1 (ADR-127/130,
   `docs/plugin-runtime.md`) valida, aprova e publica skills/MCP/tools, mas não
   existe comando de instalar/importar: a pasta `app_data/plugins` nem existe
   nesta máquina. Na prática, "plugin da Frota" hoje só funciona para quem copia
   a pasta à mão.

## O que cada motor oferece (evidência, não suposição)

| | Claude Code 2.1.270 | Codex 0.154.0 | agy 1.2.2 |
|---|---|---|---|
| inventário estruturado | `system/init`: `slash_commands`, `skills`, `plugins[{name,path,source}]`, `terminal_slash_commands`, `agents`, `mcp_servers[{name,status}]` | `codex app-server`: `skills/list` (nome, descrição, `interface.displayName`, `path`, `scope`, `pluginId`, `enabled`) e `plugin/installed` | `init` do stream só traz `cwd`, `permission_mode`, `tools`. `agy plugin list` existe (texto) |
| custo de obter | chega em TODO run; sondar sem turno dispara hooks e conecta MCPs | JSON-RPC sem turno de modelo, ~1s | nenhum canal estruturado |
| descrição | só nomes; descrição sai do disco via `plugins[].path` | vem pronta | n/a |
| como invocar | `/nome` cru no início do prompt (plugin: `/plugin:skill`) | `$nome` no texto, ou item `{type:"skill",name,path}` no `turn/start` do app-server | `/nome` expandido pelo CLI em print mode (`--disable-slash-commands` desliga) |
| builtin no headless | `claude -p "/context"` e `"/config"` respondem com `num_turns:0`, `cost:0` (medido). `/vercel:logs` rodou como skill | não medido | `/credits` → `command_result` (14/08) |

Consequência de desenho: **cada motor tem um canal de verdade diferente**, então
isso é capability, não `if agent ===`.

## Proposta

### F1 · Inventário do motor como capability (backend)

Nova capability nos dois lados (`adapters.rs` + `lib/agents.ts`, teste-gêmeo e
contrato), ao lado de `command_sources`, que continua valendo para a leitura de
disco:

```rust
pub enum CommandInventory {
    /// Lido do evento de início de run (Claude: system/init).
    RunInit,
    /// Consultado sem turno (Codex: app-server skills/list + plugin/installed).
    SideQuery,
    /// Sem canal auditado: só disco declarado (agy hoje).
    None,
}
```

- **RunInit:** o parser do Claude já vê o `init` (fixture em `adapters.rs:4512`).
  Capturar `slash_commands/skills/plugins/terminal_slash_commands` num cache por
  `(agent, projeto)` com `observadoEm`. Descrição: frontmatter de
  `plugins[].path/{commands,skills}` e das pastas `.claude/*` já lidas. Antes do
  primeiro run do projeto, cai no disco (F1b) e marca a origem como "disco".
  **Não** criar sonda que spawna `claude -p` só para ler o `init`: dispara hooks de
  `SessionStart` e conecta todos os MCPs, é trabalho fantasma.
- **SideQuery:** comando Tauri fora da thread principal (ADR-170) que abre
  `codex app-server`, faz `initialize` → `skills/list {cwds:[projeto]}` →
  `plugin/installed`, e fecha. Timeout curto; falha = inventário de disco com
  aviso, nunca popover vazio fingindo "sem comandos". O app-server é
  `[experimental]` (ver `codex_appserver.rs`), então isto é fail-open.
- **F1b, disco honesto:** ler `installed_plugins.json` + `enabledPlugins` do
  `settings.json` para o Claude; link quebrado vira item diagnóstico, não some.
- `SlashCommand` ganha `plugin?: {id, name}` do provider (distinto do
  `pluginKey` da Frota, que tem proveniência verificada), `argumentHint`
  (frontmatter `argument-hint`) e `invocation: "slash" | "dollar" | "expand"`.

### F2 · Invocação correta por motor

Hoje `expandSlashCommand` decide entre "cru" e "expande o corpo". Passa a haver
três formas, decididas pela capability:

- Claude: cru (já é assim); plugin e builtin também, porque o CLI resolve.
- Codex app-server: item `skill` no `turn/start` (nome + path do `skills/list`).
  Codex `exec`: **sondar** se `$nome` no texto aciona a skill; se não, expandir
  o `SKILL.md` app-side, como já se faz com prompts.
- agy: manter a expansão app-side até auditar uma fonte de comando custom
  (comentário de `native_slash` em `adapters.rs:839` segue valendo).
- Embedded (fila, handoff, fase de missão): regra atual continua; skill de
  plugin de provider sem corpo legível entra com a nota honesta do revezamento.

### F3 · Builtins do CLI com política declarada

Os 57 comandos do Claude misturam três coisas. Mostrar tudo seria mentir,
esconder tudo também. Tabela por adapter (dado do adapter, não código genérico):

- **terminal-only** (`terminal_slash_commands`: doctor, color, reload-plugins):
  nunca aparecem.
- **controlados pela Frota** (model, effort, fast, compact, clear, mcp, agents,
  permissões): não aparecem como "/"; o item leva ao controle da Frota que já faz
  isso (seletor de motor, `/compactar`, Configurações › MCPs). Um `/model` cru
  num spawn por turno não persiste e contradiria o seletor.
- **informativos auditados** (context, usage, insights…): aparecem com chip
  "motor" depois de sonda que confirme `num_turns:0` no headless.

### F4 · O popover

- Seções na ordem de precedência real do dedup: **Frota** · **Projeto** ·
  **Plugins** (agrupado por plugin, com nome e contagem) · **Do motor**.
- Busca por nome **e** descrição; teto de 8 vira lista rolável por seção.
- Chip único por item (hoje `CLAUDE` + `SKILL` são dois chips para um fato);
  plugin mostra o nome do plugin.
- `argument-hint` como texto-fantasma depois de inserir o pill.
- Rodapé honesto: "Inventário do Claude Code, visto no último turno às 17:02" ou
  "lido do disco, ainda sem turno neste projeto".
- Trocar o motor da conversa com um `/comando` no rascunho que não existe no
  destino: aviso na faixa de continuidade (reusa `expandPendingForTarget`).

### F5 · Plugins da Frota ganham porta

- "Adicionar plugin" em Configurações › Skills e plugins: escolher pasta → copia
  para `app_data/plugins` → aparece `pending` para revisão (fluxo de grant já existe).
- **Importar de provider não é instalar.** Um plugin do Claude/Codex já funciona
  no próprio motor (F1–F2). Converter para `frota-plugin.json` só vale para
  levar skills a motores que não têm o plugin, e aí é gesto explícito, com
  fingerprint novo. O agy faz algo parecido (`agy plugin import claude`), vale
  estudar o formato antes de desenhar o nosso.

## Riscos e o que NÃO fazer

- MCP de plugin do provider (`plugin:paper-desktop:paper`) é cortado quando o
  plano MCP é gerenciado (`--strict-mcp-config`). A skill do plugin aparece mas a
  tool dela não existe no run. O popover precisa marcar isso, senão é teatro.
- Nada de escrever em `~/.claude` ou `~/.codex` para "sincronizar" (ADR-130).
- Cache do `init` é evidência datada, não verdade presente: sempre com horário.
- Custo por envio não cresce: inventário é lido na troca de motor/projeto e
  atualizado pelo `init`, nunca por mensagem (AGENTS.md do chat, item 10).

## Decisões (14/09/2026, humano)

1. **Os três motores juntos.** F1 entra com `RunInit` (Claude), `SideQuery`
   (Codex) e disco honesto (agy) na mesma fase.
2. **Builtins entram, só os auditados** (F3). Lista abaixo.
3. **F5 é frente separada.** Esta frente só faz o composer enxergar e invocar
   o que o motor já tem.

Capability nova + mudança do contrato de invocação viram ADR antes do código.

## Auditoria de builtins do Claude Code 2.1.270 (headless, 14/09/2026)

`claude -p "/<nome>" --output-format stream-json --verbose`, cwd sem projeto.
Todos devolveram `result.subtype=success`, `num_turns=0`, `total_cost_usd=0`.

| comando | saída no headless | política F3 |
|---|---|---|
| `/context` | tabela de uso da janela por categoria | **mostrar** (motor) |
| `/usage` | uso da assinatura e reset da sessão | **mostrar** (motor) |
| `/skill-doctor` | skills carregadas, tokens e usos | **mostrar** (motor) |
| `/list-agents` | sessões Claude vivas na máquina | **mostrar** (motor) |
| `/mcp` | só contagem, e manda "use no terminal" | esconder, leva a Configurações › MCPs |
| `/model` | lê/troca modelo | esconder, é o seletor da Frota |
| `/effort` | lê/troca esforço | esconder, é o seletor da Frota |
| `/config` | uso `key=value` de configuração global | esconder, efeito fora do run |
| `/agents` | "o wizard foi removido" | esconder |
| `/recap` | "nada para resumir" sem sessão; precisa de `--resume` | sondar numa conversa com sessão |

Não sondados de propósito: `/ultrareview` e `/usage-credits`/`/extra-usage`
(cobrança), `/heapdump`, `/import`, `/rename`, `/goal`, `/autocompact`,
`/design-consent`/`/design-revoke` (mudam estado). Ficam fora até auditoria com
gesto humano. `/init`, `/security-review` e afins são comandos de prompt: rodam
turno de modelo e se comportam como skill, então entram na seção do motor como
qualquer skill.

## Sondas pendentes

- **Codex `exec` com `$nome`:** a sonda de 14/09 bateu no limite de uso da conta
  (`turn.failed: usage limit`, reset em 19/09). Até medir, `exec` expande o
  `SKILL.md` app-side; o item `skill` só vale no transporte app-server.
- **Builtins do Codex e do agy no headless:** não medidos.
- **Resultado `num_turns=0` no fio:** confirmar que o parser do Claude desenha a
  resposta de builtin como mensagem normal e não quebra o `--resume` seguinte.
