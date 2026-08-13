# Redesenho do Painel — 3 POCs visuais

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
