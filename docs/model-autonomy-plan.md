# Modelos novos sem trabalho manual — plano

> Proposto em 14/08/2026. Gatilho: "toda semana pode haver novidade (Gemini 3.7
> etc); como automatizar isso de forma 100% sozinha?". A resposta honesta: dá
> para automatizar quase tudo, **mas só se a automação virar empírica** — e uma
> parte NÃO deve ser automatizada (ver §5).

## Correção de 09/09/2026 — o M1 estava construído e desligado no codex

Manda sobre o texto abaixo. O plano entregou a sonda, a régua e a capability no
registry, e mesmo assim o seletor do Codex passou uma geração inteira de modelo
mentindo: o CLI listava `gpt-6-astra` como default DELE, respondia "sou o Codex,
baseado em GPT-6", e o app abria em "Sol" oferecendo `gpt-5.4` e `gpt-5.4-mini`,
que aquela versão já não conhecia.

O buraco não era a sonda, era o CONSUMO dela. A ligação entre lista viva e
seletor tinha sido escrita como uma função POR FORNECEDOR (`refreshAgyModels`,
`refreshOpenCodeModels`), e a terceira nunca foi escrita — o codex declarava
`listsModels` desde 14/08/2026 e ninguém perguntava. Capability declarada e não
consumida não falha: envelhece calada.

O que mudou (ADR-177):

- **Uma regra pra todos.** `refreshModelLists` varre `modelListingAgents()` e
  `liveModelsFrom` é a única tradução de payload em opção. Motor que entra no
  registry com fonte viva passa a ser perguntado sem uma linha nova.
- **`CODEX_MODELS` encolheu pra sentinela**, como o `OPENCODE_MODELS` já era.
  Nenhum modelo de motor com lista viva mora no bundle.
- **Ordem, default e esforço saem do CLI.** A ordem é a dele (frontier
  primeiro), a sentinela cita quem tem `isDefault`, e a régua de esforço vem de
  `supportedReasoningEfforts` POR MODELO — no mesmo dia, o astra aceitava
  `ultra` e o `gpt-5.5` parava em `xhigh`.
- **Cache no banco** (`model_listings`, uma linha por motor): o boot hidrata a
  última lista boa antes da sonda responder, então o pior caso de uma falha
  deixa de ser a lista compilada no binário.
- **Sumiço mudo vira aviso.** O §"nada some do seletor sem aviso" cobria só o
  que o fornecedor ANUNCIA com `upgrade`. Faltava o slug que some sem dizer
  nada, que é o pior dos dois — e o `agentModels` deixou de oferecer aprovado
  que a lista viva não conhece. Ironia registrada: o próprio plano observou que
  "`gpt-5.6` puro não está no `model/list`", e ele estava no seletor há meses,
  aprovado no gate humano em 24/08/2026.

Lição pro resto do plano: **capability nova precisa nascer com o consumidor
genérico**, não com um call site por fornecedor. Um `if` a menos hoje é uma
lista mentindo daqui a uma geração de modelo.

## Verificação empírica (14/08/2026, nesta máquina) — a realidade manda

Antes de M1 os três CLIs foram sondados na mão. Versões: **agy 1.1.13**,
**codex-cli 0.147.0**, **claude 2.1.220**.

| CLI | fonte de lista | como | achado |
|---|---|---|---|
| agy | ✅ `agy models` | TSV `slug<TAB>Rótulo` no **stdout** ("Fetching available models..." vai pro stderr); **não** há `--json` (o flag é recusado) | 14 slugs, de 3 fornecedores diferentes |
| codex | ✅ `model/list` | JSON-RPC no **mesmo** canal app-server do medidor de uso (`codex -s read-only -a untrusted app-server` → initialize → initialized → método) | 6 visíveis, +2 com `includeHidden: true`; **traz `upgrade`/`upgradeInfo.migrationMarkdown`** |
| claude | ❌ nenhuma | `claude --help` só tem agents/auth/auto-mode/doctor/gateway/install/mcp/plugin/project/setup-token/ultrareview/update; o que casa com "claude-…" em `~/.claude/*.json` é cache de tooling do usuário | capability `None`, catálogo segue sendo a fonte |

Divergências do texto original, registradas:

- O plano dizia "canal RPC local do app-server" sem nome de método. O método
  **existe e se chama `model/list`** (confirmado por
  `codex app-server generate-json-schema`, que emite `ModelListParams`/
  `ModelListResponse`). Params são todos opcionais: `cursor`, `limit`,
  `includeHidden`.
- **Achado que o plano não previa e que M1 ganhou de graça**: o codex **anuncia
  a aposentadoria**. `gpt-5.4` volta com `upgrade: "gpt-5.6-terra"` e
  `migrationMarkdown: "GPT-5.4 will be deprecated soon…"`. A guarda "slug
  aposentado vira estado explicado, não desaparecimento silencioso" não precisa
  de heurística: o motivo vem escrito pelo fornecedor.
- `codex exec` **não** aceita `-a untrusted` (só o `app-server` aceita) — a
  fumaça de M2 usa `-s read-only` sozinho.
- O conhecimento escrito à mão *"`gpt-5.6` puro é ID de API"* virou **derivável**:
  ele não está no `model/list` e a fumaça devolve `unknown-slug`.

Números de referência da sonda (14/08/2026): agy 14 slugs; codex 6 visíveis
(`gpt-5.6-sol` default, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`
com sucessor, `gpt-5.4-mini` com sucessor) + `gpt-5.6-sol-wm` e
`codex-auto-review` escondidos; `nextCursor: null`.

## O diagnóstico

Hoje são três camadas com autonomias diferentes:

1. **Preço** — já automático (`catalog.rs` puxa `models.dev/api.json`, 166
   providers, refresh 1×/dia). Modelo novo já sai com custo certo.
2. **Entrar no seletor** — semiautomático: o curador propõe
   (`model_proposals`), o humano aprova. O portão existe porque o app **não
   tem como verificar** se o modelo funciona.
3. **Lista curada** (`agents.ts`: `CLAUDE_MODELS`, `CODEX_MODELS`…) — escrita
   à mão, e o valor dela é conhecimento que catálogo nenhum publica:
   *"`gpt-5.6` puro é ID de API, rejeitado com auth ChatGPT"*, *"contexto
   DENTRO do Codex é 272k; na API os mesmos modelos têm 1M"*, *"sem família
   `-codex` desde o 5.4"*.

**A causa raiz do trabalho manual**: aquele conhecimento vem de alguém
TESTANDO contra o CLI. O portão humano é o substituto da verificação que não
existe. Logo: **crie a verificação e o portão vira burocracia.**

## M1 — Perguntar ao CLI, não só ao catálogo

Capability nova no registry (`adapters.rs` + espelho TS + teste-gêmeo):
`lists_models: Option<ModelListSource>`. Quem sabe listar, lista:

- **agy**: `agy models` (já existe, já usado na detecção).
- **codex**: canal RPC local do app-server (o MESMO que o medidor de uso já
  abre — reusar, não abrir outro).
- **claude**: verificar empiricamente o que existe hoje; se não houver fonte,
  capability `None` e o catálogo continua sendo a fonte (degradação honesta).

Efeito: modelo que o CLI não conhece **nunca é proposto**, e slug aposentado
**some sozinho** da lista em vez de virar erro no meio de um turno.

### M1 entregue (14/08/2026)

- `Capabilities.lists_models: Option<ModelListSource>` em `adapters.rs`
  (`AgyModelsSubcommand` / `CodexAppServer`; claude `None`), espelho
  `listsModels` em `lib/agents.ts`, teste-gêmeo
  `matriz_lista_de_modelos_por_agent` ↔ `agents.modelList.test.ts`, e coerência
  no loop `contrato_capabilities_x_comportamento_por_agent` (declarar fonte de
  lista exige que o modelo escolhido CHEGUE ao comando montado — implicação,
  não igualdade: o claude tem seletor e mesmo assim não tem fonte).
- Sonda em `model_list.rs` + comando `model_list(agent)`; falha classificada em
  `unsupported | spawn | timeout | protocol | rpc | empty`. **Lista vazia nunca
  é sucesso** (`empty`), e paginação que estoure o teto vira erro em vez de meia
  lista — truncar seria sumiço silencioso com outro nome.
- O canal app-server virou **um só**: `codex_appserver::probe_once` faz o
  handshake de sonda, e `usage_window.rs` passou a chamá-lo em vez de manter a
  cópia privada dele (o plano pedia "reusar, não abrir outro").
- Régua pura no front: `slugStanding()` em `lib/modelList.ts` devolve
  `listed | hidden | retired | unknown | **unverified**`. Sem lista viva o
  veredito é `unverified` ("não sei"), nunca `unknown` — motor sem fonte não
  perde nada.

## M2 — Fumaça de um token (a peça que substitui o humano)

Para cada candidato, uma chamada mínima que **classifica o desfecho**:

| desfecho | significado |
|---|---|
| `ok` | aceito e respondeu |
| `auth-rejected` | slug existe mas a sua autenticação não o alcança |
| `unknown-slug` | o CLI não reconhece |
| `context-mismatch` | aceito, mas o teto difere do catálogo |
| `unreachable` | não deu para saber (nunca vira veredito, vira "não sei") |

Isso produz **exatamente** o conhecimento que hoje está escrito à mão — com
data, versão do CLI e evidência, no padrão ADR-016 da casa. Custo: centavos
por lançamento (prompt de 1 token).

Guardas: só roda por gesto/agenda (nunca em laço), com teto de N candidatos
por rodada; resultado gravado com carimbo; falha de rede = `unreachable`, que
**não** rebaixa nem promove nada.

### M2 entregue (14/08/2026)

- Capability `model_smoke: Option<ModelSmokeDialect>` (`ClaudePrintJson` /
  `CodexExecJson` / `AgyPrintJson` — os três motores integrados), espelho
  `modelSmoke` em `lib/agents.ts`, teste-gêmeo
  `matriz_fumaca_de_modelo_por_agent` ↔ `agents.modelSmoke.test.ts`, e coerência
  no contrato (fumaça exige que o modelo chegue ao comando; **quem lista precisa
  saber testar** — a recíproca é falsa de propósito: o claude testa e não lista).
- `model_smoke.rs`: comandos `model_smoke(agent, models)` e
  `model_smoke_history()`. Registro carimbado (agent, slug, desfecho, **a frase
  do próprio CLI**, versão do CLI, contexto vivo × contexto do catálogo, data)
  em `model-smoke.json` no app_data_dir, escrita atômica no padrão do
  `catalog.rs` — sem migração.
- **Guardas duras, mecânicas**: teto de 3 candidatos por rodada (pedir mais é
  erro, não truncar); `ROUND_COOLDOWN_MS` de 60s por motor faz um laço acidental
  FALHAR em vez de gastar quota; nenhum chamador automático existe (nem boot,
  nem ticker); `unreachable` **não sobrescreve um veredito gravado**
  (`record_result`, com teste).
- Custo mínimo medido: o turno do claude caiu de **$0,036 para $0,00055** só
  derrubando as definições de ferramenta (`--tools ""`), junto com
  `--no-session-persistence --strict-mcp-config --safe-mode --max-turns 1`.
  O codex usa `--ephemeral --ignore-user-config -s read-only`. No agy a recusa
  de slug é **local** (custo zero).

**Prova nesta máquina** (`cargo test -- --ignored --nocapture fumaca_real`,
14/08/2026), pelo caminho de código implementado:

| motor | slug | desfecho | evidência |
|---|---|---|---|
| claude | `haiku` | `ok` | contexto 200000, canônico `claude-haiku-4-5` |
| claude | `claude-naoexiste-9-9` | `unknown-slug` | 404: "It may not exist or you may not have access to it" |
| codex | `gpt-5.6-luna` | `ok` | `turn.completed` |
| codex | `gpt-9.9-naoexiste` | `unknown-slug` | "Model metadata for \`gpt-9.9-naoexiste\` not found" |
| agy | `gemini-3.7-flash-low` | `ok` | `status: SUCCESS` |
| agy | `gemini-9.9-naoexiste` | `unknown-slug` | "is not recognized as a known model" |

Limites honestos registrados:

- `context-mismatch` hoje só é alcançável no **claude**: é o único CLI que
  reporta `contextWindow`. O `codex exec --json` não reporta, então o caso
  "272k dentro do Codex × 1M na API" ainda não é detectável pela fumaça.
- `auth-rejected` do **agy** nunca dispara: a frase real de recusa de auth não
  foi capturada nesta máquina. Sem fixture, cai em `unreachable` ("não sei") —
  inventar a frase é que esconderia bug (ADR-016).
- `auth-rejected` do **claude** mapeia 401/403 pela semântica HTTP
  (NEEDS-VERIFY); só o 404 é capturado de verdade.

**M3 fica quase trivial**: as três pernas da regra já existem e são consultáveis
sem escrever nome de motor — `modelListingAgents()`/`slugStanding()` (o CLI
lista), `verdictFor()` + `isVerdict()` (a fumaça deu `ok` e "não sei" não conta)
e `catalog::lookup` (o preço existe). O que falta em M3 é só a decisão de
produto: quem promove, quando, e a redação do aviso no sino.

> Correção do M3: a perna do preço NÃO é o `catalog::lookup` sozinho. A régua
> certa é a que estima o custo do turno (`pricing.rs`, catálogo → SEED); usar só
> o catálogo reprovaria por "sem preço" modelo cujo custo o app mostra na tela.

## M3 — O portão vira AVISO

Regra: candidato que passa nos três (o CLI lista **e** a fumaça deu `ok`
**e** o preço existe no catálogo) **entra sozinho** no seletor. O humano
recebe um aviso no sino: *"2 modelos novos validados e disponíveis"*.

O que **falha** vai para o humano **com o motivo** — *"o Codex rejeitou este
slug com a sua autenticação"* — que é infinitamente mais útil que
"aprovar/dispensar" às cegas.

Reuso: o aviso usa o sino (`toolHealth`, já entregue). Nada de superfície
nova. E o item **não conta no badge** (é conveniência, não impedimento —
mesma régua do "atualização disponível").

### M3 entregue (14/08/2026)

**A regra, pura e testada** (`lib/modelPromotion.ts` + 27 casos em
`modelPromotion.test.ts`): `promotionCall()` lê as três pernas e devolve
`promote | pending | reject` COM a frase do motivo e a evidência do próprio CLI.

| perna | passa | reprova | "não sei" |
|---|---|---|---|
| o CLI lista (`slugStanding`) | `listed` | `hidden`, `retired`, `unknown` | `unverified` |
| a fumaça (`verdictFor`/`isVerdict`) | `ok` | `auth-rejected`, `unknown-slug`, `context-mismatch` | `unreachable` e nunca testado |
| o preço (`pricing::model_price`) | tem preço | catálogo e SEED não conhecem | a consulta falhou |

Ordem de decisão: **qualquer reprova → `reject`**; senão **qualquer "não sei" →
`pending`**; senão **`promote`**. Ou seja: o que reprova é sempre um VEREDITO,
nunca a ignorância — e nenhum "não sei" descarta candidato (ele fica pendente).
Consequência honesta: o **claude-code não tem fonte de lista** (M1), então os
candidatos dele nunca promovem sozinhos e seguem no gate humano de sempre,
exatamente o comportamento de hoje.

- **O preço vem de `pricing.rs`, não do catálogo cru**: comando novo
  `model_price(model)` devolve `{input, cached, output, fromCatalog}` pela MESMA
  régua que estima o custo do turno (catálogo dinâmico → SEED). Perguntar só ao
  models.dev criaria uma segunda verdade: o seletor recusando "sem preço" um
  modelo cujo custo o medidor mostra na tela. Alias do Claude Code (`sonnet`)
  cai no `catalogEntryFor` que já existia.
- **A rodada** (`lib/modelRound.ts`): lista viva → aposentadorias → candidatos →
  fumaça → regra → ledger → recarrega o picker. Candidatos vêm de duas fontes,
  nenhuma por nome de motor: o que o CLI LISTA e o seu seletor não tem, e o que
  o curador propôs e segue pendente (ou foi reprovado num mundo que mudou).
  Ficam de fora o que **você** dispensou, o que já está no seletor e o que o
  fornecedor **esconde ou já aposentou** (oferecer o que o motor não oferece
  seria inventar oferta).
- **Quando roda**: gesto ("Verificar agora" em Configurações ▸ Modelos) e agenda
  diária no mesmo portão de 24h do catálogo, com freio próprio
  (`settings.lastModelRound`). Quatro freios em série: portão de 24h; só
  candidato NOVO vai pra fumaça (`pickSmokeCandidates` — veredito carimbado só
  volta à fila se a VERSÃO DO CLI mudou); teto de 3 por motor; e o
  `ROUND_COOLDOWN_MS` de 60s do M2. **Em regime normal a rodada não gasta nada**:
  sem slug novo, não há candidato a testar.
- **O aviso no sino** (`toolHealth.modelHealthItems` + a seção Ferramentas, que
  saiu do `InboxBell` pro `ToolsSection.tsx`): "N modelos novos validados e
  disponíveis" (uma linha por motor), os reprovados um a um COM o motivo, e a
  aposentadoria anunciada. **Nada disso conta no badge** (`blocking: false`,
  testado): novidade e recusa são conveniência, e aposentadoria anunciada não
  impede nada hoje. Notícia envelhece em 7 dias e sai do sino; o ESTADO fica em
  Configurações. Dispensa por conteúdo (`modelNewsDismissed`): a chave carrega
  quais modelos o aviso anuncia, então dispensar o de hoje não silencia o de
  amanhã.
- **Aposentadoria explicada**, com o achado do M2: `retirementNotices()` junta o
  sucessor e o `migrationMarkdown` DO FORNECEDOR com o que só o app sabe (você
  está com esse modelo escolhido na conversa X e na persona Y, e a troca é sua).
  Mora em tabela PRÓPRIA (`model_retirements`), e isso é a guarda: se fosse
  status do ledger, o anúncio tiraria o slug do picker e quebraria a conversa de
  quem está usando ele. Nada some; ganha uma frase.
- **O ledger** (`lib/modelLedger.ts`, extraído do `db.ts`): a `model_proposals`
  virou o registro de decisões, com `origin` (lista viva × curador), `decided_by`
  (a REGRA × você), `reason`, `evidence` e `decided_at`. Statuses: `proposed`
  (falta perna), `active` (no seletor), `rejected` (com motivo), `dismissed`
  (gesto seu, que a rodada NUNCA desfaz). **Sem migração no lib.rs**: as duas
  tabelas são de frontend (`ensure*` + `addColumn`), no padrão da casa.
- **Configurações ▸ Modelos** mostra a procedência em grupos: Entraram sozinhos ·
  Esperando você · Não entraram · Você aprovou, cada linha com o motivo e a
  frase crua do CLI. "Tirar do seletor" existe em todas as que estão no picker.
- **A guarda do §5 é mecânica**: promover chama `setApprovedModels`, que
  ACRESCENTA opção no fim do picker; nada na frente escreve `defaultModel` de
  agent, projeto ou conversa. Há teste disso (`§5 do plano: modelo novo NUNCA
  vira o seu padrão sozinho`), inclusive da reversibilidade.
- Efeito colateral bom: `reloadActiveProposals` deixou de varrer a dupla
  `["claude-code","codex"]` escrita à mão e passou a varrer o registry — com a
  lista viva promovendo, um par de ids fixo faria a promoção de um terceiro
  motor sumir sem ninguém perceber.

**O que M3 NÃO fez** (e por quê): o seletor ainda não mostra o aviso de
aposentadoria NA opção (hoje ele mora no sino e em Configurações); e um slug que
some da lista viva do CLI não gera aviso próprio (`slugStanding` já sabe dizer
`unknown`, mas ninguém pergunta na hora de montar o picker). Os dois são
naturais no M4, que é quem mexe no texto de cada opção.

## M4 — A descrição deixa de ser editorial

Hoje cada opção carrega uma frase escrita à mão. Depois de M1+M2, quase tudo
é derivável: preço (catálogo), contexto (sonda), quirks (fumaça). O texto
humano encolhe para o que sobra de opinião — e o §5 mostra que até isso pode
virar dado.

## M5 (frente futura) — a recomendação vem do SEU ledger

"Qual modelo é bom?" hoje é opinião escrita ("o mais capaz", "equilíbrio
custo"). Mas temos `turn_costs` e `deliveries`: dá para derivar do uso REAL
— qual modelo entregou mais barato, qual falhou mais, qual exigiu mais
retomadas. **Benchmark de fabricante mente; o seu histórico não.**
Fora do escopo de M1-M3 porque muda como o app opina.

## §5 — O que NÃO automatizar (a parte que segura o "100%")

- **Modelo novo NUNCA vira o seu padrão sozinho.** Entrar como opção é
  reversível e barato; trocar o motor das suas tarefas é decisão de custo e
  de qualidade que o app não tem como tomar por você.
- **"É bom?" não se responde por catálogo.** Só o M5 (dado seu) chega perto.
- **Fumaça não vira laço.** Testar automático a cada boot seria queimar
  dinheiro para descobrir o que muda uma vez por mês.

## Guardas gerais

- Agnosticismo por capability: nada de comparar nome de fornecedor em código
  genérico; o dialeto (como listar, como testar) fica confinado.
- Sem fonte confiável ⇒ capability `None` e o comportamento de hoje, intacto.
- Nada some do seletor sem aviso: slug aposentado vira estado explicado, não
  desaparecimento silencioso.
