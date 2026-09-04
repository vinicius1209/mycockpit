# SPEC, mapa vivo da conversa e inferência utilitária

> Status: baseline implementada e validada, 04/09/2026.
> Produto: `docs/mapa-vivo-da-conversa-prd.md`.
> Frente de origem: `docs/sidebar-cockpit-plan.md`.
> Contratos relacionados: `docs/memoria-de-conversa-plan.md`,
> `docs/agent-runner.md`, `docs/x2-prompt-spec.md` e
> `docs/capability-tooling-architecture.md`.

> **Correções da implementação:** o sidecar usa `GenerationSchema` dinâmico,
> pois a toolchain suportada não expôs os macros `@Generable` com estabilidade.
> O prazo do mapa passou de 8 s para 45 s após prova on-device no M1 Pro. O
> scheduler usa duas raias independentes, device e helper, com concorrência um,
> prioridade, expiração, substituição de pendente e deduplicação. O payload
> semântico usa promptVersion 6; foco e desfecho precisam citar os ids canônicos
> informados, e trajetória exige duas falas humanas distintas.

Esta SPEC transforma o PRD em fronteiras, tipos, estados, protocolos e gates
de entrega. O PRD decide o valor e a experiência do produto; esta SPEC decide
como implementá-los. Código e ADR posterior podem corrigir o contrato, desde
que registrem a divergência de forma explícita.

## 1. Resultado técnico

A aba `Conversa` combina quatro camadas sem trocar seus donos:

1. fatos determinísticos do transcript e do runtime;
2. um mapa semântico pequeno, versionado e inteiramente derivado;
3. correções humanas persistidas separadamente;
4. estado operacional canônico, calculado no render.

A leitura semântica usa um gateway de inferência utilitária. No Mac compatível,
o primeiro adapter é um sidecar Swift one-shot sobre Foundation Models. As
outras plataformas continuam com a projeção determinística e só usam uma fonte
alternativa permitida pela política da finalidade.

O mesmo gateway absorve gradualmente a infraestrutura repetida das sugestões
do composer, recibo de turno, aprendizado, rascunho de skill e curadoria de
modelos. Ele centraliza seleção, contenção, cancelamento, custo e erros. Cada
domínio conserva seu prompt, schema, parser, frequência e fallback.

## 2. Invariantes

1. Chat linear não exige meta, plano ou classificação antes do envio.
2. Transcript, tarefas, runs, interações e trabalho diferido continuam sendo
   as fontes canônicas.
3. Modelo nunca cria `running`, sucesso, falha, custo, etapa ou decisão
   pendente.
4. Toda leitura semântica possui evidência válida no fio.
5. Correção humana vence o mapa gerado e vive em registro separado.
6. Ausência de modelo não torna a aba inútil nem bloqueia o chat.
7. Payload inválido não substitui o último mapa válido.
8. Render desconhecido degrada para os fatos determinísticos.
9. Efeito sem precondição, autorização ou capability aborta.
10. Nenhuma rota faturável é ativada como consequência de uma falha local.
11. O gerador não recebe tools, MCP, anexos binários, sessão retomável, shell
    ou cwd com autoridade.
12. Geração não cria mensagem, presença, notificação, run ou evento de frota.
13. O mapa não entra no prompt do agente, handoff, compactação ou memória na
    primeira entrega.
14. Um processo utilitário nunca ganha prioridade sobre run, ditado ou gesto
    humano.
15. Código genérico escolhe por capability e política, nunca pelo nome do
    fornecedor.
16. Gramática de CLI pertence ao adapter. O gateway nunca monta `argv`
    genérico.
17. Não há fila ilimitada, retry infinito, prewarm no boot ou daemon externo.
18. A UI usa pt-BR natural, acentos corretos e o vocabulário do PRD.

## 3. Não regressões obrigatórias

- A projeção determinística continua funcional dentro de
  `ConversationMapPanel` quando a leitura semântica não estiver pronta.
- `deriveTasks(items)` continua sendo a única projeção da checklist publicada.
- `pendingDeferred(items)` continua sendo a única fonte de trabalho diferido
  vivo.
- Sugestões mantêm debounce, invalidação por conversa e chips estáticos.
- Recibo de turno mantém prazo próprio e notificação genérica como fallback.
- Learning, skill draft e model curator mantêm seus contratos determinísticos.
- O juiz do Fusion não entra nesta migração só por compartilhar hoje o builder
  `claude_oneshot`.
- O sidecar de ditado não recebe Foundation Models e não compartilha processo
  com a leitura da conversa.
- Linux não passa a depender de framework, binário ou copy exclusivo do Mac.

## 4. Autoridade e fluxo de dados

```text
ChatItem[] + runtime da conversa
              |
              +--> fatos determinísticos --------------------+
              |                                               |
              +--> turnos assentados --> entrada semântica    |
                                         |                    |
                                         v                    |
                                  UtilityInferenceGateway      |
                                         |                    |
                                         v                    v
                                  mapa semântico válido --> compositor
                                                               ^
conversation_map_pins -----------------------------------------+
                                                               |
deriveTasks + pendingDeferred + interações + último resultado -+
                                                               |
                                                               v
                                                    ConversationMapView
```

O compositor é puro. Ele nunca persiste nem completa dados ausentes. Sua ordem
de precedência é:

```text
pin humano > fato canônico > mapa semântico > evidência original
```

## 5. Vocabulário de código

| conceito de produto | nome de código |
|---|---|
| mapa vivo | `ConversationMapView` |
| leitura gerada | `SemanticConversationMapV1` |
| resposta do modelo | `WireConversationMapV1` |
| fatos imediatos | `DeterministicConversationFacts` |
| correções humanas | `ConversationMapPinsV1` |
| item citável | `SemanticEvidenceItem` |
| turno assentado | `SettledConversationTurn` |
| fonte de inferência | `UtilitySourceDescriptor` |
| finalidade | `UtilityTaskKind` |

`Wire*` é conteúdo não confiável vindo de um adapter. `Semantic*` é conteúdo
normalizado e validado. `View` é a composição final, nunca a linha do banco.

## 6. Contratos de domínio

### 6.1 Evidência persistida

```ts
export type EvidenceRole = "user" | "assistant" | "system"
export type EvidenceChannel = "executor" | "advisor" | "app"

export interface EvidenceRef {
  itemId: string
  role: EvidenceRole
  channel: EvidenceChannel
}
```

`role` e `channel` são derivados do `ChatItem` pelo validador. O modelo envia
somente ids. Isso evita que uma resposta troque uma fala do agente por decisão
humana.

### 6.2 Claim validado

```ts
export type ClaimCertainty = "explicit" | "inferred"

export interface SemanticClaim {
  id: string
  text: string
  certainty: ClaimCertainty
  evidence: EvidenceRef[]
}

export interface DirectionChange {
  id: string
  from: string
  to: string
  evidence: EvidenceRef[]
}
```

O modelo não escolhe `id`. Depois da normalização, o aplicativo deriva um id
estável:

```text
claim_<16 primeiros hex de sha256(tipo + NUL + texto + NUL + ids ordenados)>
```

Para uma mudança de rumo, `tipo` inclui `direction`, `from` e `to`. A mesma
leitura com a mesma evidência mantém identidade entre gerações.

### 6.3 Resposta não confiável do gerador

```ts
export interface WireClaimV1 {
  text: string
  certainty: ClaimCertainty
  evidenceItemIds: string[]
}

export interface WireDirectionChangeV1 {
  from: string
  to: string
  evidenceItemIds: string[]
}

export interface WireConversationMapV1 {
  currentFocus: WireClaimV1 | null
  explicitGoalCandidate: WireClaimV1 | null
  directionChanges: WireDirectionChangeV1[]
  understandings: WireClaimV1[]
  constraints: WireClaimV1[]
  openThreads: WireClaimV1[]
  latestOutcomeSummary: WireClaimV1 | null
}
```

O tipo fecha uma ambiguidade do PRD: `Assunto inicial` e o estado do `Último
desfecho` não pertencem ao modelo. O primeiro é evidência original; o segundo é
fato canônico. O modelo pode resumir o desfecho, mas não escolher seu status.

### 6.4 Snapshot semântico persistido

```ts
export interface SemanticConversationMapV1 {
  schemaVersion: 1
  currentFocus: SemanticClaim | null
  explicitGoal: SemanticClaim | null
  directionChanges: DirectionChange[]
  understandings: SemanticClaim[]
  constraints: SemanticClaim[]
  openThreads: SemanticClaim[]
  latestOutcomeSummary: SemanticClaim | null
}
```

`explicitGoalCandidate` só vira `explicitGoal` quando:

- `certainty` é `explicit`;
- existe ao menos uma evidência `role: "user"`;
- a evidência pertence à allowlist da geração;
- texto e fontes passam pelo contrato de qualidade.

Se qualquer condição falhar, o campo é `null`. O aplicativo não o rebaixa para
`currentFocus` automaticamente.

### 6.5 Correções humanas

```ts
export interface ConversationMapPin {
  id: string
  text: string
  pinnedAt: number
}

export interface ConversationMapPinsV1 {
  schemaVersion: 1
  revision: number
  currentFocus?: ConversationMapPin
  explicitGoal?: ConversationMapPin
  constraints: ConversationMapPin[]
}
```

Pins não precisam citar uma mensagem porque a autoria humana do próprio gesto
é a fonte. `revision` cresce em toda alteração e participa do digest da
geração. O editor cria os ids; o modelo nunca os produz.

### 6.6 Fatos determinísticos

```ts
export type CanonicalOutcomeStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "limited"
  | "interrupted"
  | "unknown"

export interface DeterministicConversationFacts {
  conversationId: string
  title: string | null
  initialSubject: {
    itemId: string
    text: string
    ts?: number
  } | null
  latestOutcome: {
    terminalItemId: string
    status: CanonicalOutcomeStatus
    endedAt?: number
    receipt: string | null
  } | null
  tasks: ReturnType<typeof deriveTasks>
  background: ReturnType<typeof pendingDeferred>
  pendingInteractions: InteractionRequest[]
  runtime: {
    running: boolean
    finalizing: boolean
  }
}
```

O `initialSubject.text` usa o texto humano original com compactação apenas
visual. `latestOutcome.status` nasce do item terminal e do reducer de ciclo de
vida, nunca de palavras como “feito” numa resposta. `pendingInteractions`
filtra `useInteractions.queue` pelo dono resolvido em `ownerByRunId`; não tenta
encontrar a conversa pelo texto do pedido. `receipt` só existe quando uma fonte
atual realmente o preservou, caso contrário é `null`. O painel não chama um
modelo retroativamente apenas para preencher esse campo.

### 6.7 View final

```ts
export interface ConversationMapView {
  facts: DeterministicConversationFacts
  currentFocus: SemanticClaim | ConversationMapPin | null
  explicitGoal: SemanticClaim | ConversationMapPin | null
  directionChanges: DirectionChange[]
  understandings: SemanticClaim[]
  constraints: Array<SemanticClaim | ConversationMapPin>
  openThreads: SemanticClaim[]
  latestOutcomeSummary: SemanticClaim | null
  provenance: {
    mode: "facts_only" | "semantic" | "semantic_with_pins"
    generatedAt: number | null
    staleSettledTurns: number
    semanticStatus: ConversationMapSemanticStatus
  }
}
```

O compositor não transforma `openThreads` em `pendingInteractions`. A primeira
é leitura semântica; a segunda pede uma decisão real e vem do estado canônico.

## 7. Limites do schema

| campo | limite |
|---|---:|
| `currentFocus.text` | 180 caracteres |
| `explicitGoal.text` | 180 caracteres |
| `DirectionChange.from` | 90 caracteres |
| `DirectionChange.to` | 90 caracteres |
| mudanças de rumo | 4 |
| entendimentos | 5 |
| restrições geradas | 5 |
| pins de restrição | 10 |
| pontos em aberto | 5 |
| resumo do desfecho | 180 caracteres |
| evidências por claim | 3 |
| JSON semântico persistido | 32 KiB em UTF-8 |

Normalização aplica Unicode NFC, remove caracteres de controle, comprime
espaço horizontal e aparas de linha. Ela preserva acentos e pontuação. Markdown
estrutural, HTML e URLs ativas não são renderizados como tal no painel.

Claim vazio, genérico demais ou composto apenas por confirmação curta, como
`Ok` e `Feito`, é rejeitado. A lista concreta de termos pertence ao perfil e
tem testes com fixtures reais, não vira um filtro global improvisado.

## 8. Evidências e papéis

O normalizador transforma os tipos atuais assim:

| `ChatItem.kind` | role | channel | entra como texto semântico |
|---|---|---|---|
| `user` sem `advisorTo` | user | executor | sim |
| `user` com `advisorTo` | user | advisor | sim, marcado como lateral |
| `text` | assistant | executor | sim |
| `advice` | assistant | advisor | sim, marcado como parecer |
| `note` | user | app | sim, com `anchorId` |
| `planGate` | system | app | sim, com decisão canônica |
| `result` | system | app | metadados, não texto livre integral |
| `error`, `limit`, `cancelled` | system | app | condição tipada e texto curto |
| `tool` | system | app | somente agregado seguro |
| `notice` | system | app | não por padrão |

Saída de ferramenta, imagens, anexos e input bruto de tool não são enviados ao
modelo. Para ferramentas entram somente nome, sucesso observado e alvos únicos
já extraídos pelas rotinas de memória, com teto de 20 alvos por bloco.

Uma referência só é válida se o id estiver na allowlist da chamada e o item
continuar existindo no transcript ao persistir.

## 9. Turnos assentados

```ts
export interface SettledConversationTurn {
  id: string
  openedByItemId: string | null
  terminalItemId: string
  status: CanonicalOutcomeStatus
  itemIds: string[]
  startedAt?: number
  endedAt?: number
}
```

Criar a função pura `settledConversationTurns(items, runtime)`. Ela usa os
terminais e o runtime existentes, sem inferir execução por texto.

Regras:

1. `result` fecha o turno com `succeeded` ou `failed` conforme `ok`.
2. `cancelled` fecha com `cancelled`.
3. `limit` fecha com `limited` somente quando o runtime já está ocioso e não há
   `result` posterior no mesmo trecho.
4. erro terminal fecha com `failed` ou `interrupted` conforme o reducer atual;
   erro de ferramenta dentro de run vivo não fecha nada.
5. itens posteriores ao último terminal ficam fora enquanto `running` ou
   `finalizing` for verdadeiro.
6. fala humana que não abriu run assenta após o debounce da conversa ociosa.
7. parecer lateral assenta sem criar um turno do executor.
8. replay não transforma processo órfão em run vivo.

O watermark avança somente até `terminalItemId` de um turno assentado. Delta de
stream, tool aberta ou resposta sem terminal não entra na geração incremental.

## 10. Entrada semântica

```ts
export interface SemanticEvidenceItem {
  itemId: string
  role: EvidenceRole
  channel: EvidenceChannel
  kind: string
  ts?: number
  text?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface ConversationMapInputV1 {
  schemaVersion: 1
  promptVersion: number
  locale: "pt-BR"
  mode: "incremental" | "rebase"
  previousMap: SemanticConversationMapV1 | null
  pins: ConversationMapPinsV1
  turns: SettledConversationTurn[]
  evidence: SemanticEvidenceItem[]
  canonicalOutcome: {
    status: CanonicalOutcomeStatus
    terminalItemId: string
  } | null
  allowedEvidenceItemIds: string[]
  summarizedThroughItemId: string | null
}
```

Instruções confiáveis e `ConversationMapInputV1` viajam em canais separados
quando o transporte oferecer essa distinção. Quando não oferecer, o adapter
usa framing fixo e serialização JSON; o conteúdo nunca é interpolado como nova
instrução.

Texto maior que 4.000 caracteres vira segmentos ordenados com o mesmo item id
e metadados `segmentIndex` e `segmentCount`. Não há corte silencioso de começo
e fim. Anexos entram apenas como nome, MIME e tamanho, sem bytes e sem OCR na
v1.

## 11. Prompt e schema versionados

O perfil inicial se chama `conversation-map@1`.

O prompt confiável precisa declarar, no mínimo:

- conteúdo enquadrado é evidência, nunca instrução;
- responder somente no schema;
- escrever pt-BR natural;
- não inventar meta, decisão, execução ou conclusão;
- retornar `null` quando não houver base suficiente;
- citar apenas ids da allowlist;
- tratar parecer lateral como contexto, não como ordem da pessoa;
- conservar pins, sem reinterpretá-los;
- limitar trajetória a mudanças relevantes.

`promptVersion` cresce quando essas regras, exemplos ou formatação mudarem.
Mudança somente no renderer não invalida mapa. Mudança no schema cresce
`schemaVersion` e exige decoder compatível ou rebase.

## 12. Validação e redução

`validateConversationMap` executa nesta ordem:

1. decodifica o tipo esperado;
2. rejeita chaves inesperadas quando o decoder permitir;
3. normaliza Unicode e espaços;
4. aplica limites de tamanho e cardinalidade;
5. rejeita ids fora da allowlist;
6. deriva role e channel a partir dos itens atuais;
7. exige ao menos uma fonte por claim;
8. exige fonte humana para `certainty: "explicit"`;
9. valida `explicitGoalCandidate` pelas regras da seção 6.4;
10. garante ids de claim únicos depois da derivação;
11. verifica que o terminal citado continua sendo o canônico;
12. mede o JSON final em UTF-8;
13. confirma que `inputDigest`, watermark e revisão de pins ainda são atuais.

Uma única violação rejeita a geração inteira. O redutor não salva a parte
“boa” de uma resposta estruturalmente inconsistente.

O modelo devolve um snapshot completo, nunca patch textual. O banco recebe o
novo mapa em uma escrita atômica somente após toda a validação.

## 13. Digest, watermark e invalidação

```text
inputDigest = sha256(
  schemaVersion,
  promptVersion,
  mode,
  previousMapDigest,
  pins.revision,
  ordered(itemId + contentDigest),
  canonicalOutcome,
  routePolicy
)
```

`contentDigest` usa a representação normalizada enviada, não o JSON inteiro do
`ChatItem`. O digest nunca sai na UI.

Uma tentativa não pode persistir quando:

- chegou novo turno assentado;
- pins mudaram;
- conversa foi removida;
- mapa anterior foi substituído;
- schema, prompt ou política relevante mudaram;
- uma fonte citada desapareceu;
- o cancelamento do mesmo `attemptId` foi confirmado.

Trocar de conversa não invalida uma geração válida. Voltar para ela deve
encontrar o resultado, caso a tentativa tenha terminado e ainda seja atual.

## 14. Incremento, blocos e rebase

### 14.1 Incremento

Entrada normal contém o último mapa válido e todos os turnos assentados depois
do watermark. A resposta substitui o mapa completo. Ao persistir:

- watermark aponta para o último terminal processado;
- `turns_since_rebase` cresce pelo número de turnos novos;
- `generation_mode` recebe `incremental`.

### 14.2 Entrada acima da janela

O adapter mede o orçamento real quando a fonte oferece tokenização. O pipeline
divide somente em fronteira de turno. Um único item gigante é segmentado sem
perder identidade. Cada bloco recebe o resultado validado do bloco anterior.

Nenhum resultado intermediário substitui a linha atual. Todos os blocos devem
passar. Falha no bloco N descarta a reconstrução inteira e mantém o mapa antigo.

### 14.3 Rebase

Rebase ocorre quando:

- schema ou prompt mudam;
- uma evidência persistida não existe mais;
- há 20 turnos assentados desde o último rebase;
- pin relevante muda;
- a pessoa pede `Reconstruir leitura`.

O seletor de `memoriaDaConversa` fornece a base semântica: todos os pedidos
humanos, decisões, falhas abertas, estado recente e ferramentas agregadas. Se
ainda exceder a fonte, o mesmo pipeline de blocos processa a memória em ordem.

Rebase bem-sucedido zera `turns_since_rebase`. Rebase falho não apaga nem marca
como atual o snapshot anterior.

## 15. Persistência SQLite

### 15.1 Migrações

No momento desta SPEC, a maior migração observada em `src-tauri/src/lib.rs` é
43. Isso não reserva 44. A implementação confere novamente a maior versão e
usa as três próximas versões livres, com um statement por `Migration`.

O frontend cria `ensureConversationMapTables(db)` em
`src/lib/db/conversationMaps.ts` ou módulo coeso equivalente. O ensure espelha
as tabelas para teste, dev e upgrade interrompido e segue o padrão de reset de
módulo no `beforeEach`.

### 15.2 Mapa atual

```sql
CREATE TABLE conversation_maps (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  prompt_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  summarized_through_item_id TEXT,
  summarized_through_ts INTEGER,
  input_digest TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_fingerprint TEXT,
  generation_mode TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  latency_ms INTEGER,
  turns_since_rebase INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  cost_source TEXT
)
```

`payload_json` contém somente `SemanticConversationMapV1`. Não copia
transcript, trechos de evidência, anexos ou outputs de tools. Uma conversa tem
no máximo uma linha.

Enums persistidos:

```text
source_kind: device | local_process | remote
generation_mode: incremental | rebase
cost_source: reported | estimated | unknown
```

### 15.3 Pins

```sql
CREATE TABLE conversation_map_pins (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  pins_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

UPSERT de mapa nunca toca nesta tabela. Escrita de pin usa a revisão anterior
na condição; conflito recarrega antes de oferecer nova gravação.

### 15.4 Uso agregado

```sql
CREATE TABLE utility_usage_daily (
  day TEXT NOT NULL,
  task TEXT NOT NULL,
  source_id TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  unpriced_calls INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  last_latency_ms INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, task, source_id)
)
```

O agregado permite mostrar custo por finalidade sem guardar prompt ou resposta.
Fonte que não reporta preço incrementa `unpriced_calls`; ela nunca aparece como
custo zero conhecido.

### 15.5 API de persistência

```ts
loadConversationMap(convId): Promise<ConversationMapRow | null | "corrupt">
saveConversationMapIfCurrent(row, expectedDigest): Promise<"saved" | "stale">
deleteConversationMap(convId): Promise<void>
loadConversationMapPins(convId): Promise<ConversationMapPinsV1>
saveConversationMapPins(convId, pins, expectedRevision): Promise<"saved" | "conflict">
recordUtilityUsage(sample): Promise<void>
sumUtilityUsage(task, range): Promise<UtilityUsageSummary>
```

Falha de leitura ou JSON corrompido não quebra a conversa. O render usa fatos.
Como o mapa é derivado, uma reconstrução válida pode substituir uma linha
corrompida, mas nenhum caminho toca `conversations.items`.

`expectedDigest` é o digest ainda ativo no store. Antes do SQL e logo depois
dele, o orquestrador confere tentativa, digest, watermark e revisão de pins. A
escrita usa transação e guarda otimista contra o digest armazenado que serviu
de base; outra geração vencedora transforma o resultado tardio em `stale`.

## 16. Store e orquestrador do mapa

O módulo sugerido é uma pasta, não um arquivo monolítico:

```text
src/store/chat/conversationMap/
  index.ts
  lifecycle.ts
  scheduler.ts
  persistence.ts
```

Tipos, funções puras e prompts ficam em `src/lib/conversationMap/`.

Estado efêmero por conversa:

```ts
export type ConversationMapSemanticStatus =
  | "absent"
  | "queued"
  | "generating"
  | "current"
  | "stale"
  | "unavailable"

export interface ConversationMapRuntime {
  status: ConversationMapSemanticStatus
  activeAttemptId: string | null
  activeDigest: string | null
  lastFailure: UtilityFailure | null
  repeatedFailureCount: number
}
```

O store hidrata mapa e pins junto com a conversa aberta, mas não carrega todos
os mapas no BOOT. Fatos determinísticos aparecem antes da leitura do banco.

Gatilhos:

- fim de turno assentado;
- abertura com mapa ausente ou stale;
- alteração de pin;
- source local que passa a disponível;
- mudança de schema ou prompt;
- gesto `Atualizar` ou `Reconstruir leitura`.

Debounce inicial: 700 ms depois de a conversa ficar ociosa. Rajadas substituem
o job pendente da mesma conversa.

## 17. Máquina de estados

```text
absent -> queued -> generating -> current
   |         |           |           |
   |         |           +---------> unavailable
   |         +---------------------> stale
   +-------------------------------> unavailable

current + novo turno -------------> stale -> queued
qualquer estado + pin ------------> composição imediata + queued
qualquer estado + rota off -------> facts_only
```

`unavailable` descreve ausência de rota semântica, não falha da conversa. O
último mapa válido permanece visível como stale. Uma falha isolada não gera
toast.

## 18. UtilityInferenceGateway

### 18.1 API de frontend

```ts
export type UtilityTaskKind =
  | "conversation_map"
  | "composer_suggestions"
  | "turn_receipt"
  | "lesson_distillation"
  | "skill_draft"
  | "model_curator"

export type UtilityRoutePolicy =
  | "device_only"
  | "free_only"
  | "approved_helper"
  | "off"

export interface UtilityRequest<T> {
  attemptId: string
  task: UtilityTaskKind
  locale: string
  payload: T
  inputDigest: string
  routePolicy: UtilityRoutePolicy
  projectId?: string
  conversationId?: string
  deadlineMs: number
}

export interface UtilityResult<T> {
  status:
    | "ok"
    | "unavailable"
    | "timed_out"
    | "invalid"
    | "cancelled"
    | "failed"
  value?: T
  source: {
    id: string
    locality: "device" | "local-process" | "remote"
  } | null
  timing: { startedAt: number; durationMs: number }
  cost?: {
    usd: number | null
    source: "reported" | "estimated" | "unknown"
  }
  fallbackReason?: UtilityFailureCode
}
```

Taxonomia comum:

```ts
export type UtilityFailureCode =
  | "unsupported_os"
  | "device_not_eligible"
  | "intelligence_disabled"
  | "model_not_ready"
  | "locale_unsupported"
  | "framework_unavailable"
  | "probe_failed"
  | "input_too_large"
  | "deadline_exceeded"
  | "cancelled"
  | "invalid_request"
  | "invalid_response"
  | "protocol_error"
  | "auth_required"
  | "rate_limited"
  | "spawn_failed"
  | "process_failed"
  | "security_contract_failed"
  | "stale"

export interface UtilityFailure {
  code: UtilityFailureCode
  retryable: boolean
  retryAfterMs?: number
}
```

Descrição livre pode ir ao log técnico local, sem payload. Fluxos de domínio
decidem se uma falha normalizada é visível; não interpretam string de stderr.

Comandos Tauri:

```text
utility_probe(locale)
utility_generate(request)
utility_cancel(attempt_id)
```

O frontend valida a saída do domínio novamente. Validação no Rust protege o
protocolo; validação TypeScript protege o estado persistido e o render.

### 18.2 Descriptor de fonte

```ts
export interface UtilitySourceDescriptor {
  id: string
  availability: "available" | "unavailable" | "unknown"
  supportedTasks: UtilityTaskKind[]
  locality: "device" | "local-process" | "remote"
  billable: boolean
  structuredOutput: boolean
  sessionless: boolean
  toolsDisabled: boolean
  reportsCost: boolean
  supportedLocales: string[] | "runtime"
  maxInputTokens: number | "runtime"
}
```

O registry utilitário é separado do registry de agents porque Foundation Models
não é agent. Um adapter apoiado em agent pode derivar garantias do registry de
`Capabilities`, mas a rota só existe quando provar todos os campos utilitários.
Rust e espelho TS têm testes-gêmeos.

### 18.3 Responsabilidade de um perfil

Cada perfil declara:

```ts
export interface UtilityTaskProfile<TInput, TOutput> {
  task: UtilityTaskKind
  promptVersion: number
  priority: "high" | "normal" | "low"
  defaultDeadlineMs: number
  outputSchema: string
  maxInputBytes: number
  requiresStructuredOutput: boolean
  canPersist: boolean
  canUseBillableSource: boolean
  buildInput(value: unknown): TInput
  validateOutput(value: unknown): TOutput
  fallback(input: TInput): TOutput | null
}
```

Prompts e parsers não ficam no roteador.

### 18.4 Perfis iniciais

| tarefa | prioridade | prazo | persistência | fallback |
|---|---|---:|---|---|
| mapa da conversa | normal | 45 s | snapshot | fatos determinísticos |
| sugestões | low | 4 s | lista atual | chips estáticos |
| recibo de turno | high | 3 s | contrato atual | texto genérico |
| aprendizado | low | 8 s | domínio atual | no-op seguro |
| rascunho de skill | low, por gesto | 15 s | domínio atual | template |
| curadoria | low | 20 s | domínio atual | no-op seguro |

O spike Apple mediu 12,5 s a 39,7 s no M1 Pro. O teto de 45 s preserva margem
sem bloquear a conversa, que mantém o snapshot anterior durante a geração.

## 19. Seleção de rota

O roteador filtra fontes nesta ordem:

1. perfil suporta a finalidade;
2. política permite a localidade e custo;
3. capability está efetivamente disponível;
4. locale é suportado;
5. schema cabe na capacidade estruturada;
6. entrada cabe na janela ou aceita bloco;
7. autorização remota da finalidade está válida.

Depois ordena:

```text
device compatível
  > processo local não faturável
  > fonte remota não faturável autorizada
  > helper faturável explicitamente autorizado
```

Uma tentativa acontece no máximo uma vez por fonte e digest. Pode avançar para
a próxima fonte em `unavailable`, `model_not_ready`, timeout, rate limit ou
saída inválida. Não avança quando a pessoa cancelou, quando a política mudou ou
quando houve violação de segurança.

`off` não chama o gateway. `device_only` não usa processo local de terceiros.
`free_only` nunca usa uma fonte marcada como faturável. `approved_helper` ainda
exige consentimento válido para a finalidade.

## 20. Configuração e consentimento

Adicionar a `GlobalSettings`:

```ts
export interface UtilityTaskPolicySetting {
  route: UtilityRoutePolicy
  helperSourceId: string | null
  helperModel: string | null
  remoteConsent: {
    grantedAt: number
    noticeVersion: number
  } | null
}

export interface UtilityInferenceSettings {
  version: 1
  automaticConversationMaps: boolean
  tasks: Partial<Record<UtilityTaskKind, UtilityTaskPolicySetting>>
}
```

Defaults do mapa:

```text
automaticConversationMaps = true
route = free_only
helperSourceId = null
helperModel = null
remoteConsent = null
```

Compatibilidade do `helperModel` atual:

- autorização implícita existente só é preservada para finalidades que já o
  usavam antes da migração;
- ela não autoriza `conversation_map`, pois esta finalidade pode enviar uma
  janela maior e mais histórica;
- config de projeto escolhe preferência, mas não concede consentimento global;
- o adapter legado encapsula o vínculo atual com seu CLI;
- o campo legado só é removido depois de todos os consumidores migrarem e uma
  leitura compatível sobreviver por pelo menos uma versão.

O consentimento remoto é por finalidade e versão do aviso. Revogar impede novas
chamadas imediatamente e não apaga o mapa já salvo.

## 21. Scheduler comum

O scheduler é cooperativo e limitado:

- concorrência Foundation Models: 1 em todo o app;
- concorrência por fonte remota: definida pelo descriptor, default 1;
- no máximo um job pendente por `task + conversationId` ou escopo equivalente;
- job mais novo com digest diferente substitui o antigo ainda não iniciado;
- job idêntico em voo é deduplicado;
- fila não armazena transcript, somente request já limitado;
- job expirado antes de iniciar termina `timed_out` sem spawn;
- uma nova ação humana ou um run principal pode cancelar tarefas low e adiar
  tarefas normal;
- recibo high pode concluir dentro do próprio prazo, mas nunca bloqueia o
  encerramento do turno ou a notificação fallback.

Não criar outro ticker. Se houver observação temporal, estender
`src/lib/watchdog.ts` com subscribe coalescido e um aviso por episódio.

## 22. Migração dos consumidores legados

### 22.1 Sugestões do composer

Manter no domínio:

- `SUGGEST_DEBOUNCE_MS = 700`;
- contexto e limite visual;
- até três pills de seis palavras;
- invalidação por conversa;
- persistência das sugestões;
- fallback para chips estáticos.

Mover para o gateway:

- resolução do helper;
- spawn e cancelamento;
- prazo;
- normalização de erro;
- custo e uso;
- política de privacidade.

### 22.2 Recibo do turno

Manter `RECEIPT_DEADLINE_MS = 3000`, `parseReceipt`, `receiptBody` e
`fraseDoTurno`. O deadline passa a cancelar a tentativa quando o transporte
permitir. O fallback continua sendo emitido no prazo, mesmo se a chamada não
puder ser encerrada imediatamente.

### 22.3 Aprendizado, skill e curadoria

Cada migração preserva parser, gatilho, frequência e no-op atual em teste de
caracterização. Nenhuma delas passa a rodar só porque Foundation Models ficou
disponível. Habilitação continua pertencendo ao domínio.

### 22.4 Fusion judge

Fora desta entrega. Antes de migrar, ele precisa de perfil separado, modelo
forte, custo reportado, trilha auditável e paridade de decisão. Não compartilhar
um perfil barato para reduzir código.

## 23. Adapters de CLI

Todo adapter baseado em CLI implementa:

```text
probe -> capability efetiva
build_command -> argv do fornecedor
execute -> stdout/stderr limitados
cancel -> encerra árvore do processo
normalize -> envelope comum
```

Somente `build_command` conhece flags, posição do prompt, separador `--`, modo
estruturado, sessão e desativação de tools. O gateway passa um request tipado,
não uma string de argumentos.

Uma fonte automática precisa provar em teste de contrato:

- sessão não persistida;
- tools e MCP realmente ausentes;
- stdout distinguível de stderr;
- timeout e cancelamento;
- limite de saída;
- nenhum hook que publique presença;
- custo reportado ou explicitamente desconhecido.

## 24. Sidecar `frota-intelligence`

### 24.1 Arquivos e build

```text
src-tauri/intelligence/main.swift
src-tauri/bin/frota-intelligence-aarch64-apple-darwin
src-tauri/src/utility.rs
```

`build.rs` compila o sidecar no macOS seguindo o precedente de `stt`. A config
de bundle macOS inclui o external bin; Linux o remove. O artefato participa da
assinatura e da verificação do bundle.

O nome do binário é Frota. Não introduzir `mycockpit-intelligence`.

### 24.2 Ciclo de vida

- one-shot, um pedido por processo;
- stdin, stdout e stderr sempre drenados;
- `kill_on_drop` no processo pai;
- nenhum `prewarm` no boot;
- nenhuma sessão reaproveitada;
- sem acesso solicitado a rede, arquivos, microfone ou automação;
- processo termina depois de uma resposta terminal;
- cancelar mata o filho e registra `cancelled`.

### 24.3 CLI

```text
frota-intelligence --probe --locale pt-BR
frota-intelligence --generate
frota-intelligence --self-test
```

`--probe` não carrega transcript. `--generate` lê exatamente um frame JSONL do
stdin e escreve exatamente um frame terminal no stdout. Logs vão ao stderr.

Limites de transporte:

- stdin: 256 KiB;
- stdout: 64 KiB;
- stderr capturado: 64 KiB;
- uma linha terminal; linha extra é erro de protocolo;
- UTF-8 obrigatório;
- nenhuma parte de prompt ou resposta nos logs.

### 24.4 Probe

```json
{
  "protocolVersion": 1,
  "status": "available",
  "reason": null,
  "locale": "pt-BR",
  "supportsLocale": true,
  "contextSize": 4096,
  "frameworkAvailable": true
}
```

`contextSize` acima é exemplo, não constante. O valor real vem do runtime.

Reasons fechados:

```text
unsupported_os
device_not_eligible
intelligence_disabled
model_not_ready
locale_unsupported
framework_unavailable
probe_failed
```

Casos novos do framework mapeiam para `probe_failed` até o adapter ser
atualizado. A UI nunca compara descrição textual da Apple.

### 24.5 Request

```json
{
  "protocolVersion": 1,
  "attemptId": "uuid",
  "task": "conversation_map",
  "locale": "pt-BR",
  "promptVersion": 6,
  "inputDigest": "sha256",
  "payload": {}
}
```

### 24.6 Response

```json
{
  "protocolVersion": 1,
  "attemptId": "uuid",
  "task": "conversation_map",
  "status": "ok",
  "payload": {},
  "metrics": {
    "inputTokens": 0,
    "outputTokens": 0,
    "durationMs": 0
  }
}
```

Erro:

```json
{
  "protocolVersion": 1,
  "attemptId": "uuid",
  "task": "conversation_map",
  "status": "error",
  "error": {
    "code": "model_not_ready",
    "retryable": true
  }
}
```

Mensagem livre de erro pode existir somente no stderr local. O protocolo usa
code fechado.

## 25. Foundation Models

O Swift:

- envolve a importação em `#if canImport(FoundationModels)`;
- protege chamada com a disponibilidade do macOS exigida pelo SDK;
- consulta `SystemLanguageModel.default.availability`;
- confirma `supportsLocale` para pt-BR;
- lê `contextSize` em runtime;
- cria `LanguageModelSession` sem tools;
- usa `GenerationSchema` dinâmico próprio por finalidade;
- aplica schema guiado para cardinalidade e opções estáticas;
- valida ids de evidência depois da geração, mesmo com Guided Generation;
- encerra a sessão ao terminar o processo.

Schema guiado também ocupa contexto. O sidecar mede a entrada quando a API
oferecer contagem e mantém reserva para instruções, schema e saída. Excesso
retorna `input_too_large`; quem divide em blocos é o orquestrador, não uma
truncagem oculta do sidecar.

Uma atualização do macOS pode mudar o modelo de sistema sem mudar o código do
Frota. `source_fingerprint` registra, quando disponíveis, versão do sistema,
versão do protocolo, locale e capacidade observada. Não inventa uma versão de
modelo que o framework não expõe.

## 26. Backoff e recuperação

| falha | nova tentativa automática |
|---|---|
| `model_not_ready` | somente após novo probe indicar mudança ou depois de 30 min |
| `intelligence_disabled` | somente após Configurações reabrirem/probe manual |
| `device_not_eligible` | não nesta instalação, salvo mudança de sistema/hardware |
| `locale_unsupported` | somente após locale ou capability mudar |
| timeout | uma vez no próximo digest, sem retry imediato |
| payload inválido | somente no próximo digest ou prompt version |
| rate limit remoto | conforme `retryAfter`, sem auto-resume do agent |
| auth remoto | somente após credencial mudar |
| cancelamento humano | somente por novo gesto/gatilho |

Backoff é por `source + task`, não global. Uma fonte ruim não silencia a
projeção determinística nem o run principal.

## 27. UI da aba Conversa

### 27.1 Renomeação

`ContextPanelTab` passa de `"plano"` para `"conversa"`. Como o estado é
efêmero, não há migração persistida. Todos os call sites e testes devem usar o
novo id; manter label novo sobre id antigo só posterga dívida.

### 27.2 Componentes

```text
ConversationMapPanel
  ConversationMapHeader
  CurrentDirection
  DirectionTrail
  UnderstandingList
  OpenThreadList
  CanonicalOutcome
  TaskChecklist
  BackgroundWorkList
  ConversationMapSourceDialog
  ConversationMapEditorDialog
```

O arquivo principal apenas compõe. Derivações ficam em módulos puros e blocos
visuais coesos em arquivos próprios para respeitar a catraca de tamanho.

### 27.3 Composição visual

- `Rumo atual` é a âncora tipográfica, sem cartão colorido.
- Trajetória é o gesto memorável: uma linha curta de focos conectados.
- Em largura insuficiente, a trajetória vira sequência vertical; texto não é
  espremido nem centralizado.
- Seções reutilizam `Section` e o chrome atual do painel.
- Cor aparece só em papéis canônicos de run, decisão ou falha.
- Proveniência fica em texto secundário, não em badge decorativo.
- Não há gradiente, avatar de IA, score, porcentagem ou skeleton que apague o
  conteúdo anterior.
- Controles usam `Button` e primitivas de `components/ui/`; nunca Radix cru.
- Fonte e controles respeitam as escalas fechadas do STYLEGUIDE.

### 27.4 Ordem condicional

```text
Rumo atual
Objetivo declarado, somente se existir
Trajetória, somente se houver mudança
Entendido até aqui, somente se houver itens
Em aberto, somente se houver itens
Último desfecho, somente se houver terminal
Decisões pendentes, somente se canônicas
Etapas, somente se houver plano
Trabalho em segundo plano, somente se real
```

Ausência não produz cartões vazios. A aba vazia mostra somente `A conversa
ainda não começou.`

### 27.5 Estado de atualização

O mapa anterior permanece. Cabeçalho mostra:

| estado | copy |
|---|---|
| atual | `Atualizada agora` ou horário |
| gerando com mapa | `Atualizando leitura…` |
| stale | `2 turnos novos` + `Atualizar` |
| facts only | sem alerta permanente |
| pin ativo | `Fixado por você` |

Modelo indisponível só aparece em Configurações. Gesto manual sem rota devolve
o aviso inline do PRD, sem toast de erro do chat.

## 28. Fontes e navegação para o fio

`Ver fontes` abre a primitiva canônica de detalhe. Cada fonte mostra autor,
horário, trecho resolvido no transcript e `Ver no fio`. O trecho não é salvo no
mapa.

Adicionar intenção efêmera ao store:

```ts
export interface TranscriptRevealRequest {
  conversationId: string
  itemId: string
  nonce: number
}
```

Fluxo:

1. garante que a conversa é a superfície principal;
2. localiza `[data-chat-item-id="..."]` dentro do wrapper real do transcript;
3. calcula a posição com `getBoundingClientRect` relativa ao container e seu
   `scrollTop`;
4. usa `container.scrollTo` com offset de leitura;
5. respeita movimento reduzido;
6. aplica realce transitório sem alterar o conteúdo.

Não usar `scrollIntoView` em superfície flexível. Item ausente mantém o detalhe
aberto e informa `Este trecho não está mais no fio.`

## 29. Ajuste e pin humano

`Ajustar leitura` abre `ConversationMapEditorDialog` com:

- Rumo atual;
- objetivo declarado opcional;
- restrições fixadas;
- opção `Fixar esta leitura`;
- ação `Voltar à leitura automática` por campo.

Salvar pin atualiza a view imediatamente e agenda rebase em baixa prioridade.
Falha de inferência não desfaz a edição. Conflito de revisão recarrega e mostra
uma escolha explícita, nunca last-write-wins silencioso.

Nenhuma edição muda o transcript. Nenhum pin é enviado ao agent nesta versão.

## 30. Configurações

Nova seção `Agentes e uso > Leitura das conversas`:

- `Atualizar a leitura automaticamente`;
- `Fonte`;
- `Helper de fallback`, quando houver capability;
- `Usar serviço remoto`, consentimento da finalidade;
- custo acumulado ou `custo não informado`;
- estado efetivo do modelo local;
- `Reconstruir leituras`, com escopo e confirmação.

Estados Apple são traduzidos por code. A UI não mostra toggle morto em sistema
sem a capability, mas preserva configuração inválida com explicação quando ela
foi escolhida antes de uma mudança de ambiente.

## 31. Segurança e privacidade

- Transcript é dado não confiável.
- Prompt confiável é estático e versionado.
- Sidecar não possui tools nem filesystem concedido pelo app.
- Fonte remota recebe apenas `ConversationMapInputV1` minimizado.
- Binários, imagens e outputs completos não saem.
- Logs não registram prompt, transcript, resposta ou pins.
- Citação é validada contra allowlist.
- Texto renderiza como texto, não HTML.
- `inputDigest` impede escrita atravessada.
- Consentimento remoto é separado por finalidade.
- Revogação interrompe novos jobs e cancela os ainda não iniciados.

O boundary não promete sandbox do sistema além do que o processo realmente
possui. A garantia é ausência de capacidades entregues e de leitura explícita
no código, verificada por revisão e testes.

## 32. Orçamento de recursos

| recurso | teto inicial |
|---|---:|
| processos Foundation Models simultâneos | 1 |
| gerações simultâneas por conversa | 1 |
| request do sidecar | 256 KiB |
| response do sidecar | 64 KiB |
| snapshot SQLite | 32 KiB |
| mudanças de rumo | 4 |
| claims em cada lista | 5 |
| tentativa por fonte e digest | 1 |
| primeiro mapa local típico | 5 s, meta de produto |
| cancelamento reconhecido pelo pai | 500 ms, meta |

Não há retry apertado, prewarm contínuo ou cache de transcript. Para medir
memória, o spike registra RSS antes, pico durante e até 10 s depois de encerrar
o sidecar. O processo precisa desaparecer e a memória do Frota não pode crescer
de forma monotônica em uma bateria de 50 gerações.

## 33. Observabilidade

Log estruturado permitido:

```text
attempt_id, task, source_id, locality, status,
input_bytes, output_bytes, blocks, duration_ms,
failure_code, cost_source, cost_usd
```

Nunca incluir texto, paths, títulos, ids de projeto legíveis ou conteúdo dos
claims. `conversation_id` pode aparecer somente como hash efêmero de diagnóstico
na execução local.

Métricas locais:

- latência e falha por source e task;
- taxa de saída inválida;
- fallback por motivo;
- stale turns ao abrir;
- correções humanas;
- churn de foco sem nova fala humana;
- custo e chamadas sem preço.

Nenhuma telemetria externa nasce nesta frente.

## 34. Falhas visíveis e invisíveis

| evento | painel | configurações/log |
|---|---|---|
| source local indisponível | fatos, sem banner | motivo efetivo |
| timeout isolado | último mapa | tentativa e duração |
| resposta inválida | último mapa | code e contagem |
| falhas repetidas | último mapa stale | estado degradado |
| rota paga sem consentimento | fatos | ação para autorizar |
| banco do mapa corrompido | fatos | reconstrução disponível |
| transcript corrompido | contrato atual da conversa | nunca sobrescrever |
| item citado removido | fonte indisponível | rebase agendado |

Nenhum `catch` vazio. Best-effort significa resultado normalizado e fallback,
não ausência de evidência técnica.

## 35. Matriz de testes

### 35.1 TypeScript puro

- extração de assunto inicial ignora fala ao conselheiro;
- scanner não assenta tail `running` ou `finalizing`;
- resultado, cancelamento, limite e interrupção produzem status correto;
- advisor não rouba turno do executor;
- input segmenta item grande sem perder id;
- tool entra agregada e sem output bruto;
- claim explícito sem fonte humana é rejeitado;
- goal inferido não vira objetivo explícito;
- evidência fora da allowlist rejeita o snapshot inteiro;
- ids estáveis repetem com mesma entrada;
- limites e UTF-8 são aplicados;
- compositor respeita pins e fatos canônicos;
- open thread não vira pending interaction;
- digest muda com item, pin, schema, prompt e política;
- resposta tardia não persiste;
- rebase parcial não substitui mapa;
- DB corrompido mantém facts only;
- custo desconhecido não vira zero;
- configuração legada não autoriza map remoto.

### 35.2 Gateway TypeScript/Rust

- registry TS e Rust têm capabilities gêmeas;
- router nunca escolhe billable em `free_only`;
- source incompatível com locale é filtrada;
- mesma task/digest deduplica;
- digest novo substitui job ainda na fila;
- uma tentativa por source;
- cancelamento impede fallback;
- prazo cancela quando possível;
- run principal não espera a fila;
- stdout extra, frame grande e JSON inválido falham fechados;
- stderr é drenado e limitado;
- adapter legado preserva `argv` real do fornecedor;
- tools, MCP e sessão persistente permanecem desativados;
- helper sem custo reportado marca `unknown`.

### 35.3 Swift

- build sem Foundation Models produz `framework_unavailable`;
- OS incompatível produz `unsupported_os`;
- cada availability conhecida mapeia para code fechado;
- locale não suportado não gera;
- request acima do teto é recusado;
- `GenerationSchema` serializa o wire schema;
- evidência arbitrária ainda é rejeitada pelo pai;
- segundo frame é erro de protocolo;
- `--self-test` não carrega transcript nem modelo remoto;
- processo termina depois de resultado e de cancelamento.

### 35.4 UI

- conversa vazia não pede objetivo;
- primeiro envio mostra assunto original;
- facts only é útil sem modelo;
- atualização mantém mapa anterior;
- objetivo só aparece quando existe;
- trajetória degrada verticalmente na largura estreita;
- listas vazias não criam cartões;
- fonte abre autor, trecho e ação;
- `Ver no fio` move apenas o wrapper do transcript;
- item removido tem fallback;
- pin sobrevive a restart;
- teclado opera detalhe, editor e remoção do pin;
- leitor de tela anuncia estado sem depender de cor;
- reduced motion remove transições não essenciais;
- textos passam por revisão pt-BR.

### 35.5 Fixtures e avaliação

Fixtures são payloads reais sanitizados de conversas, nunca diálogos
inventados. O corpus mínimo é o do PRD e deve congelar expected facts, claims
aceitáveis, claims proibidos e evidências obrigatórias.

Cada versão de prompt e atualização relevante do macOS roda o corpus. A entrega
é bloqueada se:

- inventar objetivo;
- contrariar status canônico;
- manter entendimento revogado;
- citar item inexistente;
- perder correção humana;
- piorar a taxa de aceitação sem explicação registrada.

### 35.6 Carga e soak

- 50 gerações locais sequenciais, medindo RSS e processos órfãos;
- conversa acima da janela em múltiplos blocos;
- alternância rápida entre 20 conversas;
- novos turnos durante geração;
- fechar e reabrir a janela durante sidecar;
- remover conversa durante tentativa;
- rate limit remoto sem retry em loop;
- app reiniciado com mapa stale e pins válidos.

## 36. Suites e gates

Em cada fase com código:

```text
cd app && bun run test
cd app && bunx tsc -b --force
cd app/src-tauri && cargo test
cd app && bun run check
```

Além disso:

- testes Swift ou `--self-test` no Mac com SDK compatível;
- QA manual com Foundation Models disponível, desativado e preparando;
- QA Linux sem external bin Apple;
- inspeção de processo e memória;
- grep de call sites de `suggest`, `helperModel`, `ConversationPlanPanel`,
  `contextPanelTab`, `deriveTasks` e `pendingDeferred`;
- validação de bundle, assinatura e hashes no fluxo normal de release.

## 37. Fases de implementação

### F0, contrato e spike nativo

- congelar tipos wire e códigos de falha;
- criar sidecar com probe, self-test e geração de fixture;
- medir locale, janela, latência e RSS;
- provar encerramento e indisponibilidade;
- registrar ADR estrutural antes de integrar.

Gate: nenhuma alteração visual e nenhum fallback pago.

### F1, projeção e persistência

- criar facts, scanner, compositor e DB;
- renomear aba para `Conversa`;
- entregar UI facts only e navegação para fonte;
- entregar pins;
- manter plano e background canônicos.

Gate: útil com toda inferência desligada.

### F2, mapa Apple

- integrar adapter e gateway;
- implementar input, blocos, validação e rebase;
- ativar `free_only` por padrão;
- mostrar estado em Configurações;
- executar corpus e soak.

Gate: nenhuma regressão de run, ditado, memória ou encerramento.

### F3, gateway dos consumidores existentes

- migrar sugestões e recibo com testes de caracterização;
- migrar learning, skill e curator em commits separados;
- manter adapter legado contido;
- agregar uso e custo.

Gate: paridade de copy, frequência, fallback e cancelamento.

### F4, helper remoto do mapa

- adicionar consentimento específico;
- provar adapter sessionless e sem tools;
- implementar disclosure e revogação;
- validar custo reportado/unknown;
- testar rate limit e auth.

Gate: impossível alcançar fonte billable sem consentimento do mapa.

## 38. Mapa provável de arquivos

```text
app/src/lib/conversationMap/types.ts
app/src/lib/conversationMap/facts.ts
app/src/lib/conversationMap/turns.ts
app/src/lib/conversationMap/input.ts
app/src/lib/conversationMap/prompt.ts
app/src/lib/conversationMap/validate.ts
app/src/lib/conversationMap/compose.ts
app/src/lib/conversationMap/fixtures/
app/src/lib/utility/types.ts
app/src/lib/utility/profiles.ts
app/src/lib/utility/gateway.ts
app/src/lib/db/conversationMaps.ts
app/src/store/chat/conversationMap/
app/src/components/layout/ConversationMapPanel.tsx
app/src/components/layout/ConversationMapSourceDialog.tsx
app/src/components/layout/ConversationMapEditorDialog.tsx
app/src-tauri/intelligence/main.swift
app/src-tauri/src/utility.rs
```

Nomes podem mudar para obedecer coesão e tamanho, mas as fronteiras não devem
ser reunidas em um único módulo.

## 39. ADRs exigidas

Antes da primeira implementação estrutural, `docs/decisions.md` registra, sem
reservar número antecipadamente:

1. mapa semântico é derivado e não participa da memória do agent na v1;
2. inferência utilitária possui gateway e scheduler próprios;
3. Foundation Models roda em sidecar one-shot separado do ditado;
4. autorização remota é por finalidade e não nasce de helper legado.

Uma ADR pode agrupar decisões inseparáveis, mas precisa preservar esses quatro
compromissos.

## 40. Fora do escopo

- despacho automático a partir de ponto em aberto;
- geração ou edição de `TaskCreate` e `TaskUpdate`;
- memória vetorial;
- resumo injetado no agente;
- sincronização externa;
- OCR ou interpretação de imagem;
- resumo de arquivo do projeto;
- daemon de Apple Intelligence;
- sessão persistente do modelo de sistema;
- migração do juiz do Fusion;
- telemetria externa;
- modelo obrigatório em Linux.

## 41. Definition of Done

A frente só está concluída quando:

1. facts only responde às perguntas básicas sem modelo;
2. mapa Apple é local, limitado, cancelável e sem processo órfão;
3. toda afirmação gerada tem fonte válida;
4. objetivo não aparece quando não foi declarado;
5. pins sobrevivem a restart e vencem novas gerações;
6. status operacional sempre coincide com as fontes canônicas;
7. fallback remoto é impossível sem autorização específica;
8. mapa não aparece em transcript, frota, notificação ou prompt;
9. longas conversas usam blocos e rebase sem corte silencioso;
10. UI respeita STYLEGUIDE, teclado, leitor de tela e movimento reduzido;
11. fixtures reais, suites completas, soak e QA de plataforma passam;
12. ADRs, documentação de arquitetura e registry refletem o código entregue.

## 42. Referências técnicas

- PRD: `docs/mapa-vivo-da-conversa-prd.md`.
- Foundation Models, `SystemLanguageModel`:
  <https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel>
- Foundation Models, `LanguageModelSession`:
  <https://developer.apple.com/documentation/foundationmodels/languagemodelsession>
- Foundation Models, `Generable`:
  <https://developer.apple.com/documentation/foundationmodels/generable>
- Atualizações do framework:
  <https://developer.apple.com/documentation/updates/foundationmodels>
- Precedente de sidecar: `app/src-tauri/stt/main.swift` e
  `docs/dictation-plan.md`.
- Contrato de prompts por adapter: `docs/x2-prompt-spec.md`.
- Memória por significado: `docs/memoria-de-conversa-plan.md`.
- Design canônico: `docs/STYLEGUIDE.md`.

## 43. Rastreabilidade do PRD

| requisito do produto | contrato desta SPEC | prova principal |
|---|---|---|
| chat sem meta obrigatória | invariantes 1 e 18, seção 27 | UI e fixture exploratória |
| foco atual com fontes | seções 6, 8 e 12 | validator e diálogo de fontes |
| objetivo somente quando declarado | seções 6.3 e 6.4 | fixture sem meta e rejeição de goal inferido |
| trajetória curta | seções 7 e 27 | limite de quatro e QA responsivo |
| correção humana vence | seções 6.5, 15.3 e 29 | persistência, conflito e restart |
| estado operacional real | seções 6.6 e 6.7 | testes dos reducers canônicos |
| conversa longa sem corte cego | seções 10 e 14 | fixture acima da janela e rebase atômico |
| Apple Intelligence local primeiro | seções 19, 24 e 25 | probe, geração e soak no Mac |
| fallback honesto | seções 19, 20, 26 e 34 | matriz de política e falhas injetadas |
| rota faturável consentida | seções 19 e 20 | teste negativo sem consentimento |
| sem impacto no run principal | seções 21 e 32 | prioridade, cancelamento e carga |
| gateway também serve às pills | seções 18, 22 e 23 | caracterização antes e depois da migração |
| privacidade e sem tools | seções 23, 24 e 31 | contrato do adapter e inspeção do processo |
| UI editorial, não kit de cartões | seção 27 | QA visual contra STYLEGUIDE |

Não há decisão de produto em aberto para iniciar F0. O spike pode medir e
propor ajuste de prazo, orçamento ou disponibilidade, mas não pode habilitar
rota paga, promover inferência a estado canônico ou mudar o escopo sem corrigir
PRD, SPEC e ADR.
