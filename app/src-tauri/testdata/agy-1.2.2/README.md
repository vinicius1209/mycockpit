# Proveniência das capturas

Streams stdout integrais do Agy CLI **1.2.2**, modelo
`gemini-3.8-flash-high`, capturados em 13/09/2026 no teste autorizado da Frota.
Os comandos e o workload vivem em `scripts/probes/agy-e2e`.

- `volume.jsonl`: sessão nova, comando com 142.976 pontos e 12s de duração,
  acompanhamento em background, leitura do recibo e resposta final.
- `resume.jsonl`: mesma sessão retomada explicitamente, recuperação de um
  código de controle sem consultar disco ou usar ferramentas.
- `app/src/test/agy-runner-1.2.2.json`: eventos realmente recebidos pelo
  `Channel<AgentEvent>` do `agent::run_once`, em uma segunda execução do
  workload, com o comando construído pelo adapter. Não são eventos inventados.

O replay não inicia CLI nem chama modelo. As capturas contêm caminhos de um
workspace de teste temporário, ids de sessões de teste e nomes do inventário
do CLI, sem conteúdo de projetos externos ou credenciais.

Relatório: `docs/teste-agy-e2e-2026-09-13.md`.
