# Incidente de sessão em sequência, plano de implementação

> Status em 01/09/2026: **direção C implementada e validada nas suítes
> automatizadas; resta a prova manual do ciclo AppKit numa build promovida**.
> O escopo inclui também a correção do ciclo nativo de abrir, reabrir e
> minimizar a janela principal no macOS. O mock de referência é
> `docs/mocks/incidente-sessao-c-sequencia.html`. A implementação, os testes e
> a build de teste foram concluídos sem promover nem reiniciar o aplicativo
> instalado. A promoção continua condicionada à confirmação explícita do
> usuário.

## Resultado de produto

O aviso terminal de limite ou erro deixa de parecer um cartão genérico de chat
e passa a ser uma sequência factual dentro do fio:

1. o turno encerrou;
2. a conversa foi preservada;
3. há um retorno informado, um retorno desconhecido ou um motivo técnico para
   consultar.

A assinatura visual é um trilho neutro com **um único marcador de estado**.
Âmbar identifica limite esperado; vermelho identifica falha real. O trilho não
é progresso, não se move e não mede percentual.

Nenhuma liberdade ou capacidade do usuário muda. Revezamento, histórico,
contexto, arquivos, custo, tokens, feedback e detalhes técnicos permanecem
disponíveis. A diferença é hierarquia: estado e próxima decisão ficam visíveis;
telemetria e ações raras recuam um nível.

O instrumento também não substitui a janela principal. No macOS, clicar no
ícone do Frota no Dock deve abrir, restaurar ou trazer a janela principal para
a frente. O instrumento permanece um acesso complementar e nunca pode ser o
único alvo que recebe foco quando a pessoa ativa o aplicativo.

## O que existe hoje

O fluxo atual é:

```text
evento normalizado
  → ChatItem limit/error/result
  → buildNodes
  → IncidentNode
  → IncidentCard em MessageList
  → onContinueWith em ChatPanel
  → prepareHybridHandoff + beginTransplant + runAgent
```

As bases corretas já existem e não devem ser refeitas:

- `messageNodes.ts` consolida `result + limit/error + exit code` em um único
  `IncidentNode`, preservando telemetria e causa crua;
- `store/chat.ts` já carrega `ts?`, e `GroupRow` já mostra a hora real do primeiro
  item do grupo;
- `resetHint` atravessa adapter, store e nó sem perder o texto original;
- ADR-140 garante que o relógio autoritativo não recebe o teto do backoff;
- `onContinueWith` só chega ao último incidente quando o turno não está rodando;
- `handleContinueWith` mantém o revezamento transacional e o gesto humano;
- `AutoResumeBanner` continua dono de tentativa e horário da retomada
  automática junto ao composer.

O problema está na apresentação. `IncidentCard` repete urgência por fundo,
borda, ícone, título e telemetria; `ContinueRow` abre vários botões ao mesmo
tempo; e tudo mora em `MessageList.tsx`, que já está no teto da catraca com
2.186 linhas.

Há ainda uma lacuna nativa independente do incidente visual:

```text
fechar a janela principal
  → hide_main_window
  → ActivationPolicy::Accessory
  → instrumento continua visível

clicar no ícone do Dock
  → RunEvent::Reopen não é tratado
  → o macOS encontra o instrumento como janela visível
  → o instrumento recebe foco, mas a janela principal não volta
```

`show_main_window` já reúne parte do caminho correto, restaurando a política
`Regular`, exibindo, desminimizando e focando `main`. Hoje ele só é alcançado
por ações internas como `Abrir Frota`; o loop de `App::run` trata apenas
`ExitRequested`. A correção deve ligar o gesto nativo ao mesmo caminho e não
duplicar regras em React, no HUD ou na tray.

## Contrato visual da direção C

### Assunto, público e tarefa

- **Assunto:** um cockpit local de trabalho que registra um turno terminal.
- **Público:** a pessoa que precisa decidir se aguarda, investiga ou troca de
  agente sem perder contexto.
- **Tarefa única:** responder em poucos segundos “o que aconteceu, o que ficou
  seguro e qual informação ou gesto vem depois?”.

### Sistema visual

| papel | decisão de produção |
|---|---|
| superfície | E0, sem cartão envolvente, sombra ou fundo âmbar/vermelho |
| trilho | divisor neutro `border-border/40`, nunca colorido |
| limite | um marcador `st-warning`, sem texto âmbar corrido |
| erro real | um marcador `st-error`; o título pode usar peso, não outra tinta |
| texto | Geist 13 px para UI, 12 px para detalhe curto |
| dado | Geist Mono 11 px para horário, duração, modelo, custo e tokens |
| controles | `compacto`, 28 px, por `Button` ou `controle("compacto")` |
| detalhes | fundo neutro + raio, sem borda aninhada |
| movimento | nenhum; o incidente é terminal e não termina sozinho |

Não entram cor nova, fonte nova, tamanho novo, gradiente, glow, ilustração,
timer, worker ou assinatura por provider.

### Assinatura

O elemento memorável é a sequência causal. Os pontos não numeram etapas de um
wizard e não fingem avanço. Eles registram fatos já ocorridos ou informação
recebida. Apenas o fato que causou o incidente recebe cor.

### Desktop

```text
Sessão em intervalo

●────────────────────●────────────────────○
turno encerrado       conversa preservada  retorno informado
limite atingido       contexto e arquivos  00:30 · São Paulo

Detalhes técnicos                         Continuar com outro agente ▾
```

### Largura estreita

```text
Sessão em intervalo

●  turno encerrado
│  limite atingido
│
●  conversa preservada
│  contexto e arquivos
│
○  retorno informado
   00:30 · São Paulo

Detalhes técnicos
Continuar com outro agente ▾
```

O DOM conserva a mesma ordem nos dois layouts. A mudança horizontal para
vertical é uma container query medida pela largura real do incidente, não pela
janela inteira.

## Correções do mock antes de produção

O mock aprovou a direção, não cada frase. Cinco ajustes são obrigatórios:

| mock | problema | produção |
|---|---|---|
| `agora` | vira mentira quando o incidente entra no histórico | metadado estático `preservado` |
| `Agente disponível` | `resetHint` informa reset, não garante disponibilidade atual | `Retorno informado` |
| `20:54` dentro da sequência | duplica a hora que `GroupRow` já mostra | a sequência não repete o timestamp |
| ponto no título + ponto no trilho | gasta a mesma cor duas vezes | só o primeiro marcador do trilho recebe cor |
| `Tentar novamente` | não existe callback de retry do turno terminal | não aparece até existir uma ação real |

Essa revisão preserva a estética da C e remove o que seria teatro no replay.

## Matriz de estados

### 1. Limite com horário de retorno

- Título: `Sessão em intervalo`.
- Fato 1: `Turno encerrado`, `O limite desta sessão foi atingido.`
- Fato 2: `Conversa preservada`, `Contexto e arquivos continuam no Frota.`
- Fato 3: `Retorno informado`, com `formatIncidentReset(resetHint)`.
- Marcador do fato 1 em âmbar; os demais neutros.
- Se houver destinos e o incidente for o último, mostra
  `Continuar com outro agente`.

### 2. Limite sem horário de retorno

- Os dois primeiros fatos permanecem iguais.
- Fato 3: `Retorno não informado`, `O agente não informou quando a sessão poderá continuar.`
- Não inventa relógio, duração, data nem estimativa.
- O revezamento continua disponível quando o caller autorizar.

### 3. Erro real

- Título: `Execução interrompida`.
- Fato 1: `Turno encerrado`, `A execução terminou sem resposta final.`
- Fato 2: `Conversa preservada`, `A conversa e os arquivos continuam no Frota.`
- Fato 3: `Motivo registrado`, `Abra os detalhes técnicos para consultar a causa.`
- Marcador do fato 1 em vermelho; nenhum fundo vermelho envolve o bloco.
- Revezamento permanece secundário e só aparece quando o caller autorizar.

### 4. Histórico antigo sem `ts`

- A hora continua omitida pelo `GroupRow`, como hoje.
- Nenhum `ocorreu agora`, data aproximada ou placeholder é criado.
- A sequência não precisa de campo temporal novo em `IncidentNode`.

### 5. Incidente sem `result`

- A sequência e a causa técnica continuam visíveis.
- Telemetria não renderiza espaço vazio.
- Detalhes mostram somente o texto cru disponível.

### 6. Incidente histórico ou conversa em voo

- `renderNode` não passa `onContinueWith` quando o incidente não é o último ou
  quando o turno está em andamento.
- Sem callback, o menu de revezamento não existe.
- O layout não reserva um botão morto.

## Arquitetura proposta

### Novos arquivos

#### `app/src/components/chat/incidentPresentation.ts`

Núcleo puro que converte `IncidentNode` em uma apresentação estável:

```ts
interface IncidentStage {
  id: "terminal" | "preserved" | "next"
  meta?: string
  title: string
  description: string
  tone: "incident" | "settled" | "information"
}

interface IncidentPresentation {
  severity: "limit" | "error"
  title: string
  stages: IncidentStage[]
}
```

Responsabilidades:

- conter `formatIncidentReset` sem interpretar o prazo para auto-resume;
- preservar o hint cru quando não houver formatação inequívoca;
- produzir a matriz de copy acima;
- não ler `Date.now`, store, provider, capability ou DOM;
- nunca retornar `agora`, progresso ou disponibilidade confirmada.

#### `app/src/components/chat/IncidentSequence.tsx`

Componente `memo` responsável somente por layout e gestos:

```ts
interface IncidentSequenceProps {
  incident: IncidentNode
  currentAgent: string
  onContinueWith?: (agent: string) => void
  feedback?: FeedbackApi | null
  feedbackText?: string
}
```

Responsabilidades:

- renderizar `<section>` + `<ol>` + `<li>` semânticos;
- usar container query para trilho horizontal ou vertical;
- manter o conector `aria-hidden`, porque o texto já carrega a ordem;
- abrir `Detalhes técnicos` em `<details>` nativo;
- renderizar telemetria e `TurnActions` dentro do disclosure;
- renderizar um único menu de revezamento com a primitiva
  `components/ui/dropdown-menu`;
- usar `Button size="compacto" variant="ghost"` no gatilho;
- não importar `radix-ui` cru nem criar estado de timer.

O menu substitui as várias pílulas por um controle secundário. Cada item mantém
o rótulo `Continuar no {agente}` e chama o mesmo `onContinueWith(id)`. A escolha
continua humana e o destino continua vindo de `DESTINATIONS`.

#### `app/src/components/chat/TurnTelemetry.tsx`

Extrai `TurnTelemetry` e `Sep` de `MessageList.tsx` sem mudar cálculo, tokens,
custo, duração, modelo ou copy. O componente continua servindo tanto a
resultados comuns quanto ao disclosure do incidente.

### Correção nativa de abertura e minimização no macOS

O contrato de produto passa a distinguir janela principal, instrumento e
estado do processo:

| gesto ou estado inicial | resultado obrigatório |
|---|---|
| clicar no ícone do Frota no Dock com `main` escondida | mudar para `Regular`, mostrar `main` e focá-la |
| clicar no ícone do Frota no Dock com `main` minimizada | desminimizar e focar `main` |
| clicar no ícone do Frota no Dock com `main` atrás de outra janela | elevar e focar `main` |
| clicar em `Abrir Frota` no instrumento | executar exatamente o mesmo caminho do Dock |
| fechar pelo botão vermelho com `Continuar ao fechar` ativo | esconder `main`; processo, runs e instrumento continuam |
| minimizar pelo botão amarelo | usar minimização nativa, sem converter o app em `Accessory` |
| fechar com `Continuar ao fechar` desativado | manter a confirmação e a saída existentes |

O `has_visible_windows` de `RunEvent::Reopen` não decide se a janela principal
deve voltar. O macOS conta o instrumento auxiliar nessa resposta; para o
Frota, instrumento visível não equivale a janela principal visível.

O fluxo canônico será:

```text
Dock / Applications com processo existente
  → RunEvent::Reopen
  → restore_main_window

instrumento / tray, Abrir Frota
  → restore_main_window

restore_main_window
  → preparar o instrumento sem roubo posterior de foco
  → ActivationPolicy::Regular no macOS
  → main.show()
  → main.unminimize()
  → main.set_focus()
```

O popover clássico deve fechar antes da restauração. O instrumento flutuante
deve apenas voltar ao modo compacto e não focável, permanecendo visível. A
operação precisa ser serializada com o presenter para que um `recompute`
assíncrono atrasado não volte a focar o HUD depois de `main.set_focus()`.

#### `app/src-tauri/src/tray.rs`

- substituir `show_main_window` por uma restauração canônica que reporte erro;
- manter a ordem `Regular → show → unminimize → focus` no macOS;
- distinguir popover de barra de menus e instrumento flutuante antes de
  esconder ou recolher;
- fazer `tray-open`, `tray_action("open")` e ações que abrem uma conversa
  reutilizarem o mesmo helper;
- não alterar `hide_main_window`, exceto para tornar explícito que `Accessory`
  pertence ao fechamento com continuidade, nunca à minimização.

#### `app/src-tauri/src/hud.rs`

- oferecer ao helper nativo uma preparação idempotente para abertura da janela
  principal;
- cancelar expansão transitória e devolver o HUD flutuante ao estado compacto,
  visível e não focável;
- impedir que worker de hover, blur ou recompute pendente recupere o foco no
  mesmo episódio de abertura;
- preservar escolha de tela, posição, snapshot e atividade exibida.

#### `app/src-tauri/src/lib.rs`

- tratar `tauri::RunEvent::Reopen { .. }` dentro de `App::run`, sob
  `#[cfg(target_os = "macos")]`;
- ignorar deliberadamente `has_visible_windows` e restaurar `main`, porque a
  janela auxiliar torna esse booleano inadequado para a decisão do produto;
- manter `ExitRequested` e a limpeza de processos exatamente como estão;
- não criar listener React, segundo processo, plugin de instância ou daemon.

### Arquivos alterados

#### `app/src/components/chat/MessageList.tsx`

- remover `IncidentCard`, `formatIncidentReset` e `ContinueRow`;
- importar `IncidentSequence` e `TurnTelemetry`;
- manter o gate atual de `renderNode` para último nó + turno assentado;
- passar um callback estável por `useStableHandler(onContinueWith)` para não
  repintar incidentes históricos durante streaming de outro nó;
- conservar os branches defensivos de `MessageItem` para `limit` e `error`,
  apontando ambos para o mesmo componente;
- não alterar `buildNodes`, agrupamento, janela progressiva ou Fio Vivo.

A extração precisa reduzir a contagem de `MessageList.tsx`. Ao final, rodar a
atualização oficial da catraca para **descer** a baseline. Nunca editar
`file-size-baseline.json` à mão.

#### `app/src/components/chat/TurnActions.tsx`

- tornar `FeedbackApi` um tipo exportado pela peça que o consome;
- atualizar `MessageList` para importar o tipo;
- preservar um re-export em `MessageList` se necessário para não quebrar os
  testes e call sites existentes.

Nenhuma ação de feedback muda. Elas apenas ficam um nível abaixo, junto da
telemetria do turno.

#### `docs/decisions.md`

Adicionar ADR-143, registrando:

- direção C aprovada;
- incidente terminal como sequência E0, não cartão tingido;
- trilho causal, estático e sem semântica de progresso;
- um marcador de estado;
- revezamento consolidado num menu neutro;
- ausência de mudança em eventos, auto-resume, handoff, custo e limites.

Adicionar ADR-144 para o ciclo nativo no macOS:

- o instrumento é janela auxiliar e não satisfaz a intenção de reabrir o app;
- Dock e `Abrir Frota` convergem para uma restauração canônica de `main`;
- `has_visible_windows` não bloqueia a restauração quando o HUD está visível;
- fechamento com continuidade e minimização continuam sendo gestos distintos;
- a correção não muda atividade, autonomia, limites ou comportamento Linux.

#### `docs/mocks/incidente-sessao-README.md`

Marcar C como direção aprovada e apontar para este plano. A, B e o comparador
permanecem como exploração histórica, não como especificação concorrente.

## Comparação com Orca e Paseo

A comparação local encontrou princípios úteis, mas nenhuma solução pronta para
copiar:

- **Orca** concentra escolhas de limite em menus semânticos e descreve o custo
  de cada opção. Isso reforça consolidar o revezamento num único menu em vez de
  várias pílulas simultâneas. A superfície analisada gerencia limite de
  histórico, não incidente terminal de conversa.
- **Paseo** separa status, dados e erro em linhas neutras, usando um ponto de
  estado em vez de tingir o cartão inteiro. Isso reforça o orçamento de um
  marcador. O card de uso do provider não resolve continuidade nem handoff.

A parte exclusiva do Frota é a sequência causal com preservação de contexto e
revezamento transacional. Copiar o cartão de uso do Paseo ou o menu de
configuração do Orca apagaria justamente essa diferença.

## Fases de implementação

### I0, congelar contrato e fixtures

- [x] adicionar ADR-143;
- [x] marcar a direção C no README dos mocks;
- [x] copiar para os testes a fixture real de limite já usada em
  `MessageList.incident.test.ts`;
- [x] registrar também um erro real com `invalid transport`, já coberto pela
  suíte atual;
- [x] não criar payload ilustrativo novo.

**Aceite:** matriz de estado, copy e dados de origem estão escritos antes do
primeiro JSX.

### I1, extrair a apresentação pura

- [x] criar `incidentPresentation.ts`;
- [x] mover e testar `formatIncidentReset`;
- [x] cobrir limite com relógio e fuso, limite sem hint, hint desconhecido e
  erro real;
- [x] provar por teste que não aparecem `agora`, `disponível` ou horário
  inventado nos fallbacks.

**Aceite:** uma função pura produz exatamente os fatos da matriz sem acessar
React ou store.

### I2, construir a sequência isolada

- [x] criar `IncidentSequence.tsx` a partir da apresentação pura;
- [x] implementar trilho horizontal e vertical com container query;
- [x] aplicar um único marcador colorido e conector neutro;
- [x] garantir `details` fechado por padrão e legível por teclado;
- [x] extrair `TurnTelemetry.tsx` e reutilizá-lo no disclosure;
- [x] manter `TurnActions` funcional dentro do disclosure;
- [x] implementar o menu único de revezamento com a primitiva compartilhada.

**Aceite:** o componente isolado cobre limite e erro nos dois temas, sem fundo
tingido, cartão envolvente, animação ou múltiplos botões de agente.

### I3, integrar ao fio sem mudar comportamento

- [x] trocar os três caminhos atuais de `IncidentCard` por
  `IncidentSequence`;
- [x] manter o gate de último nó e turno assentado;
- [x] estabilizar `onContinueWith` antes de cruzar o componente memoizado;
- [x] remover imports e símbolos mortos de `MessageList.tsx`;
- [x] confirmar todos os call sites: `ChatPanel`, `ScaledMessageList` e testes;
- [x] rodar `cd app && bun run check:file-size -- --update` para reduzir a
  baseline pelo caminho oficial.

**Aceite:** o mesmo gesto ainda chama `handleContinueWith`, que continua
passando por `prepareHybridHandoff`, `beginTransplant` e `runAgent`.

### I4, testes de contrato e acessibilidade

- [x] atualizar `MessageList.incident.test.ts` sem perder nenhuma garantia
  semântica já existente;
- [x] manter custo, tokens, duração, reset e causa técnica auditáveis;
- [x] provar limite âmbar e erro real vermelho no marcador, sem tinta no
  contêiner;
- [x] provar ausência do antigo `border-st-warning/40 bg-st-warning/10`;
- [x] testar o menu fechado, abertura por teclado, destinos disponíveis e
  callback correto;
- [x] provar que o menu some em histórico, durante run, durante finalização e
  sem destino;
- [x] testar sequência vertical abaixo do breakpoint por contrato de classes;
- [x] manter `messageNodes.incident.test.ts` verde sem afrouxar a consolidação.

**Aceite:** os testes antigos perdem somente expectativas da forma substituída
e ganham expectativas equivalentes ou mais fortes para estado, ação e
disclosure.

### I5, corrigir o ciclo nativo da janela principal

- [x] adicionar ADR-144 antes da mudança estrutural;
- [x] criar um único `restore_main_window` usado pelo Dock, pelo instrumento e
  pela tray;
- [x] tratar `RunEvent::Reopen` no macOS sem aceitar o HUD como substituto de
  `main`;
- [x] restaurar `ActivationPolicy::Regular` antes de exibir e focar `main`;
- [x] chamar `show`, `unminimize` e `set_focus` nessa ordem, propagando ou
  registrando cada falha em vez de usar `let _` no caminho esperado;
- [x] recolher o HUD flutuante sem escondê-lo e fechar apenas o popover clássico;
- [x] impedir corrida de foco entre a restauração e o worker do presenter;
- [x] manter o botão vermelho com continuidade como `hide + Accessory`;
- [x] manter o botão amarelo como minimização nativa, sem acionar o fluxo de
  fechamento;
- [x] testar o helper com o runtime de teste do Tauri para janela escondida,
  minimizada e já visível;
- [x] adicionar um teste de contrato para provar que `RunEvent::Reopen` chama o
  helper mesmo com `has_visible_windows: true`;
- [x] conferir todos os call sites de `show_main_window`, `hide_main_window`,
  `set_focus` e `set_activation_policy` depois da extração.

**Aceite automatizado:** Dock e `Abrir Frota` apontam para a mesma operação;
`ExitRequested` continua matando os processos somente na saída real; não há
branch por nome de monitor, provider ou agente.

**Aceite manual no macOS:** executar a matriz abaixo numa build de teste, sem
atividade em voo:

| preparação | gesto | observação esperada |
|---|---|---|
| `main` fechada, HUD compacto | clicar no ícone do Dock | `main` abre e recebe teclado; HUD não expande |
| `main` fechada, HUD expandido | clicar no ícone do Dock | HUD recolhe uma vez; `main` abre e mantém foco |
| `main` minimizada | clicar no ícone do Dock | a mesma janela desminimiza, sem duplicata |
| `main` atrás de outro app | clicar no ícone do Dock | `main` vem à frente |
| `main` fechada | clicar em `Abrir Frota` | resultado idêntico ao Dock |
| `main` aberta | minimizar, restaurar, fechar e reabrir | nenhum ciclo de abre e fecha, nenhum salto de tela |
| dois monitores, HUD na tela escolhida | clicar no Dock em Spaces diferentes | `main` restaura; preferência do HUD não muda |

Registrar vídeo curto ou capturas da sequência. Teste de unidade não substitui
essa prova porque `applicationShouldHandleReopen`, política de ativação e foco
são comportamentos do AppKit.

### I6, QA visual

Matriz mínima:

| eixo | casos |
|---|---|
| tema | claro, escuro |
| largura | fio de 760 px, janela estreita, painel lateral aberto |
| escala da conversa | 80%, 100%, 160% |
| incidente | limite com reset, limite sem reset, erro real |
| posição | último e acionável, histórico sem ação |
| conteúdo | com telemetria, sem telemetria, detalhe técnico longo |
| interação | abrir/fechar detalhes, abrir menu, Esc, seleção por teclado |

Verificar especialmente:

- o trilho não parece barra de progresso;
- nenhum texto cru empurra o horário ou quebra a coluna;
- o zoom do transcript não provoca overflow;
- o menu não fica cortado pelo container do fio;
- foco por mouse não deixa anel residual; foco por teclado continua visível;
- erro nunca fica discreto demais e limite nunca parece falha fatal.

**Registro em 01/09/2026:** um harness temporário importou o componente real e
o CSS de produção. Três cenários Playwright passaram em tema claro e escuro,
760 px e 420 px, zoom de 160%, limite e erro, disclosure, navegação por teclado,
`Esc` e callback do destino. As capturas ficaram em
`/private/tmp/frota-incidente-dark-760.png`,
`/private/tmp/frota-incidente-light-420.png` e
`/private/tmp/frota-incidente-erro-light-420.png`. O harness foi removido após
a inspeção. A suíte E2E do aplicativo também passou com 27 testes em Chromium
headed. Esta evidência valida a superfície web, não substitui a matriz AppKit
descrita em I5.

### I7, validação completa e entrega

Rodar, de verdade:

```bash
cd app && bun run test
cd app && bunx tsc -b --force
cd app && bun run check
cd app/src-tauri && cargo test
git diff --check
```

Depois dos gates, rodar `./scripts/build.sh test` somente quando não houver
conversa em andamento ou quando o usuário autorizar explicitamente a carga.

Promoção é um gate separado:

1. confirmar que não há conversa `running` ou `finalizing` em nenhuma janela;
2. apresentar o número do build de teste e o estado do QA;
3. obter confirmação explícita do usuário;
4. só então executar `./scripts/build.sh promote <número>` e reiniciar o app;
5. confirmar a versão instalada sem iniciar, parar ou reenviar turnos.

Nenhuma build de teste autoriza promoção automática.

**Registro em 01/09/2026:** as suítes de frontend passaram com 3.594 testes,
TypeScript e guardas passaram, e a suíte Rust passou com 689 testes, 7
ignorados e nenhuma falha. A catraca reduziu `MessageList.tsx` de 2.186 para
1.895 linhas pelo comando oficial. A build de teste completou e foi verificada
com assinatura ad hoc profunda; o script de build agora assina e verifica o
bundle antes de publicá-lo. A build rastreável do commit final deve ser gerada
depois do push. A promoção e o reinício continuam pendentes para preservar o
processo instalado e permitir confirmação explícita.

## Riscos e contenções

| risco | contenção |
|---|---|
| trilho ser lido como progresso | nenhum percentual, animação ou verbo de avanço; `aria-hidden` no conector |
| copy envelhecer no histórico | nenhum `agora`; retorno descrito como informação recebida, não estado atual |
| causa real ficar escondida | título e marcador permanecem visíveis; detalhe técnico fica a um gesto, nunca descartado |
| revezamento perder descoberta | rótulo textual permanente no gatilho; itens com nomes completos; teste de teclado |
| menu quebrar dentro do fio | portal da primitiva compartilhada; QA com scroll e painel lateral |
| regressão de desempenho | componente memoizado, callback estável, sem timer/store novo, presenter puro |
| `MessageList` crescer | extração obrigatória e baseline somente para baixo |
| promessa de retry inexistente | nenhum botão até haver callback e contrato reais |
| HUD contar como janela visível no macOS | `RunEvent::Reopen` sempre restaura `main`; não condicionar a `has_visible_windows` |
| foco voltar ao HUD depois de abrir o app | recolhimento idempotente e coordenação com o presenter antes de focar `main` |
| minimizar virar fechamento | não interceptar a minimização; `Accessory` somente no `CloseRequested` com continuidade |
| HUD sumir ao abrir a janela | esconder apenas o popover clássico; HUD flutuante fica compacto e não focável |
| regressão no Linux | toda integração com `Reopen` e política de ativação fica sob `cfg(target_os = "macos")` |
| promoção interromper trabalho | gate explícito de zero atividade antes de promover ou reiniciar |

## Fora de escopo

- mudar classificação de limites ou erros nos adapters;
- alterar `parseResetHint`, backoff ou auto-resume;
- criar retry automático ou botão de retry terminal;
- alterar `ChatItem`, SQLite, migração ou persistência;
- mudar modelos, capabilities, custos, limites ou liberdade de uso;
- redesenhar banners do composer, conteúdo do HUD, tray ou painel de uso; o
  ajuste do HUD nesta frente se limita ao ciclo nativo de foco e visibilidade;
- promover ou reiniciar o app como consequência do merge.

## Definition of done

- direção C renderizada no fio real nos dois temas e nos dois eixos de layout;
- limite e erro continuam semanticamente distintos;
- reset autoritativo, custo, tokens, duração e causa técnica preservados;
- revezamento continua humano, agnóstico e transacional;
- nenhuma atividade, disponibilidade ou progresso inventado;
- clicar no ícone do Frota no Dock restaura e foca a janela principal escondida
  ou minimizada, mesmo com o instrumento visível;
- `Abrir Frota` e o Dock usam o mesmo helper, sem corrida que devolva o foco ao
  HUD;
- fechar com continuidade, minimizar e sair preservam seus três contratos
  distintos;
- `MessageList.tsx` menor e catraca reduzida pelo comando oficial;
- testes focados, suíte completa, TypeScript, guardas, Rust e diff verdes;
- QA visual registrado por estado, sem confundir render estático com observação
  no app;
- build de teste e promoção claramente separados, sem reiniciar trabalho vivo.
