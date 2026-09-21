# Buzz (block/buzz) — estudo de padrões

> 12/08/2026. **Correção de premissa**: não é projeto do usuário — é clone
> read-only de OSS do **Block** (`github.com/block/buzz`, Apache-2.0, commit
> único squashed). Copiar REGRAS é livre; código literal exige atribuição.
> "Levar da Frota pro Buzz" seria PR upstream (DCO + CLA), não absorção.

## O que é
Workspace self-hostável onde humanos e agentes dividem as mesmas salas, e
**tudo é evento Nostr assinado** (mensagem, passo de workflow, aprovação,
evento de git). O agente não é bot: é membro com keypair, membership e
auditoria próprios — "escopado por identidade, não por flag de permissão".
28 crates Rust + desktop Tauri 2/React + mobile Flutter.

## Maturidade (o contraste que importa)

| | Buzz | Frota |
|---|---|---|
| testes Rust | **6.506** | 381 |
| specs Playwright | **134** | 2 |
| jobs de CI | **19** (ci.yml 1.109 linhas) | 2 |
| spec formal | TLA+ e Tamarin | nenhuma |

## Os 5 achados

1. **Harness por JSON solto numa pasta** (`custom_harnesses.rs`) — adicionar
   motor = escrever JSON, porque o PROTOCOLO (ACP) já normalizou. Com linha de
   segurança explícita: definição de usuário **não carrega comando de install**,
   **não tem `avatar_url`** ("nada de URL remota vinda de config editável"), id
   validado contra traversal, colisão com built-in rejeitada **no loader**, JSON
   quebrado vira warn e é pulado (um arquivo ruim não derruba os outros).
2. **Honestidade epistêmica no formato do wire**: `Option<u64>` com o comentário
   *"`None` = não sabemos; `Some(0)` = provider confirmou zero. **NÃO use
   `serde(default)`** — colapsaria o ausente em zero e destruiria a procedência
   no arquivo append-only."* Mesma doutrina do nosso medidor, mas escrita como
   especificação normativa.
3. **Hooks como tools MCP prefixadas `_`** (filtradas da lista do LLM) com
   **"Agent Sovereignty"**: timeout 2,5s = sem objeção; servidor só morre no
   SEGUNDO timeout consecutivo; **orçamento de 3 rejeições por prompt** e depois
   o agente segue. "Um hook bugado ou malicioso não pode prender o agente."
   Nosso H0-H2 é fail-open na ENTREGA; falta fail-open na AUTORIDADE.
4. **Pareamento com prova formal em Tamarin** (SAS de 6 dígitos + ECDH) — e uma
   seção "Limitations" de 9 bullets declarando o que NÃO dá, incluindo
   **"No key revocation"**. Nosso C4 tem exatamente o que falta lá: aceite no
   desktop, credencial só cunhada no gesto humano, revogação individual viva.
5. **O gênero "post-mortem que nomeia a doença"**
   (`welcome-kickoff-silent-failures.md`): *"os fatos decoram; os timers
   decidem. Inverta isso e o documento colapsa."* / *"'o agente caiu' é fato;
   'ainda não há intro' é ignorância — anunciar ignorância no prazo é o que
   produz a história errada."*

## Trazer pra Frota (ranqueado)

**B1 — Lints de estilo como ratchet de CI (altíssimo / baixíssimo).**
`check-px-text-core.mjs` (proíbe px E rem arbitrário em fonte),
`check-file-sizes-core.mjs` com `allowedLineCount` (3 linhas: arquivo novo
respeita o teto, legado congela onde está), `dead-token-guard` (job que grepa
API morta e falha se voltar). **Protege a passada de tipografia que acabamos de
fazer** — sem guarda, 24 tamanhos voltam em 3 sprints. Regra deles: "se a
guarda disparar, **divida o arquivo — nunca suba o limite nem adicione
exceção**".

**B2 — Fail-open com SOBERANIA (alto / baixo).** Orçamento de rejeições por
prompt; matar servidor só no segundo timeout consecutivo; saída de hook em
JSON-encode (anti prompt-injection); resposta injetada como tool-result
(confiança menor que system). ~40 linhas no nosso hooks.
> **ENTREGUE (14/08/2026), adaptado** — `hooks-plan.md §6`: disjuntor no script
> gerado (2 timeouts consecutivos ⇒ 5 min degradando na hora, só no desfecho
> neutro do dialeto) + teto de 8 permissões pendentes no gateway. O custo real
> que isso tira: 32s por pedido → 28 ms a partir do terceiro. Fora do escopo,
> com motivo escrito lá: orçamento de rejeições por prompt (não temos hook
> como tool MCP em laço; a única rejeição aqui é a do humano).

**B3 — Descritor efetivo único + requisito com superfície (alto / médio).**
Um lugar só onde command/args/env são resolvidos (`EffectiveHarnessDescriptor`,
consumido por 5 call sites), `spawn_config_hash` que sabe se reiniciar mudaria
algo (e documenta o que NÃO entra no hash e por quê), e `Requirement` que
carrega **qual affordance conserta o gap** — resolve direto o pendente do nosso
guia de setup (probe deixa de ser booleano e vira rota).

**B4 — Harness por JSON (alto / médio)** — só depois do registry fechado.

**B5 — O gênero post-mortem (médio-alto / baixíssimo)** — nosso `decisions.md`
registra o que se decidiu; falta o que registra **por que o código estava
errado de um jeito que se repete**.

## Doutrina deles que não temos
"Prefira evento a novo endpoint HTTP" como default de design com teste de
decisão embutido · proibições absolutas (`sem unsafe`, `sem unwrap novo em
produção`) · módulo de feature não importa de outro (só de `shared/`) · **lista
explícita do que o agente NÃO pode executar** · gotchas com número de PR ·
**lista viva de singletons a resetar** ("se você adicionar cache de módulo com
dado escopado, tem que adicionar o reset aqui"). Onde somos melhores: eles não
têm nada como nosso STYLEGUIDE (papéis de cor com "não use para") nem ADRs
numeradas.

## NÃO trazer
Nostr como substrato (relay + Postgres + Redis + 17 NIPs para um app
single-user local-first) · o "Nest" como isolamento (é memória COMPARTILHADA,
o oposto do worktree por sessão — mas o padrão "seção gerenciada dentro de
arquivo do usuário" é bom) · avatares como 568 KB de Rust · multi-tenancy/K8s.
