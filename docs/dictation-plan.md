# Ditado — plano (nunca perder o fim da frase)

> Status: proposto em 06/08/2026, do relato do usuário: "no modo editado, o
> feedback em tempo real veio, mas ao soltar o botão ele COMEU boa parte da
> frase dita no final". Referência de qualidade citada: Wispr Flow (e a
> família superwhisper / MacWhisper / VoiceInk).

> **CORREÇÃO DE SAÍDA (05/09/2026):** `SttSession` participa do coordenador do
> ADR-164. Uma captura ativa aparece na confirmação; depois do aceite, novas
> capturas são recusadas e o sidecar recebe `CANCEL` com prazo antes da
> escalada. Cancelar o diálogo não toca no ditado.

> **CORREÇÃO DE CAPTURA (01/09/2026):** D1/D2 continuam sendo o contrato, mas o
> produtor dos buffers deixou de ser o tap do `AVAudioEngine`. Com saída em fone
> Bluetooth, o engine podia manter a captura presa ao aggregate device do macOS
> mesmo quando a configuração mostrava o microfone interno. ADR-145 substitui
> esse mecanismo por `AVCaptureSession` com `AVCaptureDevice` explícito; streaming
> e CAF recebem o mesmo sample buffer, sem qualquer rota de saída.

> **CONFIABILIDADE P0 ENTREGUE (01/09/2026):** ADR-146 fecha os contratos que
> ainda faltavam depois da troca de captura. `stt_start` devolve o microfone
> realmente aberto e o pill exibe esse nome com um medidor RMS neutro. O botão e
> o Esc cancelam também durante permissões/abertura; sessões usam tentativa
> identificada para uma resposta antiga não atingir a próxima. Desconexão,
> interrupção e erro da captura finalizam uma vez, preservam a fala e avisam na
> hora. Reconhecimento sem suporte on-device agora falha fechado, coerente com
> a promessa "100% local". Sessão sem sinal devolve diagnóstico sobre a entrada
> do macOS, em vez de terminar vazia e sem explicação.
> **FECHAMENTO CONCORRENTE (02/09/2026):** a tentativa agora acompanha todos os
> eventos Tauri, não apenas a fase interna. Cada superfície ignora áudio alheio,
> `Stopping` reserva a sessão até o sidecar realmente sair, inclusive no
> cancelamento, e a conversa de destino fica congelada no início do ditado.
> Navegar durante a fala não move o
> texto para outro rascunho nem faz o `keyup` parar outro botão.
> **PROVA DE PONTA (02/09/2026):** bundle Tauri isolado, com banco próprio,
> abriu o UID `BuiltInMicrophoneDevice`, mostrou nome e nível reais, recebeu
> parcial, finalizou, reabriu e cancelou por Esc. O protocolo foi também
> contrastado com o `dictationId` e o aceite de finalização do Paseo.
> **CORREÇÃO DE FALSO ALERTA (02/09/2026):** uma releitura de arquivo concluída
> com sucesso não é degradação só porque retornou menos palavras que o
> streaming. Os dois reconhecimentos podem redigir a mesma fala de maneiras
> diferentes. `resolveFilePass` continua escolhendo o texto mais completo, mas
> só produz aviso quando a releitura falha de verdade. Arquivo indisponível,
> prazo esgotado, perda de captura e ausência de sinal continuam ruidosos.

> **D1 ENTREGUE (06/08/2026).** O que mudou de fato:
> - **D1.1** — `stopPipeline` no `main.swift`: drain de 300ms com o mic AINDA
>   aberto (é onde o fim da frase se salva) → `endAudio()` → `engine.stop()` +
>   `removeTap`. O drain vem ANTES do `endAudio` de propósito: depois dele todo
>   `append` é ignorado, então drenar depois não recuperaria nada.
> - **D1.2** — a heurística do "metade do tamanho" NÃO decide mais o final.
>   Entrou `moreComplete(candidate, best)` (pura): contém/estende vence, pedaço
>   perde, divergência decide por número de palavras, empate normalizado
>   (pontuação/acento/caixa) fica com o candidato. `bestCurrent` guarda o texto
>   mais completo da utterance; todo desfecho passa por ela. A heurística da
>   metade sobrevive SÓ como detector de reset silencioso do reconhecedor (e
>   agora commita o melhor visto, não o último parcial).
> - **D1.3** — o pill não some ao soltar o botão: fase `busy` = "Finalizando…"
>   (`dictationPillView`, pura e testada). Os timeouts (8s Swift, 15s Rust)
>   seguem intactos.
> - **Prova**: sem harness Swift no projeto, a suíte da regra vive no binário
>   (`mycockpit-stt --selftest`, 10 casos, sem mic/permissão) e o `cargo test`
>   a executa (`stt::tests::selftest_do_sidecar_prova_que_o_final_nunca_encurta`).

> **D2 ENTREGUE (06/08/2026).** Streaming virou preview; a verdade vem do arquivo
> (ADR-034).
> - **D2.1** — o mesmo callback que alimenta o reconhecedor grava um CAF temporário
>   (`AVAudioFile(forWriting:settings: format.settings)`). Apagado em TODO
>   desfecho (sucesso, erro, CANCEL, `atexit`), e o boot varre sobras de
>   `kill -9` com mais de 1h. Falha de escrita derruba a passada de arquivo
>   (áudio truncado nunca é tratado como verdade).
> - **D2.2** — no STOP, `SFSpeechURLRecognitionRequest` sobre o arquivo inteiro
>   (on-device, `addsPunctuation`, mesmo `--vocab`), prazo de 5s; esse texto é
>   o final.
> - **D2.3** — fallback honesto: falha, prazo estourado ou arquivo indisponível
>   entregam o melhor texto do streaming com `{"warn"}`, que sobe pelo canal do
>   sidecar (`SttMsg::Warn`) até `stt_stop` (`{ text, warn }`) e vira toast no
>   MicButton. **A regra do D1.2 vale também aqui**: se a releitura bem-sucedida
>   vier mais curta e divergente do que o streaming, o streaming ganha sem
>   falso alerta; diferença de redação não prova áudio truncado.
> - **Custo**: o STOP agora leva ~1s típico (0,3s de drain + até 1,2s esperando o
>   streaming fechar + a releitura). Por isso o D1.3 não é cosmético.
> - **Buraco conhecido**: o office (DeskDock/MissionDock/missionPanel) consome
>   `stopDictation()`, que devolve só o texto, então o `warn` não aparece por lá
>   (o texto nunca se perde). Superfície de missão, não tocada nesta frente.

## A causa (lida no código, não suposta)

Arquitetura atual: sidecar Swift (`app/src-tauri/stt/main.swift`) com
`SFSpeechRecognizer` em **streaming**; parciais vão pra UI por `stt://partial`;
`STOP` (`stt.rs:133`) encerra e devolve o texto final.

Dois defeitos somados explicam o corte:

1. **A ordem do STOP descarta áudio em voo** (`main.swift:246-254`):
   `engine.stop()` e `input.removeTap(onBus:0)` acontecem ANTES de
   `req?.endAudio()`. O que estava no buffer do tap (dezenas a centenas de ms
   — justamente as últimas sílabas) nunca chega ao reconhecedor.
2. **O resultado final PODE ser mais curto que o último parcial, e vence**
   (`main.swift:160-170`): a guarda de encolhimento só dispara quando o texto
   novo tem **menos da metade** do tamanho (`t.count * 2 < current.count`).
   Um final que perde só o rabo da frase (10-40% menor) passa reto, sobrescreve
   `current` e o rabo some. É exatamente o sintoma relatado.

## A lição do mercado (o que Wispr Flow e afins fazem diferente)

O padrão da categoria **não é** confiar no streaming para o texto final:

- **Grava o áudio inteiro** e roda uma passada de transcrição sobre o **buffer
  completo** ao soltar o botão. O streaming existe só para o feedback ao vivo.
  Consequência direta: é impossível "comer o fim", porque o fim está no arquivo.
- **Pós-processamento**: pontuação, remoção de hesitação ("é…", "tipo"),
  formatação sensível ao contexto (o app sabe que é um prompt de dev).
- **Push-to-talk com trava de finalização**: a UI mostra "finalizando" por
  centenas de ms em vez de fingir que acabou.

## D1 — Não perder o fim (correção da causa, barata)

- **D1.1** — Inverter a ordem no `STOP`: `endAudio()` PRIMEIRO, e só depois
  parar o engine/remover o tap, com um pequeno *drain* (~300ms) antes de
  encerrar. O áudio em voo entra no reconhecedor.
- **D1.2** — **O final nunca encurta**: guardar o melhor texto visto
  (`bestSoFar`) e, no `finish`, entregar o MAIS COMPLETO entre o final e o
  último parcial (regra: se o final não contém/estende o parcial e é menor,
  usa o parcial). Some a heurística frágil do "metade do tamanho".
- **D1.3** — UI honesta: estado "finalizando…" entre soltar o botão e o texto
  chegar (hoje o usuário solta e acha que acabou). O timeout de 8s
  (`main.swift:255`) e o de 15s (`stt.rs:145`) continuam como rede.

## D2 — Passada de áudio completo (o pulo de qualidade)

- **D2.1** — Gravar o áudio da sessão em arquivo (WAV/CAF temporário no
  scratch da conversa, apagado ao fim).
- **D2.2** — No STOP, rodar transcrição sobre o **arquivo inteiro**
  (`SFSpeechURLRecognitionRequest`, on-device, mesma stack — zero dependência
  nova) e usar ESSE texto como final; o streaming vira só preview.
- **D2.3** — Fallback honesto: se a passada de arquivo falhar ou estourar o
  prazo, entrega o texto do streaming com aviso (nunca perder a fala).
- Registrar em `agent-runner.md`/ADR o motivo: streaming é para *feedback*,
  arquivo é para *verdade*.

## D3 — Polimento de texto (opcional, opt-in)

- Pós-processar o texto final com o **modelo helper** (o mesmo das sugestões):
  pontuação, capitalização e remoção de hesitação, preservando termos técnicos
  e nomes de arquivo. Opt-in nas Configurações, com o texto cru sempre
  recuperável (mostrar "original" no hover) — nada de reescrever fala sem
  o usuário pedir.
- Vocabulário do projeto: alimentar `contextualStrings` do
  `SFSpeechAudioBufferRecognitionRequest` com nomes de arquivo/símbolos do
  repo (o app já inventaria isso) para o reconhecedor acertar jargão.

## Guardas

- On-device sempre (é a promessa do produto: nada sai da máquina).
- Nenhuma fala perdida em NENHUM caminho de erro: todo desfecho entrega o
  melhor texto disponível.
- Push-to-talk continua o gesto primário; o modo "editado" não pode ter
  comportamento diferente do direto no que diz respeito a perda.
