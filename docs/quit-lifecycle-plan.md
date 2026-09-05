# Ciclo de vida de saída do Frota

> **Status em 05/09/2026:** Q1 a Q5 implementadas no ADR-164 e suítes
> obrigatórias aprovadas. A prova manual usa uma build promovida. Este plano
> substitui apenas a parte de saída descrita em
> `docs/incidente-sessao-plan.md`. A restauração da janela principal pelo Dock,
> instrumento e barra de menus permanece como está.

> **CORREÇÃO DE PROVA (05/09/2026):** a validação da primeira build revelou
> que o snapshot React podia ainda estar em zero logo após o boot. Automações
> habilitadas agora são contadas diretamente no SQLite pelo Rust; o snapshot é
> apenas fallback conservador. Nenhuma build final depende dessa hidratação.

> **CORREÇÃO DE INTEGRAÇÃO NATIVA (05/09/2026):** a prova da build 363 mostrou
> que o Quit padrão do macOS chama `terminate:` sem emitir
> `RunEvent::ExitRequested`. O delegate do AppKit agora implementa
> `applicationShouldTerminate:`, retorna `NSTerminateLater` e só responde ao
> sistema depois da decisão ou do teardown. Isso cobre Cmd+Q, menu e Dock.

## 1. Problema

O Frota tem dois gestos diferentes que hoje parecem próximos demais:

1. fechar a janela principal e continuar trabalhando pela barra de menus;
2. sair de verdade e encerrar tudo que pertence ao aplicativo.

O primeiro gesto já é intencional quando `Continuar ao fechar` está ativo. O
segundo ainda não tem uma fronteira única:

- o item `Sair` da barra de menus usa `tray::request_quit` e confirma quando o
  snapshot informa turno ou trabalho em background;
- fechar a janela com `Continuar ao fechar` desativado reutiliza essa mesma
  confirmação;
- `Cmd+Q` e o item de saída do menu nativo podem chegar diretamente a
  `RunEvent::ExitRequested`, matar os processos e pular a confirmação;
- a decisão de confirmar depende principalmente do `TraySnapshot` publicado
  pelo frontend, mesmo quando o backend conhece processos que a UI pode não ter
  publicado ainda;
- agents, processos gerenciados, navegador e plugins recebem limpeza explícita,
  mas ditado e inferência local dependem sobretudo de `kill_on_drop`;
- atualizações de CLI usam um encerramento gentil próprio para não corromper o
  gerenciador de pacotes, mas não participam de um teardown global;
- o Companion persiste aparelhos na saída, porém o servidor não recebe o mesmo
  shutdown gracioso usado pelo botão de desligar;
- o instrumento parece um processo à parte, mas é uma janela do próprio
  processo Tauri. Ele morre com o Frota e não deve ser tratado como sidecar.

O efeito mais perigoso é a assimetria: a mesma intenção humana, sair do Frota,
pode confirmar ou não conforme a porta usada.

## 2. Objetivo

Criar um único coordenador nativo de saída que:

- distingue `ocultar` de `sair` antes de qualquer efeito;
- recebe todas as origens de saída real;
- inventaria trabalho pelo dono real, não apenas pela projeção do frontend;
- pede confirmação somente quando existe consequência relevante;
- impede novos spawns depois que a saída foi confirmada;
- encerra de forma explícita, limitada e idempotente tudo que o Frota possui;
- nunca mata sessões externas apenas observadas;
- permite que crash e encerramento forçado degradem de forma honesta;
- deixa evidência suficiente para provar que nenhum filho ficou órfão.

## 3. Decisões de produto

### 3.1 Fechar não é sair

| gesto | resultado |
|---|---|
| botão vermelho com `Continuar ao fechar` ativo | esconder `main`, mudar para `Accessory` no macOS e manter runs, automações e instrumento |
| botão vermelho com a opção desativada | pedir saída ao coordenador |
| `Sair` na barra de menus | pedir saída ao coordenador |
| `Cmd+Q` ou item `Sair` do menu do aplicativo | pedir saída ao coordenador |
| saída programática autorizada após teardown | concluir sem abrir outro diálogo |
| crash, `SIGKILL` ou encerramento forçado pelo sistema | não há promessa de diálogo; usar contenção de processos e reconciliação no próximo boot |

O aviso de primeira ocultação continua existindo: `Frota continua em operação`.
Ele não é confirmação e não deve reaparecer a cada fechamento.

### 3.2 Quando confirmar

Não mostrar confirmação em uma saída realmente ociosa. Confirmar quando pelo
menos uma destas condições for verdadeira:

- turno, missão ou disputa em execução;
- trabalho em background do agent ainda vivo;
- processo gerenciado, navegador ou worker de plugin vivo;
- ditado capturando ou finalizando;
- tentativa de inferência utilitária em andamento;
- atualização de CLI em andamento;
- automação habilitada que deixará de executar com o app fechado;
- chamada do Companion ainda em processamento, se ela puder perder um gesto já
  aceito.

Rascunhos persistidos, instrumento visível e uma janela do Companion apenas
conectada não justificam confirmação por si sós.

### 3.3 O que a confirmação diz

A confirmação é nativa. Ela não depende do React nem de um webview saudável.
O texto deriva do inventário efetivo e cita apenas consequências reais.

Exemplo com trabalho em curso:

```text
Sair do Frota?

1 turno e 2 processos serão interrompidos. O ditado atual será descartado.
O instrumento fecha junto com o app.

[Continuar no Frota] [Interromper e sair]
```

Exemplo somente com automações habilitadas:

```text
Sair do Frota?

3 automações não executarão enquanto o Frota estiver fechado.

[Continuar no Frota] [Sair]
```

Se existirem sessões externas observadas:

```text
2 sessões abertas no Terminal não pertencem ao Frota e continuarão rodando.
```

Regras de linguagem e hierarquia:

- `Continuar no Frota` é a saída segura e recebe o foco inicial;
- `Interromper e sair` só aparece quando algo será interrompido;
- `Sair` é usado quando a consequência é apenas deixar automações indisponíveis;
- não listar PIDs, nomes internos de registries ou sidecars;
- não usar uma tela React fantasiada de confirmação nativa;
- a mensagem deve caber sem disclosure adicional.

## 4. Fonte de verdade do inventário

Adicionar um `QuitInventory` montado no Rust. Cada subsistema informa somente o
que possui; o coordenador compõe, mas não adivinha.

| recurso | dono | leitura para confirmação | encerramento |
|---|---|---|---|
| agents e descendentes do run | `agent::RunRegistry` + marcador `MYCOCKPIT_RUN_ID` | quantidade de runs e PIDs efetivos | sinal de cancelamento, prazo curto, depois grupo/PID |
| trabalho diferido | adapter + `TraySnapshot` | quantidade e nomes já normalizados | termina junto com o run proprietário |
| processos de tools | `work_gateway::ProcessRegistry` | registros em estado vivo | `TERM`, prazo e `KILL` do grupo |
| navegador por projeto | `ProcessRegistry` + `BrowserRegistry` | processo e lease efetivos | mesmo caminho do processo gerenciado |
| plugins e MCPs de plugin | `PluginRuntimeRegistry` e leases | workers/chamadas vivos | recusar chamadas novas, `TERM`, prazo e `KILL` |
| ditado | `stt::SttSession` | `Starting`, `Active` ou `Stopping` | enviar `CANCEL`, drenar brevemente e matar se necessário |
| Apple Intelligence/helper | `utility::UtilityState` | tentativas registradas | enviar cancelamento de todas e aguardar `wait_bounded` |
| atualização de CLI | `update::UpdateJobs` | job `running` e método | `TERM` no grupo, prazo específico, depois `KILL` |
| Companion | `companion::CompanionState` | ação aceita em curso, não mera conexão | sentinela, flush e graceful shutdown do servidor |
| automações | tabela `schedules` + `TraySnapshot` | contagem persistida habilitada, com máximo conservador do snapshot | o processo encerra; não há daemon fora do app |
| trava de sono | `Despertador` | não entra no diálogo | soltar depois dos runs |
| instrumento | `hud::HudState` | não entra como processo | recolher e esconder; o processo principal encerra a janela |
| sessões externas | `hook_sessions` | contexto informativo | nunca encerrar |

O `TraySnapshot` continua útil para nomes e semântica de produto, mas não pode
zerar um processo que o backend ainda vê nem uma automação habilitada no
SQLite. Se as fontes discordarem, o diálogo usa a maior contagem conservadora
e copy genérica.

## 5. Máquina de estados

Criar `app/src-tauri/src/quit.rs` com um estado fechado:

```text
Idle
  -> Requested
      -> Idle                 pessoa cancelou
      -> Draining             saída confirmada ou sem consequência
          -> Committed        teardown terminou ou atingiu o prazo
              -> ExitRequested permitido
```

Propriedades obrigatórias:

- somente `Idle` pode abrir um diálogo;
- pedidos repetidos em `Requested` ou `Draining` não abrem diálogos duplicados;
- `Committed` é o único estado que permite a segunda passagem de
  `ExitRequested`;
- qualquer comando que abrir processo consulta `is_draining()` antes do spawn;
- cancelar volta a `Idle` sem alterar runs, janelas ou preferências;
- cada etapa de teardown pode rodar mais de uma vez sem matar processos alheios;
- o coordenador registra origem, inventário, decisão, duração e resultado, sem
  gravar comandos, prompts, tokens ou caminhos sensíveis.

## 6. Roteamento de todos os gestos

### `app/src-tauri/src/lib.rs`

- Em `RunEvent::ExitRequested`, chamar `api.prevent_exit()` enquanto o
  coordenador não estiver em `Committed`.
- Na primeira passagem, iniciar `request_quit(QuitOrigin::Native)`.
- Mover o bloco atual de `kill_all` para o teardown do coordenador.
- Na segunda passagem, já comprometida, permitir a saída sem repetir diálogo ou
  limpeza.
- Manter `RunEvent::Reopen` independente da máquina de saída.

### `app/src-tauri/src/tray.rs`

- Fazer `Sair` delegar ao coordenador, sem política própria.
- Fazer o fechamento com continuidade desativada usar a mesma entrada.
- Remover `force_quit` da superfície IPC pública; o commit final da saída deve
  ser uma operação interna do coordenador.
- Preservar `hide_main_window`, `notify_window_hidden` e
  `restore_main_window`.

Nenhum item de menu, atalho ou janela pode chamar `app.exit(0)` diretamente,
exceto a etapa `Committed`.

## 7. Sequência de teardown

Depois da confirmação:

1. Marcar `Draining` e impedir novos agents, tools, plugins, browser, ditado,
   inferência e updates.
2. Emitir `quit://draining` apenas como feedback; a saída não depende de o
   frontend responder.
3. Recolher o instrumento e impedir novo hover/foco.
4. Cancelar ditado e inferências one-shot.
5. Solicitar cancelamento dos runs, incluindo trabalhos diferidos.
6. Encerrar processos gerenciados, navegador e plugins por grupo.
7. Encerrar o Companion graciosamente e persistir `last_seen`.
8. Soltar leases e a trava de sono.
9. Tratar update ativo com prazo próprio, nunca com `SIGKILL` imediato.
10. Registrar o relatório do teardown, marcar `Committed` e chamar `app.exit(0)`.

Operações independentes podem drenar em paralelo, mas o commit da saída espera
o conjunto inteiro ou o prazo global. O prazo não transforma falha em sucesso:
processo que exigiu `KILL` aparece no log como escalado; PID ainda vivo após o
prazo aparece como falha de teardown.

### Prazos propostos

| classe | encerramento gentil | escalada |
|---|---:|---:|
| ditado e inferência | 300 ms | matar filho/grupo |
| agent e trabalho diferido | 750 ms | matar grupo e PIDs marcados |
| tool, navegador e plugin | 1 s | matar grupo |
| Companion | 500 ms | abandonar servidor junto com o processo |
| atualização de CLI | 5 s | matar grupo e registrar risco de instalação incompleta |
| teto global | 6 s | commit de saída com relatório de pendências |

Esses valores devem ser medidos no harness antes de virar constantes finais.

## 8. Persistência e retomada

- O transcript continua persistindo incrementalmente; o teardown não cria uma
  segunda fonte de verdade no Rust.
- O frontend recebe `quit://draining` e pode gravar um marco de intenção, mas o
  coordenador não espera essa confirmação.
- No próximo boot, runs que estavam vivos e não receberam terminal continuam
  virando interrompidos ou órfãos pelo reconciliador existente.
- Um encerramento limpo grava um pequeno recibo local de teardown com versão,
  horário, contagens e resultado. Não guardar prompt, output ou comando.
- O boot lê esse recibo apenas para diagnóstico. Ele não ressuscita trabalho.

Não é necessária migração SQLite para a primeira entrega. Se o recibo precisar
ser consultável pela UI, criar uma migração somente depois de conferir a maior
versão real em `app/src-tauri/src/lib.rs`.

## 9. Falhas e degradações

| falha | comportamento |
|---|---|
| frontend travado | diálogo e teardown continuam nativos |
| snapshot da tray atrasado | registries do backend vencem |
| diálogo não abre | registrar erro e manter o app aberto; nunca presumir consentimento |
| pessoa cancela | voltar a `Idle`, sem efeitos |
| segundo `Cmd+Q` durante diálogo | focar/manter a decisão existente, sem duplicar |
| novo spawn durante `Draining` | recusar antes do processo com mensagem de encerramento |
| filho ignora `TERM` | escalar somente o grupo possuído |
| PID foi reutilizado | exigir vínculo do registry e marcador do run; nunca matar por nome |
| sessão externa aparece no inventário | informar que continuará, jamais sinalizar |
| crash durante unwind | `kill_on_drop` ajuda, e o próximo boot reconcilia marcadores que restarem |
| `SIGKILL` ou encerramento abrupto | não há `Drop` nem teardown garantido; sidecars próprios tratam EOF do canal de controle como ordem de saída, e o boot seguinte reconcilia o restante sem prometer limpeza perfeita |

## 10. Implementação por fase

### Fase Q1: política pura e coordenador

- Criar tipos `QuitOrigin`, `QuitPhase`, `QuitInventory`, `QuitImpact` e
  `QuitDecision`.
- Extrair funções puras para decidir confirmação e montar copy em pt-BR.
- Implementar latch idempotente e segunda passagem de saída.
- Cobrir matriz de política antes de integrar processos.

### Fase Q2: inventário pelos donos

- Adicionar leituras sem efeito aos registries de agent, processos, plugins,
  STT, utility, updates e Companion.
- Separar recurso vivo, recurso apenas conectado e sessão externa observada.
- Comparar o inventário Rust com o snapshot publicado e degradar sem subcontar.

### Fase Q3: teardown explícito

- Adicionar `shutdown_all` idempotente a cada dono.
- Reutilizar os caminhos normais de cancelamento quando eles já forem seguros.
- Aplicar `TERM` e `KILL` apenas por PID/grupo registrado.
- Dar tratamento gentil específico a updates.
- Remover dependência exclusiva de `kill_on_drop` para STT e utility.

### Fase Q4: unificar as portas

- Rotear botão vermelho sem continuidade, barra de menus, menu nativo e
  `Cmd+Q` para `request_quit`.
- Proibir `app.exit` fora do commit final.
- Manter ocultação, minimização e reabertura sem regressão.

### Fase Q5: evidência e documentação

- Registrar uma ADR nova em `docs/decisions.md`, conferindo antes o maior número
  real.
- Atualizar `docs/architecture.md`, `docs/incidente-sessao-plan.md`,
  `docs/deferred-work-plan.md`, `docs/dictation-plan.md` e os comentários dos
  registries.
- Registrar a matriz manual do macOS e Linux com PIDs antes/depois.

## 11. Testes obrigatórios

### Unitários Rust

- saída ociosa não confirma;
- cada categoria de impacto isolada produz a copy correta;
- duas categorias pluralizam sem frase ambígua;
- automação habilitada confirma sem chamar de interrupção;
- sessão externa é informativa e nunca entra no conjunto de kill;
- segundo pedido não abre novo diálogo;
- cancelar devolve `Idle`;
- segunda passagem só é liberada depois de `Committed`;
- cada `shutdown_all` é idempotente;
- PID sem posse ou marcador exato é recusado.

### Integração nativa

Usar executáveis-fixture reais, não payloads inventados:

- filho direto e neto reparentado com `MYCOCKPIT_RUN_ID`;
- processo gerenciado em grupo próprio;
- sidecar falso de STT que responde a `CANCEL` e outro que ignora;
- sidecar de utility em geração;
- sidecars próprios encerram ao receber EOF no canal de controle;
- plugin worker e MCP de plugin;
- Chromium de teste pelo registry normal;
- update falso que encerra em `TERM` e outro que força escalada;
- servidor Companion com WebSocket conectado;
- processo externo parecido, mas sem posse do Frota.

Após confirmar a saída, todos os processos possuídos devem desaparecer e o
externo deve permanecer. Após cancelar, todos devem continuar.

### Frontend

- o aviso de primeira ocultação continua uma única vez;
- `quit://draining` bloqueia gestos de spawn sem inventar desfecho;
- o instrumento não se apresenta como processo separado;
- rascunhos continuam presentes após sair e reabrir;
- replay marca como interrompido um run morto no fechamento.

### Matriz manual no macOS

| preparação | gesto | esperado |
|---|---|---|
| app ocioso | `Cmd+Q` | sai sem diálogo e sem processo restante |
| turno em voo | `Cmd+Q` | confirma; cancelar preserva o turno |
| turno em voo | `Sair` da barra | exatamente o mesmo diálogo |
| continuidade ativa | botão vermelho | esconde `main`, não confirma, instrumento permanece |
| continuidade desativada | botão vermelho | usa o coordenador |
| ditado ativo | sair | informa descarte e mata `mycockpit-stt` após confirmação |
| mapa semântico atualizando | sair | cancela `frota-intelligence` |
| navegador gerenciado | sair | fecha Chromium do projeto |
| sessão externa no Terminal | sair | sessão continua viva |
| update em andamento | sair | copy específica e encerramento gentil |
| diálogo cancelado | Dock | janela principal restaura e recebe foco |

Repetir os casos aplicáveis no Linux, substituindo Dock e Notch pelas portas
disponíveis.

## 12. Critérios de aceite

- Todas as formas de sair chegam ao mesmo coordenador.
- Nenhum cleanup destrutivo acontece antes da confirmação necessária.
- Fechar para a barra de menus não entra no fluxo de saída.
- A decisão de confirmar não depende somente do frontend.
- O Notch não aparece como sidecar nem exige kill próprio.
- STT, utility, agents, processos, browser, plugins, updates, Companion, leases
  e trava de sono têm teardown explícito ou uma justificativa documentada.
- Sessões externas nunca são mortas.
- Não existe chamada pública de `force_quit` que pule o coordenador.
- O harness prova ausência de filhos possuídos depois da saída confirmada.
- `bun run test`, `bunx tsc -b --force`, `cargo test` e `bun run check` passam.
- A validação final usa uma build limpa instalada e confere processos antes e
  depois de `Cmd+Q`, barra de menus e botão vermelho.

## 13. Fora de escopo

- manter agents vivos depois que o processo do Frota encerra;
- criar daemon de background;
- matar CLIs abertos manualmente no Terminal;
- transformar o instrumento em processo independente;
- prometer confirmação ou teardown gracioso depois de `SIGKILL` ou crash do
  próprio processo;
- redesenhar a bandeja, o instrumento ou as configurações além da copy exigida
  por este fluxo.

## 14. Referência dos clones locais

O plano absorve o mecanismo, não a política de produto:

- Orca centraliza o início do teardown num gate idempotente e aplica prazo ao
  conjunto de limpezas. Ele pode manter daemons para reanexar terminais, o que
  não serve ao Frota porque o produto proíbe daemon fora do app.
- Paseo intercepta a primeira saída, espera o shutdown do daemon gerenciado e a
  revalidação de update, e só depois conclui o exit. Esse modelo de duas
  passagens é o precedente mais próximo para o coordenador do Frota.

O diferencial do Frota é a fronteira de posse: tudo que ele iniciou deve
encerrar; tudo que ele apenas observa deve permanecer.
