# Agy real, reprodução opt-in

Estes probes iniciam sessões reais e consomem quota da conta autenticada.
Só execute os comandos de CLI após autorização humana. A suíte comum usa
fixtures, sem iniciar agentes. Não execute duas cópias no mesmo diretório.

1. `python3 scripts/probes/agy-e2e/prepare.py` cria um diretório temporário e
   mostra seu caminho. Esse comando apenas prepara arquivos.
2. `python3 scripts/probes/agy-e2e/capture.py DIRETORIO volume` executa o
   CLI, salvando stdout, stderr, argv e RSS separado por processo. Leia o
   `conversation_id` do evento `init` no `volume.jsonl`.
3. `python3 scripts/probes/agy-e2e/capture.py DIRETORIO resume ID` retoma
   explicitamente a sessão do passo anterior.
4. Em `app/src-tauri`, execute o runner real:

```sh
FROTA_AGY_CAPTURE_DIR=DIRETORIO FROTA_AGY_LIVE_CASE=runner cargo test agent::agy_live_tests::runner_real_transmite_eventos_e_encerra_processos -- --ignored --exact
FROTA_AGY_CAPTURE_DIR=DIRETORIO FROTA_AGY_LIVE_CASE=cancel cargo test agent::agy_live_tests::runner_real_transmite_eventos_e_encerra_processos -- --ignored --exact
```

Substitua DIRETORIO pelo caminho absoluto gerado no passo 1. O caso cancel
exige diretório sem `workspace/cancel.pid` de uma execução anterior; prepare
um diretório novo ao repetir a matriz. O caso runner reexecuta o workload e
atualiza `receipt.json`. Nenhum probe altera o banco do app ou instala builds.

O comando volume produz 142.976 pontos, aloca 24 MiB e espera 12 segundos;
cancel grava heartbeat por até 90 segundos. O runner recebe o mesmo comando
montado pelo adapter de produção, incluindo timeout próprio de 60m; a sonda
solicita cancelamento após 180s ou dois segundos depois do início do workload
cancel. O wrapper Python usa teto de CLI de 4m e externo de 250s.

O capture remove as variáveis de correlação da Frota herdadas do processo pai.
Ainda usa as integrações globais do Agy: elas podem iniciar subprocessos no
boot, mesmo que o prompt não autorize chamadas de ferramentas externas.
Não remove MCPs, plugins, sessões ou configurações globais.

Limite de medição: RSS é amostrado a cada segundo; subprocessos muito breves
podem não aparecer. Asserções de cancelamento do runner verificam o PID do
workload e ausência de seu arquivo final. Isso não prova ausência universal
de órfãos em todos os tipos de processo.

## Caso dev server (ADR-203)

Reproduz o incidente de 17/09/2026: o Agy sobe `next dev` em background e o
`-p` fica esperando o servidor, que nunca termina. Prepare à mão um diretório
com `workspace/` (um `package.json` e `pages/index.js` mínimos; `node_modules`
pode ser link para um projeto que já tenha `next`, e aí o Next exige
`--webpack`, porque o Turbopack recusa link fora da raiz) e um
`devserver.prompt.txt` que peça `npx next dev --webpack -p PORTA` em segundo
plano, o `curl` de confirmação e as instruções de teste. Em `app/src-tauri`:

```sh
FROTA_AGY_CAPTURE_DIR=DIRETORIO FROTA_AGY_DEVSERVER_PORT=PORTA cargo test --lib agent::agy_live_tests::runner_real_mostra_a_resposta_enquanto_o_agy_espera_o_dev_server -- --ignored --exact --nocapture
```

A sonda para o run 30 s depois da explicação da espera (ou em 6 min sem ela) e
grava `devserver.normalized.jsonl` (eventos com segundos desde o início) e
`devserver.runner-summary.json`. Cobra: resposta antes ou junto da explicação,
servidor no ar durante a espera, turno encerrado só pelo parar, sem repetir a
resposta, porta livre depois de parar.
