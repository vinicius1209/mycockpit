# OpenCode como 4º motor, e o OpenRouter por tabela (plano)

> Proposto em 25/08/2026. **A fase 0 já está feita**: tudo abaixo foi MEDIDO no
> binário instalado nesta máquina (`opencode 1.17.9`, `/opt/homebrew/bin`) e
> confrontado com a documentação oficial e com a implementação do Orca clonado.
>
> Referências apontam **arquivo e símbolo**, nunca `arquivo:linha`.

## Por que isto vale a pena, em uma tabela

O pedido foi *"aproveitar de outras assinaturas além de claude, codex e agy"*.
O OpenCode não é só um 4º motor: é um **multiplicador de credencial**.

| o que ele destrava | como |
|---|---|
| GitHub Copilot, GitLab Duo, xAI SuperGrok, DigitalOcean, Snowflake | **OAuth** (assinatura que você talvez já pague) |
| OpenAI (ChatGPT Plus/Pro) e Anthropic (Claude Pro/Max) | OAuth — as MESMAS contas, por outro caminho |
| `opencode-go` | plano fixo de US$ 10/mês, com ~60 modelos (deepseek, glm, kimi, minimax, qwen, grok…) |
| OpenRouter e qualquer BYOK | chave de API no `opencode.json` |

**Medido nesta máquina:** `opencode providers list` já mostra **3 credenciais
ativas** — `openai` (oauth), `google` (oauth) e `opencode-go` (api). Você já tem
metade do caminho andado e o Frota não enxerga nada disso.

`opencode models` devolve **88 modelos** hoje, em 4 provedores.

## O que eu medi, e que decide o desenho

### 1. O contrato do `run` mapeia quase 1:1 no nosso adapter

| nosso conceito | flag do opencode |
|---|---|
| prompt one-shot | `opencode run "msg"` |
| stream estruturado | `--format json` |
| modelo | `-m provider/model` |
| esforço | `--variant high\|max\|minimal` |
| anexos | `-f arquivo` (aceita vários) |
| retomar sessão | `-s <id>` / `--continue` / `--fork` |
| diretório | `--dir` |
| bypass de permissão | `--dangerously-skip-permissions` |

É o mapeamento mais completo dos quatro motores. Anexo nativo e id de sessão o
`agy` não tem.

### 2. O `serve` expõe OpenAPI 3.1, e o catálogo de eventos é melhor que o nosso

`opencode serve` sobe um servidor HTTP com `/doc`. Os eventos que interessam:

| evento | o que resolve pra nós |
|---|---|
| `session.next.text.delta/started/ended` | streaming de texto |
| `session.next.tool.called/success/failed/progress` | eventos de ferramenta |
| `session.next.reasoning.delta` | bloco de raciocínio |
| **`session.next.compaction.started`** com `reason: "auto" \| "manual"` | **o ADR-074 de graça**: ele ANUNCIA a auto-compactação e diz o motivo |
| **`session.next.context.updated`** | janela de contexto viva (o anel do ContextRing) |
| **`permission.v2.asked` / `replied`** | canal de permissão REAL, com pergunta e resposta |
| `question.v2.asked` | perguntas ao humano |
| `session.next.model.switched` | troca de modelo no meio da sessão |
| `session.idle` / `session.error` | fim de turno e falha |

### 3. O custo vem REPORTADO, e com a divisão de cache que acabamos de precisar

`AssistantMessage` traz `cost` (número) e:

```
tokens: { total, input, output, reasoning, cache: { read, write } }
```

**`cache.read` E `cache.write`, os dois obrigatórios.** Nenhum dos nossos três
motores entrega isso: o claude reporta os dois mas só líamos `read`; codex e agy
mandam `cache_creation: 0` sempre. O OpenCode alimentaria a linha
"+N reconstruído" do ADR-084 nativamente, e o ledger ficaria explicável.

E `AssistantMessage` ainda carrega `providerID`, `modelID`, `variant`, `finish`
e `error` — procedência completa por turno.

### 4. O banco quebrado derruba os DOIS transportes (corrigido em 26/08/2026)

```
SQLiteError: no such column: replacement_seq
```

O banco local (`~/.local/share/opencode/opencode.db`) está fora de sincronia com
o binário. `opencode run` falha **com exit code 0** (!).

**A frase original desta seção dizia "e o `serve` não". Estava errada, e o erro
importava:** era ela que justificava eleger o `serve` como transporte primário.
Medido no F3, com a mesma stack trace:

```
SessionPrompt.createUserMessage → SessionContextEpoch.requestReplacement
  → SQLiteError: no such column: replacement_seq   (HTTP 500)
```

O `serve` **sobe e responde metadado** — cria sessão, lista modelos, serve o
`/doc`. O que ele não faz é **rodar um turno**: o prompt bate no mesmo
`replacement_seq`. O que parecia "um transporte são e outro doente" é um banco
doente sob os dois.

Isto não é curiosidade: é requisito. A integração precisa **reconhecer estado
local quebrado** e dizer isso, em vez de mostrar "sem resposta". E o exit 0 numa
falha significa que **não dá pra confiar no código de saída** deste CLI.

### 5. O Orca faz DIFERENTE, e não devemos copiar

O Orca integra OpenCode por **PTY/TUI**: dirige o terminal com sequências de
escape (`bracketed paste`, detecção de `show-cursor`) e infere conclusão do
output (`agent-completion-coordinator`, `agent-paste-draft`). Também lê o
`opencode.db` direto (`session-scanner-opencode-sqlite-worker`).

É coerente com o produto deles, que é um terminal com abas. **É o oposto do
nosso**, que é spawn + evento estruturado. Copiar isso traria de volta
exatamente o que a casa já decidiu não absorver.

## A decisão de arquitetura

**Transporte primário: `opencode serve` + HTTP/SSE. Fallback: `run --format json`.**

E isso **não é padrão novo** — é o padrão que o `codex_appserver` já estabeleceu:
subir o MESMO binário em modo servidor para conseguir o que o modo one-shot não
dá (lá, o pedido de permissão; aqui, o mesmo mais contexto e compactação), com
queda para o transporte simples quando o servidor não sobe.

A diferença a favor do OpenCode: o contrato dele é **OpenAPI publicado**, não
descoberto por tentativa. O `codex app-server` é marcado `[experimental]`; este
não é.

## Fases

### F0 ✅ — Medir (feito, é o corpo deste documento)

### F1 ✅ — O motor aparece na máquina (25/08/2026)

**Corrigi duas coisas que este plano dizia errado, e a suíte foi quem apontou.**

1. **`available` continua `false`.** O texto original mandava ligar as
   capabilities medidas, e a própria seção "o que NÃO fazer" proibia. A suíte
   decidiu: as flags do registro significam **"o APP conta com isso"**, não "o
   fornecedor suporta". Ligá-las sem adapter quebrou 22 testes, e por um motivo
   certo — `opencode` era o fixture de "motor do registry sem capacidade
   nenhuma", e o código distingue isso de "motor fora do registry, não sei o que
   ele reporta". Duas frases diferentes, as duas honestas.
2. **Sem sonda de banco.** O plano pedia detectar o banco quebrado no F1. Toda
   forma barata de fazer isso passa por fuçar o schema PRIVADO do opencode
   (`replacement_seq`), que muda quando eles quiserem. Medido: `db "SELECT 1"`,
   `stats` (469 sessões) e `models` passam; só o `run` falha. O reconhecimento
   vai pro F2, onde o erro existe e pode ser classificado — mesma disciplina do
   `sandbox.rs` separando "sandbox negou" de "agente quebrou".

**Entregue:** `probe_opencode` no `detect.rs` (versão + credenciais), a linha em
"Agentes na máquina", `agent_bin`, e os comandos de instalar/atualizar. A auth
aqui NÃO é booleana: conta QUANTOS provedores existem, porque é isso que decide
quantos modelos o seletor terá. Zero credencial = instalado e inútil = `missing`.

### F2 — O adapter, pelo `serve`

`OpenCodeAdapter` no `adapters.rs`, com o transporte em módulo próprio
(`opencode_server.rs`), espelhando o desenho do `codex_appserver`:
spawn → porta → SSE → mapeamento de eventos → `AgentEvent`.

Mapeamento direto do que já medimos. O `Result` sai com `cost` reportado e a
divisão de cache preenchida de verdade.

### F3 ⏸ — Permissão de verdade: contrato lido, round-trip BLOQUEADO (26/08/2026)

O `permission.v2.asked` é um canal REAL. Isso coloca o OpenCode acima do `agy`
no eixo de enforcement: ele **pergunta**, não só promete no prompt.

O que NÃO temos: granularidade de modo. Só existe o `--dangerously-skip-permissions`,
que é tudo-ou-nada. Então `enforcement` do OpenCode é `flag`, nunca `sandbox`,
e a UI precisa dizer isso — é a mesma disciplina do ADR que expôs o
`enforcement` no seletor de modo.

**O contrato foi lido do `/doc` do binário 1.17.9 e está aqui, inteiro:**

| peça | valor medido |
|---|---|
| evento | `permission.v2.asked` · `properties: { id ^per, sessionID ^ses, action, resources[], save[], metadata, source }` |
| `source` | `{ type: "tool", messageID, callID }` — dá pra casar a pergunta com a chamada |
| responder | `POST /api/session/{sessionID}/permission/{requestID}/reply` |
| corpo | `{ reply: "once" \| "always" \| "reject", message?: string }` |
| pendentes | `GET /api/session/{sessionID}/permission` (devolve `{data:[…]}`) |
| regra por sessão | `POST /session` aceita `permission: [{ permission, pattern, action }]`, `action ∈ allow\|deny\|ask` |

**A máquina foi destravada em 26/08/2026** (o usuário autorizou reinstalar):
binário 1.17.9 → **1.18.21**, plugin `oh-my-openagent` removido do config, e o
`opencode.db` movido pra `opencode.db.quebrado-20260826` (**não apagado**; 418
MB, 474 sessões, recuperável por `opencode import` a partir de um `export`). O
`auth.json` ficou intocado e as três credenciais seguem lá. Turno real medido
depois disso: `text: "oi-frota"`, `cost: 0.000942`. **O adapter do F2 está
validado de ponta a ponta.**

**Com a máquina sã, a medição inverteu o desenho do F3.** A pergunta certa não
era "como falar com o `serve`", era "o `run` já não resolve?". Rodando com
`{"permission":{"bash":"ask"}}` no `opencode.json` do projeto:

```
! permission requested: bash (echo oi-frota); auto-rejecting
```

**O `opencode run` não pergunta: ele AUTO-REJEITA.** E faz duas coisas piores
que falhar:

1. O aviso sai no **stderr como texto humano com ANSI**, não como evento no
   stream JSON. Quem lê o stdout estruturado não vê nada.
2. O turno grava `"The user rejected permission to use this specific tool
   call."` — **atribuindo ao humano uma recusa que a máquina tomou sozinha**.

Isso confirma a arquitetura do plano (o `serve` É necessário pro modo que
pergunta) mas por um motivo diferente do escrito: não é que o `run` esteja
doente, é que ele é **estruturalmente incapaz** de ter canal de permissão.

**O que foi consertado agora, sem esperar o F3:** o `tool_use` caía no
`_ => vazio` do `map_line`, nenhum evento nascia, e o `on_close` reportava
`ok:true` sobre um turno com TODA ferramenta barrada. Sucesso falso, e por cima
com a mentira do fornecedor no registro. O adapter agora distingue "a pessoa
recusou" de "ninguém foi perguntado" (guarda dos dois lados: com bypass ligado,
a frase do opencode fica de pé).

**Um terceiro achado, que muda o desenho quando o F3 voltar:** o agente padrão
vem com `permission: "*" → allow`. O canal existe e fica **mudo** — nenhum
`permission.v2.asked` sai a menos que alguém instale uma regra `ask`. Ou seja,
"o OpenCode pergunta" não é fato herdado do CLI: é **decisão de produto** do
Frota, que teria de mandar o ruleset na criação da sessão. Isso é escolha de
UX que ninguém tomou ainda, e não é detalhe de implementação.

**O que ainda falta, e é onde o F3 recomeça:** o `POST /api/session/{id}/prompt`
admite o prompt (`admittedSeq`) e **não executa** — zero mensagem, zero evento,
zero log, com credencial e banco sãos. O caminho legado
(`POST /session/{id}/message`) pendura igual. Ou falta um passo de "drenar a
fila" que o `/doc` não deixa óbvio, ou esses endpoints querem outra coisa. É
ISSO que precisa ser medido antes de escrever `opencode_server.rs`, e é barato:
subir o `serve`, mandar um prompt e descobrir o que o TUI dele faz que a gente
não está fazendo.

### F4 — Modelos e OpenRouter

**O OpenRouter entra POR DENTRO do OpenCode, não ao lado.**

Esta é a decisão que economiza um subsistema inteiro. O caminho ingênuo seria um
cliente HTTP nosso para o OpenRouter, com chave, catálogo, preço e erro
próprios. O caminho certo: o OpenCode já fala OpenRouter (BYOK, chave no
`opencode.json`), então para o Frota **OpenRouter é um provedor do OpenCode** —
mesma sonda, mesmo adapter, mesmo ledger.

- `opencode models` vira a fonte viva (`listsModels`, igual ao `agy models`).
- O seletor mostra `provider/model`, que é o dialeto real do `-m`.
- Configurar chave: o app MOSTRA o caminho (`opencode providers login`), não
  conduz o fluxo — mesma regra do `gh auth login` no cartão de Serviços.

### F5 ✅ — O aviso de limite com 4 candidatos (26/08/2026)

O pedido explícito. O que muda com um 4º motor:

- **A troca no rate limit ganha um candidato que não compete pela mesma cota.**
  Hoje, se o Claude bate no limite, trocar pro Codex pode bater no limite do
  Codex. O `opencode-go` é plano SEPARADO (US$ 10/mês) e não divide cota com
  nenhum dos três. É o melhor destino de fuga que o app pode ter.
- **`usageWindow: null` CONFIRMADO por medida.** `opencode stats` devolve
  histórico (US$ 111,50 em 198 dias, 471 sessões), não janela: sem cota, sem
  reset, sem percentual. Não há barra a mostrar, e inventar uma era o risco que
  esta fase existia pra evitar.
- **O handoff melhora sozinho** no que já existe: o `-s <id>`/`--fork` dá
  retomada de sessão nativa, e o `session.next.context.updated` dá o número real
  do contexto — o que hoje é estimativa por catálogo.

## O que NÃO fazer

- **Não** integrar por PTY/TUI copiando o Orca. É o padrão que esta casa já
  decidiu não absorver, e o OpenCode oferece contrato estruturado.
- **Não** construir cliente OpenRouter próprio. Um provedor a mais do OpenCode
  custa uma linha de config; um cliente novo custa um subsistema.
- **Não** confiar no exit code do `opencode run`: medido saindo **0 em falha**.
  O desfecho tem que vir do evento (`session.idle` × `session.error`).
- **Não** ligar `available: true` antes do adapter existir. Motor que aparece no
  seletor e não roda é a promessa vazia que o `hint: "em breve"` evita hoje.
- **Não** prometer medidor de janela sem medir o `opencode stats` primeiro.
- **Não** tocar no `~/.local/share/opencode/` do usuário para "consertar" o
  banco. Diagnóstico é nosso; reparo é gesto dele.

## Definition of done

- O OpenCode aparece no seletor, roda um turno e o custo REPORTADO chega ao
  ledger com `cache.read` e `cache.write` separados.
- Banco quebrado (o estado real desta máquina hoje) vira frase honesta na tela,
  não turno sem resposta.
- Um turno com `permission.v2.asked` PARA e espera a resposta humana.
- `opencode models` alimenta o seletor, e um modelo OpenRouter aparece lá depois
  de o usuário configurar a chave pelo CLI.
- Trocar para o OpenCode num rate limit do Claude funciona ponta a ponta.
- `cargo`, `tsc`, `vitest`, 9 guardas, e2e.

## Fontes

- [OpenCode Zen](https://opencode.ai/zen) · [docs de provedores](https://opencode.ai/docs/providers/)
- [OpenCode Zen e Go (DeepWiki, sst/opencode)](https://deepwiki.com/sst/opencode/4.5-opencode-zen-and-go-services)
- [Planos e preços (2026)](https://www.codeagentswarm.com/en/guides/opencode-plans-and-pricing)
- Binário `opencode 1.17.9` nesta máquina, e o Orca clonado em `~/projetos/orca`.
