# Continuar em outro motor (revezamento v2) — PRD

## Status (17/09/2026)

**R1, R2 e R4 entregues (17/09/2026, ADR-206).** Spike S4, R3 (ramo com outro
motor) e R5 (voltar retomando a sessão) seguem para a próxima sprint.
Épico D de `docs/sprint-ecossistema-2026-09.md`.

O que foi feito, e onde divergiu do texto abaixo:
- R1: envelope v2 com `conversation_memory` (`memoriaDaConversa`, a memória do
  `/compactar`) orçada por `orcamentoDoHandoff`: 10% da janela do destino em
  caracteres, teto 60.000, **piso 6.000** (não o piso de 3.000 do orçamento):
  janela desconhecida nunca leva menos que o contrato v1 levava. 25% do orçamento
  continua para as últimas mensagens literais, porque uma mensagem gigante
  derrubava o bloco "onde a conversa parou" da memória (o teste v1 do "gateway"
  pegou isso). Sem janela informada, a do modelo padrão do motor no registry. O
  prompt usa o rótulo do motor. Memória e últimas mensagens vão numa moldura H3
  só. Os três chamadores (composer, mesa, faixa de continuidade) herdam sem
  mudança.
- R2: a faixa de revezamento preparado já existia com "Desfazer"; ganhou "Sessão
  nova com a memória desta: leva ~N mil tokens do histórico (estimativa)",
  calculado pela montagem real do envelope. No seletor, com a conversa iniciada,
  a lista de modelos se chama "Mesmo motor · mantém a sessão" e o trilho mostra o
  motor atual e só os destinos elegíveis (`eligibleHandoffTargets`). Divergência:
  não virou menu com duas seções de texto; o trilho de ícones continua, filtrado
  e com o rótulo "Outro motor · sessão nova com a memória desta" no título.
- Verificado: golden test com fio de 100 itens (pedido e plano do meio presentes,
  teto respeitado, "Claude Code" no prompt), estimativa e faixa com testes, os
  testes v1 do handoff e o H3 do `trust.test.ts` intactos; seletor e faixa num
  harness no Chromium.
Já entregue (17/09, K2/D4): "Modelo custom…" no seletor vem da capability
`modelo_livre` (Rust) / `modeloLivre` (TS), com teste-gêmeo; o `Set` com nomes de
motor em `IdentityPicker.tsx:33` citado abaixo não existe mais. O id cru do motor
no prompt do handoff (`handoff.ts:223`) saiu no R1.
Mock aprovado: seletor de identidade com "Revezar aqui" e "Abrir ramo com…",
faixa com custo estimado e "Desfazer", em `docs/mocks/sprint-ecossistema.html`.
Double check na seção final.

Continua `docs/context-handoff.md` (contrato v1 de 29/07/2026), ADR-073 (trocar
modelo é seguro, trocar motor é handoff), ADR-124 (compactar com memória
recuperável), ADR-154 (forks e ramos) e ADR-165 (revezamento proativo e aviso de
cota).

---

## O problema, nas palavras do usuário

"Se hoje eu mudar o modelo aqui no composer, já não faz o item E3?" A resposta
honesta: trocar **modelo** no mesmo motor mantém a sessão; trocar de **motor** já
existe (revezamento), mas o gesto está escondido, não tem volta e leva pouca
memória.

## Evidência (estado atual)

- **Trocar modelo:** preserva a sessão (ADR-073); numa conversa já iniciada a
  escolha vale no próximo envio (`components/chat/composerIdentity.ts`).
- **Trocar motor = revezamento (ADR-165):** o trilho de motor do seletor aceita
  clique ("Revezar para X no próximo envio", `IdentityPicker.tsx:199`);
  `stageAgentImpl` prepara (`store/chat/revezamento.ts:12`); no envio,
  `prepareTurnTransplant` → `prepareHybridHandoff` (`lib/turnHandoff.ts:30`, `:63`);
  `commitTransplantState` zera a sessão (`revezamento.ts:42`, `sessionId: null` em
  `:68`).
- **Memória que viaja é pouca:** o envelope usa `recentHistory`
  (`lib/handoff.ts:116`, `:188`) com `HANDOFF_RECENT_BUDGET_CHARS = 6_000`
  (`:16`), só o fim da conversa. O `/compactar` e o fallback de resume usam
  `memoriaDaConversa` por significado com `orcamentoDaMemoria(janela,
  "transplante")`, teto de 60.000 caracteres (`lib/compact.ts:197`,
  `lib/transcript.ts:217`, `lib/orcamentoDaMemoria.ts:101-106`).
- **Prompt usa o id cru do motor** ("claude-code") em vez do rótulo
  (`handoff.ts:223`).
- **Sem volta:** a sessão do motor anterior não é guardada (`revezamento.ts:68`).
- **Ramo com outro motor não existe:** `forkConversationAtImpl`
  (`store/chat/clone.ts:217`) copia com o mesmo motor.
- **Elegibilidade já é agnóstica:** `eligibleHandoffTargets`
  (`lib/quotaExhausted.ts:115`) e `sessionResume` no registry (`lib/agents.ts`).
- **Comparação por nome de motor** no seletor: `IdentityPicker.tsx:33`
  (`new Set(["claude-code", "codex"])`), contra a lei de agnosticismo.

## Decisões

1. **O revezamento passa a levar a mesma memória do `/compactar`**, orçada pela
   janela do motor de destino, e diz o custo estimado antes de enviar.
2. **O gesto fica visível e reversível:** menu do seletor com duas ações por motor
   elegível, "Revezar aqui" e "Abrir ramo com X"; faixa acima do composer com
   "Desfazer" até o envio.
3. **Ramo é o jeito de experimentar sem perder nada:** a conversa original fica
   intacta com a sessão dela.
4. **Tudo por capability:** elegibilidade, retomada e modelo customizado vêm do
   registry; nenhum `if` por nome de motor.

## Requisitos

### R1 · Revezamento com memória por significado (P/M)
- `buildContextEnvelope` troca `recentHistory` por
  `memoriaDaConversa(items, orcamentoDaMemoria(janelaDoDestino, "transplante"))`.
- O texto do envelope usa o rótulo do motor (`agentDef(...).label`), não o id.
- Janela desconhecida cai no piso do orçamento (postura do anel de contexto).
- Falha de export mantém o comportamento atual (fail-open no envelope, nunca
  bloqueia o envio).
- Atualizar `docs/context-handoff.md` (contrato v2) no mesmo commit.
- **Aceite:** golden test com fio de 100 itens: pedidos e decisões do meio da
  conversa presentes no envelope; envelope nunca passa do teto de 60.000
  caracteres; prompt mostra "Claude Code", não "claude-code".

### R2 · Gesto visível com custo e desfazer (P)
- Menu do seletor de identidade em duas seções: "Mesmo motor · mantém a sessão"
  (modelos) e "Outro motor · sessão nova com a memória desta" (motores elegíveis).
- Faixa de revezamento preparado acima do composer: destino, "leva ~N mil tokens
  (estimativa)" calculado pela mesma régua de caracteres por token do orçamento, e
  "Desfazer".
- **Aceite:** motor inelegível não aparece; desfazer volta ao motor atual sem nota
  no fio; estimativa rotulada como estimativa; teste de render da faixa.

### R3 · Abrir ramo com outro motor (M)
- **Spike S4 rodado (17/09/2026): não enxerga.** Um `git worktree add` parte do
  HEAD, então NADA do que não está commitado viaja: alteração sem stage,
  alteração com stage e arquivo novo ficam todos na árvore de origem (provado
  num repo de teste com os três estados; o ramo nasceu limpo no HEAD). No repo
  da Frota o worktree nasce em 0,73 s e 39 MB, **sem `node_modules`**.
- O transporte é possível e foi medido: `git diff HEAD --binary` aplicado no
  ramo mais uma cópia do que `git ls-files --others --exclude-standard` lista
  leva modificação, apagamento, binário, modo de arquivo e arquivo novo. O que
  NÃO vai é o que o git ignora, e é justamente aí que moram `.env.local`,
  `node_modules` e artefato de build: o ramo recebe o código mas pode não
  rodar. (Cuidado achado no spike: a cópia do untracked precisa excluir
  `.mycockpit/`, senão copia o próprio worktree dentro dele.)
- **Decisão:** o padrão continua sendo ramo a partir do último commit, dito
  ANTES (é o que `isolateFork` já faz: "Parte do último commit; mudança
  não-commitada não veio junto"). Levar as alterações é gesto explícito,
  oferecido só quando `git status` não está limpo, e com o aviso de que
  arquivo ignorado não vai junto.
- `forkConversationAtImpl` aceita `targetAgent` opcional e deixa o ramo com o
  revezamento preparado; nota no ramo "Ramo aberto com X. A conversa original
  continua com Y."
- Ramo e original comparáveis no `BranchSplitView` que já existe.
- **Aceite:** sessão, itens e motor da original intocados (teste); ramo nasce com
  `parent_id` e revezamento preparado; primeiro envio do ramo faz o transplante e
  registra a nota; se o worktree não vê as alterações, a copy diz isso antes.

### R4 · Capability no lugar do nome (P)
- `CUSTOM_MODEL_AGENTS` (`IdentityPicker.tsx:33`) vira capability
  (`modeloCustom`) no registry TS e Rust, com teste-gêmeo.
- **Aceite:** teste de contrato do registry; nenhuma string de motor no seletor.

### R5 · Voltar ao motor anterior retomando a sessão (G, próxima sprint)
- `commitTransplantState` guarda `sessoesAnteriores[motor] = { sessionId, model,
  ultimoItemId }`. Ao revezar de volta, se o motor tem `sessionResume` e a sessão
  ainda existe, retoma e envia só o que aconteceu no outro motor desde
  `ultimoItemId` (mais arquivos alterados).
- Persistência: conferir se o estado da conversa sai no blob ou em coluna; se for
  coluna, `Migration` em `lib.rs` depois de conferir a versão máxima real.
- **Aceite:** Claude → Codex → Claude retoma a sessão original (teste do reducer);
  resume que falha cai no transplante completo com nota honesta.

## Não-objetivos

- Transferir a sessão privada de um CLI para outro (impossível e fora do contrato).
- Trocar de motor com turno em voo.
- Revezamento automático sem gesto (a faixa de cota esgotada continua sugerindo,
  quem decide é você).

## Ordem de entrega

Sprint atual: R1, R2, R4. Próxima: R3 (spike S4 já rodado), R5.

## Riscos

- Preâmbulo maior custa mais tokens no primeiro turno do motor novo (até ~20 mil
  tokens pelo teto); a faixa diz o custo antes.
- A sessão nova não herda cache de prompt: primeiro turno paga a criação de cache.
- Ramo em worktree NÃO vê alterações não commitadas (S4, medido); e o que o git ignora (`.env.local`, `node_modules`) não viaja nem com transporte explícito.

## Arquivos que mudam

`lib/handoff.ts`, `lib/turnHandoff.ts`, `store/chat/revezamento.ts`,
`store/chat/clone.ts`, `components/chat/IdentityPicker.tsx`,
`components/chat/CommandConsole.tsx` (está no teto: a faixa nasce em componente
irmão), `lib/agents.ts` + `src-tauri/src/adapters.rs` (capability),
`docs/context-handoff.md`.

## Double check (17/09/2026)

Conferido no código: ADR-073 (`decisions.md:2754`), ADR-124 (`:4748`), ADR-154
(`:5517`), ADR-165 (`:5775`); "Revezar para" em `IdentityPicker.tsx:199` e o `Set`
por nome em `:33`; `stageAgentImpl` e `commitTransplantState` com `sessionId:
null` (`revezamento.ts:12`, `:42`, `:68`); `prepareHybridHandoff` chamado em
`turnHandoff.ts:63`; `recentHistory` no envelope (`handoff.ts:116`, `:188`) com
6.000 caracteres (`:16`) e id cru no texto (`:223`); `memoriaDaConversa` com
orçamento `transplante` em `compact.ts:197` e `transcript.ts:217`, teto 60.000
(`orcamentoDaMemoria.ts`); `forkConversationAtImpl` (`clone.ts:217`);
`eligibleHandoffTargets` (`quotaExhausted.ts:115`); `sessionResume` no registry.
S4 rodado em 17/09/2026 (resultado no R3): worktree não vê alteração não commitada.
