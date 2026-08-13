# Missão em voo — 3 POCs visuais

> Mocks estáticos (13/08/2026), NÃO código do app. Abrir no browser:
> `missao-a.html` · `missao-b.html` · `missao-c.html`. Insumo visual para a
> frente de Missões, que está reconstruindo essa área. Nada aqui foi
> implementado, e nenhum arquivo de missão foi tocado.

Os três renderizam a MESMA cena, com os mesmos números, e cada um tem **três
estados** no seletor do topo (mais tema claro/escuro):

| Estado | O que mostra |
|---|---|
| **fase 1 · motor falante** | Planejar em voo no Claude · Opus 5 (16min 19s), ação a ação |
| **fase 2 · motor calado** | Planejar concluída + Executar UI em voo no agy · Flash 3.6 (5min 42s), **sem nenhuma ação reportada** |
| **esperando você** | gate entre fases, com decisão humana pendente |

O estado do meio é o cenário do segundo print do build 193, e é ele que
justifica metade das decisões abaixo: **os dois casos aparecem lado a lado
porque a missão real tem os dois**.

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

---

## Segunda opinião: o agy (Gemini 3.6 Flash, effort alto)

Duas rodadas, `gemini-3.6-flash-high`. Pedi que estressasse as três direções, e
depois que respondesse ao caso do motor calado.

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

### Onde ele e eu discordamos

Ele recomendou um **híbrido B+C com o filtro de ruído de A**, e o argumento
mais forte contra a própria escolha foi dele mesmo: *"em missões curtas de 2
minutos, o usuário é obrigado a encarar uma infraestrutura pesada de controle
que ele não precisava"*. Minha recomendação abaixo é o mesmo híbrido com o
**centro de gravidade em A**, não em B, e a razão está no parágrafo seguinte.

---

## Recomendação

**A como esqueleto, com a caixa de gestos de C e a declaração de granularidade
de B.** Nesta ordem, e por estas razões:

1. **A já existe.** O recolhimento por padrão, o stub, o `manuallyToggled`, a
   compensação de scroll e a regra de "falha nunca recolhe" são código rodando
   em `MessageList.tsx` + `toolGroupDisclosure.ts`, testados. A missão herdar
   isso é a diferença entre uma passada e uma reconstrução. B e C exigem
   superfície nova (inspetor com seleção; caixa de gestos) sobre uma área que
   já está sendo reconstruída.
2. **O problema mais caro do build 193 não é layout, é honestidade.** Nenhum
   dos cinco itens do feedback original, nem os três novos, é resolvido por
   "onde as fases aparecem na tela". São resolvidos pela escada do rótulo, pelos
   três estados de custo, pela ignorância declarada por capability e pelo
   vocabulário de pausa. Tudo isso é comum às três, e cabe em qualquer
   esqueleto: **escolha o esqueleto mais barato e gaste o orçamento nas regras.**
3. **A caixa de gestos de C não é opcional.** As queixas do usuário ("não sei o
   que está acontecendo em cada etapa" e "não consigo pausar a etapa em si") são
   as duas de intervenção e visibilidade, e o mínimo de A não fecha a segunda.
   Proposta concreta: os gestos de C entram no fio como um **bloco colado na
   fase corrente** (não um painel próprio), aparecendo só enquanto uma fase
   roda, com a coluna de reversibilidade e o preço por motor intactos. Isso
   preserva a densidade de A nas missões curtas, porque o bloco some quando nada
   roda.
4. **A declaração de granularidade de B é barata e vale muito.** Uma linha na
   fase **na fila** ("agy · Flash 3.6 · não reporta ações nem custo") converte o
   silêncio futuro de bug em contrato. Custa um `structured_output` lido no
   render e resolve metade da percepção de "o app travou".

O que **não** trago: a trilha permanente e o inspetor por seleção (B). Numa
missão linear de 3 fases, o fio já mostra as três; a trilha só ganha valor
quando o `MissionPlanGraph` (que existe em `missionTypes.ts:19-46` e a timeline
ignora) virar plano ramificado de verdade. Fica registrado como evolução: **se
a missão virar grafo, B deixa de ser alternativa e passa a ser necessidade.**

### O argumento mais forte CONTRA esta recomendação

O agy o nomeou primeiro, e ele é bom: **o fio esconde travamento macro.** Numa
missão de 40 minutos com a fase 2 em loop tentando consertar o mesmo teste, A
continua rolando deltas de ação e transmitindo sensação de avanço enquanto o
objetivo não anda; B mostraria "fase 2 de 3" parada há 20 minutos, que é a
informação certa. Minha mitigação (o "última saída há Xs" e o âmbar aos 10 min
de silêncio) é um paliativo: ela detecta **silêncio**, não **loop**. Um agent
falante rodando o mesmo comando oito vezes seguidas não fica em silêncio um
segundo, e nenhuma das três direções, como estão desenhadas, percebe isso.
Detectar repetição de ação idêntica é trabalho que nenhum dos mocks propõe e
que provavelmente precisa existir.
