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

### 4. O `run` está QUEBRADO nesta máquina, e o `serve` não

```
SQLiteError: no such column: replacement_seq
```

O banco local (`~/.local/share/opencode/opencode.db`) está fora de sincronia com
o binário. `opencode run` falha **com exit code 0** (!); `opencode serve` sobe
normal e responde.

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

### F3 — Permissão de verdade, e o eixo de modos

O `permission.v2.asked` é um canal REAL. Isso coloca o OpenCode acima do `agy`
no eixo de enforcement: ele **pergunta**, não só promete no prompt.

O que NÃO temos: granularidade de modo. Só existe o `--dangerously-skip-permissions`,
que é tudo-ou-nada. Então `enforcement` do OpenCode é `flag`, nunca `sandbox`,
e a UI precisa dizer isso — é a mesma disciplina do ADR que expôs o
`enforcement` no seletor de modo.

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
