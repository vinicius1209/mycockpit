# Perf do fio de chat: o custo por TOKEN

> **Status:** P1, P2, P3, Etapa A e Etapa B ENTREGUES (13–14/08/2026).
> Escrito DEPOIS da entrega, a pedido da revisão: a frente inteira existia só em
> mensagem de commit, e a invariante que sustenta tudo (§2) morava num
> comentário de módulo. Plano que não existe não é revisável, e invariante que
> não tem teste não é invariante.

## 0. O resultado em uma frase

Renderizar um token num fio real de 1.885 itens custava **1,028 ms** e passou a
custar **0,223 ms** (janela de 150 nós, o caso normal), sem uma linha de JSX
mudada e sem nenhuma diferença visível na tela.

## 1. O problema, medido

O fio de referência é REAL (conversa de 665 KB exportada da máquina do autor):
**1.885 itens, 394 nós, 150 visíveis**. O medidor roda 200 tokens de
`text_delta` e divide.

Onde o tempo estava, quando a frente abriu (P3, 026deff):

| passe | share |
|---|---|
| `buildNodes` | 49% |
| `tsById` | 14% |
| planos (`deriveTaskPlans`) | 14% |
| `feedbackTextByResult` | 7% |
| `attReads` | 5% |

O padrão comum: **derivações O(N) sobre o fio INTEIRO rodando a cada token para
alimentar uma tela que mostra 150 nós.** A janela (`CHAT_WINDOW = 150`) existia
desde antes, mas era aplicada só no FIM (`nodes.slice(hiddenCount)`), depois de
todo mundo já ter varrido tudo.

Nota de honestidade sobre os números: cada etapa foi medida no seu próprio A/B,
e o absoluto DERIVA entre processos (o JIT esquenta diferente). Por isso a
Etapa B mediu A/B **intercalado no mesmo processo** — rodar tudo-antes e depois
tudo-depois chegou a mostrar `buildNodes` oscilando 0,58 → 0,82 sem nenhuma
mudança de código. Comparar linhas de etapas diferentes desta tabela é
comparar réguas diferentes; o delta DENTRO de cada etapa é que vale.

## 2. A invariante (a causa de tudo)

> **A `key` de um nó é o id do item de MENOR índice que aquele nó cobre.**

`buildNodes` percorre `items` em ordem e, para cada trecho que vira um nó, usa
como `key` o id do PRIMEIRO item do trecho: o texto que abriu a bolha, a tool
que abriu o burst, o item que abriu o incidente, a `TaskCreate` que ancorou o
plano.

Dela saem dois corolários:

1. **As keys são monótonas** no índice dos itens.
2. **Tudo que um nó visível referencia está em `windowStartIndex(items,
   visible[0].key)` ou depois.**

O corolário 2 é a licença que a Etapa A usa para escopar as derivações a um
SUFIXO do fio. Sem ele, escopar é chute: um nó visível poderia citar um item
antes do começo da fatia, e o sintoma não seria lentidão, seria **dado faltando
na tela** (a hora do grupo some, o selo "não foi aberto" de um anexo some) —
silencioso e intermitente, o pior tipo.

**Por que é obrigatória, e não uma conveniência:** todo o ganho da frente vem
de trocar "varre o fio" por "varre a fatia". Se a key de um nó passar a ser
derivada de outro item do trecho (o último tool do burst, por exemplo), a
fatia calculada começa DEPOIS de itens que a tela ainda cita, e as derivações
escopadas devolvem menos do que a tela precisa.

**Onde ela é testada:** `messageNodes.chave.test.ts` — 400 fios adversariais
com semente, e para cada nó a cobertura é recuperada do que o nó CARREGA (marca
com o id dentro do texto de cada item de texto, ids das tools, `result` do
incidente), nunca reimplementando o fold. Três casos: a invariante nó a nó, a
monotonicidade das keys, e "nenhum item é coberto por dois nós".

Isso é a CAUSA. `threadWindow.test.ts` testa a CONSEQUÊNCIA (a fatia cobre o
que a janela mostra) e não substitui: com a key do nó de prosa trocada para o
último tool do segmento, `threadWindow.test.ts` seguiu **verde nos 18 casos** e
o teste de invariante falhou na primeira semente. Foi exatamente esse
experimento que justificou o arquivo novo.

**Pré-condições declaradas** (as duas em comentário no código, com teste):

- `id` de item é ÚNICO no fio (o reducer carimba `uid()`). `windowStartIndex`
  busca de trás para frente e devolveria a ocorrência mais RECENTE se houvesse
  repetição, começando a fatia depois do nó que a pediu.
- Um tool FILHO nasce depois do pai no fio. `withDescendants` é o único ponto
  do fold que faz um nó carregar item que veio depois dele; filho ANTES do pai
  faria o nó da raiz cobrir um item anterior à própria key.

## 3. As etapas

### P1 — reativa os dois `memo` inertes (7d83945)

`memo` de `MessageItem`/`ToolLine` estava escrito, documentado e sem efeito:
recebia props com identidade nova a cada token. `attachmentReadsByItem` passou
a indexar POR ITEM preservando referência, `reuseNodes` passou a devolver o nó
do frame anterior quando ele diz a mesma coisa, e `useStableHandler` fixou
`onStop`/`onRetry`.

| medida | antes | depois |
|---|---|---|
| nós assentados com identidade nova | 149/149 | 1/149 |
| `MessageItem` com prop nova | 25/25 | 0/25 |
| `ToolGroup` com `tools` novo | 113/113 | 0/113 |
| `buildToolForest` recomputado | 113/113 | 0/113 |

O 1/149 que sobra é a bolha viva, que mudou de verdade.

### P2 — pai e filho param de derivar o mesmo plano (9e1314d)

`deriveTaskPlans` rodava DUAS vezes por token (ChatPanel + MessageList, mesmo
array, mesmo frame; três com a aba Plano aberta). `taskPlansOf` memoiza por
IDENTIDADE do array num `WeakMap`.

| passe | antes | depois |
|---|---|---|
| planos + `findLast` (pai×filho) | 0,2404 | 0,1234 |
| TOTAL | 1,0619 | 0,9221 (-13,2%) |

### P3 — o reducer de token para de varrer o fio (026deff)

`text_delta` fazia `items.map(...)` para trocar UM item; agora acha a bolha viva
de trás para frente e substitui só o índice alvo, preservando a referência de
todos os outros (é disso que os `memo` do P1 vivem).

| passe | antes | depois |
|---|---|---|
| passe do reducer | 0,0288 | 0,0026 (-91%) |
| TOTAL (acumulado P2+P3) | 1,0280 | 0,8688 (-15,5%) |

Registro honesto do P3: o reducer era a ORIGEM da churn de identidade, não o
custo (2,8% do frame).

### Etapa A — as derivações param de varrer o fio para servir a janela (88ceee3)

Nasce `threadWindow.ts`, a ponte entre as duas contagens (a janela corta NÓS,
as derivações consomem ITENS). `tsForGroups` varre de trás para frente com
early-exit assim que achou as chaves que abrem os grupos visíveis;
`feedbackTextByResult(items, from)` começa no início do TURNO que contém a
janela (o acumulador zera em cada item do usuário);
`attachmentReadsByItem(..., from)` usa que a fatia é um SUFIXO.

| passe | antes | depois | delta |
|---|---|---|---|
| `tsById` | 0,1098 | 0,0163 | -85,2% |
| `feedbackTextByResult` | 0,0648 | 0,0231 | -64,3% |
| `attReads` | 0,0630 | 0,0228 | -63,8% |
| `windowStartIndex` (novo) | — | 0,0047 | novo |
| **TOTAL** | **0,8630** | **0,6886** | **-20,2%** |

Com "mostrar anteriores" clicado (janela = fio inteiro) nada regride: 0,8830 →
0,8266 (-6,4%). Na fatia de 150 nós: 571 itens varridos em vez de 1.885.

**Degradação honesta**: chave desconhecida volta para o fio INTEIRO (o custo de
hoje), nunca para uma fatia curta. Errar para menos aqui é dado sumindo da
tela, que é pior que lentidão.

### Etapa B — a dobra reconstrói só a faixa que o token mexeu (7975039)

`buildNodes` era 61% do que sobrou. Não vira um `map`: é uma DOBRA COM
VIZINHANÇA (um `text_delta` muda um item, mas o nó depende dos vizinhos).
Incremental aqui é reconstruir a FAIXA afetada e reaproveitar o prefixo que a
mudança comprovadamente não alcança — com `Restart` (pontos em que o segmento
está fechado), `firstDiff` por identidade e recuo até a raiz quando a sequência
de tools filhos mudou.

| cenário | antes | depois | delta |
|---|---|---|---|
| JANELA · `buildNodes` | 0,4257 | 0,0075 | -98,2% |
| JANELA · `reuseNodes` | 0,0492 | 0,0003 | -99,5% |
| JANELA · TOTAL | 0,7051 | 0,2234 | -68,3% |
| showAll · TOTAL | 0,8243 | 0,3401 | -58,7% |
| MISTO · TOTAL | 0,7046 | 0,2300 | -67,3% |

Piso honesto medido: com o 1º item do fio mudando a cada frame (faixa = fio
inteiro, que a store nunca produz), o passe custa **+9,3%** e o total +5,5% —
o preço do diff e da escrituração dos pontos de retomada.

A prova é de PROPRIEDADE (`messageNodes.incremental.test.ts`): fios e mutações
com semente, identidade PROFUNDA com a passada inteira em todo passo. Ela achou
os dois bugs que importavam (o `toolId` repetido, que agora degrada para o fio
inteiro; e o `min(start, diff - 1)`, porque a dobra lê UM item além do último
que consumiu).

## 4. O que sobrou (e por quê)

- **`firstDiff` é O(n) por frame e não escala.** Ele compara `prev.items[i] ===
  items[i]` desde o índice 0 até achar a divergência: num fio onde só o último
  item muda (o caso normal do streaming), isso é uma varredura do fio inteiro
  por token, mesmo que barata (comparação de ponteiro, sem alocação). O custo
  cresce linearmente com o fio e hoje some no ruído; num fio 10× maior ele vira
  o próximo gargalo. Fim honesto: só cai com o reducer entregando a dica ("o
  que mudou foi o índice k"), o que acopla store e render — trabalho de outra
  frente, não um `TODO` escondido aqui.
- **Planos (`taskPlansOf`) e `pendingDeferred` NÃO são escopados à janela, de
  propósito.** O escopo por sufixo é legítimo só para derivação cujo consumidor
  é o nó VISÍVEL. Não é o caso destas duas: o plano vivo mora acima do composer
  e depende do último turno do usuário (que pode estar fora da janela), os
  marcos de plano aparecem no transcript inteiro, e `pendingDeferred` alimenta
  o aviso do botão de parar, a linha viva e a contagem do diálogo de saída —
  responder "não há trabalho diferido" porque o item ficou fora da janela seria
  teatro de estado, não otimização. As duas já não são recalculadas duas vezes
  por frame (P2 para planos; `useMemo` por identidade do array para o
  diferido); o que sobra é a varredura O(N) por token, e ela só cai virando
  derivação incremental de verdade.
- **Depois da Etapa B ninguém remediu o share de cada passe.** As tabelas acima
  são as medições de cada etapa; o perfil do estado ATUAL não foi levantado.
  Quem for atacar o próximo gargalo mede primeiro.

## 5. Guardas da frente

- Zero mudança visual é requisito, não efeito colateral: nenhuma linha de JSX
  mudou em nenhuma das cinco etapas, e a Etapa B comparou os nós visíveis chave
  a chave nos quatro cenários.
- Toda função escopada **degrada para o fio inteiro** quando não reconhece a
  chave. Nunca para uma fatia curta.
- `MessageList.tsx` está congelado em **2792** linhas na baseline do ratchet
  (`scripts/lints/file-size-baseline.json`); crescer exige extrair, que foi o
  que a Etapa A fez ao criar `threadWindow.ts`.
- Medição A/B **intercalada no mesmo processo**, mediana de rodadas ímpares.
  Tudo-antes seguido de tudo-depois mede a deriva do JIT, não a mudança.
