# Missão em voo — 3 POCs visuais

> Mocks estáticos (13/08/2026), NÃO código do app. Abrir no browser:
> `missao-a.html` · `missao-b.html` · `missao-c.html`. Insumo visual para a
> frente de Missões, que está reconstruindo essa área. Nada aqui foi
> implementado, e nenhum arquivo de missão foi tocado.

Os três renderizam a MESMA cena, com os mesmos números, e cada um tem **quatro
estados** no seletor do topo (mais tema claro/escuro):

| Estado | O que mostra |
|---|---|
| **fase 1 · motor falante** | Planejar em voo no Claude · Opus 5 (16min 19s), ação a ação |
| **fase 2 · motor calado** | Planejar concluída + Executar UI em voo no agy · Flash 3.6 (5min 42s), **sem nenhuma ação reportada** |
| **esperando você** | gate entre fases, com decisão humana pendente |
| **plano grande · 7 de 12** | OUTRA missão, de 12 fases, a viva é a 7, parada há 22 min repetindo o mesmo comando |

O estado do meio é o cenário do segundo print do build 193, e é ele que
justifica metade das decisões abaixo: **os dois casos aparecem lado a lado
porque a missão real tem os dois**.

O quarto estado foi acrescentado na revisão de 13/08 e é o mais importante dos
quatro. A primeira rodada dos mocks assumiu **3 fases** porque era o que o print
mostrava, e 3 é um número gentil: cabe em qualquer layout, e o custo de
descobrir tarde que uma fase travou é baixo, porque só há três. Nada no código
garante 3 (ver a seção seguinte), e **"fase 7 de 12 parada há 20 min" é um
problema de outra ordem que "fase 2 de 3"**: há mais coisa para caber, há mais
coisa dependendo da fase viva, e o dinheiro já gasto quando o humano descobre é
muito maior. O estado grande é o teste que separa as três direções, e ele
inverteu a recomendação deste documento.

## O diagnóstico que os três atacam

De `docs/mission-ui-feedback.md` (1 a 5) mais o que o segundo print acrescentou
(6 a 8):

1. Repetições do ADR-037 vivas: "Claude · Claude · Opus 5"; "Agora: X"
   repetindo a linha imediatamente acima.
2. Três linhas idênticas **"Executar ferramenta"** sem identidade, enquanto a
   quarta diz "Criar landing-plan.md" (o nome CHEGA às vezes).
3. `US$ 0,000` depois de 16 min de Opus: número não medido com cara de medido.
4. Composer travado: fire-and-forget num produto cuja alma é supervisão humana.
5. Falta o tempo decorrido da MISSÃO (só a fase tem cronômetro).
6. **Motor calado tratado como motor falante**: 5min 42s de agy com um
   `Agora: preparando…` inventado no lugar do que a tela não sabe.
7. **Sem detalhe por etapa**: a fase concluída colapsa mostrando só o custo, e
   "o que ela FEZ" não existe em lugar nenhum.
8. **Sem pausar a etapa**: o único controle é Parar, que mata a missão inteira.

## Quantas fases tem um plano de voo (o que o código diz, 13/08)

Leitura direta de `lib/missionPlans.ts`, `lib/missionTypes.ts`,
`lib/missionDraft.ts`, `store/mission.ts`, `lib/missionEngine.ts` e
`components/mission/{MissionPlanCanvas,FlightPlansView,MissionTimeline}.tsx`.
Nenhum arquivo foi tocado; isto é o que eles dizem hoje.

### Mínimo 1, máximo nenhum, típico 3 (e o típico é de fábrica, não do motor)

- **Mínimo: 1.** `validateMissionPlan` rejeita plano vazio
  (`missionPlans.ts:136`) e `removePhase` trava quando sobra uma
  (`FlightPlansView.tsx:284`).
- **Máximo: não existe.** `addPhase` (`FlightPlansView.tsx:271`) não tem teto,
  o import validado não tem teto, o store não tem teto. Um plano de 12 fases é
  montável hoje, no editor, sem tocar em código.
- **Típico: 3**, e vale saber por quê: os **três** presets de fábrica
  (`DEFAULT_MISSION_PRESETS`, `missionTypes.ts:243`) são o mesmo trio
  planejador → executor → revisor. Ou seja, 3 é o número que a fábrica entrega,
  não uma propriedade do motor. Desenhar para 3 é desenhar para o preset que
  veio na caixa.
- O único crescimento **automático** tem teto: cada reprovação do revisor
  apenda duas fases (Corrigir + Revisar) e o clamp é `MAX_REVIEW_LOOPS = 2`
  (`missionEngine.ts:42`), ou seja **+4 no máximo**. Um plano lançado com 8 que
  reprova duas vezes vira 12 sozinho, sem ninguém editar nada.

### Editável antes do voo: sim, inteiro. Durante, pelo humano: não

- **Antes.** A biblioteca (`FlightPlansView`) adiciona, remove, reordena
  (`moveMissionPhase`) e edita fase a fase. O launcher (`missionDraft.ts`)
  edita agent/modelo/effort/autonomia por fase no momento do lançamento, sem
  adicionar nem remover, e marca o preset como "Personalizado".
- **Durante, pelo humano: não existe.** Nenhuma superfície adiciona, remove ou
  reordena fase de missão em voo. Os gestos humanos em voo são exatamente três:
  responder o gate (`answerGate`), resolver a recuperação
  (`resolveRecovery`/`abortRecovery`) e `abort` (parar a missão).
- **Durante, pelo motor: sim**, e é a única fonte de mudança em voo: a
  reprovação apenda Corrigir + Revisar no fim (`missionEngine.ts:274-292`,
  aplicado em `store/mission.ts:937-948` e persistido no marco seguinte).
- **Furo pequeno e real:** o motor copia as fases no lançamento
  (`phases: [...preset.phases]`, `missionEngine.ts:84`), então editar o plano
  na biblioteca **não afeta a missão em curso**. Isso é a decisão certa e a UI
  não diz isso em lugar nenhum: quem editar o plano com uma missão voando vai
  supor que mudou alguma coisa.

### Se o plano muda, a fase em execução não é tocada. O denominador é

As fases novas entram **no fim** da lista; `current` não se move; a fase viva
não sofre nada. O que muda é o **denominador**, e é aí que está o problema de
UI: `MissionTimeline.tsx:713` renderiza `fase {current+1}/{n}` com
`n = mission.phases.length` (linha 665) lido a cada render. Uma tela que dizia
"3 de 3" passa a dizer "3 de 5" **sem uma palavra**, e o número novo vai assim
para o banco e para o tray (`phaseCount`, `store/mission.ts:279`).

A recuperação é o outro caso, e é mais bruto: `applyRecoveryChoice`
(`missionEngine.ts:189-200`) **sobrescreve** agent/modelo/effort da def da fase
corrente e ela re-roda do começo (o índice não avança, o prompt não muda). O
motor original some do objeto: não sobra registro de que aquela fase começou no
Codex e terminou no Claude.

### Linear, e o código é explícito

`MissionPlanGraph` já tem o vocabulário de ramificação (`condition:
"success" | "failure" | "always"`, `maxTraversals` reservado,
`missionTypes.ts:27-37`), mas `validateMissionPlan` recusa tudo que não seja
uma cadeia única: "O motor atual aceita somente conexões de sucesso"
(`missionPlans.ts:169`), "O motor atual aceita uma única rota, sem
ramificações" (`:172`), "Loops ainda não são executáveis neste motor" (`:180`).
O canvas é **layout, não topologia**: `nodesConnectable={false}`
(`MissionPlanCanvas.tsx:237`) e o próprio rodapé dele diz "Rota linear
executável". `preset.phases` é a projeção executável; o grafo guarda
coordenadas.

**Consequência para os mocks:** numerar 1..N e desenhar uma sequência não é
simplificação, é o modelo real. As três direções estão certas sobre a
topologia. O que o estado grande testa não é o modelo, é o **espaço**.

## O que os três compartilham (o diagnóstico virando regra)

Estas decisões não são de direção, são de casa. Aparecem iguais em A, B e C.

### R1 · Identidade uma vez por contexto
`Claude · Opus 5` é escrito UMA vez, no cabeçalho da fase (A/C) ou na estação
da trilha (B). Nenhuma linha filha repete motor ou modelo. A linha viva fala do
que ainda não terminou, e o marco acima já está no pretérito: a duplicação do
"Agora: Criar landing-plan.md" fica impossível por construção, não por
cuidado.

### R2 · A escada do rótulo (mata o "Executar ferramenta")
Ordem fixa, primeira que casar vence:

1. **verbo + alvo** · "criou landing-plan.md · +148 linhas"
2. **sem verbo mapeado, mas com payload** · mostra o comando ou o caminho cru
   em mono: "rodou `rg -n "landing" docs/`"
3. **só o identificador da tool** · mostra ele em mono:
   `mcp__figma__get_file`. Id feio é identidade; "Executar ferramenta" não é.
4. **nada além do evento** · agrega numa linha só, com a culpa dita:
   "2 ações sem rótulo (o motor não mandou o nome)" + "ver payload".

Hoje o `default:` de `toolview.ts:381-390` pula do degrau 1 direto pro rótulo
genérico, e é por isso que tool MCP, tool própria do Codex e tool do agy caem
todas na mesma string. Um caso citável do degrau 2: o Codex manda
`file_change` com `input = item.changes`, **sem `file_path`**
(`adapters.rs:1786-1797`), e a UI sai com "Editar arquivo" sem arquivo, embora
o caminho esteja no payload.

O degrau 4 é a **forma honesta** proposta: N linhas iguais é pior que ausência,
porque finge conteúdo. Agregado, o buraco fica **mensurável** (se aparecer
"9 ações sem rótulo", o adapter tem bug e o usuário vê).

### R3 · Custo honesto, em três estados e nenhum deles zero
- **"—"** com o momento da aterrissagem dito ("fecha ao fim de cada fase").
  "medindo…" foi descartado: implica um medidor vivo que não existe, porque o
  código só soma no evento `result` de cada fase (`store/mission.ts:764`).
- **"não mede"** com o motivo, quando o motor não reporta. O agy tem
  `reports_cost: false` **e** `cumulative_usage: false`
  (`adapters.rs:379-382`): o custo daquela fase não existe, nem como
  estimativa por tokens.
- **o número medido**, em **2 casas** (`fmtCost` hoje usa 3 abaixo de US$ 1,
  `lib/format.ts:13`).

E o total da missão passa a declarar a **cobertura**: "US$ 2,07 · medido em 1
de 3 fases", em vez de fingir que soma tudo. Único zero legítimo no app seria
motor local, onde zero é o custo real.

### R4 · Um relógio vivo só, e a missão ganha idade
O cronômetro que tica pertence à **fase corrente**. A missão carrega uma
**idade** de granularidade de minuto ("começou há 24 min"), que não é
cronômetro e não compete. Resolve o item 5 do feedback sem reabrir o bug dos
builds 181/182 (dono único do agora, B2.2). `MissionRun.startedAt` já existe e
nunca foi renderizado.

### R5 · Ignorância declarada, por capability (não por nome de motor)
A tela não sabe o que é "agy". Ela consulta `structured_output`
(`adapters.rs:216,378`), que **já existe no registry** e diz que aquele stdout
é texto puro, não fluxo de eventos. Com a capability em `false`:

- a fase troca o feed de ações por um bloco que diz **o que se sabe**: "o agy
  não reporta ação por ação · rodando há 5min 42s · última saída há 38s ·
  14 KB no stdout", mais a última linha de texto que o motor escreveu, que é
  conteúdo real e não verbo inventado;
- a fase **na fila** já avisa antes de rodar ("não reporta ações nem custo"),
  pra a quietude não ser surpresa;
- somem as frases proibidas: "preparando…", "trabalhando…", "redigindo
  resposta…" (`MissionTimeline.tsx:70-74`).

**Duas idades, não uma.** O que decide alarme é "última saída há Xs", não
"rodando há Xs": silêncio só assusta em relação à última vez que se ouviu
algo. Regra: acima de **10 min sem byte**, a linha vira âmbar, o texto passa a
"sem sinal do agy há 11min 20s" e "Interromper esta fase" sobe para botão.
Antes disso é cinza, porque calado não é quebrado.

Não nasce capability nova aqui: `structured_output` é proxy fiel enquanto
"emite JSON estruturado" e "emite evento por ação" andarem juntas. Se um motor
quebrar o proxy (JSON sem eventos de ferramenta), aí sim entra `tool_events`
nos dois lados + teste-gêmeo + contrato.

### R6 · Detalhe por etapa, inclusive nas concluídas
Hoje a fase concluída não guarda **nem duração**: `MissionPhaseRun` não tem
`endedAt` (`missionTypes.ts:137-149`), e o `LiveActivity` só existe em
`running` (`MissionTimeline.tsx:443-445`). Os três mocks assumem dois campos
novos, e isso precisa ser dito alto: **`endedAt` por fase** e a **contagem de
ações derivada de `items`**. Sem eles o resumo não fecha.

Ordem fixa do resumo colapsado (o resumo deve SER a informação):
**entregável → impacto → duração congelada → custo → quem fez** (este último em
sussurro mono; o nome do motor importa pra auditoria, mas não é o que o olho
procura).

E o expandido mostra o que a UI hoje **joga fora**: `HandoffDoc.decisions[]`
(choice / rejected / reason) é parseado e injetado no prompt da fase seguinte
(`missionHandoff.ts:26-32`) e depois descartado pelo resumo
(`store/mission.ts:1074-1083`). Numa fase concluída, "o que ela decidiu e o que
rejeitou" vale mais que a lista de ferramentas. Zero dado novo, só parar de
descartar.

**Regra decidível de quando ferramenta vira ruído**: até 5 ações, mostra todas.
Acima de 5, leituras e buscas agregam num stub ("3 leituras · mostrar") e ficam
visíveis só as **mutações** (escrita, comando, commit), a **falha** e a **ação
corrente**. Falha nunca agrega.

### R7 · O vocabulário de pausa, sem prometer o que não existe
Não há pausa real de um turno de agent: dá pra matar o processo, dá pra não
começar o próximo. Então **"Pausar" não aparece**, porque o rótulo mentiria
sobre o que acontece com o processo. O que existe:

| Gesto | O que faz | Reversível |
|---|---|---|
| **Segurar no fim desta fase** | a fase corrente termina normal; a próxima não começa sem você. Nada é interrompido agora | sim (interruptor) |
| **Interromper esta fase** | mata o processo agora; **o que já foi escrito continua no worktree**; a fase fica incompleta | não |
| **Pular fase** | a fase não roda | sim enquanto ela está na fila, não na corrente |
| **Trocar o motor da próxima fase** | a próxima fase roda em outro agent/modelo | sim até ela começar |
| **Parar missão** | mata a corrente e cancela as que faltam; worktree e handoffs ficam no disco | não |

O preço é dito **antes do clique** e é **por motor**: interromper uma fase do
Claude ou do Codex permite retomar a sessão (`session_resume: true`);
interromper a do agy significa rodar a fase inteira de novo
(`session_resume: false`, `adapters.rs:376`). A infra pra isso já existe em
parte: `abort(convId)` (`store/mission.ts:1198-1230`) é o "parar", o gate já
sabe pausar e esperar resposta (`store/mission.ts:957-1006`), e o
`RecoveryCard` já troca agent/modelo/effort quando uma fase morre
(`MissionTimeline.tsx:297`).

### R8 · O humano volta a falar
O composer para de estar travado: ele muda de **destino**, não de existência. A
copy de hoje ("Missão em andamento; pare a missão para enviar manualmente…",
`CommandConsole.tsx:307-309`) é honesta e inútil. A mensagem é entregue no
**gate entre fases**, o ponto de junção onde não atropela execução em curso, e
a legenda diz isso na cara. Em C existe também o destino "agora", habilitado só
onde `inline_interaction` é `true` (Claude sim, Codex e agy não).

As três regras seguintes nasceram do estado grande. Elas não são de direção
tampouco: aparecem iguais em A, B e C, e nenhuma delas é opcional quando N
passa de meia dúzia.

### R9 · A janela viva (recolhimento vira estrutura, não estética)
Com 3 fases, recolher o passado é economia de tela. Com 12, é a diferença entre
ver e não ver: sem recolhimento **a fase viva sai da tela**, e o único assunto
da tela sai da tela. A regra desenhada nos três mocks:

Sempre visíveis, em qualquer N: a **fase viva** aberta, a **fase imediatamente
anterior** em uma linha, a **próxima** em uma linha. Todo o resto agrega em
**dois** stubs, um de cada lado ("4 fases concluídas · 51min · US$ 11,40" e
"+4 fases na fila"), e cada stub **declara o que engoliu** em vez de esconder
("1 com motor trocado no voo", "2 apendadas no voo · 1 delas não mede custo").

Não há limiar de N. Com 3 ou 4 fases a janela já cobre o plano inteiro e nenhum
stub aparece, então a regra não fica boba em missão curta e não precisa de um
número mágico. (O agy propôs ligar o recolhimento em N > 5; o limiar é um
parâmetro a mais para fazer o mesmo trabalho.)

**Quatro exceções que nunca agregam:** fase que falhou ou foi interrompida,
fase segurada por você, fase com marca de procedência (abaixo), e fase que você
abriu à mão. A última já é código rodando: `manuallyToggled` no `MessageList`.

### R10 · Fase que entrou no meio do voo não pode parecer nativa
O plano muda em voo (seção acima), e hoje a mudança **não deixa rastro nenhum**.
Duas marcas, e as duas são **tipografia, não tinta** (mono, borda tracejada,
cinza):

- na fase: "apendada no voo às 18:41", "motor trocado no voo", "reprovada";
- no cabeçalho: os **dois** números, "fase 7 de 12 · lançou com 10", com "o que
  mudou" abrindo um **log curto** com hora, autor e efeito ("18:41 · o motor
  apendou Corrigir e Revisar porque a fase 5 reprovou; o plano foi de 10 para
  12" / "17:58 · você trocou o motor da fase 3 depois que ela parou por limite;
  ela re-rodou do começo").

Autor explícito, porque as duas fontes existem e são diferentes: o motor apenda,
o humano troca. Descartado o "Plano v2" que o agy propôs: número de versão é
encanamento, o que decide é o que mudou, quando e por quem. E procedência não
ganha cor: se cada qualificador de fase pedisse uma, um plano de 12 fases teria
seis, e o orçamento de tinta morre no primeiro plano longo.

### R11 · Travamento macro não é silêncio, e precisa de heurística própria
O paliativo do R5 ("última saída há Xs", âmbar aos 10 min) detecta **quietude**.
Um agent rodando o mesmo teste oito vezes **nunca fica quieto** e mesmo assim
não anda, e num plano de 12 com cinco fases dependentes o custo de descobrir
tarde é outra ordem de grandeza. A heurística proposta, decidível e com dado que
o app já tem:

> **mesmo comando ≥ 4 vezes seguidas** E **nenhum arquivo alterado no worktree
> desde a primeira**.

As duas juntas, nunca uma sozinha. O texto relata **o que se observou**, não o
diagnóstico: "rodou `bun run test src/billing` 4 vezes nos últimos 6 min, e
nenhum arquivo mudou no worktree desde a primeira". Quem conclui "travou" é o
humano; o app não aborta sozinho, e o gesto oferecido é o de sempre
("Interromper esta fase", com o preço por motor). No estado grande dos três
mocks, as quatro execuções vermelhas ficam **linha a linha**, furando a régua de
5 ações do R6 de propósito: a repetição visível é a evidência que sustenta o
aviso, e agregá-la em "4 comandos" apagaria justamente o que importa.

Descartado o terceiro fator que o agy propôs ("acima de 150% do tempo estimado
da fase"): `MissionPhaseDef` não tem estimativa nenhuma, e inventar uma seria
teatro com casa decimal. E "nada escrito há 22 min" tem definição única: tempo
desde a última **escrita no worktree**, nunca desde o último byte de stdout.

---

## A — Missão é um fio

**Tese:** missão não é superfície nova, é o fio com plano de voo. Vale tudo que
a despoluição do chat já ensinou: o passado recolhe pra uma linha que já é a
informação, só o vivo fica aberto, o filho mostra o delta, o marco vai pro
pretérito. O humano fala pelo gesto de sempre (um composer no rodapé), só que a
mensagem aterrissa no gate.

**Resolve:** 1 e 2 estruturalmente (não há como a mesma string aparecer duas
vezes empilhada), 3, 4 no mínimo viável, 5, 6 (bloco do motor calado dentro da
fase), 7 (expandir inline, com as decisões do handoff), 8 no mínimo (segurar +
interromper como link no rodapé do composer).

**Sacrifica:** a visão de onde a missão está no plano. Numa missão de 3 fases o
fio ainda cabe, mas o "1 de 3" vira uma linha de texto no meio de outras, e a
trilha não existe como objeto. É o menor delta sobre o código real (o
`MessageList` já faz recolhimento, stub e `manuallyToggled`), e o maior risco de
a missão longa virar rolagem infinita onde nada localiza.

**No plano grande (12 fases): escala, e melhora.** É a única direção que não
precisou de saída de emergência, porque a lista vertical não tem denominador de
largura: 12 fases custam altura, e altura é exatamente o que a janela viva (R9)
resolve. Duas peças novas entraram, e só por causa do N:

- a **régua fixa** no topo do painel, que não rola: "fase 7 de 12 · lançou com
  10 · próxima: Portar o histórico de faturas · +4 na fila" mais o tempo sem
  escrita. É uma linha, e é a única concessão de A à tese de B. Não é trilha de
  estações, não é inspetor, não tem seleção. Resolve o "nada localiza" do
  parágrafo acima sem importar a estrutura que quebra em B;
- a **marca de procedência** (R10) nas fases que o plano não tinha quando
  decolou.

O mock também expôs um **furo do motor** que só aparece com plano longo: a fase
5 termina `done` com o revisor reprovando, e a correção é apendada no **fim da
fila**, então as fases 6 a 10 rodam em cima de um schema já reprovado e a
correção só chega na 11. Num preset de 3 fases isso nunca aparece, porque o
revisor é o último. A tela não conserta o motor; ela para de esconder
("reprovada · a correção roda só na fase 11"). Se isso for bug do motor
(provavelmente é), a UI honesta é o que o torna visível.

## B — Painel de voo

**Tese:** numa missão o valor é saber **onde ela está no plano**, não cada
ferramenta que rodou. A trilha das 3 fases fica sempre na tela, declarando por
estação o que aquele motor consegue reportar, e o detalhe mora num **readout**
abaixo que funciona como **inspetor**: clicar numa estação troca o que ele
mostra, inclusive nas fases concluídas.

**Resolve:** 1, 2, 3 (os três estados de custo viram mostradores lado a lado, o
que é a leitura mais clara das três), 5, 6 (a granularidade é declarada ANTES
de rodar, então a quietude é contrato e não bug), 7 (o inspetor é o melhor
lugar pro passado das três), 8 nos controles do rodapé.

**Sacrifica:** o senso de tempo e de sequência. O readout mostra uma fase por
vez; a história da missão inteira nunca está numa tela só. E é a única das três
que precisa de um conceito novo de navegação (seleção de estação), com o risco
clássico: o usuário não descobre que a estação é clicável.

**No plano grande (12 fases): quebra**, e o mock mostra a quebra em vez de
descrever, com as duas saídas empilhadas abaixo dela. Abra `missao-b.html` no
estado "plano grande" e as três estão lá, uma sob a outra.

A conta: o painel tem 880px com 30px de padding de cada lado, 820px divididos
por 12 estações dão **68px por estação**. Em 68px não cabe "Portar o histórico
de faturas", não cabe "planejador · Claude · Opus 5", e não cabe a declaração
de granularidade, que era a melhor ideia de B ("reporta ação a ação" ocupa
sozinha mais que a estação inteira). Sobra o número da fase e três letras.

| Saída | Cabe? | O preço |
|---|---|---|
| **janela de 5 com corte anunciado** (duas antes, a viva, duas depois, uma tampa clicável de cada lado dizendo o que ficou de fora: "‹ 4 fases · US$ 11,40") | sim | a trilha **deixa de ser mapa**. A tese de B era "o todo sempre na tela"; uma janela de 5 numa missão de 12 é um carrossel com dois botões, e o usuário volta a montar o todo de cabeça |
| **trilha vertical, as 12 sem corte** (foi a saída que o agy recomendou) | sim | **dissolve a direção**. Cada fase passa a ter a largura inteira, as 12 linhas consomem uns 370px antes do readout, e o objeto resultante **é a lista de fases de A com o detalhe embaixo**. Some a barra horizontal, some a leitura lado a lado, e some a única coisa que distinguia B de A. Aplicar a janela viva (R9) nessa lista resolve os 370px e completa a conversão |

Descartados: scroll horizontal cru (esconde sem dizer o que escondeu) e
minimapa (dois pontos de foco para uma informação que cabe numa linha de texto).

**B não sobrevive ao próprio remédio**, e essa é a informação mais útil que
esta revisão produziu. O que B mantém sob N grande é uma vantagem só, e ela é
real: a estação viva é **um lugar fixo na tela**, então o aviso de repetição
(R11) tem onde morar sem empurrar nada. Foi daí que saiu a régua de A.

Um efeito colateral que também só aparece com N variável: **a barra de
progresso piora**. Ela dizia 33% com 1 de 3; aqui diz 50% com 6 de 12, e o
denominador mudou depois da decolagem. Uma barra que **recua sozinha** (de 60%
para 50% quando duas fases foram apendadas) é pior que não ter barra. Se a
trilha sobreviver, a barra ou congela o denominador de lançamento e declara
isso, ou sai.

## C — Sala de controle

**Tese:** se o humano não pode agir, a tela é TV. A trilha e o detalhe existem,
mas a peça central é a **caixa de comando**: o que dá pra fazer agora, com o
preço de cada gesto escrito ao lado, e o que **não** dá aparecendo desligado
com o motivo.

**Resolve:** 4 e 8 de longe melhor que as outras duas (é a única que trata
intervenção como assunto, com reversibilidade como coluna e o preço por motor
escrito na linha), 1, 3, 5, 6, e 7 no nível de resumo + gaveta.

**Sacrifica:** densidade. São 5 gestos empilhados numa tela onde, na maioria das
missões, o usuário não vai clicar em nenhum. Em missão curta de 2 minutos a
infraestrutura de controle é maior que a missão. E o detalhe da fase corrente é
o mais pobre das três, porque a caixa comeu o espaço.

**No plano grande (12 fases): quebram duas coisas ao mesmo tempo.** A trilha
fina quebra pelo mesmo motivo de B (66px por fase), e essa dói menos, porque a
trilha de C nunca foi a peça principal, e sim um índice: quando a trilha é
secundária por desenho, mutilá-la com a janela de 5 custa pouco. É a única
coisa que C ganha de B sob N grande.

O que quebra de verdade é o **vocabulário da caixa de comando**, que foi
escrito inteiro em cima de um destino único, "a próxima fase". Com 5 fases
futuras isso racha em três lugares:

- **os gestos ganham alvo.** "Pular a próxima" e "Trocar o motor da próxima"
  viram "Pular uma fase" e "Trocar o motor de uma fase", com um seletor ao
  lado. E a coluna de preço deixa de ser texto fixo: ela passa a ser
  **calculada a partir da escolha** ("Portar o histórico fora significa que
  Testes de integração vai rodar contra um histórico não portado"). É mais
  trabalho, e é o único jeito de não mentir;
- **a fila de mensagens vira agenda.** Cada mensagem ganha destino próprio, e a
  guarda de acúmulo passa a contar **por fase de destino**: 3 mensagens
  espalhadas em 3 fases não são o mesmo risco que 3 empilhadas numa só;
- **o botão vermelho fica mais caro.** "Parar missão" numa missão de 3 cancela
  uma ou duas; aqui cancela cinco e joga fora US$ 13,28 e 1h47. A régua da casa
  (preço antes do clique) já estava certa; o que muda é que o preço **escala**,
  então tem que ser lido do estado, nunca escrito à mão no componente.

Um caso que **só existe com N grande** e que nenhuma versão de 3 fases desta
caixa alcançava: a fase 11 foi apendada pelo motor e herdou o agent do executor
anterior, sem ninguém escolher. É a fase que mais merece revisão de motor, e
até agora era inalcançável.

Saldo: com 12 fases C fica **mais** justificada (há muito mais o que decidir) e
**mais** desequilibrada (a caixa cresce de novo, um chip a mais e dois
seletores, enquanto a fase viva continua com o mesmo espaço). As duas ao mesmo
tempo, e é honesto dizer que o mock não resolve a segunda.

---

## Segunda opinião: o agy (Gemini 3.6 Flash, effort alto)

Três rodadas, `gemini-3.6-flash-high` (a terceira na revisão de 13/08). Pedi que
estressasse as três direções, depois que respondesse ao caso do motor calado, e
por último a pergunta do plano grande: *"como mostrar progresso de um plano de
12 etapas onde só uma está viva, sem perder nem a etapa viva nem a noção de onde
ela está no todo?"*.

### O que veio e foi ADOTADO

- **"Enfileirar para o próximo gate não é meio-termo covarde"**, é a única
  estrutura sustentável para execução por fases: quebrar a fase no meio destrói
  o contrato dos papéis (planejador / executor / revisor). Mas com uma
  condição: *"sem o botão de pausa entre ações, o gate vira uma cela"*. Foi daí
  que saiu o par **enfileirar + segurar no fim desta fase** nas três, em vez de
  só enfileirar.
- **"O rótulo 'Pausar' em processo ativo é uma mentira"**, e o botão não deve
  existir. Adotado literalmente: nenhuma das três tem "Pausar".
- **A copy do motor calado não pode ser estática.** A frase que serve aos 30s
  não serve aos 25 min. Adotado como regra decidível, com o limiar amarrado ao
  **tempo desde o último byte** (10 min), não ao tempo da fase.
- **"Assuma a ignorância da telemetria de forma explícita"** para ações sem
  nome, agregando ("3 ações sem metadados da engine"). Adotado, com a copy
  reescrita pro vocabulário da casa: "2 ações sem rótulo (o motor não mandou o
  nome)".
- **Tratar motores diferentes de forma diferente é honestidade**, e a diferença
  deve morar no contrato de capacidades, com a UI trocando de componente quando
  a capability é falsa. Adotado, com uma correção: ele propôs uma capability
  nova (`TelemetryGranularity`); no nosso registry `structured_output` já diz
  isso, e capability nova sem motor que quebre o proxy é registro morto.
- **Detalhe expandido inline**, não gaveta lateral nem tela cheia: *"a gaveta
  quebra o foco horizontal e esconde o contexto temporal"*. Adotado em A e C.
  Em B o inspetor é deliberadamente diferente, e o README registra isso como
  divergência de direção, não descuido.
- **Colapsar leituras acima de N ações e manter visíveis as mutações.**
  Adotado como a régua de "quando detalhe vira ruído", com N = 5.
- **Zero só é correto em motor local** (custo real zero) ou no milissegundo
  antes do primeiro token. Adotado como a única exceção do R3.
- Os modos de falha em missão longa que ele levantou viraram requisito: o fio
  (A) *"transmite falsa sensação de avanço enquanto o objetivo macro está
  travado"*; o painel (B) *"mostra Fase 2 e nada muda por 20 minutos, o app
  parece quebrado"*; a sala (C) acumula *"três correções consecutivas"* que
  fazem o modelo ignorar a fase anterior. Daí saíram, respectivamente, o
  "última saída há Xs" visível em A, o mesmo em B, e a **fila de mensagens
  visível com editar/remover e aviso a partir de 3** em C.

### O que veio e foi DESCARTADO (com motivo)

- **PID na tela** ("Processo ativo (PID 84102)"). É encanamento sem decisão
  junto: o usuário não faz nada com um PID, e a régua da casa é que número na
  tela existe pra sustentar decisão. Ficou o que é acionável: tempo desde o
  último byte, volume de saída e o atalho pra saída bruta.
- **"(calculando ao concluir)"** como copy do custo. Diz o mesmo que "—" com
  legenda, mas ocupa o slot do valor com uma frase, o que quebra o
  `tabular-nums` e o alinhamento de coluna. Ficou "—" no valor e a explicação
  na legenda ao lado.
- **Motor no primeiro campo do resumo colapsado** ("✓ 1. Analisar Arquitetura
  (Claude Code)"). Quem varre uma lista de fases concluídas procura o
  entregável, não o fornecedor. O motor ficou por último, em sussurro.
- **Links diretos "para o arquivo no editor"** no resumo colapsado. O app já
  tem `MissionFilesDialog` e `listMissionFiles`; duplicar navegação de arquivo
  no resumo é superfície nova sem demanda.
- **A recomendação dele (B)**, em parte. Ver abaixo.
- **"Pular Fase: se estiver rodando, mata o processo e avança"** com um rótulo
  só. Dois preços diferentes com o mesmo botão é a receita do clique
  arrependido: separamos "pular na fila" (reversível, interruptor) de "pular a
  corrente" (irreversível, confirmação).

### Rodada 3 · o plano de 12 etapas (13/08)

Ele respondeu em três partes: layout, recolhimento e o modo de falha da própria
recomendação.

**ADOTADO:**

- *"Layouts horizontais quebram quando o denominador muda (N de 10 para 12). A
  linha do tempo vertical acomoda crescimento para baixo sem mover a área de
  trabalho."* Ele disse isso **antes** de eu desenhar a quebra de B, e é o
  mesmo veredito: a trilha vertical é a saída que funciona, e é justamente ela
  que dissolve B em A.
- O **recibo de entrega** da fase concluída (o que ficou pronto, o custo final,
  a métrica real: "3 arquivos alterados, 14 testes passaram"), em vez do log
  bruto. Já era o R6, e agora vira também o texto dos stubs agregados do R9: o
  stub tem que ser um recibo, não uma contagem.
- O **contador de inatividade explícito**, com o console congelado no último
  evento real em vez de spinner. Adotado com correção de fonte: ele mede "sem
  resposta do agente"; nós medimos **escrita no worktree**, que é o que decide.

**ADOTADO como confissão:** o modo de falha que ele apontou na própria
recomendação é o melhor parágrafo das três rodadas. *"Se o agente travar de
verdade, o contador `[Aguardando resposta há 22m]` é indistinguível de um agente
que está apenas demorando. O design falha em dar um diagnóstico definitivo de
'travou' versus 'está pensando'."* É exatamente o furo que o R11 fecha, e a
única razão de o R11 existir. Ele nomeou o buraco em duas rodadas seguidas sem
propor a saída; a saída (comando repetido + worktree parado) é deste documento.

**DESCARTADO:**

- **As duas colunas (320px de timeline + 560px de console).** O painel tem
  880px **no total** e vive dentro do app, não é tela cheia: 320 + 560 não deixa
  padding, e o console fica com menos que os 560px que ele mesmo declarou
  mínimo para caber um diff. Pior, a coluna esquerda vira um **segundo eixo de
  rolagem** competindo com o fio, e com 30 fases ela rola sozinha e a fase viva
  sai da tela do mesmo jeito. A janela viva (R9) resolve o mesmo problema sem
  gastar uma coluna.
- **Projetar para N > 25.** É o cenário de falha que ele levantou, e ele não
  existe por acidente: o clamp `MAX_REVIEW_LOOPS = 2` limita o crescimento
  automático a +4 fases. Passar de 25 exige um humano montando 25 à mão, e aí é
  escolha dele. Fica registrado, não desenhado.
- **"Fases futuras com 50% de opacidade."** Opacidade uniforme apaga a
  declaração de granularidade da próxima fase ("não reporta ações nem custo"),
  que é a melhor informação que uma fase na fila tem para dar. Futuro é
  hierarquia tipográfica, não transparência.

### Onde ele e eu discordamos

Ele recomendou um **híbrido B+C com o filtro de ruído de A**, e o argumento
mais forte contra a própria escolha foi dele mesmo: *"em missões curtas de 2
minutos, o usuário é obrigado a encarar uma infraestrutura pesada de controle
que ele não precisava"*. Minha recomendação abaixo é o mesmo híbrido com o
**centro de gravidade em A**, não em B, e a razão está no parágrafo seguinte.

---

## Recomendação (revisada em 13/08, depois do teste do plano grande)

**A como esqueleto, com a caixa de gestos de C, a declaração de granularidade
de B e duas peças que o plano grande tornou obrigatórias: a régua fixa (R9) e o
aviso de repetição (R11).**

O esqueleto não mudou. **A confiança mudou, e a ordem das razões também.** Na
primeira rodada, A ganhava por ser o menor delta sobre o código real, e o
contra-argumento (o fio esconde travamento macro) ficava em aberto no fim do
documento. Depois do teste de 12 fases, A ganha por um motivo mais forte e o
contra-argumento foi resolvido em vez de adiado:

1. **A é a única que escala, e as outras duas disseram isso sozinhas.** A trilha
   de B quebra em 68px por estação; a saída que funciona (vertical) converte B
   em A; a trilha de C quebra igual, e só dói menos porque em C ela já era
   secundária. Não é preferência, é aritmética de largura, e vale para qualquer
   plano acima de meia dúzia de fases, que o app aceita montar hoje sem tocar em
   código. Esta razão é nova, e é a que passou a mandar: se o mock de 3 fases
   fosse o único teste, a escolha teria sido feita por gosto.
2. **A já existe.** O recolhimento por padrão, o stub, o `manuallyToggled`, a
   compensação de scroll e a regra de "falha nunca recolhe" são código rodando
   em `MessageList.tsx` + `toolGroupDisclosure.ts`, testados. A missão herdar
   isso é a diferença entre uma passada e uma reconstrução. B e C exigem
   superfície nova (inspetor com seleção; caixa de gestos) sobre uma área que
   já está sendo reconstruída.
3. **O problema mais caro do build 193 não é layout, é honestidade.** Nenhum
   dos cinco itens do feedback original, nem os três novos, é resolvido por
   "onde as fases aparecem na tela". São resolvidos pela escada do rótulo, pelos
   três estados de custo, pela ignorância declarada por capability e pelo
   vocabulário de pausa. Tudo isso é comum às três, e cabe em qualquer
   esqueleto: **escolha o esqueleto mais barato e gaste o orçamento nas regras.**
4. **A caixa de gestos de C não é opcional.** As queixas do usuário ("não sei o
   que está acontecendo em cada etapa" e "não consigo pausar a etapa em si") são
   as duas de intervenção e visibilidade, e o mínimo de A não fecha a segunda.
   Proposta concreta: os gestos de C entram no fio como um **bloco colado na
   fase corrente** (não um painel próprio), aparecendo só enquanto uma fase
   roda, com a coluna de reversibilidade e o preço por motor intactos. Isso
   preserva a densidade de A nas missões curtas, porque o bloco some quando nada
   roda. **Emenda do plano grande:** os gestos que apontam para "a próxima fase"
   precisam nascer com **alvo selecionável** (pular qual, trocar o motor de
   qual), e o texto do preço precisa ser **lido do estado**, porque ele muda com
   a escolha e com quantas fases dependem dela. Nascer sem isso é escrever a
   caixa duas vezes.
5. **A declaração de granularidade de B é barata e vale muito.** Uma linha na
   fase **na fila** ("agy · Flash 3.6 · não reporta ações nem custo") converte o
   silêncio futuro de bug em contrato. Custa um `structured_output` lido no
   render e resolve metade da percepção de "o app travou".
6. **A régua fixa e o aviso de repetição entram junto, não depois.** São as duas
   peças que o plano grande obrigou, e nenhuma é enfeite: sem a régua (R9), "onde
   estou no plano" some assim que o plano passa da altura da tela; sem o aviso
   (R11), o custo de descobrir tarde escala com N e o app fica bonito enquanto
   queima orçamento em círculo. Prioridade entre as duas, se for preciso
   escolher: **o aviso primeiro**, porque a régua melhora a leitura e o aviso
   evita prejuízo.

O que **não** trago: a trilha permanente de estações e o inspetor por seleção
(B). Numa missão de 3 fases o fio já mostra as três; numa de 12 a trilha não
cabe (é o resultado desta revisão); e o inspetor por seleção é a única
navegação nova das três direções. A régua fixa de A é a parte de B que
sobrevive, reduzida a uma linha que não rola: posição, denominador declarado e
tempo sem escrita. Sem estações, sem seleção, sem barra de percentual.

Fica registrado como evolução, com uma correção sobre a versão anterior deste
parágrafo: eu havia escrito que a trilha só ganharia valor quando o
`MissionPlanGraph` virasse plano ramificado de verdade. **Isso estava errado
pelo motivo oposto ao que eu supunha.** O motor recusa ramificação explicitamente
hoje (`missionPlans.ts:169-180`), e mesmo assim a trilha já tinha valor: o valor
é "onde estou no todo", que existe em plano linear e cresce com N. O que a
revisão mostrou é que esse valor **não precisa de trilha** para ser entregue.
Se a missão virar grafo, B volta à mesa, mas não como trilha horizontal de
estações, que é a peça que já sabemos que não cabe.

### O argumento mais forte CONTRA esta recomendação, e o que sobrou dele

Era este, e o agy o nomeou primeiro: **o fio esconde travamento macro.** Numa
missão de 40 minutos com a fase 2 em loop tentando consertar o mesmo teste, A
continua rolando deltas de ação e transmitindo sensação de avanço enquanto o
objetivo não anda; B mostraria "fase 2 de 3" parada há 20 minutos, que é a
informação certa. A mitigação da primeira rodada ("última saída há Xs" e âmbar
aos 10 min) era um paliativo confesso: detecta **silêncio**, não **loop**.

O R11 fecha esse buraco, e fecha nos três mocks, não só em A: comando repetido
≥ 4 vezes **e** worktree parado desde a primeira, relatando o observado sem
diagnosticar, sem abortar nada sozinho. Um agent falante andando em círculo
passa a ser visível, e passa a sê-lo no fio, que era exatamente onde o
argumento dizia que não daria.

**O que continua em aberto, e agora é o argumento mais forte:** o R11 depende
de dois dados que a UI hoje não tem à mão de forma confiável. O histórico de
comandos por fase existe no fio, mas "nenhum arquivo alterado no worktree desde
a primeira execução" exige uma leitura do worktree que ninguém faz hoje
(`missionWorktree.ts` cria e gerencia o worktree; não há amostragem periódica de
`git status`). Sem esse segundo fator, sobra "rodou o mesmo comando 4 vezes",
que é ruidoso e vira alarme falso em teste que legitimamente re-roda. **O R11
não é uma decisão de UI, é um pedido de dado**, e se ele não for barato, a
recomendação volta a ter o furo que tinha antes.

Segundo em aberto, menor: nenhum dos três mocks resolve o desequilíbrio de C
com N grande (a caixa de comando cresce enquanto a fase viva não), e a proposta
de colar os gestos na fase corrente ameniza sem medir. Isso é assunto do
protótipo real, não de mais um mock estático.
