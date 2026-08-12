# Despoluição do fio — 3 POCs visuais

> Mocks estáticos (12/08/2026), NÃO código do app. Abrir no browser:
> `fio-despoluicao-a.html` · `-b.html` · `-c.html`. Os três renderizam a MESMA
> cena (verificações concluídas → vite dev rodando em background com 4 shells →
> grupo com 1 falha entre 6 ok → linha viva → composer), com as strings reais
> dos prints dos builds 186-187. Cada mock tem tema claro/escuro
> (prefers-color-scheme + toggle), navegação A/B/C no topo e anotações ①…⑥
> com legenda no rodapé. Todos respeitam as 6 regras do Warp
> (`background-status-plan.md` B1'): cronômetro tabular irmão do texto animado,
> nome trunca antes do número, gerúndio no vivo / pretérito no marco, contagem
> agregada, sem status inventado.

## O diagnóstico que os três atacam

1. Rótulo repetido (cabeçalho do grupo E primeira linha filha, mesma string).
2. Estado repetido ("Uma ação falhou" no grupo e no filho).
3. Explosão de cor num recorte só (azul + verde + vermelho + âmbar + cinzas).
4. Caminhos longos truncados ocupando espaço sem informar.
5. Metadados técnicos misturados com conteúdo.

## A — Tinta mínima

**Tese:** a poluição é de TINTA, não de informação. Tudo continua visível, mas
quase tudo em cinza (Xirp-like): cor só onde carrega decisão — vermelho na
falha, latão na ação primária. Check verde vira ponto neutro (sucesso é o caso
comum). Rótulo e estado aparecem UMA vez; o filho mostra só o delta (porta,
duração, motivo). Metadados em sussurro mono à direita.

**Resolve:** 1, 2, 3, 5. **Não resolve:** altura — todas as linhas continuam
no fio; uma conversa longa continua longa.

**Sacrifica:** a leitura periférica por cor ("tem algo verde, passou") e o
grito dos estados de risco: "Liberado" e "Parar" ficam discretos, e isso é
debatível num app que executa comando na máquina do usuário.

## B — Recolhido por padrão

**Tese:** o que terminou vira UMA linha ("✓ 2 verificações concluídas · 3s");
só o VIVO fica aberto (o vite dev com os 4 shells atuais). Grupo com falha não
recolhe quieto: o resumo nomeia a culpada ("1 de 7 falhou · Gerar PDF (iPhone
SE)") e abre mostrando SÓ a linha falhada; as 6 ok viram stub "6 concluídas ·
mostrar". Pretérito e tempo congelado no resumo, gerúndio na linha viva.

**Resolve:** 1, 2, 4, 5 e a altura (o passado custa 1 linha por grupo). A cor
sobra naturalmente porque há menos linhas pintadas — 3 melhora sem virar tese.

**Sacrifica:** um clique para auditar detalhe; e o recolher automático ao
terminar precisa de cuidado pra não "puxar o tapete" de quem estava lendo o
grupo aberto (o app já tem o precedente do `manuallyToggled`).

## C — Trilho

**Tese:** o fio é só história (prosa + marcos de 1 linha no pretérito); tudo
que respira mora num trilho de UMA linha colado no composer, estilo pill bar
do Warp: dots + "está trabalhando…" + pill com nome truncado e contagem
agregada ("4 shells") + cronômetro. Expande pra detalhe e ação (Parar, abrir,
ver saída). O trilho absorve a linha viva do rodapé — vira o dono ÚNICO do
"agora" — e esvazia sozinho quando nada roda. Falha NÃO vai pro trilho
(estado vivo não persiste, Warp R3/R6): vira marco vermelho no fio.

**Resolve:** 1, 2, 3, 4, 5 no fio (fica o mais limpo dos três). 

**Sacrifica:** contexto — o detalhe do que roda fica longe da prosa que o
explica (o usuário lê "subindo o servidor" e o servidor está em outra
superfície); é a maior obra das três (superfície nova + sincronização
fio↔trilho); e reabre o risco que o B2.2 matou nos builds 181/182: duas
superfícies falando do mesmo trabalho — aqui mitigado fazendo o trilho
SUBSTITUIR a linha viva, nunca coexistir com ela.

## Recomendação

**B, com a paleta de A.** Razões:

1. B é o único que ataca a causa estrutural das duas repetições do print: o
   resumo do grupo passa a SER a informação, e o filho só existe expandido —
   não há como a mesma string aparecer duas vezes empilhada.
2. Resolve o custo de altura (a reclamação de "poluído" é tanto tinta quanto
   volume), e mantém a visão do que roda em background: o vivo é o único
   aberto, então ele se destaca por contraste estrutural, não por mais cor.
3. É o menor delta sobre o código real: `ToolGroup` já colapsa, já tem
   `summarizeToolGroup`, `manuallyToggled` e auto-collapse — B é
   principalmente mudar defaults + o stub das ok. C exige superfície nova e
   contraria o B2.2 (dono único do agora) a menos que substitua a linha viva.
4. A paleta de A entra como segunda passada barata (checks cinza, metadados em
   sussurro, cor só em falha/vivo/ação primária), mantendo âmbar no "Liberado"
   e vermelho no "Parar" — o único ponto onde A vai longe demais.

C fica registrado como evolução futura se a demanda por "mission control"
crescer (muitos trabalhos longos simultâneos); a pill bar dele conversa com o
que o tray popover já faz.

## Implementado (12/08/2026) — B com a paleta de A

Entregue em `MessageList.tsx` + `toolview.ts` (`describeToolGroup`) +
`toolGroupDisclosure.ts` (decisões puras, testadas). O que virou código:

- **Resumo é a informação**: cabeçalho do grupo com contagem, duração TOTAL
  congelada (1º nascimento → última atividade; nunca "0s", regra do Warp) e,
  na falha, a culpada nomeada ("1 de 7 falhou · Gerar PDF (iPhone SE)"; com
  várias, "3 de 7 falharam"; grupo de uma ação, "Executar testes falhou").
- **Regra EXATA do recolhimento** (guarda "não puxar o tapete"), em
  `toolGroupDisclosure.ts`: (1) grupo que nasce assentado nasce recolhido —
  falha assentada nasce ABERTA mostrando só a linha falhada; (2) vivo fica
  aberto; (3) na transição vivo→assentado recolhe SÓ se ninguém togglou
  manualmente, não houve falha, e o leitor não está desancorado do fundo com o
  grupo visível na viewport (fora da viewport, ou seguindo o fundo com
  stick-to-bottom, recolhe). Ao recolher um grupo ACIMA da viewport, o
  scrollTop é compensado pela altura perdida no mesmo frame (layout effect) —
  sem isso o texto de quem lê abaixo saltaria (WKWebView não tem
  overflow-anchor e o autoscroll do ChatPanel só cobre quem está no fundo).
  Limite conhecido: grupo parcialmente visível no topo conta como "na
  viewport" e não recolhe (não há salto a compensar).
- **Stub das concluídas**: no grupo falhado, as ok viram "N concluídas ·
  mostrar" (contagem plana, inclui descendentes); em voo, o histórico ok segue
  recolhendo a partir de 2 como antes — e a falha assentada fica FORA do stub
  em todos os níveis, o que elimina o "Uma ação falhou" duplicado dos prints.
  A culpada rende ANTES do stub mesmo quando cronologicamente veio depois das
  ok (como no mock ③): quem expandiu quer a falha; a linha do tempo completa
  volta ao abrir o stub.
- **Rótulo uma vez**: filho de nível 1 cuja string repetiria o cabeçalho mostra
  só o delta (no diferido, "iniciado/concluiu/interrompido"; nos demais, o
  estado). Linha falhada NUNCA dedupa — ela é a evidência e mantém o nome.
- **Paleta A**: check de sucesso e dots concluídos em cinza; contagens de diff
  (+N −N) em sussurro mono; cor restante só em falha (vermelho), vivo
  (st-running) e ação sensível (brass). Exceções deliberadas mantidas:
  "Liberado" âmbar e "Parar" vermelho (decisão de produto), e as cores DENTRO
  do diff aberto (evidência) intactas.
- **Fronteira da paleta (explícita)**: três verdes `st-success` continuam no
  MessageList de propósito — a caption "concluído" do fim de turno
  (TurnTelemetry), o "Regra salva" do feedback e o check de "Plano concluído"
  (PlanMilestone). São marcos de TURNO/PLANO/gesto do usuário: no máximo um
  por turno, fora do alvo do diagnóstico (a repetição de tinta era por linha
  de ferramenta, N vezes por burst). Se uma próxima passada da paleta for
  além dos grupos de atividade, começa por esses três.
- **Não implementado de propósito**: relógio vivo no cabeçalho do grupo (o
  mock ② mostra "12min 40s" ticando) — o "agora" continua com dono único, a
  linha viva do rodapé (B2.2); o grupo vivo mantém só o "atividade há Xs" que
  já existia.
