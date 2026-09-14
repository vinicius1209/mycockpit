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
