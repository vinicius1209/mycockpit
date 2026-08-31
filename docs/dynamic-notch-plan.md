# Instrumento flutuante da Frota, plano de implementação

> Status em 30/08/2026: **N1-N5 implementadas; homologação automatizada e QA
> nativo do notch atualizados até o build #327**. Ilha, bordas e troca de monitor
> permanecem cobertas por contrato/testes, sem alegação de inspeção visual.
> O mock histórico continua em `docs/mocks/dynamic-notch-hud.html`, mas não é
> fonte de comportamento nem de tokens visuais.

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

## Decisões preservadas

- O nome de provider não participa de geometria, snapshot ou presenter.
- A posição `menubar` continua como fallback interno e compatibilidade; a
  pessoa liga/desliga o instrumento por um único toggle.
- Brass permanece cor de gesto/decisão humana. Estado de execução usa os tokens
  semânticos existentes; seleção de posição é neutra.
- O notch físico é tratado como parte da forma: topo preto, reto e sem filete;
  a curva pertence somente à saída inferior. A ilha sem notch não imita
  hardware que não existe e conserva a superfície temática própria.
