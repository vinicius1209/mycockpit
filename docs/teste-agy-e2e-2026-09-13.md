# Agy CLI real e integração com o Frota, 13/09/2026

## Resultado

Foram executados **quatro turnos reais**, autorizados pelo usuário, com
**Agy 1.2.2** e **gemini-3.8-flash-high**. Volume/background, retomada explícita,
runner de produção e cancelamento passaram. Não foi reproduzida uma nova
falha de produção nesta matriz. Foram adicionados probes e regressões com
streams reais; nenhum comportamento de produção foi alterado nesta rodada.

O conteúdo gigante do incidente de 12/09 não reapareceu como prosa neste
teste. Isso não prova que o Agy nunca o emitirá novamente: a proteção de
Markdown implementada anteriormente continua necessária.

## Matriz realmente executada

| Caso | Caminho | Evidência | Resultado |
| --- | --- | --- | --- |
| Volume e background | CLI diretamente, stdout bruto em arquivo | Python emite 142.976 pontos, aloca 24 MiB, espera 12s e escreve recibo com SHA-256; Agy acompanha via `manage_task`, lê recibo e responde | exit 0; 29,15s de parede no wrapper |
| Retomada | CLI com `--conversation` apontando para o id anterior | Recuperou `FROTA_AGY_E2E_731`, marcador e quantidade de pontos sem executar ferramentas | Mesmo id confirmado, exit 0; 6,26s de parede |
| Runner | `AgyAdapter::build_validated_command` → `agent::run_once` → `Channel<AgentEvent>` | Nova execução do workload; 30 eventos normalizados, ferramentas e resultado final | exit 0; 24,14s no teste; stderr vazio |
| Cancelamento | Mesmo runner, `Notify` real durante workload vivo | Workload de 90s interrompido dois segundos após criar seu arquivo de PID; heartbeat parou em 2; PID ausente após retorno; arquivo final não criado | `cancelled=true`, `success=false`; nenhum resultado de sucesso; teste em 9,13s |
| Replay de adapter | Stdout bruto dos dois primeiros casos → adapter real | Texto emitido equivale à concatenação dos deltas, sem duplicar `result.response` | Aprovado |
| Reducer | Captura do Channel do terceiro caso → `reduceItems` | Ferramentas fechadas, um resultado, recibo e hash integrais, sem output convertido em prosa | Aprovado |
| WebKit | Os 30 eventos → reducer → `MessageList` real, em WKWebView isolado | Dez itens, recibo visível e conteúdo final completo | Etapa mais lenta de redução/render: 12 ms |

O SHA-256 esperado e recebido para a linha de pontos é
`b3ccbb785193599e4fcef14b9c218b92fe70b18981f525eff0c3f7cf9600147c`.

O campo `duration_seconds` do result do Agy não foi usado como cronômetro do
wrapper: no caso retomado retornou 57,48s enquanto o processo observado durou
6,26s. São medidas distintas; as durações da tabela vêm dos relógios locais.

## Saída extensa e diferença para o incidente

O CLI 1.2.2 já entregou a saída da ferramenta com `<truncated 2 lines>` e o
recibo final. Houve um `step_type: system_message` separado, sem `text_delta`.
O stdout bruto não contém a linha inteira de pontos como resposta do agente.
Logo, **neste teste, a truncagem aconteceu antes do adapter do Frota**.

Passos `agent_response` sem `text_delta` foram observados antes de ferramentas;
a resposta final chegou em deltas ACTIVE e DONE. A ausência de texto nesses
passos intermediários não foi tratada como falha. O adapter preservou os deltas
reais e não repetiu a resposta agregada do evento result.

Isso esclarece o comportamento da versão testada, mas não determina quem
introduziu o envelope e o texto gigante na captura antiga. Não foi feito
downgrade do Agy nem alterada sua configuração global.

## Memória e processos

Amostragem de `ps` a cada segundo, com RSS separado por PID e PPID:

| Caso direto | Pico RSS do Agy | Pico RSS da árvore |
| --- | ---: | ---: |
| Volume/background | 205,5 MiB | 536,4 MiB |
| Retomada | 187,4 MiB | 476,4 MiB |

No pico da primeira execução foram observados Agy, Python do workload e
processos iniciados automaticamente pelo CLI: `npm exec @playwright/mcp@latest`,
seu Node e `SkyComputerUseClient`. O prompt não pediu chamadas dessas
integrações, e elas não aparecem como chamadas executadas no stream capturado.
Ainda assim, seu boot ocupa memória. Todos os descendentes observados nas duas
execuções diretas estavam ausentes na checagem posterior ao encerramento.

No runner real, `run_status` mediu até 536 MB na árvore. O cancelamento também
confirmou que o PID do workload não sobreviveu. Isso valida estes processos
concretos, sem prometer limpeza universal para qualquer árvore possível.

**Não foi comprovado vazamento de memória.** São execuções curtas de processos
novos, não horas de navegação com históricos retidos na mesma heap do app.
RSS da árvore do agente não mede a memória da WebView. Retenção em `byId` e
backlog de persistência descritos no relatório anterior continuam questões
separadas, sem causa comprovada ou nova correção nesta rodada.

## Fronteira do teste

O runner testado é o `run_once` de produção, com o comando construído e
validado pelo adapter. Leitura de stdout, normalização, telemetria, fechamento
e cancelamento usaram código real. O Channel foi interceptado pelo teste para
salvar os eventos, e esses eventos foram reproduzidos no frontend real.

**Não foi acionado o composer do aplicativo instalado.** O preflight/MCP por
projeto, o `run_manifest`, a persistência no banco do usuário e a navegação
entre conversas no app instalado não fazem parte desta matriz. O próprio
`run_once` não emite o `Cancelled`/`Done` final da orquestração externa; o teste
verifica seu Outcome e não fabrica esses eventos para completar uma captura.

O WKWebView usa um harness isolado com reducer e MessageList, sem o shell e o
banco do app. A medição não é a latência total do gesto de abrir uma conversa.
Os workloads são controlados; os streams dos agentes e eventos do runner são
reais. Nenhum mock foi usado para representar uma resposta do modelo.

## Artefatos e reprodução

- `scripts/probes/agy-e2e`: preparação local, workload, wrapper de captura e
  prompts. O README descreve os comandos e o consumo de quota dos casos vivos.
- `app/src-tauri/testdata/agy-1.2.2`: streams brutos persistidos e proveniência.
- `app/src-tauri/src/agy_live_tests.rs`: regressão sem CLI na suíte normal e
  probe real explicitamente ignorado por padrão.
- `app/src/test/agy-runner-1.2.2.json`: eventos efetivamente recebidos no Channel.
- `app/src/store/chat.agyLive.test.ts`: regressão do reducer com esses eventos.
- `/tmp/frota-agy-e2e-20260913`: capturas locais completas, argv, stderr,
  amostras de memória, recibos, resumo do runner, harness WebKit e logs dos
  testes. Esse diretório é temporário.

Validação completa executada: **4.171 testes frontend** em 429 arquivos;
**783 testes Rust aprovados, 8 ignorados** (inclui o probe que inicia Agy);
`bunx tsc -b --force` e `bun run check` aprovados. O probe ignorado foi rodado
explicitamente duas vezes, uma por caso autorizado. Os scripts Python foram
verificados e o preparador executado sem iniciar novas chamadas.

O único acréscimo em `agent.rs` é o registro do módulo sob `#[cfg(test)]`.
Nenhum caminho operacional muda estado por causa desta alteração. Os probes
criam sessões de teste no Agy e arquivos em seu workspace isolado. Não houve
commit, instalação de build, alteração de MCPs ou uso de outros projetos.
