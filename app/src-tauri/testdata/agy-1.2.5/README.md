# Proveniência das capturas

Agy CLI **1.2.5**, modelo `gemini-3.8-flash-low`, capturado em 17/09/2026 nesta
máquina, num diretório temporário (`/tmp/agy-bg`), com o mesmo formato de
comando do adapter (`-p … --output-format stream-json --add-dir`). O caminho da
home foi trocado por `/Users/exemplo`; nada mais foi editado.

Pedido: "Rode o comando `sleep 25 && echo terminou-o-sleep` em segundo plano
(background task). Não espere por ele: logo em seguida responda apenas: PRONTO."

- `bg-sleep.jsonl`: stdout integral. Linha do tempo medida: `init` e steps 0 a 2
  (ferramenta ACTIVE) até 11,7 s; **silêncio** até 36,8 s; então os steps
  segurados (ferramenta DONE, a resposta "PRONTO." do step 3, a notificação da
  tarefa e o comentário do step 5) e o `result`, com exit 0 aos 39,5 s.
- `bg-sleep.stderr`: a única linha de stderr, escrita aos 13,7 s, no começo do
  silêncio: `root agent idle; waiting for 1 background task(s) (bounded by
  --print-timeout)`.
- `bg-sleep.transcript.jsonl`: o `transcript.jsonl` da conversa no fim do run.
  O step 3 ("PRONTO.") tem `created_at` 13:07:41, antes do aviso de espera: a
  resposta já estava no histórico enquanto a ponte seguia muda.

Incidente que motivou a captura: 17/09/2026, `npx next dev` em segundo plano.
O agente respondeu em 13 min e o turno ficou "trabalhando" até a interrupção
manual 25 min depois, porque o `-p` espera a tarefa terminar (teto no
`--print-timeout`, 60 min na Frota) e o servidor nunca termina.
