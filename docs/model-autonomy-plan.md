# Modelos novos sem trabalho manual — plano

> Proposto em 14/08/2026. Gatilho: "toda semana pode haver novidade (Gemini 3.7
> etc); como automatizar isso de forma 100% sozinha?". A resposta honesta: dá
> para automatizar quase tudo, **mas só se a automação virar empírica** — e uma
> parte NÃO deve ser automatizada (ver §5).

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
