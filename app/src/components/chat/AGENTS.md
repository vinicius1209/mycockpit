# AGENTS.md — o composer e o caminho do envio

Escopo: `app/src/components/chat/`. Leia antes de mexer em
`ChatPanel.despacharEnvio`, `CommandConsole`, `ComposerParts` ou em qualquer
coisa entre o Enter e a primeira bolha do fio.

Regra de repositório mora no `AGENTS.md` da raiz; o backend do turno tem o dele
em `app/src-tauri/src/AGENTS.md`. Aqui só entra o que é desta camada.

## A lei desta camada

> **Todo gesto tem resposta visível no primeiro quadro. O que demora é o
> trabalho, nunca o sinal de que ele começou.**

**Por que existe.** Medido em 07/09/2026: o `handleSend` fazia ~10 `await`
(persona, doutrina, lições, expansão de "/", export do transcript) ANTES de
chamar `beginPreparation`. Durante toda essa fase a conversa nem sabia que havia
um envio. Depois vinha o preflight do Rust, de 3 a 5 segundos, e o único sinal
era o botão de enviar ficando cinza mais um placeholder que ninguém via, porque
o composer continuava cheio do texto da pessoa. Espera de 4s com tela imóvel não
é lentidão percebida, é travamento percebido. Correção: ADR-169.

## Feedback

1. **O §6 do STYLEGUIDE vale aqui, sem exceção.** 0–100ms nada · até 1s só
   `disabled` · 1–3s spinner · 3s+ estágios nomeados. Um preflight de segundos
   mostrando só `disabled` está violando a régua da casa, não "sendo discreto".
2. **Marque o estado ANTES do primeiro `await`, não depois.** `beginPreparation`
   é o carimbo de "existe um envio". Ele nasce logo depois das guardas que
   decidem se o texto é PARECER (`@persona`), FILA ou COMANDO BUILTIN — os três
   casos em que o envio não vira turno desta conversa. Handler que só se declara
   no fim deixa a primeira fatia da espera sem dono.
   **Corolário obrigatório:** carimbo cedo cria dívida de limpeza. Se um `await`
   do preparo estourar, a conversa fica presa, com o composer desabilitado e
   "Verificando capacidades…" eterno. Por isso `handleSend` é um invólucro que
   cria o `runId`, chama `despacharEnvio` e apaga o carimbo em qualquer exceção.
   Chamada nova no preparo NÃO precisa ser à prova de exceção; o invólucro é que
   precisa continuar existindo.
   **Divergência conhecida, declarada de propósito:** `lib/fleet/send.ts` (o
   envio da mesa) ainda tem a forma ANTIGA, com 18 `await` antes do
   `beginPreparation` e sem rede. Ele não entrou na ADR-169 porque a medição foi
   feita no composer e a mesa tem outra superfície de feedback. Não presuma que
   a regra já vale lá; quando aquela superfície for medida, ela herda este
   arquivo ou ganha o dela.
3. **Placeholder não é feedback quando há texto no campo.** Se o sinal depende
   do campo estar vazio, ele não existe no caso que importa. Escolha um canal
   que sobreviva ao estado real da tela. Hoje o canal é o PRIMÁRIO: no preparo
   ele troca a seta pelo círculo (`.preparo-spin`), mantém o mesmo degrau de
   controle para a fileira não dançar, e muda o `aria-label` junto — um botão
   que anuncia "Enviar" enquanto já prepara mente para quem não vê a tela.
4. **Atraso e degradação moram no CSS, nunca num timer.** O spinner do preparo
   só aparece depois de 700ms, porque preflight quente termina em ~100ms e
   spinner que pisca é pior que nenhum. O atraso é `animation-delay`, preso à
   PRESENÇA do elemento, então morre junto com o estado, inclusive quando o
   turno morre por erro. E `prefers-reduced-motion` degrada para ponto sólido
   com `opacity` explícita: o bloco global desliga a revelação, e sem a opacidade
   o indicador sumiria — degradar para ausência de sinal é o que o §6 proíbe.
5. **Revezamento imediato também é envio.** O incidente permanece factual no
   fio; a decisão aparece na faixa única de continuidade acima do composer.
   Depois das guardas, `continueConversationWith` chama `beginPreparation`
   antes do primeiro `await`, conserva o pedido e os anexos do executor e limpa
   o carimbo quando o destino não aceita o run. Retomada automática existente
   entra na mesma faixa, nunca em um segundo aviso concorrente.

## A fronteira de aceite

6. **A bolha do fio continua nascendo do `run_manifest`.** É o contrato de
   "estado real, nunca teatro": o app não mostra como enviado o que o backend
   não aceitou. Isto NÃO está em discussão por causa de latência.
7. **Mas "não fingir que enviou" não obriga "não mostrar nada".** As duas coisas
   são separáveis: um item PRÓPRIO de envio-em-curso, visivelmente provisório e
   com identidade de cliente, reconciliado (ou removido com o texto de volta no
   composer) quando o backend responde, respeita o contrato e mata a sensação de
   travamento. Referência estudada: o par `clientMessageId` +
   `reconcileCanonicalUserTurnMembership` do Paseo.
   **Se for adotar, adote inteiro**: reconciliação por id (nunca por posição, ou
   uma resposta lenta reordena o fio), falha mantém o item com "tentar de novo"
   em vez de sumir, e o rascunho sobrevive até o aceite.
   Isso muda contrato do fio: entra por ADR antes do código. Não foi feito na
   ADR-169, que resolveu o sinal sem tocar na fronteira.

## O caminho crítico

8. **Trabalho no `despacharEnvio` só se depende do texto deste envio.** Persona,
   doutrina e lições respondem "quem somos", não "o que você pediu"; podem estar
   resolvidas antes. O teste é literal: se a resposta seria a mesma com o campo
   vazio, não é trabalho deste envio.
9. **Nada de reserializar a conversa inteira por mensagem.** `renderTranscript`
   mais `exportConvContext` percorrem e mandam o fio todo pela ponte a cada
   envio (1,66 MB na maior conversa medida). O congelamento da janela foi
   resolvido no backend (ADR-170, o comando saiu da thread principal); o custo
   de atravessar a ponte continua e é dívida conhecida. Exportar só quando o fio
   MUDA foi avaliado e recusado: um ponteiro de memória desatualizado por um
   turno é problema de honestidade, não de performance.
10. **Custo tem que ser proporcional ao gesto, não ao histórico.** Qualquer coisa
   nova neste caminho que cresça com o tamanho da conversa é regressão: a
   conversa boa é a longa, e é justamente nela que o app fica lento.
11. **Persona é conceito do produto, não de fornecedor.** Nada nesta pasta
    compara nome de motor para decidir o que mostrar. O gatilho dos
    Especialistas, as caras e a contagem valem igual com claude-code, codex e
    agy. Se um dia precisar variar, a resposta é uma capability no registry
    (`lib/agents.ts` + `adapters.rs`), nunca um `if` de nome aqui.

## Movimento

12. **Movimento nesta pasta responde a GESTO, não ao tempo.** O olhar do avatar
    dos Especialistas (`AgentFace`, ADR-166) segue o ponteiro dentro de um raio,
    volta ao neutro quando o cursor sai, e não existe sem cursor. É da família
    do `:hover`, não da família do spinner. Movimento ambiente no rodapé
    competiria com o único movimento que ali significa algo.
13. **Ouvinte de janela é ÚNICO e de módulo.** `lib/olhar.ts` segue o padrão do
    `lib/minuteTick.ts`: um `pointermove` para N caras, coalescido por quadro,
    ligado no primeiro assinante e desligado no último. Seis avatares não podem
    virar seis assinaturas do mesmo evento, e medir geometria N vezes por quadro
    é layout thrashing por decoração.
14. **Interromper deixa registro no fio, não no toast.** Com turno rodando, o
    envio forçado (Enter) e o Parar CORTAM o turno. O gesto carimba a causa em
    `lib/corte.ts` e o fio grava o marco com autor quando o `cancelled` do
    runner chega (ADR-180). Toast de sucesso aqui repetiria o fio e sumiria;
    ele fica só para falha e para superfícies fora do fio (Mesa, bandeja).
    Nunca desenhe o corte a partir do Enter: com steering nativo o Enter
    corrige SEM parar, e só o evento pode dizer que houve corte.

## O inventário do "/"

15. **O envio nunca consulta o motor.** `readProjectCommands` (expansão no
    `despacharEnvio`) usa só o que o motor já anunciou e o disco; a consulta
    lateral (Codex `skills/list`) é do popover, `readCommandInventory`, e relê
    por ABERTURA do "/", nunca por tecla (ADR-189, item 10 acima).
16. **Lista sem procedência é teatro.** O popover diz se o inventário veio do
    motor (com horário) ou das pastas, e mostra o que sumiria em silêncio (link
    de skill quebrado). Builtin do CLI só entra auditado em `builtin_commands`.

## O caminho quente do streaming

17. **O composer não re-renderiza por token.** Ele lê a conversa por
    `useConvDoComposer`, nunca por `useActiveConv`. Render por delta recria
    props de filhos, e efeito de terceiro que grava estado vira um commit extra
    por token. Numa conversa longa o React desiste no 51º (`#185`), e isso já
    cortou resposta no fio duas vezes (ADR-190).
18. **Prop para plugin de terceiro é estável por conteúdo.** Array ou função
    recriados a cada render (`presets.map(...)` inline) reacendem os efeitos
    da lib. Estabilize no ponto de entrada, não confie no chamador.
19. **O handler do canal do run nunca pode lançar.** O `Channel` do Tauri só
    entrega o próximo evento depois que o atual retorna: uma exceção congela o
    turno inteiro, sem erro. `entregarSemTravar` fica em volta do `onmessage`.

## A nota que vai junto

20. **Nota endereçada leva texto E anexos.** `withNotasDoTurno` é a única porta,
    para composer e mesa, e a lista que ela devolve é a do run e a da bolha do
    fio. Nota mencionada sem os prints chegava ao agente sem o assunto
    (ADR-192).

## Os testes que seguram isto

- `ComposerActions.preparo.test.tsx` — fixa os itens 1 e 3: o círculo no
  preparo, o `aria-busy`, o rótulo honesto, o degrau de controle preservado e a
  precedência do Parar sobre o preparo.
- `EspecialistasTrigger.test.tsx` — a porta das personas: sem persona não se
  inventa cara, a cor é o domínio, o total conta o escopo inteiro.
- `lib/olhar.test.ts` — o item 12: ouvinte único, coalescimento por quadro,
  desligamento no último assinante, e o `null` quando a máquina não aceita olhar.
- `lib/avatarRig.test.ts` — o item 11: determinismo da cara, queda da
  intensidade com a distância, neutro fora do raio e pupila que não escapa.
- `CommandConsole.permissao.test.tsx`, `ModeSelect.test.tsx` — o que o composer
  promete sobre modo e permissão.
- `composerIdentity.test.ts`, `composerPlaceholder.test.ts` — identidade e
  estado do campo por situação.
- `redeDePreparo.test.ts` — o corolário do item 2: estouro (assíncrono E
  síncrono) apaga o carimbo, e a falha deixa rastro em vez de sumir.
- `filaComposer.test.ts`, `store/chat.corte.test.ts` e
  `MarcoDeCorte.test.tsx` — o item 14: sem toast no corte, causa carimbada
  pelo gesto e consumida pelo `cancelled`, marco com autor.
- `lib/chatHandoff.test.ts`, `lib/composerContinuity.test.ts` e
  `ContinuityBanner.test.tsx` — o item 5: resposta antes do primeiro `await`,
  pedido/anexos preservados, semântica imediata ou futura e uma única faixa.
- `lib/fleet/promptCascade.notas.test.ts` — item 20: texto e anexos da nota
  real, sem duplicar no reenvio, e as duas portas de envio usando a mesma função.
- `lib/entregaDeEvento.test.ts` e `convDoComposer.test.ts` — itens 17 a 19:
  o canal segue depois de um evento que falha, e delta de texto pelo reducer
  real não troca a conversa do composer.
- `lib/slashSections.test.ts`, `lib/agents.commands.test.ts` e, no Rust,
  `command_inventory` e `adapters_claude_inventory_tests.rs` — itens 15 e 16:
  seções na ordem de navegação, rodapé de procedência e builtin auditado.

Falta ainda um teste que fixe a ORDEM do item 2 — que o carimbo aconteça antes
do primeiro `await` DENTRO do `despacharEnvio`. Hoje isso está garantido por
leitura: `despacharEnvio` depende de projeto, store e Tauri, e um teste honesto
dele pede uma fixture de envio que ainda não existe. A rede do corolário, essa,
está coberta.

## Gesto de fora do composer escreve no rascunho acrescentando

Citar arquivo, enviar comentários do diff, pedir correção de entrega e qualquer
gesto novo que ponha texto no composer a partir de outra superfície usam
`useComposerDrafts.getState().appendText`: o texto entra depois do que já foi
escrito, com uma linha em branco. `setText` troca o rascunho inteiro e fica para
quem É o composer (digitação, "Editar" de uma mensagem enviada). Foi o `setText`
nesses gestos que apagava o que a pessoa estava digitando (K1).

## Citação e arquivos soltos no composer (capricho, ADR-205)

- A citação mora no rascunho como bloco (`ComposerDraft.blocos`, persistido) e
  vira TEXTO no envio, em `textoDoEnvio`, no formato de `lib/citacao.ts`. Não
  crie outro caminho para levá-la ao motor: a porta é `withNotasDoTurno`, que
  emoldura como dado. Todo envio que não passar por `textoDoEnvio` sai sem a
  citação.
- A bolha nunca mostra o formato cru: `UserMessageBubble` separa as citações e
  desenha a linha ↳. "Editar" devolve a citação como bloco.
- Mensagem citável tem `data-citavel` com o id do item. Superfície nova que deva
  ser citável recebe o atributo; a pílula e o menu de contexto já a enxergam.
- Colagem grande (R7) é o segundo tipo de bloco: mesma porta (`textoDoEnvio` no
  envio, `withNotasDoTurno` no prompt), no FIM do texto, com contagem de linhas
  no marcador. Bloco novo segue o mesmo caminho: tipo em `BlocoDoRascunho`,
  `parseBlocos`, chip em `BlocosDoRascunho.tsx`, formato + moldura em `lib/`.
- Arquivo do sistema chega pelo evento do Tauri (`SolturaNoComposer`), nunca
  pelo `drop` do HTML5. O alvo de ARQUIVO é a coluna da conversa inteira
  (`[data-coluna-da-conversa]` no `ChatPanel`, fio e composer), com o mesmo
  véu (`VeuDeSoltura`) para o Finder e a árvore; texto e imagem do fio seguem
  soltando só no `[data-composer-card]` (ADR-280).
- Os dois caminhos de arquivo acabam em `soltarCaminhos`: não crie uma terceira
  soltura. O que não é anexo (imagem e PDF seguem anexo) vira CARTÃO, bloco
  `arquivo` do rascunho (ADR-252), venha do Finder ou da árvore, e o rótulo do
  véu diz o verbo do resultado (`rotuloDosCaminhos`). Nunca volte a
  despejar `@caminho` no texto. No envio ele é o ÚLTIMO envelope
  (`textoDoEnvio`), então é o primeiro a sair na bolha e na moldura do prompt
  (`emoldurarArquivos` em `withNotasDoTurno`). A pasta do arquivo de fora do
  projeto vale só naquele envio: `runAgent` a lê da moldura e manda
  `pastasDoTurno`, só para motor com `pastasExtras`.

## Mantenha este arquivo verdadeiro

Mudou a ordem do `despacharEnvio`, o que aparece durante o preparo, ou quando a
bolha entra no fio? Atualize este arquivo no MESMO commit. Na review, diff de
comportamento de envio sem diff aqui (ou sem um "nenhuma regra mudou" explícito)
conta como entrega incompleta.
