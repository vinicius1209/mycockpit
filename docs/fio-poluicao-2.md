# Fio: a poluição que sobrou depois do ADR-037

> Auditoria de 14/08/2026, a partir de um print novo do usuário ("o output do
> Claude Code ainda parece poluído"). Diagnóstico próprio primeiro (reproduzido
> em teste de render contra o código real), depois segunda opinião (Gemini 3.7
> Flash High via `agy`) e terceira (gpt-5.6-terra via `codex exec`), curadas.
> **Nada foi corrigido nesta passada.** O entregável é o diagnóstico + o mock
> `docs/mocks/fio-densidade.html` (mesma cena em 3 estados).
>
> Régua: `docs/STYLEGUIDE.md` é lei. A tese é "a UI mostra estado e pede
> decisão; o resto recua". E nem toda densidade é poluição: custo e modelo por
> turno são features centrais do produto.

## 0. A cena, medida (não descrita de memória)

A cena do print foi remontada em `renderToStaticMarkup` com os payloads reais do
adapter (`system/task_started` → `AgentEvent::DeferredWork`, `adapters.rs:1155`)
e o texto do DOM extraído. Um turno com um trabalho em background vivo,
disparado por um `Agent` com `description: "Check address edit history in prod"`:

```
Você
confere o histórico
Claude Code                                    ← cabeçalho de autor
10:20
Trabalho em background: Check address edit history in prod     ← ①
1 agente · atividade há 3min                                   ← ②
  Check address edit history in prod          general-purpose  ← ①
    Briefing do agente · 1 linha
    Trabalho em background: Check address edit history in prod ← ①
    iniciado
Claude Code                                    ← cabeçalho de autor DE NOVO
trabalho em background · Check address edit history …          ← ①
4min 12s                                                       ← ②
```

Contagens medidas no mesmo HTML:

| Medida | Valor |
|---|---|
| Ocorrências do nome do trabalho | **4** |
| `animate-spin text-st-running` (spinners azuis) | **3** |
| `animate-cockpit-pulse` (pontos do rodapé) | **3** |
| Ocorrências de "Claude Code" (cabeçalho de autor) | **2**, adjacentes |
| Cronômetros ticando por segundo | **2** (`ActivityAge` + `Elapsed`) |

E a MESMA cena, depois que o trabalho termina, recolhe para:

```
2 delegações concluídas · 1 agente · 5min 00s
```

O nome do que rodou some, e a contagem está errada.

## 1. Bugs confirmados (não são gosto)

### B1. A dedup do ADR-037 não dispara. Dois furos independentes, não um

`MessageList.tsx:382-383`:

```ts
const echoesHeader =
  headerLabel != null && status !== "error" && p.label === headerLabel
```

- **Furo A (o que o brief já apontava):** compara string exata. O cabeçalho é
  `"Trabalho em background: Check address edit history in prod"` (o prefixo vem
  de `toolview.ts:360`) e o filho de nível 1 é `"Check address edit history in
  prod"` (label do `Agent`, `toolview.ts:336-348`). Igualdade falha, os dois rendem.
- **Furo B (não estava no brief, e é o pior):** `headerLabel` só é passado ao
  `ToolNodeList` **de nível 1** (`MessageList.tsx:1147`). O `ToolNodeList`
  aninhado dentro da `ToolLine` (`MessageList.tsx:690`) não repassa a prop. O nó
  `DeferredWork` mora no nível 2 (o reducer o pendura no `tool_use` de origem
  via `parentToolId`, `store/chat.ts:977`) e sua string é **idêntica** à do
  cabeçalho. Ou seja: mesmo com igualdade exata funcionando, essa repetição
  passaria batido.

O teste que "prova" a dedup (`MessageList.despoluicao.test.ts:104-135`) monta o
nó `DeferredWork` **sem `parentToolId`**, que é justamente a forma que o reducer
nunca produz quando há `task_started`. Fixture divergente do payload real
escondendo o bug: é a lição do ADR-016 de novo.

**A regra certa não é normalizar prefixo.** Nome é propriedade de uma
*entidade* (o trabalho / a delegação), não de um nó de árvore. A correlação já
existe e é determinística: `deferred.id` / `toolUseId` ligam o nó sintético ao
`tool_use` que o criou. O dono do nome deve ser o ancestral visível mais alto
que apresenta aquela entidade, e a posse desce recursivamente. Comparar string é
remendo, e foi exatamente por isso que o remendo vazou.

### B2. "2 delegações concluídas": contagem de nó de implementação, não de trabalho

`describeToolGroup`/`settledLabel` (`toolview.ts:413,555`) contam **itens do
array de tools**. Um único trabalho em background produz dois: o `Agent` de
origem e o `DeferredWork` sintético. Com `n === 1` o rótulo seria o nome do
trabalho; com `n === 2` cai no balde plural genérico e o nome **desaparece do
fio**. Duas violações de uma vez:

- §7 do STYLEGUIDE, honestidade: "contagem sem fonte única é proibida". A fonte
  única aqui é a entidade, não o nó.
- ADR-037: o resumo recolhido "passa a SER a informação". "2 delegações
  concluídas · 1 agente · 5min" não é informação, é um recibo sem nome.

### B3. Três spinners narrando o mesmo agora, na mesma linhagem

Cabeçalho do grupo (`ToolGroupStatus`, estado `running`), linha do `Agent`
(`StepDot` `running`) e linha do `DeferredWork` (`StepDot` `running`) giram os
três, todos `text-st-running`, um dentro do outro, mais os 3 pontos pulsantes do
rodapé. Seis elementos azuis animados para UM trabalho. STYLEGUIDE §6 ("dono
único do agora") e §2 (orçamento de tinta por recorte).

Consequência de B1/B2: com a posse do nome corrigida, o nó `DeferredWork` deixa
de ser uma linha própria (vira o estado da linha do pai) e dois dos três
spinners somem sozinhos.

### B4. O cabeçalho de autor renderiza duas vezes seguidas

`WorkingIndicator` (`MessageList.tsx:2781`) é appendado depois dos `groups` e
desenha o próprio gutter + nome + badge de motor, mesmo quando o grupo
imediatamente anterior é do MESMO autor. `messageGroups.ts` existe justamente
para coalescer autor contíguo, e a linha viva escapa dele. No print isso é
"Claude Code" duas vezes com ~40px de distância.

### B5. `ActivityAge` não tem hora nem dia

`MessageList.tsx:855-874`: `< 5s` → "agora", `< 60s` → "há Xs", senão
**sempre** `há {minutos}min`. Um trabalho em background de 3h (que é o caso de
uso do deferido, o teto de espera do CLI foi levantado pra 4h no ADR do
deferred-work) mostra "atividade há 180min", ao lado de um `fmtDuration` que na
mesma tela escreve "3h 00min". Vocabulário de tempo divergente em dois
elementos vizinhos.

## 2. Decisões de densidade (aqui não há bug, há escolha)

### D1. O bloco "Comando" (candidato 2 do brief): a assimetria é o argumento

Não é "o comando polui". O comando é evidência de um app que executa coisa na
máquina do usuário, e §7 (honestidade) pesa a favor de mostrá-lo. O defeito é
que **a caixa irmã já resolveu isso e a do comando não herdou a régua**:

| | Briefing do agente (`MessageList.tsx:549-577`) | Comando (`:585-597`) |
|---|---|---|
| Nasce | recolhido, atrás de botão | **aberto** |
| Diz o tamanho | sim (`· N linhas`) | não |
| Teto de altura | `max-h-52` + scroll interno | **nenhum** |

Um heredoc de 34 linhas empurra o estado vivo pra fora da viewport, dentro do
próprio grupo que deveria estar mostrando o agora. **Limite honesto proposto:**
mesma régua do briefing, com uma diferença deliberada, comando de **1 linha
continua aberto** (é o caso comum e o recolhimento custaria mais clique do que
economiza altura); de 2 linhas pra cima, recolhe com `Comando · N linhas` e abre
com o mesmo `max-h-52` + scroll. O texto nunca é cortado no armazenamento nem no
`title`: contenção visual, não truncagem de evidência.

Precisa de decisão do dono do produto? Não. É bug de hierarquia disfarçado de
densidade, e os três modelos concordaram sem hesitar.

### D2. O rodapé do turno (candidato 3): separando decisão de telemetria

`TurnTelemetry` (`MessageList.tsx:1588`) + `TurnFeedback` (`:1340`), por turno
concluído, para sempre no histórico:

```
✓ concluído · 5min 00s · 35k↓ · 19k↑ · cache 2.0M · claude-opus-5 · US$ 2,62 · Diff
👍 🎯 🧠 🧪 ⚡ 👎 ＋   🎓 Transformar em aprendizado
```

Classificação, item a item:

| Item | O que é | Veredito |
|---|---|---|
| `✓ concluído` | estado | fica (é o marco verde, 1 por turno, ADR-037) |
| `5min 00s` | estado | fica |
| `claude-opus-5` | estado (quem executou) | **fica** (feature central) |
| `US$ 2,62` | estado (quanto queimou) | **fica** (feature central) |
| `Diff` | decisão | fica |
| `35k↓ · 19k↑ · cache 2.0M` | telemetria | **recua**: é o *detalhe que explica o custo*, e o lugar onde a pergunta nasce é o próprio custo (hover/title). Nenhuma decisão do usuário depende de ler "cache 2.0M" em todo turno |
| 6 emojis + `＋` (8 a mais) | on-ramp de gesto | **recua, não morre** (ver abaixo) |
| `Transformar em aprendizado` | gesto real | fica, em 11px cinza, no mesmo recuo |

Sobre os emojis, aqui eu **divirjo dos dois modelos externos**, que pediram
extirpação. A reação não é métrica de engajamento: ela é a porta de entrada do
loop de aprendizado e o valor selecionado é **persistido junto com a regra**
(`selectedReaction` alimenta `openAsk` e chega ao `api.save`,
`MessageList.tsx:1363-1400`). Matar a fileira mata a única on-ramp. O que
sobra de crítica válida é a permanência: 7 controles fixos × todo turno do
histórico é mobília, e um turno antigo sem reação **não está pedindo decisão
nenhuma**. Proposta: turno sem reação mostra duas palavras cinzas que só
acendem no hover ("reagir · transformar em aprendizado"); turno **com** reação
mostra a reação escolhida, porque aí virou estado. Os 6 primários passam a
morar no `＋`, que já é disclosure existente.

Isso é o estado **2** do mock. O estado **1** (só os bugs, rodapé intocado)
existe pra testar a hipótese de que a poluição percebida é 80% repetição, e
que, corrigida ela, a densidade do rodapé para de incomodar.

### D3. "atividade há 3min" no cabeçalho vivo: divergência com a casa

Os dois modelos externos apontaram, independentemente, que "atividade há 3min"
concorre com o cronômetro do rodapé e viola "dono único do agora".
**Formalmente, a casa já decidiu o contrário e por escrito**: ADR-037 rejeitou
o relógio vivo no cabeçalho de propósito, e o STYLEGUIDE §6 diz "grupo vivo
mostra **no máximo** 'atividade há Xs'". Não é um segundo relógio do trabalho:
é a **idade do último evento**, ou seja, o detector de travamento (fica âmbar e
vira "sem eventos há Xs" quando `stalledSince` chega).

Onde eles têm razão mesmo assim: quando o trabalho está saudável, esse número
não carrega informação alguma e mesmo assim tica de segundo em segundo ao lado
de outro que tica. Recomendação (não é o que os dois pediram, e não fere o
ADR): renderizar a idade **só quando ela informa**, ou seja, quando
`stalledSince` está setado ou a idade passa de um limiar (20s é o candidato,
acima do "está se mexendo" do olho), com o espaço reservado abaixo disso (§6
R6: "sem status confiável, não inventa; fica o espaço reservado"). Isso mata o
segundo número ticando no caso comum e preserva o detector, que é a razão de
ele existir. Junto com isso, B5 (formatar hora/dia).

## 3. As três leituras, curadas

Prompt idêntico para os dois externos (cena renderizada + os 3 candidatos +
as regras congeladas do STYLEGUIDE), pedindo crítica, acréscimos e priorização.

### Onde os três concordam (é forte, trate como fechado)

1. **Comparar string é a abordagem errada.** Codex: "String não é identidade…
   a dedup deve usar um `workId` ou correlação canônica entre chamada da
   ferramenta e nó sintético, **propagada recursivamente** para todos os
   descendentes. Normalizar prefixos é apenas remendo." Gemini: "a identidade
   pertence exclusivamente ao nó raiz; filhos herdam por ID semântico e exibem
   apenas a operação específica". É exatamente o furo B que eu tinha achado no
   código (a prop que não desce), dito de forma independente pelos dois.
2. **"2 delegações concluídas" é bug de honestidade, e perder o nome ao
   recolher é pior que a contagem errada.** Gemini: "o resumo recolhido precisa
   manter o título"; Codex: "a contagem complementa, não substitui a identidade
   do que aconteceu".
3. **O bloco Comando: contenção, não censura.** Ambos propuseram exatamente a
   régua do briefing (recolhido + contagem de linhas + altura máxima com
   scroll). Codex acrescentou o ponto que eu não tinha escrito: "não corte nem
   altere o comando armazenado; truncar a visualização é honesto **se o usuário
   consegue revelar e copiar** o conteúdo completo".
4. **Token/cache saem da primeira leitura; custo, modelo, duração e Diff
   ficam.** Codex desenhou a linha alvo quase idêntica à minha:
   `Concluído · 5min · claude-opus-5 · US$ 2,62 · Diff`.
5. **A barra de reações não pode ser mobília permanente.** (Onde eu divirjo é
   no destino, não no diagnóstico, ver D2.)

### O que veio deles e eu **adotei**

- **Codex, "dois pontos vivos na mesma linhagem duplicam o mesmo estado; um
  único nível deve carregar o indicador vivo".** Eu não tinha olhado para os
  spinners. Fui medir: são **3**, mais 3 pontos pulsantes. Virou o B3.
- **Codex, "não corte nem altere o comando armazenado… cópia integral
  disponível".** Entrou como cláusula explícita na D1: contenção visual nunca
  vira truncagem de evidência.
- **Codex, "três affordances expansíveis muito próximas (cabeçalho, briefing,
  comando): o usuário decodifica estrutura antes de entender o trabalho".**
  Registrado como item de protótipo, não de correção. Colapsar tudo numa "área
  de detalhes da delegação" é uma reescrita do disclosure de 2 níveis que o
  ADR-037 acabou de congelar, e não se mexe nisso sem mock.
- **Gemini, "amnésia do histórico".** Nomeou melhor do que eu o efeito de B2: o
  problema não é a contagem estar errada, é o fio esquecer o que rodou.

### O que veio deles e eu **descartei** (com motivo)

- **Ambos: "remover `atividade há 3min`".** Descartado como está. Contraria uma
  decisão escrita e deliberada (ADR-037 + STYLEGUIDE §6) e joga fora o detector
  de travamento. Substituído pela versão condicional da D3. Os dois modelos não
  tinham o contexto de que aquele número vira âmbar quando o trabalho para de
  emitir evento, o que é a única razão de ele existir.
- **Ambos: "extirpar a fileira de emojis" (Gemini: "resquício de chat
  corporativo… métrica de engajamento").** Descartado: a leitura é plausível de
  fora e **errada aqui**, porque a reação é entrada persistida do loop de
  aprendizado, não contador de engajamento (nem sai do app). Mantido o
  diagnóstico (não pode ser permanente), trocado o remédio (recuo por hover +
  estado, ver D2).
- **Gemini: "`general-purpose` e `iniciado` são rótulos órfãos que ocupam
  largura sem guiar decisão".** Descartado. Depois de B1 corrigido, esses dois
  passam a ser o ÚNICO conteúdo das linhas filhas (o delta que o ADR-037 pede).
  Tirar os dois deixaria linhas vazias, ou pior, reintroduziria a repetição do
  nome pra ter o que escrever.
- **Gemini: "compactar `35k↓ · 19k↑ · cache 2.0M` em `54k tok (2.0M cache)`
  precisa de protótipo".** Descartado como caminho: somar entrada e saída
  destrói a distinção que dá pra ler o custo (saída custa múltiplas vezes a
  entrada). Se recua, recua inteiro pro hover; não vira um número novo que
  ninguém sabe interpretar.
- **Codex: "timestamp `10:20` é gosto, deixe como está".** Concordo, e por isso
  não está em lugar nenhum da lista de ação.

### O que só eu vi (nenhum dos dois tinha o DOM)

B4 (cabeçalho de autor duplicado), B5 (`ActivityAge` sem hora), a contagem
exata de spinners, e o furo B da dedup (a prop `headerLabel` que não desce da
árvore). Este último os dois **preveram por raciocínio** ("propagada
recursivamente"), sem poder confirmar.

## 4. Recomendação priorizada

### Corrigir já (bug; não precisa de mock, precisa de teste)

1. **B1, posse do nome por entidade.** Trocar a comparação de string por
   correlação de identidade (`deferred.id`/`toolUseId`/`toolId`) e **propagar
   a posse por toda a subárvore**, não só ao nível 1. Teste obrigatório com a
   fixture REAL (nó `DeferredWork` **com** `parentToolId`, que é o que o
   reducer produz), porque a fixture atual é justamente a que esconde o bug.
2. **B2, contagem por trabalho.** `describeToolGroup` deve contar entidades, não
   itens: um `tool_use` e seu `DeferredWork` são UM. E grupo de 1 trabalho
   preserva o nome ao recolher ("Check address edit history in prod ·
   concluído · 5min 00s").
3. **B3, um indicador vivo por linhagem.** Cai quase todo sozinho depois de 1 e
   2; o que sobrar (cabeçalho gira **e** filho gira) vira regra explícita.
4. **D1, teto no bloco Comando.** Régua do briefing (recolhido acima de 1 linha
   + contagem + `max-h-52` com scroll), texto íntegro e copiável.
5. **B5, `ActivityAge` com hora/dia.** Uma linha de formatação; hoje escreve
   "há 180min" ao lado de um "3h 00min".

### Precisa de mock/decisão do dono (o `docs/mocks/fio-densidade.html` existe pra isso)

6. **D2, o rodapé do turno.** Comparar estado 1 (rodapé intocado) contra estado
   2 (token/cache no hover do custo; reações por hover/estado). A pergunta a
   responder olhando o mock é uma só: *corrigidos os bugs, o rodapé ainda
   incomoda?* Se não incomodar, D2 não acontece.
7. **D3, a idade condicional no cabeçalho vivo.** Diverge de uma linha escrita
   do STYLEGUIDE, então exige gesto explícito: se for adiante, é ADR novo +
   linha no §6, não uma passada silenciosa.
8. **B4, cabeçalho de autor da linha viva.** É bug de agrupamento, mas o
   conserto mexe no `WorkingIndicator`, que é o dono do "agora" e está sendo
   tocado por outra frente. Baixo risco, ordem alta de cuidado.

### É gosto, deixe como está

- `claude-opus-5` e `US$ 2,62` na primeira leitura do rodapé. É o produto.
- O timestamp `10:20` no cabeçalho do grupo.
- O `general-purpose` como meta da linha filha (vira o delta útil depois de B1).
- "Liberado" âmbar e "Parar" vermelho, sempre (exceção fixa do §2).

## 5. Notas de manutenção achadas de passagem (NÃO corrigidas)

- `MessageList.despoluicao.test.ts:104-135` testa a dedup com uma fixture que o
  reducer nunca produz (sem `parentToolId`). O teste passa e o app repete o
  rótulo. Não alterei nenhum teste existente nesta passada, mas quem for
  corrigir B1 precisa saber que **esse teste verde é falso**.
- O comentário de `TurnTelemetry` (`MessageList.tsx:1585-1587`) descreve
  "células rotuladas" e o código é uma linha corrida de `·`. Comentário
  desatualizado desde alguma passada anterior.
- `MessageList.tsx` está em 2792 linhas, acima do teto de 700 do §10 e vivendo
  de baseline congelada. Toda correção acima cai nele. Vale dividir antes, não
  depois (o próprio STYLEGUIDE registra que foi ali que 11 varreduras O(N) se
  esconderam).
