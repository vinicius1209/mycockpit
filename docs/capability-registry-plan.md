# Registry de capabilities — plano (agnosticismo como mecanismo, não disciplina)

> Status: **G0 ✅ · G1 ✅ · G2 ✅ · G3 ✅ (01/08/2026)** — review gate APROVADO
> (2 rodadas; bloqueante do embedded consertado com `reexpandIfEmbedded`;
> política do GC de evidência aceita no ADR-029).
> Pendências conhecidas pós-entrega: `handoff.ts:246/306` ainda compara
> `targetAgent === "agy"` (vazamento de `context_mcp`, follow-up); seam de
> transporte do app-server codex (`agent.rs:460`) fica pra fase futura;
> `serializeContext` (recap curto) não menciona capturas.
> Proposto em 01/08/2026, após a entrega dos comandos "/" agnósticos.
> Gatilho: auditoria achou decisão de capability espalhada por `matches!` de
> nome de agent em código GENÉRICO — o mesmo tipo de vazamento que fez o
> popover de "/" ensinar `.claude/commands` numa conversa Codex.
> Princípio (do usuário, e do agent-runner.md §2 desde o v0.1): nada fixo no
> domínio de um fornecedor fora do adapter dele; adicionar um motor = escrever
> um adapter + declarar capabilities, sem tocar N pontos espalhados.

## G0 — Inventário (auditoria de 01/08)

**Legítimo** (por-provider DENTRO de módulo de provider — é papel de adapter):
`update.rs` (plano por canal), `detect.rs` (pacotes), `AgentLogo/avatars`
(identidade visual), `agents.ts` (mapas legacy de modelo), `permissionNote.ts`
(realidade por CLI, §7.1), `modelCurator.ts`.

**Vazamento** (código genérico decidindo por nome — alvo deste plano):
- `agent.rs:361` — `supports_work_mcp = matches!(agent, "claude-code"|"codex")`.
- `agent.rs:311` — `is_claude` para decisões de injeção.
- `mcp_control.rs:914/1482/1492` — lista fixa de agents válidos/roteáveis.
- `sources.rs:388` — convenções de descoberta de comando por nome.
- `slashCommands.ts:45/88/91` — native-slash e copy do vazio por nome no front.
- `fusion.ts:120` — par complementar HARDCODED claude↔codex.

## G1 — O registry (a espinha; primeiro, porque o resto consulta ele)

- **G1.1 (Rust)** — materializar a `Capabilities` do agent-runner.md §2 na
  trait `AgentAdapter` (adapters.rs): campos derivados dos achados REAIS, não
  especulação — `work_mcp`, `context_mcp`, `managed_mcp`, `deferred_work`,
  `native_slash`, `command_sources` (convenções de descoberta), `session_resume`,
  `structured_output`, `reports_cost` (+ o `supports_attachment` que já existe).
  Um único mapeamento nome→adapter (a factory que já existe). `agent.rs`,
  `mcp_control.rs` e `sources.rs` passam a CONSULTAR capabilities — zero
  `matches!` de nome fora da factory.
- **G1.2 (TS)** — `agentDefs.ts` vira o espelho único no front (native_slash,
  convenções pro copy do vazio, capacidade de fusion): `slashCommands.ts` e
  afins consultam a definição, não o nome.
- **G1.3** — `fusion.ts:120`: complementar DERIVADO do registry (outro motor
  disponível com capability de disputa), nunca par fixo.
- **G1.4** — teste de contrato: para cada agent registrado, capabilities
  declaradas ↔ comportamento dos build_command (ex.: `work_mcp=true` ⇒ o
  comando contém a injeção; `native_slash=false` ⇒ expansão app-side). É o
  teste que impede o próximo vazamento.

## G2 — Furos restantes da entrega de comandos (dependem de G1.2)

- **G2.1** — launchers de Missão e Fusion expandem `/comando` no campo de
  tarefa (dispatchers próprios, fora das duas superfícies de send).
- **G2.2** — fila coalescida: expandir CADA mensagem antes do join `\n\n`
  (hoje só expande sozinha na fila).
- **G2.3** — revezamento/handoff: `/comando` pendente no preâmbulo expande
  para o motor de DESTINO (ou nota honesta se ambíguo).

## G3 — Pendências agnósticas das entregas anteriores

- **G3.1** — Fusion × trabalho diferido (D3.2 do deferred-work-plan): candidato
  com capability `deferred_work` invisível na superfície → suprimir a tool
  (`--disallowedTools "Workflow"`) em vez de deixar workflow órfão em silêncio.
  Decisão por capability, não por nome.
- **G3.2** — notificação diária de update: comando sugerido do CANAL detectado
  (payload ganha canal), não o comando npm estático.
- **G3.3** — evidência de imagem: GC da pasta `evidence/` (junto do GC de
  anexos) e recap/companion cientes de imagem ("N capturas" no texto) — vale
  para qualquer motor que reporte imagem.

## Ordem e gates

G1 primeiro (é a espinha; G2/G3 consultam o registry). G2+G3 em seguida,
paralelizáveis entre si. Cada fase: suítes completas verdes + review gate.

## Guardas

- Capability declarada tem que ser VERDADEIRA por versão auditada (§7.1 do
  agent-runner): na dúvida, declarar `false` e degradar honesto.
- Nenhuma UI genérica pode ler `conv.agent` para decidir COMPORTAMENTO — só
  para identidade visual (logo/selo). Comportamento vem de capabilities.
- Fora do escopo: protocolo de plugin externo (agent-runner §6 continua
  "quando precisar"); OpenCode entra DEPOIS do registry, como prova dele.
