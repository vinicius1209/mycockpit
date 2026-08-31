# Especificação técnica do instrumento flutuante

> Status: contrato implementado. O QA nativo do notch foi atualizado até o
> build #327 em 30/08/2026; posições sem recorte seguem validadas por contrato
> e testes, sem alegação de inspeção visual nesta rodada.
> Decisões: ADR-129, ADR-132, ADR-134 e ADR-135.

## 1. Invariantes

1. A preferência descreve intenção; `HudRuntimeView` descreve o resultado.
2. Geometria de notch vem de `NSScreen`, nunca de resolução ou nome de modelo.
3. A janela nativa possui tamanho, posição, foco e hit target.
4. A UI possui somente render e gestos; não reposiciona a janela por CSS.
5. Atividade vem exclusivamente de `TraySnapshot`.
6. Sem opt-in, o presenter efetivo é `menubar`.
7. Sem notch real, `notch` degrada para `island` com motivo visível.
8. No Linux, o popover clássico e posições genéricas continuam alcançáveis;
   nenhuma tela ganha notch inferido.
9. Presenter flutuante e ícone da barra de menus são mutuamente exclusivos.

## 2. Contratos

### `ScreenGeometry`

```text
id, name, active
hasNotch, notchWidth, notchHeight, safeTop
screenWidth, screenHeight, originX, originY
visibleWidth, visibleHeight, visibleX, visibleY
scaleFactor
```

Todas as medidas publicadas ao frontend estão em pontos lógicos. O módulo
AppKit coleta em coordenadas globais com origem inferior e converte para o
espaço global com origem superior usado pelo Tauri. A referência vertical é o
topo do `CGMainDisplayID`; monitores acima dele preservam coordenadas negativas.

### `HudPreferences`

```text
enabled
position: notch | island | left | right | bottom | menubar
hoverExpand
followActiveScreen
```

Esses campos persistem no store global do frontend. O backend usa default
desligado até receber a hidratação, evitando duas fontes persistentes e uma
janela inesperada no boot.

### `HudRuntimeView`

```text
enabled
requestedPosition
effectivePosition
hoverExpand
followActiveScreen
expanded
screen
fallbackReason
supportedPositions
```

Somente esse objeto decide qual componente o entrypoint da bandeja monta.

## 3. Comandos e eventos

| contrato | efeito |
|---|---|
| `get_screen_geometries` | mede todas as telas |
| `get_notch_geometry` | compatibilidade, retorna a tela escolhida |
| `hud_status` | leitura sem reposicionar ou esconder a janela |
| `set_hud_preferences` | aplica intenção e recolhe de modo seguro |
| `set_hud_expanded` | redimensiona; foco é pedido apenas por gesto explícito |
| `hud://state` | publica somente o runtime resolvido |

`hud_status` é deliberadamente sem efeito. Uma implementação anterior que
recomputasse e escondesse `menubar` durante a leitura faria o clique da bandeja
fechar o próprio popover.

Ao aplicar um presenter flutuante com sucesso, o backend oculta o ícone da
barra de menus. Ao desligar ou degradar para `menubar`, esconde a janela antes
de restaurar o ícone. Falha preserva a porta que já estava alcançável.

No macOS, `acceptsMouseMovedEvents` sozinho não entrega hover de forma confiável
ao `WKWebView` compacto sem foco. Um único worker do presenter acompanha a
posição global somente enquanto o HUD compacto está ligado, em intervalos de
50 ms, e expande após 90 ms dentro do frame. O frame nativo anima entre os
layouts, o conteúdo entra e sai com fade curto, e `Escape` exige uma nova
entrada do ponteiro antes de reabrir.

## 4. Resolução de tela e posição

- Com `followActiveScreen=true`, a tela marcada como ativa vence; ausência
  desse sinal usa a primeira tela medida.
- Com `followActiveScreen=false`, a primeira tela estável vence.
- `notch` usa o centro do frame total e `safeTop`.
- No compacto, a coluna central tem exatamente `notchWidth`; somente as asas
  laterais recebem glifos. Texto vive no nome acessível e no expandido, nunca
  atrás do hardware.
- `island` usa o topo do visible frame com margem de 8 pontos.
- `left` e `right` usam o centro vertical do visible frame.
- `bottom` fica 8 pontos acima da base visível.

Dimensões atuais:

| estado | notch | island/bottom | left/right |
|---|---:|---:|---:|
| compacto | `max(notch+64, 240)` × `max(safeTop, 28)` | 300 × 36 | 28 × 128 |
| expandido | até 540 × 320 | até 540 × 320 | até 540 × 320 |

O tamanho expandido é limitado pelo visible frame com margem. A compactação
nunca cria uma camada invisível maior que o conteúdo.

## 5. Camada macOS

O `NSWindow` usa:

- `NSStatusWindowLevel` no modo flutuante;
- `CanJoinAllSpaces`, `Stationary`, `IgnoresCycle` e `FullScreenAuxiliary`;
- `hidesOnDeactivate=false` e `movable=false`;
- focável somente no estado expandido;
- vibrancy de popover aplicada depois de a content view existir.

Ao recolher uma janela que estava focada, o presenter a esconde antes de
remover a capacidade de foco, redimensiona e mostra novamente. Isso impede que
o instrumento retenha teclado com uma área compacta.

## 6. Render e acessibilidade

- O compacto inteiro é um botão com nome que inclui o estado atual.
- Borda lateral usa leitura vertical e mantém o mesmo contrato de expansão.
- `Escape` recolhe; apontar expande apenas se a preferência estiver ligada.
- Clique expande com foco para teclado; a saída do ponteiro recolhe após uma
  janela curta, sem botão redundante de recolher.
- No notch físico, o casco é preto em qualquer tema, o topo é reto e sem
  filete em `y=0`, e somente os cantos inferiores recebem raio. Ilha e bordas
  continuam superfícies temáticas independentes.
- Ações de parar, revisar, pausar e navegar usam os mesmos `TrayAction` do
  popover clássico.
- Animações usam os tokens da aplicação e `reducedMotion="user"`.
- Não existem streak, matriz, progresso ou atividade sintetizados.

## 7. Falhas

- Falha de medição mantém estado observável e não inventa notch.
- Falha ao aplicar posição aborta o efeito e retorna erro ao chamador.
- Evento de tela desconhecido pode ser ignorado no render, mas não autoriza
  mover a janela com geometria incompleta.
- O snapshot vazio significa ausência de atividade observada, não sucesso de
  um run.

## 8. Critérios de aceite

- Toggle desligado mantém apenas o popover clássico.
- Toggle ligado move e dimensiona a janela de verdade.
- O Mac integrado usa as áreas auxiliares medidas; monitor externo usa ilha.
- Hotplug reposiciona sem reiniciar a aplicação.
- Compacto não bloqueia cliques fora do conteúdo.
- Teclado opera todas as ações e movimento reduzido elimina animação não
  essencial.
- Suítes, tipos, guardas e QA visual têm resultados registrados separadamente.
