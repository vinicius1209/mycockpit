# STYLEGUIDE — MyCockpit (Frota)

> O doc canônico de design do app. Congela as regras da despoluição (ADR-037,
> background-status B1'/B2, lições Orca/Xirp) antes que divirjam. Em regra de
> USO, este guia manda; `docs/design-system.md` segue como referência de tokens
> e atmosfera, e `app/src/index.css` é a fonte de verdade dos valores. Onde os
> três discordarem: STYLEGUIDE > index.css > design-system.md.
>
> Toda regra aqui é DECIDÍVEL: números, listas fechadas e colunas "não use
> para". Um agent aplica sem julgamento estético. Exceção não listada não
> existe; exceção nova exige ADR em `docs/decisions.md` + linha aqui.

## 0. Por que este guia é rígido

Uma crítica externa disse que este guia "sacrifica expressividade em prol do
controle rígido de ruído". Está certa na descrição, e é exatamente a escolha
que fizemos, não um efeito colateral.

O motivo é a condição de produção desta UI: ela é editada por MUITOS agentes em
PARALELO, em sessões que não se falam, que não viram as telas umas das outras e
que não vão herdar o gosto de ninguém. Nesse regime, regra que exige julgamento
estético ("use a cor com parcimônia", "prefira hierarquia sutil") não produz uma
interpretação: produz vinte, todas defensáveis, todas divergentes, e a
divergência só aparece semanas depois, junta, como incoerência que ninguém
consegue atribuir a um autor. Foi assim que a escala tipográfica chegou a 19
tamanhos em uso e o verde virou decoração ambiente em 26 arquivos (§9). Nenhum
desses desvios foi mau gosto de alguém, foram vinte leituras razoáveis da mesma
frase vaga.

Então o guia troca expressividade por decidibilidade de propósito: **número
fechado, lista fechada, coluna "não use para"**. É uma perda real, e a perda é
o preço. O que ela compra: qualquer agente, sem contexto de conversa nenhuma,
aplica a mesma regra e chega no mesmo pixel; e uma guarda automática (§10) pode
cobrar a regra, o que julgamento estético jamais permitiria.

Duas consequências que valem mais que a preferência de quem estiver editando:

- **A saída pra uma regra apertada demais é ADR, nunca exceção local.** Se a
  regra impede algo que a tela precisa, isso é um bug do guia e se conserta no
  guia (`docs/decisions.md` + linha aqui), pra que a próxima sessão herde a
  decisão. Contornar em silêncio devolve o problema pro modo antigo.
- **Este guia não é gosto, é contrato.** Quem discordar dele está fazendo uma
  crítica potencialmente boa, e o lugar dela é o ADR. Sem este parágrafo, a
  próxima crítica boa parece teimosia nossa, e a resposta a ela vira uma
  discussão de estética em vez do que ela deveria ser: uma proposta de mudar o
  contrato.

## 1. A tese

**O Frota é um cockpit de decisão: a UI mostra o estado real da frota e pede a
próxima decisão — tudo que não é estado nem decisão recua.**

Consequências (as três dobradiças de todo o resto do guia):

1. **Cinza é informação.** O caso comum é sucesso; sucesso não ganha tinta. Se
   está tudo cinza, está tudo bem — e o usuário aprende a confiar nisso. Cor é
   um orçamento gasto só onde carrega decisão ou estado excepcional (Xirp).
2. **O passado recolhe, o vivo respira, a decisão pede na medida.** Grupo
   concluído vira uma linha; só o que roda fica aberto; falha nunca se esconde
   (ADR-037). Estado de risco num app que executa comando na máquina do
   usuário não fica discreto: "Liberado" é âmbar, "Parar" é vermelho.
3. **Utilidade no Trabalho > espetáculo.** Produto de compra única (Mac/Linux),
   sem métrica de engajamento pra alimentar. Nada de atividade inventada,
   número teatral ou animação que não comunique estado real.

## 2. Papéis de cor

Vocabulário fechado. Toda cor nova entra por token em `index.css` (par
claro+escuro) e por linha nesta tabela — nunca hex cru em componente.

| Papel | Tokens | Use para | **NÃO use para** |
|---|---|---|---|
| **Cinza** (saudável/neutro) | `foreground`, `muted-foreground`, `faint`, `border`, `sel`, `sel-hover` | Texto, sucesso comum (check de ferramenta, dot concluído), metadado em sussurro mono, **item selecionado em lista/árvore (`sel`)**, tudo que está simplesmente OK | Suavizar erro ou atenção ("cinza escuro" não é vermelho educado); esconder falha |
| **Verde** (marco raro) | `st-success` | No fio: marco de TURNO/PLANO/gesto — máx. **1 por turno** (caption "concluído", "Plano concluído", "Regra salva", ADR-037). Fora do fio: check "probe passou" em Configurações/Onboarding (verde exige probe, `SettingsDialog.tsx:249`) | Sucesso por linha de ferramenta; estado ambiente permanente (badge/dot "ok" que fica na tela); identidade visual de agent; texto corrido |
| **Âmbar** (precisa de você / risco autorizado) | `st-warning` (= `st-queued`) | Fila, gate, aviso que pede decisão, e o modo "Liberado" (risco autorizado fica visível) | Qualquer coisa que não seja decisão pendente, fila, gate ou risco autorizado. Seleção não é âmbar **nem brass**: seleção não é cor (ADR-043). Também não é progresso normal nem substituto do vermelho em falha real |
| **Vermelho** (falha + destruição) | `st-error`, `destructive` | Falha consumada (marco vermelho, linha culpada) e ação destrutiva ("Parar", excluir, revogar) | Caminho de saída (Cancelar/fechar/voltar é ghost, sem cor); ênfase; aviso não-fatal (âmbar) |
| **Azul** (vivo) | `st-running` | O que roda AGORA: pulse do dot, esteira de telemetria, linha viva | Qualquer coisa parada; link; decoração |
| **Brass** (gesto) | `brass`, `brass-soft`, `ring` (= `brass`) | Ação primária/sensível, foco (`--ring`), marca | **Marcar item selecionado em lista, árvore ou aba** (isso é preenchimento neutro + peso + pip, sem tinta — ADR-043); texto pequeno sobre a superfície de seleção no tema claro (3.56:1 < AA, regra S3.6); ícone ilustrativo/empty state; medidor saudável; tinta de "importância" genérica |
| **Cores de diff/git** | `hljs-addition/deletion`, `git-open`, `git-merged` | SÓ dentro do domínio git: `+N −N`, linhas de diff abertas (evidência), estado de PR do GitHub | Qualquer semântica fora de git; sucesso/erro geral |
| **Identidade de agent** (categórica) | `brass` (Claude), `st-running` (Codex), `id-violet` (Antigravity) | Cor de série em gráfico/legenda de custo por agente | Verde e vermelho (colidem com status); pintar estado com a cor da identidade |

Regras de aplicação:

- **SELEÇÃO NÃO É COR. Uma receita só, no app inteiro** (ADR-043):
  **preenchimento neutro `--sel` + peso 500 + pip neutro de 3px no gutter**
  (x=5px da superfície). Nenhuma tinta de status, nenhuma barra de acento,
  nenhum sublinhado colorido, nenhum ícone tingido por estar ativo. Hover é
  `--sel-hover` (~metade da opacidade: hover é convite, seleção é fato) e o
  texto do item selecionado é `foreground` (S3.6).
  - **Por que a regra existe, medido**: o âmbar fazia dois trabalhos, marcar
    seleção e significar perigo. Em OKLCH no tema escuro, `--brass` `#e4a862`
    (seleção) e `--st-queued` `#d99138` (perigo) estão a **1,2° de matiz**
    (H 69,1 × 67,9), separados só por **6,0 de luminosidade** (L 77,4 × 71,4),
    num traço de 2,5px. No tema claro (`#a9742b` × `#c1861f`) são **4,1°** e a
    relação **INVERTE**: lá o perigo é o mais CLARO (ΔL +6,3), aqui é o mais
    escuro. Não havia nem regra consistente a aprender. Num app cuja doutrina é
    aprovação humana, a tinta de "isto executa sem pedir" não pode ser prima da
    tinta de "esta linha está selecionada".
  - **Sem gutter, sem pip.** O pip é o marcador do GUTTER de lista/árvore. Numa
    tira horizontal de abas não existe gutter, então o que sobra da receita é
    **preenchimento + peso** (`ContextPanel`/`contextPanelChrome.tsx`: aba ativa
    é `bg-sel` + `foreground`). Pip em aba seria um marcador sem coluna pra
    morar; sublinhado colorido continua proibido.
  - **Exceção fechada: controle segmentado** (o comutador da barra superior e a
    linha de Execução) não é lista; segue em E1 (`bg-card` + `--shadow-sm`),
    como já é. E o "Liberado" âmbar do segmentado de Execução continua onde
    está, porque é risco, não seleção. (Aba DENTRO de cartão não pode usar essa
    receita: cartão sobre cartão é elevação aninhada, daí ela usar `--sel`.)
  - **Divergência datada, não acidental** (§0): a receita vale hoje na árvore da
    sidebar (projeto, conversa, feature SDD, entradas globais) **e no painel
    direito** (abas Contexto/Alterações/Plano, migradas na Fase 2 do ADR-043).
    Os demais sítios de brass-como-ativo (`FlightPlansView`, `SddView`,
    `ScheduledView`, `LearningSection`, `FusionBoard`, `MissionPlanCanvas`,
    `InteractionHost`, `RichSelect`…) ainda usam a gramática velha e migram por
    superfície tocada. Quem tocar numa dessas telas migra ela; ninguém adiciona
    brass-como-ativo novo.
- **Identidade de motor não carrega estado.** A marca do agent na árvore
  (`AgentMark`) é permanente e responde só "qual motor é este". Estado do turno
  mora no slot direito (§6), nunca grudado na marca: numa linha de lista,
  identidade e estado disputando o mesmo pixel fazem perder de vista se aquilo
  é QUEM ou COMO ESTÁ. A marca distingue por **logo/silhueta**; cor categórica
  por agent (`brass`/`st-running`/`id-violet`) segue restrita a série de
  gráfico e legenda, como a tabela acima manda.
- **Alias de token é explícito ou não existe.** `--ring` **é** `--brass` e
  `--st-idle` **é** `--faint`; os dois estão escritos como `var(...)` em
  `index.css`, não como o hex repetido. Repetir o valor era duplicata por
  acidente: os dois pares divergiriam em silêncio na primeira passada de cor, e
  o app passaria a ter dois cinzas de "ocioso" sem ninguém decidir isso.
- **Orçamento de tinta por recorte**: num viewport de uma superfície, fora de
  cinza + brass, no máximo **2** cores de status simultâneas. Se um layout
  pede 3, algo que devia ser cinza está pintado (o diagnóstico do ADR-037).
- **Medidores** (anel de contexto, barras de uso, quota): **cinza < 60% ·
  âmbar 60–80% · vermelho ≥ 80%**. A partir de 80% o medidor deixa de ser
  mudo: o número entra como texto ao lado (padrão do anel que grita).
  Medidor saudável NUNCA é brass nem verde. A régua é UMA e é código:
  `meterTone`/`METER_TEXT`/`METER_FILL` em `lib/meter.ts` (o `usageTone` do
  medidor de plano delega pra lá). Medidor novo importa, não recalcula.
- **Valor absoluto (sem teto natural) é CINZA até o usuário dar um teto.**
  Percentual tem 100% pra todo mundo; US$, MB e contagem não têm. Escolher o
  valor em que o número vira âmbar/vermelho seria opinião nossa disfarçada de
  medição (US$ 5 é troco num refactor de 12h e é caro num teste de prompt).
  Então: cinza sempre; com teto definido pelo USUÁRIO, o absoluto vira
  percentual daquele teto e cai na régua acima. É `absoluteTone` em
  `lib/meter.ts`; o custo da sessão (`PresenceBar.tsx`) é o primeiro caso, com
  o teto em Configurações ▸ Uso e custo (`sessionCostLimit`). **Custo não é
  gesto: nunca brass** (era, até 14/08/2026).
- **Estado ambiente é cinza.** Dot/badge que fica na tela representando "a
  última vez deu certo" é cinza; verde é transição (marco), não decoração
  permanente.
- **Modo de RISCO tem sinal ambiente; STATUS não.** Rótulo estático vira papel
  de parede: você para de ver o que está sempre ali. Então o modo que executa
  sem pedir ("Liberado") acende uma MOLDURA na área de conteúdo (ring âmbar de
  1px, `ring-inset`, sem animação, `pointer-events-none` — `CLIMATE_FRAME_CLASS`
  em `lib/climate.ts`). Rodando/concluído/falhou NÃO ganham moldura: já têm
  lugar no fio e na linha viva, e moldura que qualquer estado acende deixa de
  significar. A moldura tem **um dono só**, e o dono é o risco autorizado.
  - **Autolimitado**: só o modo perigoso acende. Não existe clima de "Só lê"
    nem de "Pede" — sinal que acende sempre não é sinal.
  - **Colisão com o âmbar de DECISÃO**: decisão ganha. Com pedido pendente na
    conversa ativa, o clima recolhe (`riskClimateOn`) — o âmbar da tela precisa
    ser lido como "responde aqui". O modo segue DITO na linha de Execução
    (segmented âmbar + triângulo), que é a fonte autoritativa; o clima é
    lembrete, não é a verdade.
  - **Colisão com o vermelho de FALHA**: falha não apaga o clima. Falha é
    conteúdo (matiz próprio, dentro do fio) e o modo continua perigoso depois
    dela; apagar a moldura ali mentiria sobre o próximo turno. Planos diferentes
    (moldura × conteúdo), e o orçamento de tinta segue em 2 cores.
  - **Escopo**: é da CONVERSA ATIVA, por herança do projeto dela (a permissão é
    do projeto; ver `ExecutionRow.tsx`). Conversa de outro projeto na mesma
    janela não contamina a moldura.
- **Verde não identifica agent.** Cor de identidade não pode colidir com o
  vocabulário de status.
- Diferença deliberada vs Orca: lá `--primary` é cinza e nada grita; aqui
  aprovação humana é doutrina, então **"Liberado" âmbar e "Parar" vermelho são
  exceções fixas** — não as apague numa passada de despoluição.

## 3. Tipografia

Duas famílias, e só: **Geist** (UI e prosa) e **Geist Mono** (código, caminho,
etiqueta técnica, número). O display serif do design-system nunca embarcou
(`--font-display` aponta pra Geist, `index.css:49`); serif só volta por ADR.

**Escala fechada — 4 tamanhos de corpo:**

| px | Papel | Exemplos |
|---|---|---|
| **11** | Etiqueta e metadado: `.label-mono`, sussurro mono, contadores, timestamps | duração, `+N −N`, badges |
| **12** | Secundário denso: linhas de sidebar, tabelas densas, tooltips | lista de conversas |
| **13** | Corpo de UI: linhas de painel, botões, forms, títulos de card | padrão quando em dúvida |
| **14** | Prosa de leitura: mensagens do chat, markdown, descrições longas | `Markdown.tsx:178` |

**Exceção hero (declarada e fechada — 3 paradas, todas com papel único):**

| px | Papel | Hoje |
|---|---|---|
| **20** | Título de view / métrica de seção | `SddView.tsx:679`, `MissionControl.tsx:123` (derivado) e `:327` (título da view) |
| **30** | Métrica de painel (custo, frota) | `CostAudit.tsx:118`, `MissionControl.tsx:355` |
| **38** | Saudação do estado vazio | `ChatPanel.tsx:1296` |

Regras decidíveis:

- Meio-pixel é proibido (`11.5`, `12.5`, `10.5`, `9.5` não existem na escala).
- Abaixo de 11 não existe; entre 14 e 20 não existe; ênfase acima de 14 se faz
  com **peso** (`font-medium`/`semibold`), não com tamanho.
- Classes de tamanho do Tailwind (`text-xs`, `text-sm`, …) só dentro de
  `components/ui/` (primitives shadcn); componente do app usa px da escala.
- **`tabular-nums` em todo número que muda em vida** (cronômetro, custo,
  contadores, percentuais) — e número métrico é `font-mono`.
- Etiqueta de instrumento é a classe `.label-mono` (`index.css:253`), não
  mono+uppercase+tracking à mão.
- **Caixa-alta com tracking é roupa de RÓTULO, nunca de CONTROLE.** Título de
  seção (`AJUSTES`, `DOUTRINA`, `MISSÕES`) se LÊ e usa `.label-mono`; aba,
  botão e chip se CLICAM e vão em caixa normal. Vestir os dois igual achata a
  hierarquia da tela (não se distingue navegação de conteúdo), e o custo é
  medido, não estético: a tira de abas do painel direito mede **353,6px** em
  caixa-alta com `tracking-[0.08em]` e **298,9px** sem (−15%) — era isso que
  cortava "PLANO" em "PL" no painel padrão (build 206).
- **Rótulo de controle degrada por LARGURA, nunca por decreto.** Quando a tira
  não cabe, o rótulo cede pro ícone por **container query** medida contra a
  largura real do contêiner (`TabBtn` em `contextPanelChrome.tsx`, `@min-[…]`),
  com `title`/`aria-label` no botão — nunca ícone-só fixo, que transforma um
  rótulo lido em um enigma decorado. Número que muda sozinho (contador) fica
  visível nos dois modos: esconder rótulo é economia de espaço, esconder dado
  é perda de informação.
- Mono nunca tem ligadura (`index.css:449` — regra global, não repita local).

**Mapa de migração** (o que existe → o alvo; aplicar por superfície tocada,
nunca em big-bang):

| Hoje | Alvo |
|---|---|
| 9 / 9.5 / 10 / 10.5 | 11 |
| 11.5 | 12 |
| 12.5 | 13 |
| 13.5 / 15 / 16 / 17 | 14 (título usa peso) |
| 19 | 20 |
| 34 | 30 |
| `text-xs` | 12 · `text-sm` → 13 (fora de `ui/`) |

## 4. Elevação

**Três níveis. Não adicione um quarto.**

| Nível | Receita | Onde |
|---|---|---|
| **E0 — plano** | fundo + hairline `--border` | listas, linhas do fio, painéis laterais (`--rail`) — a faixa de status é E0 **sem** hairline e **sem** fundo próprio: ela é o piso da janela |
| **E1 — cartão** | `bg-card` + `--shadow-sm` (+ `--lift` opcional) | segmented ativo, cards de painel, pills, **painel direito** (`ContextPanel`) |
| **E2 — flutuante** | `--shadow-pop` | popover, dialog, dropdown, composer, tray, lightbox |

- Focus ring (`--ring` brass) e halos de estado
  (`0 0 0 3px var(--brass-soft)` etc.) são FOCO, não elevação — podem somar-se
  a qualquer nível.
- `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl` são proibidos em
  componente do app; primitives em `components/ui/` que ainda os carregam
  (shadcn cru) migram pra `--shadow-pop` quando tocados.
- Profundidade vem de hairline + véu, não de sombra pesada.
- **A proibição de cartão-em-cartão é de BORDA aninhada, não de raio**
  (ADR-043): superfície que se separa por **cor + raio, sem hairline**, não
  conta como cartão para esta regra. É o que deixa o painel direito ser E1 com
  o composer em E2 lá dentro. E ela fica **mais** forte, não menos: como o
  painel virou superfície, nada lá dentro tem borda própria (nem divisor, nem
  chip contornado, nem a barra sticky do `DiffPanel`, que ocluí com `bg-card`).
- **Hairline de largura total só termina em ARESTA RETA** (ADR-043). Superfície
  com raio R tem `padding-inline ≥ R`. Numa janela de canto arredondado (o raio
  real do macOS é **10px**, `lib/climate.ts`), faixa full-bleed com `border-t` e
  fundo próprio é proibida: a reta morre no meio do arco, o retângulo de fundo é
  decepado, e o olho lê "recorte". Quem separa é o **inset do conteúdo** (8px na
  faixa de status, `AppShell.tsx`), e a faixa passa a ser o piso da janela.
- **Divisor é último recurso.** Seções de um mesmo painel se separam por
  **proximidade assimétrica: 24px acima do título, 8px abaixo** (razão 3:1) —
  `Section` em `components/layout/contextPanelChrome.tsx` é a implementação, e
  painel novo importa em vez de reinventar. Hairline entre seções só sobrevive
  onde muda a **propriedade** do conteúdo (lista de dados → zona de ação, como
  a barra sticky do `DiffPanel`), nunca onde muda só o assunto. `<Separator />`
  como irmão direto de seção de painel é o padrão que isto proíbe: eram 7 no
  `ContextPanel`, todos correndo de parede a parede enquanto o conteúdo
  respirava 20px.

## 5. As quatro camadas de esconder

Regra de disclosure do app inteiro (absorvida do Orca, agora nossa):

1. **Capability ausente some com o toggle.** Motor sem a capability não mostra
   o item NEM o controle de ligar (nada de toggle morto). A decisão vem do
   registry, nunca de nome de agent (ex.: compactar/resume em
   `ChatPanel.tsx:452,729`).
2. **Não-configurado esconde; configurado-com-erro FICA.** Feature que o
   usuário nunca ligou não ocupa tela; feature que ele ligou e quebrou fica
   visível com o erro dito ("Servidor fora do ar…",
   `CompanionSettings.tsx:217`) — senão a UI tremula e mente.
3. **CTA só depois do estado assentar.** Botão/aviso que depende de probe ou
   snapshot só aparece quando a leitura terminou; check verde exige probe real
   (`SettingsDialog.tsx:249`). Nunca CTA piscando enquanto carrega.
4. **Dismissal é persistido.** O que o usuário dispensou não volta no próximo
   boot (`dismissed` em `db.ts:1091`, fila do inbox em `inbox.ts:120`). E
   dispensa nunca é aprovação disfarçada: dismiss de permissão nega
   (fail-closed, `interaction.ts:134`).

## 6. Movimento e tempo

As regras do Warp (background-status B1', validadas contra o código deles) +
proporcionalidade do Orca:

- **Número que tica é IRMÃO do animado, nunca filho** (R2): cronômetro/custo
  fora do elemento com shimmer/pulse, senão a animação reseta a cada tick.
- **Cronômetro estável** (R1): segundos inteiros enquanto roda; duração exata
  congelada só no fim; **nunca "0s"** (antes de 1s não mostra nada). No web é
  `tabular-nums` + largura mínima + `shrink-0` (B2.1).
- **Quem cede é o NOME, nunca o tempo** (R5): rótulo trunca (no texto E no
  CSS, `store/chat.ts:204`) antes de empurrar o cronômetro.
- **Gerúndio no vivo, pretérito no marco** (R4): a linha viva fala "subindo o
  servidor…"; o fio registra "servidor subiu · 3s" com tempo congelado.
- **Agregada + detalhe** (R5): N trabalhos viram "N trabalhos em background ·
  <mais recente>" (`deferredLiveLine`, `store/chat.ts:232`); nome atrás de
  nome empilhado é proibido. Detalhe mora numa superfície só (Fio Vivo).
- **Dono único do agora** (B2.2/ADR-037): a linha viva do rodapé é a ÚNICA
  superfície com relógio vivo; grupo vivo mostra no máximo "atividade há Xs".
  Dois relógios narrando o mesmo agora foi o bug dos builds 181/182.
- **Sem status confiável, não inventa** (R6): sem dado → some o sinal, fica o
  espaço reservado (layout não desalinha); "não sei" degrada pro bucket
  pessimista, nunca pra sucesso; estado vivo não é persistido (replay/restart
  marca interrompido/órfão).
- **Slot da linha de conversa** (ADR-043): a linha da sidebar tem um **slot
  direito de 36px com dono único**, que responde uma pergunta só ("quando?"),
  em ordem fechada: **`pede > rodando > falhou > tempo relativo`**. A decisão é
  `slotEstado`/`fmtQuando` em `components/layout/conversationWhen.ts`; quem
  precisar do slot importa, não reimplementa.
  - **Tempo relativo por um ticker ÚNICO de 60s** para a lista inteira
    (`lib/minuteTick.ts`, padrão do `lib/watchdog.ts`), nunca um por linha:
    40 conversas não viram 40 assinaturas de relógio pra responder a mesma
    pergunta.
  - **Precisão que degrada**: `agora · 9m · 1h · 3d`, e data (`12/08`) a partir
    de 7 dias, porque "34d" é ruído fingindo precisão. **Nunca segundos**: a
    linha viva do composer segue dona do agora.
  - **Sem carimbo, o slot cala** e o espaço fica reservado (a coluna não dança).
- **Movimento é pra VIVO, e só pro que termina sozinho.** "Rodando" na sidebar é
  uma esteira azul de 22×2px porque é evento em curso e o único estado da lista
  que acaba por conta própria; ponto azul parado ali seria indistinguível de
  ponto azul esquecido. Pela mesma régua, a moldura do modo Liberado NÃO pulsa
  (condição permanente) e a falha NÃO pulsa (já aconteceu). Duas condições
  inegociáveis pra qualquer movimento assim: `prefers-reduced-motion` degrada
  pra indicador **estático e visível** (não pra ausência de sinal), e a animação
  vive presa à PRESENÇA do elemento (CSS), nunca a um timer — assim ela morre
  junto com o estado, inclusive quando o turno morre por erro, cancelamento ou
  fechamento do app. Esteira que sobrevive ao fim do turno é número parado
  vestido de vivo.
- **Feedback proporcional à duração**: 0–100ms → nada; até 1s → só `disabled`
  (pré-reservando a largura do controle, sem trocar o rótulo); 1–3s →
  spinner; 3s+ → estágios nomeados (o que está acontecendo agora).
- Durações vêm dos tokens (`--dur-fast` 120ms · `--dur` 200ms · `--dur-slow`
  320ms); `prefers-reduced-motion` desliga pulse/reveal/esteira sempre
  (`index.css:238,368`).

## 7. Copy

pt-BR, voz direta, minúscula técnica nos metadados.

- **Honestidade**: nunca implicar que o app agiu, observou ou sabe algo sem
  estado real por trás. "Rodando" falso é proibido; contagem sem fonte única é
  proibida; o aviso diz o preço da ação ("interrompe o turno completo e o
  trabalho em background morre junto", `MessageList.tsx:511`).
- **Tempo verbal**: gerúndio só no que está vivo; pretérito no marco. Nunca
  pretérito em coisa que ainda roda nem gerúndio em coisa que acabou.
- **Caminho de saída nunca é destrutivo**: Cancelar/fechar/voltar é ghost, sem
  cor; vermelho fica pra ação que destrói (`confirm({ danger })`,
  `lib/confirm.tsx`). O default de um dialog de escape é "continuar", não
  "descartar".
- **Sem travessão "—" em prosa de UI** (vírgula, ponto ou parênteses; "·" e
  "→" ok). Única forma tolerada: "—" sozinho como glifo de valor ausente numa
  célula (`SettingsDialog.tsx:362`).
- **Vocabulário canônico** (as palavras do produto; não inventar sinônimo):
  - **Frota** — o nome do app; **frota** — o conjunto de agents/trabalhos.
  - **turno** — uma rodada de execução (prompt → resultado).
  - **fio** — a timeline da conversa; **marco** — evento consumado de 1 linha
    no fio; **linha viva** — a faixa do rodapé, dona do agora; **Fio Vivo** —
    o detalhe da execução em background.
  - **trabalho em background** — trabalho diferido vivo fora do turno.
  - **projeto** e **conversa** — as unidades de organização.
  - **Especialista / piloto / convidado / volante** — personas; um pilota por
    vez; "Retomar o volante" devolve o comando.
  - **missão / fase / gate / rota** — o modo missão e os planos de voo.
  - **Só lê / Pede / Liberado** — os três modos de permissão
    (`lib/permission.ts`); "Liberado" nunca vira "yolo" na UI.
  - **Parar** — mata processo gerenciado; **Interromper turno** — para o turno
    do agent. Não trocar um pelo outro.
  - **despachar** — enviar trabalho pra frota (sempre por gesto humano).

## 8. Rubrica de review de tela

Formato de saída pra revisores (humanos ou agents) avaliando uma superfície.
Sempre nos DOIS temas (claro e escuro). Output:

```
Tela: <nome> · Estado: <vazio | vivo | falha | assentado>
Top 3 fixes:
  1. <maior desvio, com file:line>
  2. …
  3. …
Checklist:
  [ ] Cor: orçamento respeitado (≤2 cores de status no recorte fora de
      cinza+brass); sucesso comum em cinza; tabela do §2 sem violação
  [ ] Tipografia: só 11/12/13/14 (+hero declarada); tabular-nums nos números
      que mudam; ênfase por peso, não por tamanho
  [ ] Elevação: só E0/E1/E2; nenhum shadow-md/lg/2xl novo
  [ ] Disclosure progressiva: resumo É a informação; detalhe a 1 clique;
      falha nunca recolhida; 4 camadas de esconder (§5) aplicadas
  [ ] Hierarquia de ação: no máx. 1 ação primária por superfície; saída em
      ghost; destrutiva em vermelho SÓ se destrói
  [ ] Densidade: linhas nas réguas (projeto ~40px, conversa ~34px, grid 4px);
      denso nas laterais, respirável no centro
  [ ] Cards-em-cards: BORDA aninhada é proibida (borda com raio dentro de
      borda com raio). Separar por cor + raio, sem hairline, é permitido (§4);
      dentro de uma superfície assim, divisor só por mudança de propriedade
  [ ] Alinhamento: números de coluna à direita e alinhados; nada fora do
      grid de 4px; largura pré-reservada pro que muda
  [ ] Movimento/tempo: regras do §6 (cronômetro, gerúndio/pretérito, dono
      único do agora, sem status inventado)
  [ ] Copy: §7 (honestidade, vocabulário canônico, sem travessão em prosa)
  [ ] Botão direito: §11 (nenhum menu do motor; menu do app pela primitiva
      única; nenhum item que não faz; campo de texto ganha do container)
Veredito: aprovado | aprovado com ressalvas | reprovado
```

Regra do Top 3: sempre exatamente três, ranqueados por visibilidade (quanto
tempo o usuário passa olhando aquilo), cada um com file:line e a regra deste
guia que viola. Achou mais de três? Os demais viram lista curta abaixo do
veredito. Achou menos? Diga "sem desvio" no slot, não invente.

## 9. Apêndice — auditoria (12/08/2026) e a passada que a fechou

Os 10 maiores desvios do app REAL contra este guia, ranqueados por
visibilidade. **A passada de correção rodou em 12/08/2026 e fechou os 10.**
Status abaixo, com o que sobrou de propósito.

1. ✅ **Escala tipográfica estilhaçada** — eram 19 tamanhos distintos em uso,
   com os meio-pixel dominando (`11.5`, `12.5`, `10.5`, `9.5`). Migrados pelo
   mapa do §3, por área (chat · laterais · Configurações · painel/missões).
   Hoje o app usa **só 11/12/13/14 + 20/30/38**, e `text-xs`/`text-sm` só
   sobrevive dentro de `components/ui/`, como o §3 permite. Onde o override
   caía sobre `.label-mono` (que já é 11px), a classe saiu em vez de repetir
   o valor.
   **Efeito colateral tratado**: o badge de estágio da `Sidebar.tsx` deu o
   maior salto (9.5 → 11px) num `shrink-0` ao lado de um título `truncate`, e
   na sidebar no mínimo (190px) "IMPLEMENTAÇÃO" comia o título. A saída NÃO foi
   voltar o tamanho (a escala é lei) nem inventar um rótulo curto (§7): caiu o
   `uppercase`+`tracking-wide` feito à mão, que o §3 já proibia. Sentence case
   custa ~74px contra ~92px em caixa-alta, menos do que o badge ocupava antes
   da migração.
2. ✅ **Anel de contexto fora da regra de medidor** — a régua virou decisão
   pura e compartilhada em `app/src/lib/meter.ts` (`meterTone`, `meterIsLoud`,
   `METER_TEXT`, `METER_FILL`, com teste em `meter.test.ts`). O `ContextRing`
   consome de lá (saudável deixou de ser brass; o "grita com número" desceu de
   90 pra 80) e o `usageTone` do medidor de plano delega pro mesmo módulo. O
   limiar de OFERECER compactar (`offersCompactAction`, 70%) é comportamento e
   NÃO foi tocado.
   ⚠️ **Aqui a passada NÃO foi neutra, de propósito**: o anel passou a gritar
   com número em 80% (era 90) e a ficar âmbar em 60% (era 70). É o item 2 da
   auditoria sendo cumprido — a régua de medidor do §2 é a régua, e o incidente
   que a motivou foi justamente o contexto bater 100% sem ninguém avisar. Quem
   olhar o diff e achar "mudou comportamento numa passada de estilo": mudou,
   e este parágrafo é o registro.
3. ✅ **"Parar" com duas tintas** — o stop do composer virou
   `variant="destructive"` (`ComposerParts.tsx`), igualando o do fio.
4. ✅ **Verde como estado ambiente** — viraram cinza: `StatusDot.success`,
   badge de estágio "done" da sidebar, dot da última execução no tray, dot de
   motor saudável no Mission Control, "ok" do histórico do Agendado, badge
   "concluída" das missões e o `StageBadge` do ContextPanel. **Sobrou verde de
   propósito** (e deve continuar): probe real em Configurações/Onboarding
   (doutrina "verde exige probe"), marco de turno/plano no fio (ADR-037),
   `+N` e linhas de adição do domínio git. Restam ~49 usos de `st-success`,
   quase todos nessas três famílias; a triagem fina de check por linha de
   ferramenta (`TaskChecklist`, `Markdown`, `FusionBoard`) e do badge
   "ativa/arquivada" do `LearningSection` ficou de fora — lá o cinza colapsaria
   uma distinção que a tela precisa manter.
   **Consequência registrada**: no `StatusDot` (mapa de 5 estados, não ternário
   binário) `idle` e `success` viraram o MESMO pixel. Onde isso importava —
   a linha colapsada do Agendado — o desempate saiu da cor e virou texto:
   `lastRunLabel` em `ScheduledView.tsx` diz "nunca rodou" ou "última
   dd/mm, hh:mm" na linha de metadados (com teste, porque se o rótulo sumir a
   lista volta a ter dois estados indistinguíveis). Regra geral que fica: **dot
   ambiente cinza é a lei; quem precisa distinguir dois estados saudáveis usa
   texto, não tinta.** `StatusDot` novo em superfície nova precisa checar se a
   linha tem esse desempate.
5. ✅ **Verde como identidade de agent** — Antigravity saiu do `--st-success`
   e ganhou `--id-violet` (par claro/escuro em `index.css`), nos dois mapas de
   cor categórica (`MissionControl`, `CostAudit`). Linha nova na tabela do §2.
6. ✅ **Elevação fora dos 3 níveis** — `shadow-lg/md` dos primitives shadcn
   (dialog, select, dropdown-menu, context-menu) e o `shadow-2xl` do Lightbox
   migraram pro `--shadow-pop`. Zero `shadow-md/lg/xl/2xl` no app.
7. ✅ **Travessão em copy de UI** — toasts, tooltips, títulos, descrições de
   modelo, notificações do sistema e os marcos que a missão escreve no fio.
   **Escopo deliberado**: só copy que o usuário LÊ; texto de PROMPT
   (`lib/mission`, `lib/handoff`, `lib/skills`, `lib/trust`, `lib/transcript`,
   `lib/doctrine`) ficou como está, porque ali o "—" é entrada do agent, não
   prosa de UI. (Os `file:line` citados na auditoria original tinham drift:
   `CompanionSettings.tsx:217` e `SettingsDialog.tsx:774` não tinham travessão
   nenhum.)
8. ✅ **Hero divergente pro mesmo papel** — 34px → 30px (métrica de painel do
   Mission Control) e 19px → 20px (Readout do Mission Control e da
   MissionTimeline). As três paradas hero são as do §3.
9. ✅ **Hex cru fora de token** — `#3fb950`/`#a371f7` viraram `--git-open` e
   `--git-merged`, com par claro/escuro (o verde nativo do GitHub não é
   legível sobre fundo claro). Sobra um hex no app: o `#D97757` dentro do SVG
   da marca do Claude Code (`AgentLogo.tsx`), que é logotipo de terceiro.
10. ✅ **Brass decorativo** — ícones ilustrativos e spinners de empty state do
    `SddView` viraram cinza; o brass ficou nos gestos (Inicializar SDD, Nova
    feature, etapa ativa). A triagem dos ~130 `text-brass` do resto do app
    segue aberta como higiene contínua, não como desvio de topo.

**Bônus fechado junto**: o popover do `InboxBell` tinha o mesmo clipping que a
UsagePill (`DropdownMenuContent` z-50 sob o header z-[110]) → `z-[120]` +
`sideOffset={8}`, sem tocar no `dropdown-menu` global.

## 10. Guarda automática (ratchet de lints)

Este guia deixou de depender de memória: três scripts rodam na CI (job
`guardas` do `.github/workflows/ci.yml`, separado dos testes) e localmente por
`cd app && bun run check`. A ideia é a do Buzz (`docs/study-buzz.md`, item B1):
**passada de despoluição sem guarda re-fragmenta em poucos sprints**. Código
nosso; só as regras vieram de lá.

| Script | Protege | Falha quando |
|---|---|---|
| `scripts/check-type-scale.mjs` | §3, a escala fechada | aparece tamanho de fonte fora de {11, 12, 13, 14, 20, 30, 38}px em `app/src/**`, seja `text-[15px]`, seja rem arbitrário (`text-[0.9rem]`), seja `font-size:` em CSS. Também acusa classe nomeada do Tailwind (`text-sm`) fora de `components/ui/` |
| `scripts/check-file-size-ratchet.mjs` | legibilidade (arquivo grande esconde bug) | um arquivo passa do teto do tipo (500 linhas `.ts` · 700 `.tsx` · 900 teste) ou cresce acima do congelado em `scripts/lints/file-size-baseline.json` |
| `scripts/check-dead-tokens.mjs` | §2, §4 e §7 | volta `shadow-md/lg/xl/2xl`; aparece `text-st-success` além do declarado por arquivo; entra travessão "—" em prosa de UI |

Regras de convívio (as três valem mais que a conveniência do momento):

- **Se a guarda de tamanho disparar, DIVIDA o arquivo.** Nunca suba o teto,
  nunca edite a baseline à mão, nunca adicione exceção. A baseline **só
  encolhe**: quando um arquivo baixa, `bun run check:file-size -- --update`
  desce o número dele (e a guarda cobra isso, senão a catraca afrouxa
  sozinha). O contexto é real: `MessageList.tsx` chegou a 2.8k linhas, e foi
  exatamente ali que 11 varreduras O(N) se esconderam.
- **Tamanho novo na escala exige ADR + linha no §3**, não exceção no script. O
  erro já diz o arquivo:linha, o valor achado e a parada de destino (o script
  repete o mapa de migração do §3 em vez de inventar régua própria).
- **Exceção de token morto é por arquivo, com contagem e motivo escrito** no
  mapa da regra (`scripts/lints/deadTokens.mjs`). O número congela: o verde de
  marco/probe que já existe continua, verde novo não entra. Exceção que sobrou
  folgada aparece como nota no fim da varredura, pra ser apertada.

O que ficou registrado como exceção hoje: o verde declarado do §2 (probe real
em Configurações/Onboarding, marco de turno/plano no fio, `+N` do domínio git)
mais a triagem que o §9 item 4 adiou de propósito (`TaskChecklist`,
`Markdown`, `FusionBoard`, badge do `LearningSection`); e o travessão de
**texto de prompt** (`lib/mission`, `handoff`, `missionHandoff`, `skills`,
`learning`, `planMode`, `doctrine`, `transcript`, `trust`), que é entrada do
agent e não prosa de UI (§9 item 7). Saída de `console.*` também não é copy de
UI: fica fora por regra, não por exceção.

Os núcleos puros dos três scripts vivem em `scripts/lints/` com teste vitest
ao lado (o `bun run test` do app já os coleta). Padrão novo entra como mais um
objeto em `DEAD_TOKEN_RULES`.

## 11. Superfícies do sistema

**O app não expõe menu do motor. Todo botão direito é nosso** (ADR-042).

O menu que o WKWebView (macOS) e o WebKitGTK (Linux) abrem sozinhos é artefato
do MOTOR, não feature do produto: ele oferece "Reload" (que recarrega o app no
meio de um turno), "AutoFill", "Search with Google", "Show Writing Tools". Ver
menu de navegador dentro do Frota é o mesmo tipo de vazamento que scrollbar de
navegador ou cursor de link: denuncia a casca e quebra a ilusão de app.

Regras decidíveis:

- **Uma primitiva só.** Todo menu de contexto sai de
  `components/ui/context-menu.tsx`. Item, rótulo e divisor são constante
  compartilhada ali dentro: menu ancorado em elemento (`ContextMenu*`) e menu
  ancorado no cursor (`PointMenu*`) têm a MESMA aparência. Elevação E2
  (`--shadow-pop`), item em 13px, rótulo de grupo em 11px.
- **Item que não FAZ não existe.** Nada de item desabilitado "pra manter o
  formato", e nada de ação que abre um toast de erro previsível. Sem a
  capability (ex.: leitura de área de transferência fora do Tauri), o item
  **some** (§5 camada 1). "Salvar como…" não existe enquanto não houver
  implementação real.
- **Menu vazio é pior que menu ausente.** Alvo sem item honesto não abre menu
  nenhum; o menu do motor continua suprimido do mesmo jeito.
- **Campo de texto ganha de menu de container.** Onde há `input`, `textarea`
  ou `contenteditable`, o menu é o de edição (Cortar · Copiar · Colar ·
  Selecionar tudo), mesmo que a superfície em volta tenha menu próprio: ali o
  botão direito tem função de sistema a cumprir. Campo de senha só oferece
  **Colar**; campo somente-leitura não oferece Colar nem Cortar.
- **Teclado é obrigatório.** Menu de contexto é alcançável por teclado (a tecla
  de menu / Shift+F10 emitem `contextmenu` como o mouse), navega por setas e
  sai no Esc. A primitiva Radix já entrega isso; quem adicionar menu novo não
  pode quebrar.
- **Saída de dev, e só em dev.** Em build de desenvolvimento, **Shift + botão
  direito** devolve o menu do motor (é por lá que se chega em "Inspecionar
  elemento"). Em build de release não existe escape.
- **Copy:** os rótulos seguem o §7 (pt-BR, sem travessão) e descrevem o
  RESULTADO pro usuário, não o alvo interno. "Mostrar na pasta", nunca
  "Mostrar no Finder": o produto também é Linux.

Superfície nova com menu de contexto entra por este caminho ou não entra.
