# Instrumento flutuante da Frota, plano de implementação

> Status em 31/08/2026: **N1-N6 implementadas; homologação automatizada e QA
> nativo do notch atualizados até o build de teste #336**. Ilha, bordas e troca
> de monitor permanecem cobertas por contrato/testes, sem alegação de nova
> inspeção visual.
> O mock histórico continua em `docs/mocks/dynamic-notch-hud.html`, mas não é
> fonte de comportamento nem de tokens visuais.
> Em 31/08/2026, a direção D, **Instrumento vivo**, foi aprovada e implementada
> no conteúdo expandido. O mock permanece referência histórica de hierarquia e
> interação, não uma fonte paralela de estado.

## Correção que governa este plano

A primeira tentativa era um protótipo React: posição fixa, notch inferido por
resolução, preferências sem efeito e telemetria simulada. A ADR-129 retirou o
protótipo de produção. A retomada só foi autorizada depois de fechar os gates:

- geometria real de `NSScreen`, inclusive safe area e áreas auxiliares;
- presenter nativo responsável por tamanho, posição, foco e hit area;
- fallback explícito, sem transformar resolução em modelo de hardware;
- `TraySnapshot` como única fonte de atividade, decisão e automação;
- opt-in, teclado, movimento reduzido e paridade com o popover clássico.

## Resultado de produto

A janela `tray-popover` agora tem dois presenters sobre o mesmo snapshot:

1. **Barra de menus**, padrão e fallback universal: popover clássico 360 × 430.
2. **Instrumento flutuante**, opt-in: notch físico, ilha no topo, borda
   esquerda, borda direita ou base da tela.

Ligar a opção é o gesto humano que permite mostrar a janela fora da barra. Sem
esse gesto, nenhum HUD aparece. Em tela sem notch, a intenção `notch` vira
`island` e a UI mostra o motivo e a posição efetiva.

## Fases

### N1, geometria nativa, concluída

- `app/src-tauri/src/notch.rs` lê `safeAreaInsets`,
  `auxiliaryTopLeftArea`, `auxiliaryTopRightArea`, frame, visible frame, escala
  e id real de cada `NSScreen`.
- A largura do notch é o intervalo entre as áreas auxiliares. Ausência dessas
  áreas significa ausência de notch, mesmo numa tela com resolução parecida.
- Coordenadas AppKit, cuja origem fica embaixo, são convertidas para o espaço
  lógico do Tauri a partir do `CGMainDisplayID`, a mesma referência usada pelo
  Tao. Um monitor acima mantém Y negativo e não desloca a tela principal.
- `NSApplicationDidChangeScreenParametersNotification` dispara um recálculo
  coalescido pelo presenter. A rajada abre um único worker após 75 ms; uma
  mudança durante o recálculo pede somente uma passada final pela geração mais
  recente.
- No Linux, monitores vêm da API pública do Tauri e nunca declaram notch.

Fixture real usada no teste do Mac integrado:

```text
frame 1512 × 982 · visible 1512 × 949 · safeTop 32
auxLeft x=0 width=663 · auxRight x=848 width=664
notch efetivo = 185
```

O segundo QA no mesmo hardware corrigiu a altura compacta para os 32 pontos do
recorte físico, sem empilhar outra faixa abaixo. O centro do grid reserva os
185 pontos medidos do hardware; marca e estado ocupam somente as duas asas,
sem texto encoberto. Apontar expande em 90 ms. Com o presenter flutuante ativo,
o ícone da barra de menus some; desligar o HUD restaura o ícone e o popover
clássico.

O terceiro QA mostrou que clique funcionava, mas hover não. Habilitar
`mouseMoved` no `NSWindow` também não resolveu no `WKWebView` compacto sem
foco. A abertura agora vem de um único worker nativo, ativo somente com o HUD
compacto e o gesto habilitados. Ele lê a posição global a cada 50 ms e exige
90 ms dentro do frame antes de expandir. O frontend continua responsável pelo
fade e pelo recolhimento; `Escape` só permite outra abertura após uma nova
entrada real.

### N2, configuração efetiva, concluída

- `GlobalSettings` persiste `hudEnabled`, `hudPosition`, `hudHoverExpand`,
  `hudFollowActiveScreen` e `hudScreenId` na fonte única de settings. A pessoa
  escolhe o modo automático ou qualquer tela enumerada pelo mesmo presenter.
- No macOS, a escolha usa o UUID estável do display, não o número efêmero da
  sessão. Se a tela escolhida sair, a Frota usa temporariamente a tela ativa,
  publica o motivo e conserva a preferência para restaurá-la no hotplug.
- O backend nasce desligado para não produzir flash nem surpresa antes da
  hidratação, depois recebe a intenção pelo comando `set_hud_preferences`.
- Configurações mostra posição pedida, posição efetiva, destino escolhido,
  telas disponíveis, dimensões, notch detectado e fallback. `Mostrar agora`
  testa o mesmo presenter nativo.

### N3, frontend sem telemetria inventada, concluída

- `TraySurface` escolhe `TrayPopover` ou `DynamicHud` pelo estado efetivo do
  backend, não por preferência lida no DOM.
- O estado compacto mostra somente contagens, duração e título derivados de
  `TraySnapshot`.
- O estado expandido preserva tarefas, parar, decisões, última conclusão,
  automações, sessões externas, nova tarefa, abrir Frota e Configurações.
- Elementos interativos são botões reais, `Escape` recolhe e ícones sem texto
  têm nome acessível.
- `MotionConfig reducedMotion="user"` respeita o sistema. Não existe promessa
  de frequência de atualização; a animação acompanha o compositor disponível.

### N4, presenter de janela, concluída

- `app/src-tauri/src/hud.rs` resolve tela, fallback e layout.
- A janela compacta tem exatamente a área clicável visível. Expandir muda o
  tamanho nativo para 540 × 320 e torna a janela focável; recolher remove o
  foco e reduz o hit target.
- Hover expande em 90 ms sem roubar teclado. Clique no instrumento, `Mostrar agora`
  e clique na tray podem pedir foco explicitamente para permitir teclado e Esc.
- O QA no hardware eliminou a aparência de popover: o notch usa casco preto,
  topo reto e sem filete; o compacto ocupa apenas a altura do recorte físico. O
  nome técnico do monitor e o botão `Recolher` saíram, e a saída do ponteiro
  recolhe o painel.
- O presenter aplica `NSStatusWindowLevel`, comportamento em Spaces,
  transparência, vibrancy e sombra sem criar uma janela gigante invisível.
- Mudança de monitor recalcula a posição. Blur recolhe o instrumento; no modo
  clássico, blur esconde o popover.

### N5, validação automatizada concluída

- [x] testes puros de notch, conversão de coordenadas, fallback e layout;
- [x] testes de contrato do entrypoint e defaults opt-in;
- [x] compilação focada Rust e TypeScript;
- [x] suíte completa de frontend, 337 arquivos e 3.559 testes aprovados;
- [x] suíte completa Rust, 677 testes aprovados e 7 ignorados;
- [x] `bunx tsc -b --force`, build de produção, 13 guardas do guia e
  `git diff --check`;
- [x] QA visual do notch no app rodando, build #327: 185 × 32 px de hardware,
  compacto com centro vazio e glifos nas asas, casco preto, tray exclusiva,
  conteúdo expandido legível, recolhimento ao sair e `Escape` sem reabertura;
- [x] prova nativa de hover: worker único vivo na build empacotada, leitura do
  ponteiro e frame reais, mais contratos de entrada, permanência e supressão;
- [ ] gesto humano de hover estacionário na build #327. A automação de desktop
  restaura o cursor após cada ação, portanto esta observação fica separada das
  provas nativas em vez de ser declarada como QA visual;
- [ ] inspeção visual de ilha, bordas e mudança física de monitor. Os layouts,
  fallback e recálculo estão cobertos por testes, mas não foram apresentados
  como prova visual nesta rodada.

### N6, Instrumento vivo, implementado

#### Resultado real em 31/08/2026

- `DynamicHud` foi dividido em orquestrador, compacto e expandido antes da
  mudança visual; nenhum teto de arquivo ou baseline foi elevado.
- `hudPresentation.ts` concentra prioridade, foco estável, ciclo do snapshot e
  reducer da confirmação. Carregamento e indisponibilidade não caem mais em
  `Frota pronta`.
- A composição D usa tempo em 30px, trilho vivo em CSS, linha silenciosa de
  sistemas e até duas atividades secundárias. Não entrou progresso inferido,
  gradiente, timer por tarefa ou regra por provider.
- A parada exige dois gestos. O envio, a espera, a falha e o atraso de cinco
  segundos têm estados explícitos; somente a remoção da atividade no snapshot
  encerra a intenção local.
- A revisão de texto retirou jargão de protocolo da interface e conferiu
  acentuação e coerência da copy em pt-BR. Títulos vindos do estado real não são
  reescritos pelo render.
- Validação automatizada: 339 arquivos e 3.582 testes frontend, 684 testes Rust
  aprovados e 7 provas manuais ignoradas, além de TypeScript, 13 guardas do
  guia, lint sem erro e build Tauri de teste #336.
- QA visual na build #336: casco preto, centro de 185px livre no notch físico,
  estado assentado, cabeçalho, ação principal e `Escape` inspecionados. A
  preferência de tela e posição usada antes do QA foi restaurada ao final.
- Estados de voo, três tarefas, decisão e confirmação destrutiva foram
  validados no componente de produção por matriz pura e render estático. Não
  são registrados como observação física; hover estacionário e hotplug seguem
  pendências manuais já declaradas.

#### Objetivo e fronteira

A direção D substitui somente o conteúdo **expandido** do `DynamicHud`. Casco,
geometria, escolha de tela, estado compacto, `TrayPopover` clássico e ações
nativas continuam como estão. Não entra preferência nova: quem já optou pelo
instrumento recebe a composição nova; quem usa a barra de menus não muda.

O centro do instrumento passa a responder à pergunta mais importante do
momento. A prioridade é explícita e pura:

| prioridade | modo | fonte real | centro do instrumento |
|---:|---|---|---|
| 0 | carregando ou indisponível | ciclo do `get_tray_snapshot` | estado de leitura, nunca “Frota pronta” inventado |
| 1 | confirmação local | gesto `Parar tarefa` + atividade ainda presente | título da tarefa e confirmação; nenhum efeito antes de `Parar agora` |
| 2 | decisão pendente | `decisions`, `blocking` e destino do snapshot | contagem, `decisionSubtitle` e `Revisar no Frota` |
| 3 | em voo | `activities` | tempo, tarefa principal, detalhe e trilho vivo |
| 4 | assentado | `lastTurn` | último turno e desfecho observado |
| 5 | pronto | snapshot carregado e vazio | convite para uma nova tarefa |

`deriveHudPresentation(snapshot, intent, focusedConvId)` será uma função pura.
Estado desconhecido degrada para `indisponível`; nunca cai em `pronto`. Uma
confirmação local perde validade assim que sua atividade sai do snapshot.

#### Hierarquia visual aprovada

- Casco `#000000`, Geist para texto e Geist Mono para tempo, em qualquer tema e
  em qualquer posição flutuante.
- O cabeçalho conserva marca, estado e `Abrir Frota`. No notch físico, a área
  central medida continua livre para o hardware; as duas asas recebem conteúdo.
- Em voo, `30px` pertence somente ao tempo. Título usa 14px; ações e metadados
  usam 11, 12 ou 13px. Nomes cedem espaço e truncam antes do tempo.
- O trilho é presença, não porcentagem. Um segmento curto se move por CSS
  enquanto a atividade existe; não há preenchimento de 34%, ETA ou progresso
  inferido. Com movimento reduzido, vira ponto estático ainda visível.
- Azul aparece somente no estado vivo. Âmbar aparece somente quando algo
  espera a pessoa. Vermelho aparece apenas na confirmação destrutiva.
- Automações e terminal viram uma linha secundária sem cartão próprio. A ação
  `open-schedules` continua alcançável e `pause-schedules` permanece no rodapé
  quando houver automações ativas.
- Não há cartões com borda dentro do casco. Hierarquia vem de espaço, peso,
  divisor interno `border-border/40` e mudança de composição.

#### Uma ou várias tarefas

O snapshot já limita a três atividades. A primeira atividade permanece o foco
enquanto existir; uma atualização de detalhe ou tempo não troca o centro. Se
ela terminar, a próxima atividade na ordem autoritativa assume. As demais
aparecem em um trilho secundário de uma linha, com nome, estado e atalho para
abrir a conversa, sem novos cartões nem rotação automática.

Não será criado algoritmo por fornecedor, modelo ou tipo de run. Missão,
disputa e turno continuam chegando como `TrayActivity` e recebem a mesma
composição.

#### Decisões e ações

- `Parar tarefa` abre a confirmação local do mock e chama
  `setHudExpanded(true, true, false)`: a janela ganha foco e deixa de ser uma
  expansão transitória. Mover o ponteiro para fora não fecha a confirmação;
  blur ou `Escape` continuam sendo saídas.
- O primeiro `Escape` durante a confirmação escolhe a saída segura, `Manter em
  voo`; fora dela, `Escape` recolhe como hoje.
- Somente `Parar agora` chama `runTrayAction("stop-activity", ...)`. Enquanto o
  evento é entregue, a ação fica desabilitada e a copy diz
  `Interrupção solicitada`, não `interrompida`.
- A remoção da atividade no próximo snapshot é a confirmação real. Rejeição do
  invoke volta à decisão com erro visível. Sem confirmação após cinco segundos,
  o HUD diz `Interrupção ainda não confirmada` e oferece tentar de novo ou
  abrir a Frota; nenhum `catch` cala a falha.
- Uma decisão real de agent não é respondida dentro do HUD nesta fase. O
  snapshot possui contagem e destino, mas não pergunta nem opções. A superfície
  mostra somente o que sabe e usa `review-decision` para abrir a conversa certa.
- `Nova tarefa`, `Abrir Frota`, `Abrir conversa`, automações e Configurações
  continuam usando os `TrayAction` existentes.

#### Transições

O frame nativo continua em 540 × 320 e não redimensiona entre modos internos.
Somente o conteúdo troca:

```text
em voo --Parar tarefa--> confirmar parada --Manter em voo--> em voo
                                  |
                              Parar agora
                                  v
                       interrupção solicitada
                                  |
                    snapshot remove a atividade
                                  v
                  outra tarefa | assentado | pronto

em voo | assentado | pronto --decisão real chega--> decisão pendente
decisão resolvida --snapshot novo--> em voo | assentado | pronto
```

Se uma decisão real chegar durante a confirmação local, sua contagem permanece
no cabeçalho e ela assume o centro assim que a confirmação for resolvida.

A troca usa um único fade com deslocamento de 4px em 200ms. Não há scale,
gradiente ou animações concorrentes. `MotionConfig reducedMotion="user"`
remove deslocamento e movimento do trilho. O cronômetro reaproveita o ticker de
30 segundos já existente; N6 não cria interval, worker ou assinatura de store.

#### Responsabilidades e arquivos

`DynamicHud.tsx` já tem 515 linhas, portanto N6 começa dividindo, nunca subindo
o teto da catraca:

| arquivo | responsabilidade |
|---|---|
| `app/src/lib/hudPresentation.ts` | tipos, prioridade, atividade principal e reducer da intenção local |
| `app/src/lib/hudPresentation.test.ts` | matriz pura de estados, invalidação e corridas |
| `app/src/components/tray/DynamicHud.tsx` | snapshot, listeners, relógio e integração com o presenter |
| `app/src/components/tray/DynamicHudCompact.tsx` | compacto atual, sem mudança visual |
| `app/src/components/tray/DynamicHudExpanded.tsx` | shell expandido, foco adaptativo e ações |
| `app/src/components/tray/DynamicHud.test.tsx` | contrato do presenter, notch seguro e degradação |
| `app/src/components/tray/DynamicHudExpanded.test.tsx` | render dos modos e hierarquia de ações |

Não se espera mudar `TraySnapshot`, SQLite, settings, `tray.rs`, `hud.rs` ou
`notch.rs`. Se o QA provar que o foco existente não fixa a interação, essa
descoberta volta para uma ADR antes de tocar no worker nativo.

#### Sequência de implementação

1. Criar o seletor/reducer puro e fixtures reais de snapshot: vazio, uma e três
   tarefas, pedido bloqueante, disputa, última conclusão e snapshot ausente.
2. Separar compacto e expandido sem mudança visual; rodar testes e catracas
   antes de introduzir a D. Esse commit torna o diff visual revisável.
3. Implementar os modos `flight`, `decision`, `settled`, `ready` e
   `unavailable`, mantendo uma única atividade principal estável.
4. Implementar confirmação, envio e reconciliação de `stop-activity`, com
   timeout injetável e sem declarar parada antes do snapshot.
5. Aplicar trilho vivo, responsividade e transições. Abaixo de 480 × 280, os
   sistemas viram uma única linha e atividades secundárias cedem primeiro; as
   ações principais nunca somem.
6. Atualizar `dynamic-notch-spec.md` e esta fase com o resultado real do QA.

#### Comparação com Orca e Paseo

- Do Paseo, reaproveitamos a ideia de prioridade testável e determinística:
  atenção bloqueante vence estados de revisão e atividade; identidade estável é
  preservada enquanto o item não muda. Não copiamos sua taxonomia em inglês.
- Do Orca, preservamos a publicação coalescida: um snapshot recebido produz uma
  derivação e um render, sem novas assinaturas por linha nem relógios por tarefa.
  O movimento do trilho fica no compositor, não num loop JavaScript.
- Nenhum dos dois possui presenter equivalente de notch. Geometria, foco e
  fallback continuam sendo decisões próprias da Frota.

#### Critérios de aceite de N6

- [x] nunca mostra `Frota pronta` antes de carregar um snapshot válido;
- [x] decisão pendente sempre vence a visualização do tempo;
- [x] `Parar tarefa` não produz efeito antes de confirmação humana;
- [x] parada só aparece consumada depois de a atividade sumir do snapshot;
- [x] uma atividade principal não troca por atualização de detalhe ou tempo;
- [x] três atividades continuam alcançáveis sem rolagem no frame de 540 × 320;
- [x] notch físico mantém a faixa central sem texto sob o hardware;
- [x] ilha, esquerda, direita e base preservam casco preto e aresta acoplada;
- [x] hover sem interação recolhe; clique, teclado ou confirmação fixam até
  blur ou `Escape`;
- [x] todas as ações funcionam por teclado, o foco é visível somente em modo
  teclado e a ordem começa pelo conteúdo prioritário;
- [x] movimento reduzido conserva estado sem deslocamento nem trilho animado;
- [x] nenhuma comparação de provider, intervalo periódico, migração ou preferência;
- [x] `bun run test`, `bunx tsc -b --force`, `cargo test`, `bun run check`,
  build Tauri e `git diff --check` passam;
- [ ] QA visual registra separadamente notch integrado, ilha externa, uma e
  três tarefas, decisão real, confirmação de parada, estado vazio e hotplug.

## Decisões preservadas

- O nome de provider não participa de geometria, snapshot ou presenter.
- A posição `menubar` continua como fallback interno e compatibilidade; a
  pessoa liga/desliga o instrumento por um único toggle.
- Brass permanece cor de gesto/decisão humana. Estado de execução usa os tokens
  semânticos existentes; seleção de posição é neutra.
- O notch físico é tratado como parte da forma: topo preto, reto e sem filete;
  a curva pertence somente à saída inferior. Ilha e bordas preservam suas
  formas próprias, mas todo presenter flutuante usa o mesmo casco preto.
