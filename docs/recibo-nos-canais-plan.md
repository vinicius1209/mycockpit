# O recibo de turno nos outros canais (plano)

> Status: **R1 ✅ · R2 ✅ (21/08/2026)** · R3 pendente. Fecha o que a ADR-055
> deixou explicitamente de fora: o recibo (M2 do estudo do Maestri) chega na
> notificação nativa e no sino, mas não na tray nem no Companion.

## Correção do diagnóstico anterior

Eu disse que "nenhum dos dois consome o feed de fim de turno". Meio certo, e a
metade errada muda o desenho:

- **A tray JÁ TEM um `lastRun`** (`TraySnapshot.last_run`: `name`, `status`,
  `at`). Só que ele é o último **AGENDAMENTO**, montado em `App.tsx:460` a
  partir da tabela `schedules` — não o último turno de conversa. Ou seja: existe
  um vizinho com nome quase igual, e isso é risco de leitura ("última execução"
  significando duas coisas diferentes).
- **O cliente do Companion é NOSSO** (`app/src-tauri/companion/index.html` +
  `core.js`, servido ao celular). Então dá pra fechar as duas pontas — não é
  caso de "adicionar campo e torcer para o cliente renderizar".

## A boa notícia: o estado durável já existe

O recibo não precisa de armazenamento novo. Ele já é gravado no feed do sino
como `body` do item `run_done`/`run_error` (`store/notifications.ts`), que é
persistido. Tray e Companion são SNAPSHOTS — e o feed é exatamente a fonte de
verdade que um snapshot precisa.

Isso derruba a parte cara do trabalho: não há evento novo, nem canal novo, nem
sincronização. É leitura.

## A restrição que desenha o resto

Recibo só existe para turno de **background**, e só quando o helper responde
dentro de 3s (ADR-055). Então os dois canais vão mostrar recibo em PARTE dos
turnos, e precisam degradar sem parecer quebrados.

Isso alinha melhor do que parece:

- **Tray**: você olha a bandeja justamente quando a janela não está na frente —
  que é quando o recibo é gerado.
- **Companion**: você está no celular, longe da máquina. Idem.

Onde NÃO alinha, e o plano assume: turno de primeiro plano não gera recibo, e
nesses casos a linha cai no que já existe ("turno concluído").

## Fases

### R1 ✅ — Tray: a última CONVERSA, ao lado da última automação
- `TraySnapshot` ganha `last_turn: { title, receipt, ok, at } | null`, montado do
  feed do sino (o item `run_done`/`run_error` mais recente com `convId`).
- **Nomear os dois de forma que não se confundam.** Hoje `lastRun` é
  agendamento; a linha nova é conversa. Se a tray mostrar "última execução" duas
  vezes com significados diferentes, o ganho vira ruído — a copy precisa dizer
  *automação* × *conversa*, não "run".
- Sem recibo, mostra o desfecho como hoje. Nunca linha vazia.

### R2 ✅ — Companion: o turno recém-terminado
- `CompanionSnapshot` ganha `lastTurns: CompanionTurn[]` (os N mais recentes,
  com `receipt` opcional). Plural porque no celular você chega DEPOIS: um só
  responde "e agora?", vários respondem "o que aconteceu enquanto eu não estava".
- Render em `companion/core.js`, na mesma gramática das seções que já existem.
- **Reusar o corte de `CompanionDelivery`**: ele já resolve projeto+agente+custo
  por entrega; a seção nova é irmã, não uma segunda invenção.

### R3 — Uma frase, um lugar (só se R1/R2 provarem que vale)
Hoje a frase do desfecho é montada em `receiptBody` (nativa) e de novo no sino,
e R1/R2 seriam a terceira e a quarta. Se as quatro divergirem em copy, o mesmo
turno passa a ser descrito de quatro jeitos. Extrair um formatador puro DEPOIS
de ver os quatro em uso — antes disso é abstração no escuro.

## O que NÃO fazer

- **Não** gerar recibo para turno de primeiro plano só para encher os canais: a
  chamada custa, e a ADR-055 já decidiu isso com motivo.
- **Não** criar um quinto canal. A ADR-013 fixou 3 canais e nenhum silencioso;
  isto é enriquecer os que existem, não somar mais um.
- **Não** deixar a tray com duas linhas chamadas "última execução".
- **Não** persistir nada novo. Se a resposta parecer "precisa de tabela", o
  desenho está errado — o feed já é a memória.

## Definition of done

- Tray mostra o último turno da CONVERSA, distinguível da última automação.
- Companion mostra os turnos recentes, com recibo quando existe.
- Turno sem recibo aparece com o desfecho de sempre, sem buraco na tela.
- Nenhuma tabela nova, nenhum evento novo.
- `tsc` 0, suíte verde, 6 guardas.

## Como ficou o R1 (21/08/2026)

`lib/lastTurn.ts` — puro, 8 testes. A peneira que importa é o `convId`: o feed
carrega desfecho de MISSÃO e notícia de ferramenta no mesmo balde, e um "último
turno" mostrando missão concluída estaria dizendo outra coisa com a mesma frase.

**Onde ele aparece foi a decisão melhor do que a planejada.** A empty state da
tray dizia *"Inicie uma tarefa ou aguarde a próxima automação"* — instrução
genérica, zero informação. Com nada em voo, o útil não é instrução: é **o que
acabou de acontecer**. Então o recibo tomou esse lugar (título, frase, "há N
min"), e a instrução volta só quando não há turno nenhum.

Sem recibo, cai no desfecho ("turno concluído"/"turno falhou") — nunca linha
vazia. E a última AUTOMAÇÃO segue sendo o pontinho da linha de agendamentos,
com nome próprio: os dois nunca dividem a mesma frase.

**Custo estrutural:** o `App.tsx` estava acima do teto e a montagem do snapshot
saiu para `lib/traySnapshot.ts` — recorte fechado, porque tudo ali lê
`getState()` e não depende de props, hooks nem árvore de render. O App ficou com
o QUANDO (deps + relógio de minuto); o QUE a bandeja mostra mora no módulo.

## Como ficou o R2 (21/08/2026)

`turnosRecentes(feed, max = 5)` na mesma `lib/lastTurn.ts` do R1, e a peneira
ganhou um segundo furo: além do `convId` (que já separava turno de desfecho de
MISSÃO), agora exige `projectId`. O motivo é do celular, não do desktop — lá o
aparelho não tem como resolver de que projeto veio a linha, e "Revisar o parser"
sem projeto ao lado é uma frase que não ajuda ninguém que está longe da máquina.
Turno sem projeto resolvível não entra em vez de entrar mudo.

Cinco, não um: no celular você chega DEPOIS. Um só responde "e agora?"; a lista
responde "o que aconteceu enquanto eu não estava" — que é a pergunta que se faz
ao pegar o telefone.

O cliente (`companion/index.html`) segue a gramática de `renderDeliveries()`
inteira, inclusive o dedupe por assinatura: sem recibo, cai em "turno
concluído"/"turno falhou". A seção entrou ENTRE "Em execução" e "Entregas
recentes", e a ordem de render passou a espelhar o DOM — precisa de você → agora
→ acabou → entregue. O mock de desenvolvimento ganhou os três casos (com recibo,
sem recibo, falhou) pra que o degradado seja visível sem precisar de máquina.

**Custo estrutural, e ele tinha um recado.** `lib/companion.ts` (1288 linhas,
788 acima do teto) estourou a baseline com ~26 linhas. A fronteira do corte não
foi escolhida: o arquivo já a tinha desenhado com os próprios banners de seção.
Saiu `lib/companionAction.ts` — a metade de ESCRITA (o que o celular manda
fazer, e o veredito fail-closed de cada ação); ficou em `companion.ts` a metade
de LEITURA (montar o snapshot). Que a divisão tenha caído exatamente em
leitura × escrita, sem ninguém planejar, é o sinal de que o arquivo já eram dois.

O ping de "conversa mudou" foi o único fio atravessado: as duas metades pingam,
e o throttle é estado de módulo (`Map` de timers). Deixá-lo em qualquer lado
fecharia um ciclo de import — a mesma armadilha que já custou um
`window is not defined` em teste aqui. Virou `lib/companionPing.ts`, sem dono
entre os dois.
