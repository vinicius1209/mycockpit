# Onde cada motor compacta, e o que os hooks custam de verdade (estudo, 16/09/2026)

> Gatilho: depois da ADR-196 (anel do Claude Code medindo contra o limiar do
> próprio motor), o pedido foi estudar o mesmo para o Codex e o agy, "sempre
> batendo nas docs oficiais, sempre com testes reais na máquina", e investigar
> os 29 mil tokens de hooks que apareceram no `/context` de uma sessão.
>
> **Atualização (16/09/2026, tarde):** o Codex foi testado no binário real
> contra uma Responses API local (limiar exato, overrides e cortes); o limite
> do agy foi cravado por experimento controlado; e o aviso de compactação do
> agy foi corrigido na ADR-197. Ver §2.1, §3.1 e §3.2.
>
> Versões medidas: Claude Code 2.1.270 · codex-cli 0.154.0 · agy 1.2.4.
> Código de produto alterado: aviso do agy (ADR-197) e anel do Codex e do agy (ADR-198). Os payloads reais colhidos estão
> apontados em cada seção; o que ficou sem prova ao vivo está dito.

## Resumo em uma tabela

| motor | o anel antes | o anel depois (ADR-196/198) | onde o motor compacta de verdade | fonte da verdade |
|---|---|---|---|---|
| Claude Code | % da janela | % até o limiar do motor | 967.000 (janela 1M, padrão) | `get_context_usage` estruturado, sem turno |
| Codex | `last input / 258.400` | `last total / 244.800` | **244.800** (90% de 272.000) | código aberto + `config/read` + catálogo local |
| agy | `input+cache / ≈1.000.000` | estimativa do agy / 256.000 | **256.000** (Gemini Flash) · 128.000 (Gemini Pro) | só no banco interno do agy |

O erro do agy era o maior: a conversa "nuvem" aparecia com 25% no anel da Frota
e estava a 97% do ponto em que o agy resume a conversa. Hoje aparece com 96%.

---

## 1. Hooks: os 29 mil tokens não chegam ao modelo

### Origem

Na sessão `c3ad6874` (prime-sales-hub), o `/context` estimava 29.132 tokens em
anexos `hook_success`. Todos eram do **Orca**: 117 anexos (57 PreToolUse, 50
PostToolUse, 6 PostToolUseFailure, 3 Stop, 1 SessionStart). O comando do hook
do Orca tem 2.165 caracteres (script com PowerShell em base64), e o Claude Code
grava um anexo com o comando inteiro a cada disparo, porque o hook imprime
`{}`. Os hooks da Frota, do Xirp e do thaytool não imprimem nada e não geram
anexo.

### A/B real (haiku, cinco chamadas de Bash sequenciais, mesma pasta)

| | contexto da 1ª à 6ª chamada (usage da API) | crescimento | anexos gravados | `/context` estima |
|---|---|---|---|---|
| com hooks | 19.361 → 20.145 | 784 | 12 (29.064 caracteres) | 7.212 tokens de `hook_success` |
| sem hooks | 19.361 → 20.087 | 726 | 0 | 0 |

**Os hooks custaram 58 tokens reais ao modelo; a estimativa local diz 7.212.**
O `totalTokens` do `get_context_usage` (o que a ADR-196 usa e o que o
auto-compact compara) veio do usage da API nos dois casos, então o anel da
Frota não é afetado. Só as categorias do `/context` ficam infladas.

### O custo que existe

- **Latência:** mediana por evento PreToolUse, medida executando os comandos
  instalados com payload real: Xirp 116 ms, Frota 17 ms, Orca 11 ms, thaytool
  5 ms. Cerca de 150 ms por evento, e cada chamada de ferramenta paga Pre e
  Post.
- **Arquivo de sessão inchado:** anexos de hook são 26% dos 29,4 MB da sessão
  `6a2b67a9`, 18% da `8f7bba12` e 13,5 MB da maior (`e6c0fd18`, 184 MB). Isso
  pesa no aviso "esta sessão nativa ocupa X MiB" da Frota e no resume.

### Recomendação

Remover os hooks de apps que não estão em uso (Orca, Xirp, thaytool foram
instalados para estudo). É edição do `~/.claude/settings.json` global, então é
decisão sua. Se algum dia a Frota mostrar as categorias do `/context`, os
anexos entram como **estimativa do motor**, nunca como consumo.

---

## 2. Codex 0.154.0

### Documentação oficial

A referência de configuração ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference))
lista `model_context_window`, `model_auto_compact_token_limit` ("unset uses
model defaults") e a nova `model_auto_compact_token_limit_scope`
(`total` padrão · `body_after_prefix`). Ela **não diz** o padrão por modelo.
Um artigo externo cita "janela − 13.000", que é a fórmula do Claude, não a do
Codex; não foi usado.

### Código da tag instalada (`rust-v0.154.0`)

- `protocol/src/openai_models.rs:515` `auto_compact_token_limit()`:
  `min(limite configurado, janela × 9 / 10)`. Override acima de 90% é cortado.
- `usable_context_window()` = janela × `effective_context_window_percent` / 100.
  É esse número que o rollout grava como `model_context_window`.
- O próprio teste do Codex fixa os três:
  `model_context_window_limits_preserve_their_distinct_meanings` → janela
  272.000, usável **258.400**, compacta em **244.800**.
- `core/src/session/context_window.rs`: o que se compara ao limiar é o
  `last_token_usage.total_tokens` (entrada **e saída**) **mais uma estimativa
  dos itens que entraram depois** da última resposta do modelo (saída de
  ferramenta, raciocínio). Janela cheia (258.400) força compactação em
  qualquer escopo.
- `model_context_window` configurado é limitado por `max_context_window` do
  catálogo (`model_context_window_override_clamps_to_max_context_window`).
- O TUI mostra "% de contexto restante" descontando uma base fixa de 12.000
  tokens (`BASELINE_TOKENS`). O número do Codex e o nosso não batem por
  construção.

### Na máquina

- **Catálogo local** (`~/.codex/models_cache.json`, buscado hoje): todos os
  modelos com `context_window` 272.000, `effective_context_window_percent` 95,
  `auto_compact_token_limit` vazio. Alguns com `max_context_window` 872.000.
- **`config/read` no app-server** (sem turno, sem cota, 0,03 a 0,3s): devolve
  `model_context_window`, `model_auto_compact_token_limit` e o escopo efetivos
  para o `cwd`. Provado com um `CODEX_HOME` temporário. Os nomes das chaves são
  `snake_case`. Sua config atual não tem override. `model/list` **não** traz
  janela.
- **Rollouts reais** (317 arquivos): **364 compactações**, sendo **224 no
  `codex_exec`**, o modo headless. Todas dispararam com o último `total_tokens`
  entre 213 mil e 245.793, coerente com "limiar 244.800 contando o que ainda
  vai entrar". Logo depois do `compacted`, o `token_count` cai (ex.: 216.534 →
  19.713). O rollout já tem o antes → depois.
- **Turno com modelo da OpenAI não rodou:** a cota do Codex está esgotada até
  19/09 às 10:12 (erro real capturado). O teste do binário foi feito como em
  §2.1, que não depende da cota.

### 2.1 Teste do binário real contra uma Responses API local

A decisão de compactar é do cliente: o Codex compara o `usage` que o servidor
devolve com o limiar. Então o `codex exec` 0.154.0 real foi apontado (por
`CODEX_HOME` temporário, provider `mock` com `wire_api = "responses"`) para um
servidor local no formato dos testes oficiais do Codex
(`core/tests/common/responses.rs`): um turno devolve `total_tokens = T`, o
`resume` seguinte mostra se houve pedido com o prompt de compactação
("CONTEXT CHECKPOINT COMPACTION") e se o rollout ganhou `compacted`. O
catálogo local foi copiado, então a janela reportada foi a real (258.400).

| caso | não compacta | compacta | janela reportada |
|---|---|---|---|
| padrão, gpt-5.6-sol (busca binária de 240k a 300k) | 244.799 | **244.800** | 258.400 |
| `model_auto_compact_token_limit=100000` | 99.999 | 100.000 | 258.400 |
| `model_auto_compact_token_limit=500000` | 244.799 | 244.800 (cortado a 90%) | 258.400 |
| `model_context_window=400000` no sol (máx. 272k) | 244.799 | 244.800 (janela cortada) | 258.400 |
| `-m gpt-6-astra` + `model_context_window=400000` (máx. 872k) | 359.999 | **360.000** | 380.000 |

A fórmula do código vale no binário, ao token: limiar =
`min(limite configurado, 90% × min(janela configurada, máx. do catálogo))`,
e a janela reportada é essa janela × 95%.

### O que o anel do Codex deveria fazer

1. Medir `total_tokens`, não só `input_tokens` (a diferença chega a 4 mil).
2. Teto = `min(limite configurado ?? catálogo, 90% × (janela configurada
   limitada ao máximo ?? janela do catálogo))`, lido de `config/read` +
   catálogo. Com escopo `body_after_prefix`, não afirmar limiar (o que conta é
   o crescimento depois do prefixo, que não enxergamos).
3. No fim do turno, se houve `compacted`, o marco do fio sai do rollout com
   antes → depois.

Ressalva honesta: o catálogo é cache interno do Codex, não API. Sem o slug
nele, nada se afirma.

---

## 3. agy 1.2.4

### Documentação oficial

A página de conversas ([docs/cli/conversations](https://antigravity.google/docs/cli/conversations/))
não fala de contexto nem de compactação. O `/compact` manual é pedido aberto
([issue #999](https://github.com/google-antigravity/antigravity-cli/issues/999),
11/09, sem resposta). Não há chave de configuração documentada para janela ou
limiar.

### Na máquina

- **`/context` só no interativo.** Em `-p` o agy responde: "/context is not
  available in print mode (it opens the interactive context breakdown)".
- **TUI por terminal emulado** (pty + `pyte` num venv temporário): numa
  conversa real grande, `/context` mostra "Gemini 3.8 Flash (High) ·
  244.6k/1.0M tokens (23.3%)", com categorias e espaço livre. **Não mostra
  reserva nem ponto de compactação.** A Frota tinha 248.850 para a mesma
  conversa (entrada + cache da última chamada), o que bate.
- **O limite real está no banco interno.** Cada conversa é um SQLite em
  `~/.gemini/antigravity-cli/conversations/<id>.db`; a tabela `gen_metadata`
  guarda um protobuf por geração. Decodificado com `protoc --decode_raw`:
  **7.185 gerações de modelos Gemini Flash trazem `256000`** no mesmo campo,
  e uma de `gemini-pro-default` traz `128000`. O binário tem a mensagem
  "exceeding cascade_config.checkpoint_config.max_token_limit (%d)".
- **Compactações reais passadas** ("# Resuming from a compaction" nos
  transcripts): nas que deu para alinhar com o uso por geração, a chamada
  anterior estava entre 252 e 261 mil tokens. Nenhum contexto de agy guardado
  pela Frota passa de 248.850.
- **Compactação provocada ao vivo, capturada:** a conversa "nuvem" foi
  bifurcada pelo `/fork` do TUI (a original não foi tocada) e recebeu um pedido
  de leitura de arquivo. Stream real (`testdata/agy-1.2.4/compactacao-checkpoint.jsonl`):
  - step 380 `agent_response`: `input_tokens` 250.647;
  - leitura de ~29 KB empurra para ~258 mil;
  - step 382 `step_type: "checkpoint"`, 14,9s;
  - step 383 `agent_response`: 5.915 + 16.298 de cache = **22.213**.
  - **Nenhum `compaction_info` no stream.**

### 3.1 Janela de 1 milhão e compactação em 256 mil: as duas coisas são verdade

O Gemini 3.8 Flash tem janela de 1 milhão, e é isso que o `/context` do agy
mostra. O que não aparece é o ponto em que **o próprio agy** resume a conversa,
que é outro número:

- Cada registro de geração em `gen_metadata` traz o par (estimativa do agy,
  `256000`). A estimativa é a mesma do `/context`: 244.639 no banco, "244.6k"
  na tela. Fica de 2 a 4,5 mil abaixo do uso real da API.
- Nas **8.368 chamadas de modelo** de todas as conversas, o maior contexto
  enviado foi 261.348, e os maiores ficam colados em 256 mil.
- **Experimento controlado** num segundo fork da "nuvem", subindo com
  mensagens de tamanho conhecido e sem ferramentas:

| degrau | estimativa do agy | uso real da API | compactou? |
|---|---|---|---|
| a (+20.000 caracteres) | 252.769 | 255.334 | não |
| b (+7.000) | 255.444 | **257.274** | **não** |
| c (+1.800, ≈ 256.360 estimado) | cruzou antes da chamada | cai para 22.217 | **sim** |

Regra: **o agy compacta antes da próxima chamada quando a estimativa dele
passa de 256.000.** O degrau b prova que o critério é a estimativa, não o uso
real (257.274 reais sem compactar). Em uso real da API, a compactação acontece
por volta de 257 a 260 mil. O `256000` vem com cada geração do servidor e vale
para os Gemini Flash registrados nesta máquina (3.6, 3.7 e 3.8); o único
registro de `gemini-pro-default` traz `128000`.

Nota: o changelog da 1.1.12 diz que `-p "/context"` respondia em modo
headless; na 1.2.4 ele recusa.

### 3.2 Corrigido: o aviso de compactação do agy (ADR-197)

Na 1.2.4 a compactação chega como `checkpoint` DONE **sem `usage`** (12 a
15 s); o checkpoint auxiliar de versões anteriores trazia `usage` de ~120 tokens.
A Frota agora avisa com antes → depois quando as duas medidas estão no mesmo
run ("250.647 → 22.213 tokens") e só com o depois quando o run começa pela
compactação. Fixtures reais em `testdata/agy-1.2.4/`.

### Dois defeitos da Frota que isto expõe

1. **O anel do agy mede contra ≈1.000.000** (catálogo) quando o agy compacta
   em 256.000. A conversa "nuvem" aparece com 25% e estava a 97%.
2. **A Frota nunca avisou uma compactação do agy.** O adapter procura
   `compaction_info`, que não existe no stream real; o fixture do teste
   `AGY_STEP_COMPACTADO` era inventado (`conversation_id: "a1"`). Houve pelo
   menos três compactações reais em conversas rodadas pela Frota
   ("Olist implementações", "Sobre a meta", uma do sicredi).

### O que o anel do agy deveria fazer

- Detectar compactação por **step `checkpoint` seguido de queda do contexto**
  (os `checkpoint` pequenos do início de conversa não derrubam nada), e
  escrever antes → depois no fio, como no Claude.
- Teto: 256.000 só é afirmável lendo o banco interno do agy, que não é
  contrato. Duas saídas honestas, a decidir:
  - (a) ler `gen_metadata` da conversa (sem turno, local) com leitura
    defensiva e rótulo "limite lido do agy (formato interno)", degradando para
    nada quando o campo sumir;
  - (b) não afirmar teto, mas parar de mostrar "25% de 1M" como se fosse folga.
- Nota lateral: o `/context` do agy abriu com o aviso "Gemini 3.5 Flash (High)
  is no longer available". É o default salvo no `settings.json` do agy, não o
  modelo da Frota (as conversas da Frota já usam `gemini-3.8-flash-high`).

---

## Artefatos de teste deixados na máquina

- Claude: sessões `3ce216fd` e `910e37a9` em `/tmp/frota-hooks-ab`.
- agy: conversa `beed4885` (dois turnos "ok") e os forks `564fc26f` e
  `f9f0e12e` da "nuvem", ambos compactados. A "nuvem" original segue intacta.
- Codex: `/tmp/frota-codex-mock` (servidor local, `run.sh` e um `CODEX_HOME`
  por caso), reaproveitável para validar a próxima versão do Codex.
- Temporários: `/tmp/codex-src` (clone esparso da tag), `/tmp/frota-pty-venv`
  (pyte), `/tmp/frota-agy-ctx`, `/tmp/frota-codex-ctx`, `/tmp/frota-codex-home`.
