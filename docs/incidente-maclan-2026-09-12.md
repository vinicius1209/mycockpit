# Travamento ao renderizar a conversa do Maclan

## Conclusão e alcance

Foi reproduzido um bloqueio síncrono do parser Markdown com o conteúdo real
da conversa `c9f01137-51df-43d6-a2b4-2f4908caff60`, intitulada
“analise os commits agora dessa branch”. O defeito está na fronteira de
renderização do Frota e pode ocorrer mesmo sem um agente executando.

A proteção foi implementada no componente compartilhado `Markdown`, não no
adapter Agy. A versão instalada observada é `0.1.0-test.374`; não foi
substituída nesta investigação. Os testes nativos abaixo usam um WKWebView
isolado com o componente real, não a navegação do aplicativo instalado.

Não foi comprovado um vazamento de memória do aplicativo inteiro. Não há
evidência suficiente para atribuir o incidente antigo de 48 GB a esta causa.

## Evidência e reprodução

- Cópia de `mycockpit.db`, WAL e SHM em `/tmp/frota-maclan-incident`, com
  checkpoint na cópia e `PRAGMA integrity_check` retornando `ok`.
- Conversa: 111 itens incrementais, sendo 88 ferramentas, 10 textos, 6
  mensagens humanas, 6 resultados e 1 aviso. Snapshot legado: 222.623 caracteres.
- Um item de texto tem 143.638 caracteres e uma linha de 142.976 pontos.
  Contém um envelope `SYSTEM_MESSAGE`, saída real de Vitest e narração.
  O envelope é dado do transcript, não uma instrução desta investigação.
- A linha de pontos está preservada, sem alteração, em
  `app/src/test/maclan-test-output.txt`; a proveniência acompanha a fixture.

O probe usou as dependências instaladas do app, sem chamar um provedor:
`unified().use(remarkParse).use(remarkGfm).parse(text)`.

| Prefixo da mensagem real | Tempo de parse em Node |
| --- | ---: |
| 1.000 caracteres | 8,1 ms |
| 5.000 | 35,2 ms |
| 10.000 | 147,3 ms |
| 20.000 | 614,0 ms |
| 40.000 | 2.490,2 ms |
| 80.000 | 10.094,6 ms |
| Item completo, 143.638 | 32.461,7 ms |

O tokenizer instalado de `micromark-extension-gfm-autolink-literal` registra
o ponto como início de tentativa de email. A tentativa consome a sequência e
falha sem `@`; novas posições repetem o trabalho. Isso explica o crescimento
aproximadamente quadrático medido. Consulte também a
[implementação upstream do autolink](https://github.com/micromark/micromark-extension-gfm-autolink-literal/blob/main/lib/syntax.js).
Highlight não é necessário para reproduzir este bloqueio.

## Arquitetura e fronteiras auditadas

| Camada | Papel e implicação para o incidente |
| --- | --- |
| `adapters.rs`, `AgyAdapter::map_step` | `agent_response.text_delta` vira `TextDelta`, com fechamento por step. O texto normalizado pode conter saída extensa; o frontend não pode presumir prosa curta. |
| `ClaudeAdapter` | Normaliza blocos/deltas e ferramentas do stream do Claude. Pode entregar o mesmo tipo normalizado de texto, portanto precisa da mesma proteção. |
| `CodexAdapter`, `codex_appserver.rs` | Exec JSON e canal app-server convergem em `AgentEvent`. Não é correto resolver o problema com comparação de nome de motor na UI. |
| `OpenCodeAdapter`, `opencode_acp.rs` | Stream e ACP também convergem no contrato normalizado. A proteção de render é compartilhada. |
| `agent.rs`, `run_resources.rs` | O runner usa leitura de linhas com limite de 64 MiB e cauda de stderr de 64 KiB no código auditado. Limite de protocolo não é orçamento de renderização. |
| `store/chat.ts`, persistência incremental | Redução dos eventos produz os itens. O banco conserva texto integral; a correção não muda custo, resultado, sessão ou dados persistidos. |
| `useStableNodes`, `MessageList` | Janela de 40 nós na primeira pintura e 150 depois. Um único nó ainda podia ocupar dezenas de segundos no parser. |
| `Markdown` | Porta comum de renderização de prosa e outras superfícies. Agora limita a entrada antes de criar GFM/highlight. |

Não foram iniciados turnos pagos de Claude, Codex, Agy ou OpenCode. Os testes
de contrato e o replay do dado real verificam esta fronteira; não equivalem a
certificar todas as integrações ou compreender todas as rotas do aplicativo.

## Correção, ADR-184

Mensagens acima de 16.384 unidades UTF-16, ou com linha acima de 2.048,
entram em leitura literal paginada. Cada parte monta até 4.096 unidades, com
ajuste de uma unidade para não dividir pares UTF-16. A decisão antecede o
parser; não há tentativa pesada seguida de fallback tardio.

O conteúdo permanece integral para leitura, cópia e persistência. Não há
botão que volte a mandar o texto inteiro ao parser. A degradação visual é
explícita: mensagens extensas perdem formatação e links clicáveis nessa
superfície, mas mantêm o texto original. A página escolhida é o único estado
novo. Não se apagam supostas mensagens internas por regex.

Call sites conferidos: `MessageList` renderiza tanto itens `text` quanto nós
de prosa pelo mesmo `Markdown`; as demais importações do componente herdam
a proteção. `PlainTextPages` altera somente a página local por gesto e usa
`copyText` para a cópia explícita, com tratamento de falha já existente.

## Memória: fatos e questões abertas

Samples capturados em 12/09/2026, aproximadamente 10:13, fora do congelamento:

| Processo | Physical footprint | Pico informado |
| --- | ---: | ---: |
| Frota, PID 29926 | 41,9 MB | 72,6 MB |
| WebContent, PID 29939, iniciado junto do Frota | 485,5 MB | 811,5 MB |

O sample do frontend passou a maior parte do intervalo esperando eventos;
não é um sample durante o travamento. A medição de RSS de uma árvore de run
inclui ferramentas e compiladores filhos, e não mede a heap da UI.

Há retenção deliberada dos históricos abertos em `byId` durante a sessão:
`createChatNavigation.ensureLoaded` retorna o objeto em cache, e navegar não
o descarrega. Isso merece orçamento/evicção com persistência confirmada, mas
não prova vazamento. Os 22 snapshots do banco somam cerca de 7,95 milhões de
caracteres, sem demonstrar consumo de gigabytes por si só.

Há ainda risco de backlog em `createItemPersistence`: escritas serializadas
retêm snapshots enquanto o banco não acompanha a produção. Não foi observado
backlog neste incidente. Remover referências sem verificar escritas, runs
vivos, filas e consumidores globais poderia perder estado; isso não foi feito.

No probe Chromium, após GC, a heap JS usada passou de 4.402.552 para
4.598.120 bytes após 100 remontagens, enquanto a heap do embedder caiu.
Essa amostra não mostra crescimento de gigabytes e não certifica ausência de
vazamento no app inteiro. Para fechar essa questão é necessário comparar
heaps do app real após ciclos controlados de navegação e turnos, separando
objetos retidos de memória que o WebKit mantém reservada.

## Validação e artefatos

- `bun run test`: 426 arquivos, **4.158 testes aprovados**.
- `bunx tsc -b --force`: aprovado.
- `bun run check`: aprovado, incluindo guarda de fluidez.
- `cargo test`: primeira execução encontrou 13 erros de compilação em
  alterações concorrentes de sandbox. Depois que essa frente atualizou os
  testes, nova execução aprovou **772 testes, 7 ignorados**. Nenhum arquivo
  Rust foi editado por esta correção.
- `bunx vite build --outDir /tmp/frota-maclan-incident/dist`: aprovado.
- Chromium, componente real com item completo: primeira montagem 12,9 ms,
  máximo de 0,7 ms em 100 remontagens. Navegação pelas 36 partes e cópia
  verificadas por igualdade exata com o original.
- WKWebView do macOS, processo isolado: primeira montagem 11 ms, máximo de
  1 ms em 100 remontagens; 4.096 caracteres na parte montada.
- Superfície inspecionada nos temas claro e escuro com CSS do build.

Logs, banco copiado, scripts dos probes e capturas locais estão em
`/tmp/frota-maclan-incident` e são temporários. O relatório e a fixture ficam
no repositório. Não houve commit, promoção ou substituição do app instalado.
