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
| **Cinza** (saudável/neutro) | `foreground`, `muted-foreground`, `faint`, `border` | Texto, sucesso comum (check de ferramenta, dot concluído), metadado em sussurro mono, tudo que está simplesmente OK | Suavizar erro ou atenção ("cinza escuro" não é vermelho educado); esconder falha |
| **Verde** (marco raro) | `st-success` | No fio: marco de TURNO/PLANO/gesto — máx. **1 por turno** (caption "concluído", "Plano concluído", "Regra salva", ADR-037). Fora do fio: check "probe passou" em Configurações/Onboarding (verde exige probe, `SettingsDialog.tsx:249`) | Sucesso por linha de ferramenta; estado ambiente permanente (badge/dot "ok" que fica na tela); identidade visual de agent; texto corrido |
| **Âmbar** (precisa de você / risco autorizado) | `st-warning` (= `st-queued`) | Fila, gate, aviso que pede decisão, e o modo "Liberado" (risco autorizado fica visível) | Seleção ou item ativo (isso é brass); progresso normal; substituir vermelho em falha real |
| **Vermelho** (falha + destruição) | `st-error`, `destructive` | Falha consumada (marco vermelho, linha culpada) e ação destrutiva ("Parar", excluir, revogar) | Caminho de saída (Cancelar/fechar/voltar é ghost, sem cor); ênfase; aviso não-fatal (âmbar) |
| **Azul** (vivo) | `st-running` | O que roda AGORA: pulse do dot, esteira de telemetria, linha viva | Qualquer coisa parada; link; decoração |
| **Brass** (gesto) | `brass`, `brass-soft`, `ring` | Ação primária/sensível, foco (`--ring`), item ativo, marca | Texto pequeno sobre superfície de hover no tema claro (3.56:1 < AA, regra S3.6 em `Sidebar.tsx:990`); ícone ilustrativo/empty state; medidor saudável; tinta de "importância" genérica |
| **Cores de diff/git** | `hljs-addition/deletion`, verdes/roxos de PR | SÓ dentro do domínio git: `+N −N`, linhas de diff abertas (evidência), estado de PR do GitHub | Qualquer semântica fora de git; sucesso/erro geral |

Regras de aplicação:

- **Orçamento de tinta por recorte**: num viewport de uma superfície, fora de
  cinza + brass, no máximo **2** cores de status simultâneas. Se um layout
  pede 3, algo que devia ser cinza está pintado (o diagnóstico do ADR-037).
- **Medidores** (anel de contexto, barras de uso, quota): **cinza < 60% ·
  âmbar 60–80% · vermelho ≥ 80%**. A partir de 80% o medidor deixa de ser
  mudo: o número entra como texto ao lado (padrão do anel que grita,
  `ContextRing.tsx:49`). Medidor saudável NUNCA é brass nem verde.
- **Estado ambiente é cinza.** Dot/badge que fica na tela representando "a
  última vez deu certo" é cinza; verde é transição (marco), não decoração
  permanente.
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
| **20** | Título de view / métrica de seção | `SddView.tsx:679` |
| **30** | Métrica de painel (custo, frota) | `CostAudit.tsx:115` |
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
| **E0 — plano** | fundo + hairline `--border` | listas, linhas do fio, painéis laterais (`--rail`) |
| **E1 — cartão** | `bg-card` + `--shadow-sm` (+ `--lift` opcional) | segmented ativo, cards de painel, pills |
| **E2 — flutuante** | `--shadow-pop` | popover, dialog, dropdown, composer, tray, lightbox |

- Focus ring (`--ring` brass) e halos de estado
  (`0 0 0 3px var(--brass-soft)` etc.) são FOCO, não elevação — podem somar-se
  a qualquer nível.
- `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl` são proibidos em
  componente do app; primitives em `components/ui/` que ainda os carregam
  (shadcn cru) migram pra `--shadow-pop` quando tocados.
- Profundidade vem de hairline + véu, não de sombra pesada: cartão dentro de
  cartão com borda própria e raio próprio é proibido (ver rubrica §8).

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
  [ ] Cards-em-cards: PROIBIDO (borda com raio dentro de borda com raio;
      achatar em E0 com divisores hairline)
  [ ] Alinhamento: números de coluna à direita e alinhados; nada fora do
      grid de 4px; largura pré-reservada pro que muda
  [ ] Movimento/tempo: regras do §6 (cronômetro, gerúndio/pretérito, dono
      único do agora, sem status inventado)
  [ ] Copy: §7 (honestidade, vocabulário canônico, sem travessão em prosa)
Veredito: aprovado | aprovado com ressalvas | reprovado
```

Regra do Top 3: sempre exatamente três, ranqueados por visibilidade (quanto
tempo o usuário passa olhando aquilo), cada um com file:line e a regra deste
guia que viola. Achou mais de três? Os demais viram lista curta abaixo do
veredito. Achou menos? Diga "sem desvio" no slot, não invente.

## 9. Apêndice — auditoria (12/08/2026)

Os 10 maiores desvios do app REAL contra este guia, ranqueados por
visibilidade. É o backlog da próxima passada de despoluição; nada disto foi
corrigido nesta entrega.

1. **Escala tipográfica estilhaçada** — 24 tamanhos distintos em uso, com os
   meio-pixel dominando (161× `text-[12px]`, 138× `[11px]`, 123× `[11.5px]`,
   103× `[13px]`, 102× `[12.5px]`, 93× `[10.5px]`, 47× `[10px]`, 29×
   `[9.5px]`, 17× `[9px]`). Toda superfície viola o §3; migrar pelo mapa, por
   superfície tocada.
2. **Anel de contexto fora da regra de medidor** — saudável em brass e
   limiares 70/90 (`app/src/components/chat/ContextRing.tsx:41-42`) vs §2:
   cinza <60, âmbar 60–80, vermelho ≥80 (o "grita com número" desce de 90
   pra 80). Visível em toda conversa com contexto medido.
3. **"Parar" com duas tintas** — o stop do composer é `bg-primary` neutro
   (`app/src/components/chat/ComposerParts.tsx:538`) enquanto o do fio é
   vermelho (`app/src/components/chat/MessageList.tsx:514`). Mesma família de
   ação, hierarquias diferentes; §2 fixa vermelho pra parar/destruir.
4. **Verde como estado ambiente** — badge "done" permanente na sidebar
   (`app/src/components/layout/Sidebar.tsx:1003`), dot de última execução no
   tray (`app/src/components/tray/TrayPopover.tsx:300`), probes ok em verde no
   Mission Control (`app/src/components/panel/MissionControl.tsx:1277`) e
   status dot genérico (`app/src/components/common/StatusDot.tsx:8`). §2:
   ambiente saudável é cinza; a despoluição do ADR-037 parou no MessageList
   (44 usos de `text-st-success` em 26 arquivos).
5. **Verde como identidade de agent** — Antigravity pintado com
   `--st-success` (`app/src/components/panel/MissionControl.tsx:71-75`);
   identidade colide com vocabulário de status (§2).
6. **Elevação fora dos 3 níveis** — `shadow-2xl` em
   `app/src/components/chat/Lightbox.tsx:149` e
   `app/src/components/onboarding/OnboardingWizard.tsx:141`; `shadow-md/lg`
   nos primitives shadcn crus (`app/src/components/ui/dialog.tsx:64`,
   `ui/dropdown-menu.tsx:45,233`, `ui/select.tsx:63`,
   `ui/context-menu.tsx:38,141`) em vez de `--shadow-pop`.
7. **Travessão em copy de UI** — strings de produto com "—" em prosa:
   `app/src/App.tsx:602,676,678`,
   `app/src/components/settings/CompanionSettings.tsx:217`,
   `app/src/components/settings/SettingsDialog.tsx:774` (contra a regra da
   casa, §7).
8. **Hero divergente pro mesmo papel** — métrica de painel em 30px
   (`app/src/components/panel/CostAudit.tsx:115`) e 34px
   (`app/src/components/panel/MissionControl.tsx:1002`); métrica de seção em
   19px (`MissionControl.tsx:115`,
   `app/src/components/mission/MissionTimeline.tsx:748`) vs 20px
   (`app/src/components/sdd/SddView.tsx:679`). §3 fecha em 20/30/38.
9. **Hex cru fora de token** — verdes/roxos do GitHub direto no className
   (`app/src/components/layout/DiffPanel.tsx:221`,
   `app/src/components/sdd/SddView.tsx:807-810`). Domínio git é permitido
   (§2), mas sem token não há par claro/escuro auditado (#3fb950 sobre fundo
   claro não foi medido).
10. **Brass decorativo** — ícones ilustrativos e spinners de empty state
    tingidos de brass (`app/src/components/sdd/SddView.tsx:267,303,326,351`);
    §2 reserva brass pra gesto/foco/ativo/marca (133 usos de `text-brass` no
    app pedem essa triagem, SddView com 20 é o pior caso).
