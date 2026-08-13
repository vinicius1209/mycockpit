# Redesenho do Painel — 5 POCs visuais

> **Atualização de 13/08/2026**: chegaram `painel-d.html` (o Painel deixa de
> existir) e `painel-e.html` (o Painel vira retrospectiva), depois de o banco
> REAL do usuário ser consultado. A evidência de uso, a comparação das cinco
> direções e a recomendação final estão na seção
> [Depois da evidência de uso](#depois-da-evidência-de-uso-13082026) no fim
> deste arquivo. **Tudo que vem antes dela foi escrito sem esse dado** e segue
> valendo como descrição de A, B e C.

> Mocks estáticos (12/08/2026), **não** código do app. Abrir no browser:
> `painel-a.html` · `painel-b.html` · `painel-c.html`. Os três renderizam a
> MESMA cena com os MESMOS números (US$ 20,13 hoje ▼88% vs ontem, US$ 673,92 na
> semana, Codex 68% / Claude 32%, "Frota parada", as entregas com projeto e
> custo), tema claro e escuro, navegação A/B/C no topo e anotações ①…⑧ com
> legenda no rodapé. Tokens copiados de `app/src/index.css`; tipografia só
> 11/12/13/14 + as paradas hero 20/30 do `docs/STYLEGUIDE.md` §3.
>
> A e B têm um seletor **cheio · calmo** na barra do mock (a mesma tela nos dois
> estados). C mostra os dois estados empilhados no mesmo arquivo, porque a
> comparação entre eles É a tese dele.

## O problema

O Painel de hoje (`app/src/components/panel/MissionControl.tsx`), de cima pra
baixo: gasto do dia em 30px (o maior tipo da tela) → 4 caixas de métrica →
barra de custo por agente → 3 botões → Board (quase sempre vazio) → **"Nada
esperando você. Bom voo."** em 13px cinza no meio da página → Entregas →
Frota abaixo da dobra.

Feedback do usuário: *"nosso inbox está solto/perdido na tela inicial"* e
*"parece ter muita informação, precisa de revisão"*.

Diagnóstico, nas palavras do STYLEGUIDE §1: a tela **lidera com dinheiro e
sussurra a decisão**. Custo é feature central do produto, mas é contexto, não
manchete. Um painel que abre gritando gasto treina o usuário a ignorar o
painel. Os quatro sintomas concretos que as três direções atacam:

1. **Hierarquia invertida**: o hero de 30px é o custo; a fila de decisões é o
   6º bloco.
2. **Vazio sussurrado**: o estado mais comum (nada pendente) vira uma linha de
   13px, indistinguível de um item que não carregou.
3. **Métrica demais na primeira dobra**: 4 caixas + sparkline + barra por
   agente + legenda respondem uma pergunta que quase nunca é a da sessão.
4. **Blocos vazios ocupando espaço nobre**: Board com 3 colunas (duas vazias)
   entre as ações e a fila.

## Inventário: o que o Painel REALMENTE tem hoje

Os mocks só mostram dado que já existe no código. Fonte por bloco:

| Bloco | Origem no código | Mocks usam |
|---|---|---|
| Fila "Precisam de você" | `pendingDecisions(queue)`, tipos `pr` · `fusion` · `card` · `prd` · `proposal` (`lib/inbox.ts`) | PR com checks/±linhas/merge, disputa a julgar, card bloqueado com "parado há X min" |
| "Encontrados no projeto" | `foundDecisions(queue)` (planos lidos do `.claude/plans`), com idade e Adotar/Ignorar | linha de gaveta com contagem e idade |
| Trabalhos vivos | `liveRows` (turno · missão · disputa, cross-projeto) | "Em voo (2)" com tipo e idade |
| Board de intenção | `useCards` → 3 lanes (`BoardLane.tsx`), custo por card via `listCardCosts` | contagens por lane + o card em andamento |
| Entregas | `listRecentDeliveries(60)`, corte em 8 | 3 linhas + "ver as 12 da semana" |
| Custo | `ledgerWindows` (hoje/7d/30d), `dailySpend` 14 d, `costByAgent`, `ledgerTokens`, `CostAudit` | hoje, 7 d, sparkline 14 d, split por agente |
| Frota | `settings.detected` (versão, `auth`, `updateAvailable`), `limitedAgents`, sessões externas, próximas agendadas | rate limit, update, logado, terminal observado, agendada |
| Ações | `goNewWork("mission"|"fusion")`, `goNewFeature` | Nova missão · Nova disputa · Nova feature |

Nada nos mocks é feature nova. As duas únicas mudanças de *lugar* propostas
são: (a) as 4 caixas de métrica + auditoria por agente migram pra
**Configurações ▸ Uso e custo**; (b) o corte de listas fica **anunciado**
("e mais 7", "ver as 12 da semana"), como o Board já faz com `hiddenOlder`.

---

## A — "O que precisa de você primeiro"

**Tese.** A tela abre pela pergunta que ela existe pra responder. A fila de
decisões toma o topo e herda o hero de 30px que era do custo; o vazio dela é
uma afirmação calma com âncoras temporais verificáveis ("Nada esperando você.
Frota parada. Última entrega há 2 h, próxima agendada em 2 h 48 min"). Frota
viva logo abaixo, custo numa faixa de instrumento de uma linha, Board e
Entregas depois, Frota (detalhe) no rodapé ordenada por quem pede decisão.

**Resolve:** 1, 2 e 3 de frente. 4 parcialmente (o Board desce, mas continua
com 3 colunas).

**Sacrifica:** a leitura de custo periférica. Hoje o valor do dia é a primeira
coisa que o olho encontra; em A ele está no terço médio da página, em 13px
mono. Quem abre o app **pra ver quanto gastou** paga um scroll curto ou um
clique. Também aposta tudo numa fila que pode crescer: com 8 pendências, "Em
voo" e custo saem da primeira dobra (o corte/paginação da fila vira requisito,
não detalhe).

**Armadilha na implementação:** o hero de 30px do vazio não pode virar um
empty state decorativo. Ele só se sustenta porque diz dado real; se um dia a
"última entrega" ou a "próxima agendada" não existir, a frase encurta em vez
de inventar.

## B — "Painel de voo"

**Tese.** Uma linha de estado da frota no topo (38px de altura, 13px de tipo)
responde "rodando / esperando você / quebrado", e o resto são **cartões de
igual peso**, um por pergunta: Precisam de você · Em voo · Board · Custo e uso
· Entregas · Frota e agenda. Nenhum bloco tem tipo maior que outro; a
prioridade vem da linha de estado e da ordem de leitura. Cada cartão declara a
pergunta que responde e tem um ⌄ que o esconde (dismissal persistido, §5).

**Resolve:** 1 (a linha de estado assume a manchete e ela é estado, não
dinheiro), 3 (custo vira um cartão entre seis) e 4 (Board vira contagem por
lane + o item que está andando). Resolve 2 parcialmente: o vazio ganha um
cartão de tamanho fixo com frase afirmativa, mas continua do tamanho dos
vizinhos.

**Sacrifica:** o ranqueamento. Peso igual significa que uma fila com 3
decisões ocupa a mesma área que um cartão de Entregas que ninguém precisa ler
agora; a hierarquia inteira passa a depender de uma linha de 13px no topo.
É a direção que mais exige disciplina de copy nessa linha, e a que menos
perdoa um dia em que ela não tenha dado confiável. Também é a mais cara: 6
cartões com altura mínima ocupam mais tela que a lista de A.

**Armadilha na implementação:** cartão de igual peso convida a caixa vazia com
"0". Cartão sem conteúdo tem que dizer o estado em prosa curta ("Frota
parada."), nunca mostrar um zero grande, e o ⌄ precisa persistir de verdade
(§5 camada 4), senão vira decoração.

## C — "Zero estado"

**Tese.** O estado saudável é o comum, e a tela devia parecer com isso. O
Painel nasce quase vazio e calmo: linha de estado, o hero do vazio, as ações,
a linha de custo na base e uma gaveta de linhas silenciosas (Board, Entregas,
Encontrados) com a contagem real. Seção sem item **não renderiza** título nem
moldura. Conforme surgem decisões e trabalho, a tela cresce, e a ordem em que
os blocos entram é a ordem em que pedem você. O arquivo mostra os dois estados
empilhados, com os mesmos dados de fundo.

**Resolve:** 2 (o vazio vira a tela inteira, não uma linha), 4 (nada vazio é
renderizado, incluindo lanes do Board), 3 (só custo do dia + 7 d + sparkline
ficam) e 1 por consequência.

**Sacrifica:** a estabilidade espacial. É a direção em que a tela mais muda de
forma entre um boot e outro, e memória muscular ("Entregas fica aqui") é
justamente o que faz um app de uso diário ficar rápido. Também tem o custo mais
alto de honestidade: sem esqueleto, um bloco que aparece 800ms depois da
varredura parece que "pulou" na tela, e o usuário não sabe se a ausência é
"não tem" ou "ainda não carregou". A regra que resolve isso não é visual, é de
estado: a tela calma só é legítima **depois** da primeira varredura completar
(o `loaded` que o `MissionControl` já tem).

**Armadilha na implementação:** zero estado convida a esconder o que está
quebrado junto com o que está OK. CLI em rate limit e update pendente ficam
visíveis mesmo na tela calma (§5 camada 2: não-configurado esconde,
configurado-com-erro FICA). É a anotação ③ do mock.

---

## Decisões de estilo comuns às três (e por que)

- **O hero de 30px trocou de dono, não de existência.** A parada hero
  "métrica de painel" continua uma só na tela; ela só deixou de ser o custo.
- **Uma primária brass por superfície** (§8): só o item mais pronto da fila (o
  PR mergeable) é brass; os outros usam botão neutro. Três brass empilhados
  anulam a hierarquia que o bloco acabou de criar.
- **Nada de verde ambiente.** O ícone de PR verde e o dot de entrega verdes de
  hoje (`MissionControl.tsx`, `Dot tone="done"` e o `GitPullRequest`
  `text-st-success`) viram cinza nos mocks. Verde é marco/probe, não estado
  permanente (§2, e o item 4 do apêndice da auditoria).
- **Card bloqueado é âmbar, não vermelho.** Nada falhou nem foi destruído:
  alguém está esperando decisão. Com isso o recorte fica em duas cores de
  status (âmbar + azul do vivo), dentro do orçamento de tinta.
- **Corte anunciado**: "e mais 7 →", "ver as 12 da semana →". Lista cortada em
  silêncio é o começo de um número que ninguém confere.

## O que veio do agy (Gemini 3.6 Flash High) e o que foi descartado

Consulta rodada com `agy -p "<prompt>" --model gemini-3.6-flash-high` (o
`--output-format json` existe nesta versão, mas o texto bastou). Pedi 3
organizações distintas com justificativa, trade-off e armadilha, mais três
perguntas fechadas (o que cortar, qual escolher, como fazer um vazio
afirmativo).

**Aproveitado:**

- **A convergência.** Ele também escolheu a organização orientada ao inbox
  entre as três dele, pelo argumento de sessão curta ("abre pra destravar e
  fecha"). Isso não decidiu nada sozinho, mas tirou a direção A do campo do
  gosto.
- **A armadilha da fila sem teto**: inbox que cresce sem limite empurra o
  resto pra fora da tela. Virou o parágrafo de trade-off de A (com corte
  anunciado no lugar de rolagem interna, ver descarte abaixo).
- **A armadilha do feed cronológico**: se tudo vira um fluxo único ordenado por
  hora, decisão urgente afunda. Está no desenho de C, onde a ordem dos blocos é
  por quem pede você, nunca por timestamp.
- **O formato do vazio afirmativo**: mensagem clara + dados de apoio + as ações
  de criação logo abaixo, sem ilustração nem frase poética. É a espinha do
  hero de A e de C.
- **Mover as 4 métricas e a barra por agente pra Configurações ▸ Uso e custo.**
  Coincidiu com o brief e ficou.

**Descartado, com motivo:**

- **"Remover o Board totalmente da tela inicial"** (ele sugeriu uma aba
  "Projetos/Planejamento"). O board de intenção é cross-projeto por desenho
  (E1) e é onde o trabalho NASCE; tirá-lo do Painel exigiria inventar uma view
  que não existe. Os mocks rebaixam (contagem por lane em B, só a lane com
  trabalho em C, e depois do custo em A) em vez de exilar.
- **"Detalhes de CLI vão pra Configurações; a home só mostra alerta se
  quebrar"**. A primeira metade contraria a tese do app (a UI mostra o estado
  real da frota); a segunda é o que os mocks fazem de qualquer jeito. Ficou o
  meio-termo: linha compacta ordenada por quem pede decisão, saudável em cinza
  e sem badge.
- **Layout de 2 colunas 60/40 com rolagem em cada uma** (organização 2 dele).
  Em 900px úteis os cards de decisão viram texto espremido, e rolagem dupla na
  mesma página é exatamente o defeito que ele mesmo listou como armadilha.
- **"Custo do dia em brass sutil"**. Brass é gesto e foco (§2), nunca tinta de
  importância genérica. O custo nos três mocks é cinza mono tabular.
- **"Custo em 20px hero ao lado do status da frota"** (organização 2). Colocar
  a segunda maior parada tipográfica no custo recria o problema numa escala
  menor. Em B ele usa 20px **dentro do cartão de custo**, onde 20px é métrica
  de seção e compete só com o próprio cartão.
- **"Frota operando normalmente / sem bloqueios"** como copy do vazio. Na cena
  real a frota está PARADA; dizer "operando" é teatro (§7 honestidade), e
  "bloqueios" não é vocabulário canônico. Virou "Nada esperando você. Frota
  parada."
- **Rolagem interna no bloco do inbox** como remédio pro inbox grande.
  Preferimos corte anunciado, que é o padrão que o app já usa (`hiddenOlder`,
  `slice(0, 8)` das entregas). Área com scroll próprio esconde item de decisão,
  que é o oposto do que a tela quer.

## Recomendação

**A, com dois empréstimos: a linha de estado do B e a regra "seção vazia não
renderiza" do C.**

Por quê:

1. **O defeito é de hierarquia, e só A o inverte de frente.** B redistribui o
   peso (ninguém grita, mas ninguém chama também) e C ataca o vazio, que é
   metade do problema. A põe a decisão no topo e no maior tipo, que é
   literalmente o pedido do STYLEGUIDE §1.
2. **É a menor cirurgia no código real.** O `MissionControl` já calcula
   `pending`, `liveRows` e `windows`; A é reordenação de seções + a faixa de
   custo + mover 4 `Readout` e o `CostAudit` pra Configurações. B pede seis
   containers novos com estado de esconder persistido; C pede um contrato novo
   de "só renderiza depois do `loaded`" em todas as seções.
3. **O vazio de A é o de C.** A afirmação calma com âncoras temporais é a mesma
   nas duas; o que C adiciona é apagar o resto da tela junto, e é aí que ele
   perde estabilidade espacial sem ganhar decisão nenhuma.
4. **A linha de estado do B é boa demais pra ficar em B.** Uma linha de 13px
   dizendo "2 em voo · 3 esperando você · 1 CLI em rate limit" é resposta
   completa pra sessão de 5 segundos, custa 38px e degrada por largura (Orca
   §6). Em A ela entra acima do hero, sem disputar com ele.

O que **não** recomendo levar adiante: cartões de igual peso (B) como
organização geral do Painel, porque delegam a hierarquia inteira pra uma única
linha e encarecem a tela; e apagar seção vazia (C) sem antes acertar o gate do
`loaded`, senão a tela passa a mentir por omissão durante a varredura.

---

# Depois da evidência de uso (13/08/2026)

A, B e C foram desenhados olhando pro **código** do Painel: que blocos existem,
o que cada um calcula. Depois disso o banco real do único usuário foi
consultado, e ele conta uma história diferente da do código.

## A evidência

| Superfície | Uso real |
|---|---|
| Conversas | **16** |
| Entregas | **5** |
| Disputas | **2** |
| Aprendizados | **1** |
| Board (cards) | **0** |
| Agendado | **0** |
| Missões | **0** (a superfície está em **reconstrução** por outra frente) |
| Custo | **US$ 6.260 em 30 dias** |

Lido de frente: **a tela inicial de hoje é, em uso real, um Board vazio, um
botão "Nova missão" nunca clicado, um "Nova disputa" clicado duas vezes e um
"próxima agendada" que nunca teve o que dizer.** O produto mora na aba
Trabalho, onde estão as 16 conversas e quase todo o dinheiro.

Duas leituras importantes, e a segunda é desconfortável:

1. **O Board sai.** Zero card em 16 conversas não é "feature nova esperando
   descoberta", é uma resposta. E a intenção de trabalho já existe em três
   formatos que ele usa: abrir conversa, marcar entrega, escrever plano de voo.
   Decisão tomada; os mocks D e E já não têm Board.
2. **A fila de decisões, o herói de A, também não tem lastro medido.** Os tipos
   da fila (`inbox.ts`) são `pr` · `fusion` · `card` · `prd` · `proposal`.
   Cards: 0. Disputas: 2 em toda a vida do app. Ou seja: a cena de "3 esperando
   você" dos cinco mocks é **cenário**, não medição, e o estado normal da fila
   é o vazio. Isso não invalida A, mas muda o que A é: A não é "a tela que
   mostra 3 decisões", é "a tela que quase sempre diz *nada esperando você* em
   30px". Que é, literalmente, C.

**Ressalva registrada**: zero missão **não** é prova de feature morta. Missões
está em obras por outra frente; D mantém "Planos de voo" na sidebar e E não
toca nela. Nenhuma das duas direções corta Missões.

**Sobre os números dos mocks**: A, B, C e D usam a MESMA cena (US$ 20,13 hoje,
US$ 673,92 na semana, 3 pendências, 2 em voo), pra comparação justa. **E é a
exceção deliberada**: uma retrospectiva desenhada com número de cenário é
vaidade por definição, então ela usa só o banco medido (16 conversas, 5
entregas, 1 aprendizado, US$ 6.260 em 30 dias). Onde A e C dizem "ver as 12 da
semana", era cena.

## D — "O Painel não existe"

**Tese.** Decisão e trabalho são o mesmo gesto, e separá-los em duas abas cobra
um clique que não produz nada. A aba Painel **sai do switcher** (que hoje é
`Painel · Trabalho · Features` em `titleBarModes.ts` e passa a
`Trabalho · Features`). O Trabalho ganha um destino fixo na sidebar,
**Resumo**, que ocupa a área do fio quando nenhuma conversa está aberta: o que
precisa de você, o que está rodando, uma faixa fina de custo. Escolher uma
conversa troca o resumo pelo fio, no mesmo retângulo, sem trocar de aba.

O arquivo mostra os dois estados empilhados, porque a transição entre eles É a
tese.

**Por que o slot existe**: a sidebar já tem entradas globais no topo
(`ScheduledEntry` e `FlightPlansEntry` em `Sidebar.tsx`, "Agendado" e "Planos
de voo"). "Resumo" entra como irmão delas. D não inventa um padrão de
navegação, usa um que está no código.

**Resolve:** o problema que a evidência levanta, que é *manter uma aba inteira
cujo estado normal é o vazio*. Resolve 1, 2, 3 e 4 do diagnóstico original por
herança de A e C, e resolve o clique morto entre decidir e trabalhar.

**Sacrifica**, e a lista é longa de propósito:

- **Custo do dia e estado da frota perdem superfície permanente.** Fora do
  Resumo, o gasto de hoje deixa de existir na tela: a pill do topo mede
  **janela do plano** em porcentagem (`UsagePill.tsx`), não dinheiro. Quem
  vigia US$ 6.260/mês o dia inteiro passa a depender de ⌘1.
- **A fila some quando você abre uma conversa.** Com o fio na tela, as outras
  decisões só existem como contador âmbar no item Resumo e no sino que já
  existe (`InboxBell.tsx`). Lembrar, sim; comparar duas decisões lado a lado,
  não.
- **Depende de uma regra de boot.** D só funciona se o app **abrir no Resumo**,
  sempre. Se algum dia ele voltar a restaurar a última conversa (o
  comportamento natural de todo app de chat), o Resumo deixa de aparecer e a
  direção inteira vira letra morta, em silêncio.
- **É a única das cinco que é porta de mão única.** Reordenar blocos (A, B, C)
  se desfaz num commit. Remover uma aba desfaz memória muscular, e memória
  muscular não tem rollback.

## E — "Retrospectiva"

**Tese.** O Painel para de disputar urgência e vira **auditoria**: poucos
números, muito ar, e um mapa de onde o dinheiro queimou. A urgência sai da tela
e vira uma **faixa persistente** no topo do app, visível em qualquer aba.

O conteúdo, tudo derivado do que já existe no ledger: gasto de 30 dias como
hero, três derivados em 20px (US$ 208,67 por dia · US$ 1.252 por entrega
registrada · US$ 47,20 no lado descartado das disputas), o mapa de calor de 14
dias × hora pintando **US$ por hora**, custo por agente cruzado com entregas
por agente, e as 5 entregas listadas inteiras.

**A crítica embutida, e onde ela foi resolvida.** Uma tela que responde "o que
eu já fiz" não responde "o que precisa de mim". Em E isso vira uma faixa âmbar
de 30px logo abaixo da barra do topo, com contagem, idade da mais antiga e
estado da frota, mais um botão que leva pra fila no Trabalho. **O preço está
declarado no mock**: 30px cobrados em toda tela do app, inclusive nas 16
conversas, onde área vertical é o produto. Sem a faixa, E não é uma direção,
é uma tela de estatística com um inbox perdido.

**Resolve:** a pergunta que nenhuma das outras quatro responde bem. Nenhum
mock de A a D diz onde foram os US$ 6.260, e US$ 6.260/mês é o maior fato deste
produto. E também é a única que mostra o **denominador**: US$ 76,30 dos
US$ 6.260 (1,2%) estão atribuídos a uma entrega registrada, o que diagnostica o
registro de entregas, não o trabalho.

**Sacrifica:**

- **A tela inicial deixa de pedir decisão**, que é a tese do produto (§1). Como
  home, E é o defeito original com uma janela maior: hoje a tela lidera com o
  dinheiro de hoje, em E ela lidera com o dinheiro de 30 dias.
- **Cobra 30px de toda superfície do app**, pra sempre, pra devolver o inbox
  que ela mesma expulsou.
- **Precisa de dado que o app ainda não tem em quantidade.** Com 5 entregas em
  30 dias, "entregas por semana" não é gráfico, é ruído amostral com cara de
  tendência. O mock troca o gráfico pela lista das 5 e escreve a régua: gráfico
  só acima de ~20 pontos no período.
- **Convida vaidade.** Todo tile a mais nessa tela é um convite pra medir
  esforço em vez de resultado. O mock recusa tokens absolutos, contagem de
  conversas, contagem de projetos e "1 aprendizado" como tiles, e não inventa
  sequência de dias (o app não mede isso).

## As cinco, contra a evidência

| | Manchete da tela | Com o uso REAL medido | Sacrifica | Tamanho da cirurgia |
|---|---|---|---|---|
| **A** | Fila de decisões em 30px | Quase sempre "Nada esperando você" em 30px | Custo periférico; fila sem teto | Pequena (reordenar + faixa de custo) |
| **B** | Linha de estado + 6 cartões iguais | Metade dos cartões nasce vazia (Board 0, Agendado 0) | O ranqueamento inteiro | Grande (6 containers + dismissal persistido) |
| **C** | O vazio calmo | É o retrato mais fiel do estado normal | Estabilidade espacial | Média (gate do `loaded` em toda seção) |
| **D** | Não existe tela; existe destino | Elimina a aba cujo estado normal é o vazio | Vigilância de custo e frota; regra de boot; porta de mão única | Média (remover modo + item de sidebar) |
| **E** | US$ 6.260 em 30 dias | Responde o maior fato do produto | A tese do app na home; 30px em todas as abas | Grande (view nova + faixa global + derivados) |

## Recomendação final entre as cinco

**D, com a faixa de E como acessório condicional, e o conteúdo de E como
destino, nunca como home.** Concretamente:

1. **Remover a aba Painel do switcher.** Ela fica `Trabalho · Features`.
2. **"Resumo" como destino fixo na sidebar** (⌘1), irmão de "Planos de voo" e
   "Agendado", com a hierarquia de A (decisão no topo, no maior tipo) e a regra
   de C (seção sem item não renderiza título nem moldura). Sem Board.
3. **Boot abre no Resumo**, com a última conversa marcada `última` no topo da
   lista. Essa regra é parte da direção, não detalhe de implementação.
4. **A faixa âmbar de E entra**, mas seguindo a regra de C: **só existe quando
   tem conteúdo**. Com a fila vazia (o estado normal, pela evidência) ela não
   ocupa pixel nenhum, e o custo de 30px só é cobrado quando 30px foram
   ganhos.
5. **O conteúdo de E vira um destino de consulta** (Configurações ▸ Uso e
   custo, alcançável também pelo "uso e custo →" da faixa do Resumo), com o
   mapa de calor e os três derivados. Retrospectiva é consulta, não sessão.

O argumento decisivo não é "um clique a menos". É este: **o problema de "ver o
estado da frota enquanto trabalho" não é resolvido nem por A nem por D.** Hoje
o Painel some no instante em que você troca pra Trabalho, exatamente como o
Resumo de D some quando você abre uma conversa. A visibilidade permanente só
existe em elemento de chrome (faixa, sino, tray), nunca em aba. Se a aba não
compra visibilidade e o estado normal do conteúdo dela é o vazio, **a aba não
está se pagando**. É por isso que D é a direção certa e A é o meio-termo caro:
A arruma a hierarquia de uma tela que a evidência diz que quase não tem
conteúdo.

E é a melhor **tela** das cinco e a pior **home** das cinco. O conteúdo dela é
o único que responde a pergunta de US$ 6.260, e por isso ele tem que existir.
Mas colocá-lo na abertura é reescrever a tese do produto: um cockpit que abre
mostrando o mês passado não pede a próxima decisão, ele explica a anterior.

### O argumento mais forte CONTRA a minha recomendação

**Missões está em reconstrução, e D remove o chão embaixo dela.** Quando o modo
missão voltar, ele vai querer uma superfície cross-projeto pra planos de voo em
execução, gates esperando aprovação e rotas paradas. Hoje esse lugar é o
Painel. Se o Painel for removido agora, essa superfície vai ter que renascer
dentro do Trabalho, e a frente que está reconstruindo Missões vai encontrar a
arquitetura de navegação diferente no meio do caminho. Somando com o fato de D
ser a única porta de mão única das cinco, existe uma leitura defensável de
sequência: **fazer A agora** (que é reversível, pequena, e já resolve
hierarquia, vazio e excesso de métrica), **esperar Missões assentar**, e só
então avaliar se a aba ainda se paga. Se essa leitura vencer, ela vence por
argumento de **timing**, não por argumento de desenho: nada nela contradiz que
a aba não compra visibilidade.

Um segundo contra, menor mas real: a regra de boot de D ("abre sempre no
Resumo") é frágil por natureza social. É o tipo de regra que uma frente futura
relaxa em nome de conveniência ("restaurar a última conversa é mais rápido"), e
quando relaxar, o Resumo some sem que ninguém perceba, porque nada quebra.
Se D for adiante, essa regra precisa de teste, não de comentário.

## Segunda opinião do agy (Gemini 3.6 Flash High) sobre D e E

Consulta rodada com `agy -p "<prompt>" --model gemini-3.6-flash-high`, pedindo
pra ESTRESSAR as duas direções em sete frentes (o que se perde ao dissolver o
Painel; o desenho que salva D; onde vai parar o "precisa de mim" em E; se
retrospectiva é honesta ou vaidade; quais métricas são vaidade; se heatmap é
teatro; veredito entre as cinco).

**Aproveitado, e o que mudou por causa disso:**

- **"O estado zero não pode ser a ausência de seleção."** O argumento é que
  "deselecionar" não é um gesto que exista em app de conversa: clicar de novo
  no item ativo não desmarca, então depois do primeiro clique da sessão o
  resumo morreria pra sempre. **Isso reescreveu D**: em vez de um estado vazio
  do Trabalho, o resumo virou um **destino fixo** na sidebar (anotação ② do
  mock). É a contribuição mais valiosa da consulta.
- **A armadilha da restauração de estado**: app de produtividade restaura a
  última conversa ao abrir, e nesse caso o resumo nunca apareceria. Virou a
  regra de boot explícita (anotação ④) e o segundo contra da recomendação.
- **A cegueira multithread**: resolvida a decisão 1, as outras duas somem da
  tela. Virou a anotação ⑨ e o contador âmbar no item Resumo, com a regra de
  não contar duas vezes.
- **"Tray sozinho é inviável"** (tela cheia e segundo monitor engolem o menu
  bar do macOS). Fechou a opção (a) do brief e empurrou E pra faixa persistente
  (anotação ① de E).
- **"Retrospectiva é honesta como auditoria financeira, desonesta como
  produtividade."** É o enquadramento inteiro de E: sem placar, sem esforço,
  com dinheiro e denominador.
- **Custo por entrega e custo do lado descartado das disputas** como os dois
  recortes que valem a tela. Viraram dois dos três derivados de 20px.
- **"Heatmap de atividade é teatro; pintando US$ por hora vira detector de
  vazamento."** Adotado inteiro, com a frase dele sobre a célula quente às 23h
  ser um alerta, não uma medalha. No mock isso virou o episódio das 01h às 04h
  de ontem, que de quebra **explica** o pico que o sparkline de A, B e C
  desenha sem explicação.
- **Tokens absolutos, contagem de projetos e contagem de conversas como
  vaidade.** Saíram dos tiles (anotação ⑨ de E).

**Descartado, com motivo:**

- **O nome "Cockpit"** pro destino fixo. Cockpit é a metáfora do produto
  inteiro (§1), não o nome de uma tela; usar como rótulo de item de sidebar
  gasta a palavra. Ficou **Resumo**, que diz o que é.
- **"Kill switch" no rodapé do resumo.** O app tem duas ações distintas e
  não intercambiáveis, **Parar** (mata processo gerenciado) e **Interromper
  turno** (§7), e nenhuma delas é botão de lista de leitura. A ação mora na
  conversa.
- **Proporções fixas de viewport** (fila 70%, frota 30%). Proporção fixa é o
  oposto da regra de C: com fila vazia, 70% da tela viraria vazio decorado. As
  seções crescem com o conteúdo.
- **"Badge de contagem é ruído inútil."** Discordo em parte, e a parte que ele
  acerta já está no mock: badge sem destino obriga a caçar em 16 conversas.
  Mas o badge no item Resumo **tem** destino, e é o único lugar onde a fila
  continua existindo com o fio aberto. Ficou, com a regra de só aparecer quando
  o Resumo não está na tela.
- **A conta "US$ 134,78 por entrega" (673,92 ÷ 5).** Mistura janela de 7 dias
  com o total de entregas de sempre. Refeita com denominador coerente
  (6.260 ÷ 5 = US$ 1.252 em 30 dias) e com a ressalva de método impressa em
  11px ao lado do número.
- **"Aprendizados é métrica morta, deletar."** Deletei o **tile**, não o dado:
  virou linha de gaveta com o número real. Contagem baixa não é feature morta,
  e o app deixar de contar é como ele esquecer que a feature existe.
- **"Taxa de desperdício" incluindo "conversas sem entrega".** Chamar de
  desperdício toda conversa que não virou entrega registrada é um julgamento
  falso: 98,8% do gasto está aí, e boa parte virou código. Ficou só a metade
  demonstrável (o lado descartado da disputa), e o resto virou a linha do 1,2%,
  que acusa o **denominador** e não o trabalho.
- **"Detalhe de CLI não é conteúdo de estado zero de chat"** (crítica dele a
  D). No Frota o estado da frota É conteúdo de primeira classe (§1), então a
  premissa não vale aqui. O que a crítica acerta é outra coisa, e está
  registrada: em D esse estado passa a existir só no Resumo.
- **"Retrospectiva pra Configurações ▸ Custos e Auditoria"**, no veredito dele.
  Adotado no espírito (não é home), recusado como enterro: US$ 6.260/mês não é
  item de configuração, e o destino precisa ser alcançável pela navegação, não
  só por um modal.

**Onde ele não tinha como acertar**, e o mock corrigiu com o código na mão: o
switcher tem exatamente três modos (`titleBarModes.ts`), então "remover o
Painel" é uma linha de dado, não uma refatoração de navegação; a sidebar já tem
entradas globais (`ScheduledEntry`, `FlightPlansEntry`), então o slot do
"Resumo" já existe; a `UsagePill` mede **janela do plano**, não dinheiro, então
D realmente perde a vigilância de custo (ele supôs que o custo do dia já morava
na barra do topo); e o `InboxBell` já existe, então a faixa de E é um reforço
de um sinal que o app tem, não a criação de um inbox.

**A convergência dele com a minha recomendação** (remover o Painel, destino
fixo na sidebar, retrospectiva rebaixada) tirou a direção do campo do gosto,
mas não é prova: ele e eu compartilhamos o mesmo viés de gostar de arquitetura
enxuta, e nenhum dos dois vai ter memória muscular quebrada quando a aba
sumir.
