# Status de trabalho em background — plano (um lugar só, legível)

> Status: **B1 ✅ · B2 ✅ (06/08/2026)**.
> Proposto em 06/08/2026, do feedback do usuário sobre os builds 181/182:
> "o tempo decorrido quebra a linha", "rolando pra cima aparece um trabalho em
> background solto, parece descentralizado, confuso". Pesquisa mandatória antes
> de codar: **Warp (código-fonte clonado em `~/projetos/warp`, 902 MB)**, Claude
> Code (CLI), e os IDEs com agent (Cursor/Copilot/Zed).

## O que está errado hoje (evidência dos prints)

1. **Quebra de linha no tempo.** A linha viva do agente é
   `[avatar] Claude Code / trabalho em background rodando (Nome A, Nome B) … 5min 30s`
   num flex sem largura reservada: com dois trabalhos e nomes longos, o texto
   empurra o cronômetro e ele quebra em `5min` / `30s`. O tempo é o dado que
   mais muda e o que menos pode dançar.
2. **Dois lugares dizendo a mesma coisa, em gramáticas diferentes.** O nó
   `Trabalho em background: Se… · local_agent · em background · [Claude Code] ·
   [Interromper turno]` fica ancorado no meio do fio (onde nasceu), enquanto a
   linha viva do rodapé repete o mesmo estado. Rolando pra cima, o usuário
   encontra um cartão órfão sem saber se é histórico ou coisa viva.
3. **Ruído técnico exposto**: `local_agent`, "em background" repetido duas
   vezes na mesma linha, selo de motor ao lado de rótulo de transporte.
4. **A ação está no lugar errado**: "Interromper turno" (que mata o TURNO
   inteiro) aparece dentro do cartão de UM trabalho — sugere que interrompe só
   aquele item.

## B1 — Pesquisa (obrigatória, antes de desenhar)

- **B1.1 — Warp (fonte local)**: como o "agent working / long-running command"
  é renderizado — o bloco fixa altura? O cronômetro tem largura tabular
  reservada? O status vive no bloco de origem, num rodapé fixo, ou nos dois com
  papéis distintos? Como agrupam N tarefas simultâneas? Extrair as REGRAS
  (não copiar pixels).
- **B1.2 — Claude Code CLI**: a linha viva ("· Baking… 2m14s") é uma só,
  ancorada no rodapé, com verbo + tempo tabular. O que ela mostra quando há
  vários trabalhos.
- **B1.3 — Cursor/Copilot/Zed**: onde mora o "rodando em background" e o que
  acontece com o cartão quando termina.
- Entregar um comparativo curto de REGRAS antes de qualquer código.

## B1' — O que a pesquisa achou (regras, não pixels) ✅ 06/08/2026

Fonte de cada coluna: **Warp** = leitura do código-fonte clonado em
`~/projetos/warp` (Rust puro, UI no framework próprio `warpui`; paths citados);
**Claude Code CLI** = observação de uso (não há fonte); **IDEs com agent** =
observação de produto (não há fonte). Só o que tem path é evidência dura.

### As 6 regras que importam pro nosso caso

**R1 — O cronômetro não quebra porque ele MUDA POUCO, não porque é largo.**
O Warp arredonda a duração para segundos inteiros ENQUANTO roda, com o motivo
escrito no código (`app/src/terminal/model/block.rs:2699-2721`: "keeps the
formatted duration string stable between one-second repaint ticks … don't cause
the counter to flicker sub-second values"), e só troca pela duração exata com
decimais quando termina (`block.rs:2465-2469`). O texto é monoespaçado
(`app/src/terminal/view.rs:23516-23523`). Antes de 1s inteiro **não mostra nada**
e o placeholder que arma o timer tem largura ZERO (`view.rs:23571-23584`).
Busca por `tabular`/`tnum`/`font_feature`/`min_width` no repo inteiro: **zero
ocorrências** — o Warp não reserva largura pro relógio, ele estabiliza o
CONTEÚDO. Nosso caso é diferente: nosso rótulo divide a MESMA linha flex com o
tempo, então a estabilização de conteúdo não basta — mantemos `tabular-nums` +
largura mínima + `shrink-0` (B2.1), que é a tradução web da mesma intenção. O
único slot de largura reservada que o Warp tem é pro **ícone** de status
(`app/src/workspace/view/vertical_tabs.rs:4499-4519`).

**R2 — Número que tica NÃO mora dentro do texto animado.** Regra explícita, dita
duas vezes no código (`app/src/ai/blocklist/block/view_impl/common.rs:310-312` e
`406-411`): o sufixo com timer/tokens é renderizado como elemento separado
"we don't want it to shimmer since that would cause the animation to reset every
time the tokens or time changes". Mesma coisa vale pro nosso spinner de dots: o
tempo é irmão, nunca filho do que anima. E nunca mostrar "0s"
(`common.rs:392-394`: esconde o sufixo antes do último tick).

**R3 — O rodapé é uma faixa de UMA linha, de altura TRAVADA, que some por
completo.** `BlocklistAIStatusBar` é irmão do editor de input, não item da lista
de blocos (`app/src/terminal/input/universal.rs:202-210`), tem altura fixa de uma
linha (`common.rs:647-651`, padding × 2 + font size), só renderiza pro
**último exchange ativo** (`status_bar.rs:746`) e vira `Empty` quando nada roda
(`status_bar.rs:1226,1236`). Ele nunca guarda histórico.

**R4 — Dois lugares, tempos verbais diferentes.** Rodapé fala no gerúndio
("Starting agent X …", `orchestration.rs:676-679`); o card no histórico troca
para o **pretérito** quando termina ("Started agent X locally." +
check verde, `orchestration.rs:579-586`; "Thinking" → "Thought for 12 seconds",
`output.rs:351-355`) e **congela o tempo final**. Uma terceira superfície, o
header do pane, diz só **quem está no controle** ("Agent is in control" /
"User is in control", `inline_agent_view_header.rs:22-27`). É exatamente a
hierarquia que falta pra gente: agora (rodapé) · marco/resultado (fio) · quem
pilota (cabeçalho).

**R5 — N tarefas: contagem agregada + uma superfície de detalhe; nome truncado,
nunca empilhado.** Card agregado no momento do disparo (`"Spawning {total}
agents…"` → `"Spawned {launched} of {total} agents"` com estado próprio pro
sucesso parcial, `run_agents_card_view.rs:1359-1441`); pill bar com o
orquestrador primeiro carregando um badge **agregado da árvore** e os filhos com
status individual (`orchestration_pill_bar.rs:632-644`), com **largura máxima de
rótulo fixa** (`PILL_LABEL_MAX_WIDTH = 83.`) — quem cede é o nome; lista lateral
separando `ACTIVE` de `PAST` (`conversation_list/view.rs:806-810`) e overflow
virando `"+ {n} more"` (`vertical_tabs.rs:4538-4542`). A agregação tem regra de
precedência escrita (`orchestration_topology.rs:182-227`): filho `InProgress`
manda, EXCETO se o pai está esperando — "Parent's own waiting state outranks
descendant in-progress".

**R6 — Sem status confiável, não inventa: some o sinal, fica o espaço.** O Warp
só mostra status fino quando o transporte prova que sabe
(`cli_agent_sessions/mod.rs:154-162`: `supports_rich_status` só é `true` depois
de uma notificação OSC 777 rica; o fallback OSC 9 do Codex "does not qualify") —
sem isso a pill não aparece, mas o slot continua reservado pra não desalinhar.
"Não sei" cai no bucket **pessimista** (`TaskUnknown` → filtro `Failed`,
`agent_conversations_model.rs:411`), nunca em sucesso. E estado vivo **não é
persistido** de propósito (`specs/QUALITY-780/TECH.md:112-120`: "The honest model
— 'the wait ends when the app dies' — has a smaller surface area and degrades
gracefully"); card restaurado de spawn volta como `Cancelled`. É a nossa regra
de replay-safe (D1.5) dita por outra casa.

### Comparativo curto

| Regra | Warp (fonte) | Claude Code CLI (uso) | IDEs com agent (produto) | Frota (decisão) |
|---|---|---|---|---|
| Onde mora o "agora" | faixa de 1 linha colada ao input, altura travada, some sozinha | linha única no rodapé, acima do prompt | painel/lista de agents à parte | linha viva no fim do fio (junto do composer) é a ÚNICA dona (B2.2) |
| Estabilidade do tempo | arredonda p/ segundo inteiro + monoespaçada; sem largura reservada | verbo + tempo na mesma linha, sem quebra | tempo relativo, pouco preciso | `tabular-nums` + largura mínima + `shrink-0`; quem trunca é o nome (B2.1) |
| Número vs. animação | elementos irmãos, número fora do shimmer | idem | — | dots e cronômetro irmãos do rótulo, `shrink-0` (B2.1) |
| Papel do item no histórico | pretérito + resultado + tempo congelado | linha estática, imutável | cartão vira link/resumo | nó = marco ("iniciado") e depois resultado (B2.2) |
| N simultâneos | contagem agregada + pills com rótulo de largura máxima | agrega, não empilha | lista com seções ACTIVE/PAST | "N trabalhos em background · <mais recente>", detalhe no Fio Vivo (B2.5) |
| Quem pilota | header do pane, superfície própria | cabeçalho da sessão | cabeçalho do painel | selo do motor no cabeçalho do agente (B2.3) |
| Sem informação | não mostra sinal; desconhecido ≠ sucesso; estado vivo não persiste | linha some | chip "unknown" | linha some, nada de estado inventado; replay derruba a linha e preserva o marco |

### O que isso muda no B2 (nada, confirma)

As cinco correções já cravadas sobrevivem à pesquisa. Ela só acrescenta três
detalhes de implementação: (a) o cronômetro fica FORA do elemento que anima
(R2); (b) o tempo mostrado na linha viva é o do trabalho NOMEADO nela, não o do
turno, porque o turno perde o `startedAt` no `result` (`chat.ts:1050`) e a linha
ficaria sem relógio justamente no estado em que o background segura tudo; (c)
com N trabalhos, o nome é o que trunca e a lista completa fica no `title` +
Fio Vivo, sem empilhar (R5).

## B2 — Correções que já dá pra cravar (independem da pesquisa)

- **B2.1 — Cronômetro nunca quebra**: `tabular-nums`, largura mínima
  reservada, `shrink-0`, e o texto descritivo com `truncate` — quem cede é o
  nome, nunca o tempo (o DS já pede `tabular-nums` em métricas).
- **B2.2 — Um lugar canônico para o estado vivo**: a linha do rodapé (junto do
  composer, onde o olho já está) é a dona do "o que está rodando agora". O nó
  no fio vira **marco** ("trabalho em background iniciado") e, ao terminar,
  **resultado** — nunca um segundo painel de status vivo competindo.
- **B2.3 — Vocabulário limpo**: some `local_agent` e a duplicação de "em
  background"; o selo do motor fica no cabeçalho do agente, como manda o
  work-hierarchy.
- **B2.4 — Ação no dono certo**: no cartão de um trabalho, a ação é sobre
  AQUELE trabalho (parar/ver saída/retomar); "Interromper turno" só na
  superfície do turno, com copy dizendo que o background morre junto (o D1.4
  do deferred-work-plan já cravou essa regra).
- **B2.5 — N trabalhos**: com mais de um, a linha viva mostra
  `N trabalhos em background · <o mais recente> · tempo`, e o detalhe abre no
  Fio Vivo (não empilha nome atrás de nome).

### O que foi entregue no B2 ✅ 06/08/2026

Tudo em TypeScript (nenhuma migração, nenhuma capability nova, nada no Rust).

- **B2.1** — `Elapsed` ganhou `className` e a linha viva o usa com
  `min-w-[4.5rem] shrink-0 tabular-nums`; o rótulo virou `min-w-0 truncate`.
  O tempo é IRMÃO dos dots que animam, nunca filho (regra R2 do Warp).
- **B2.2** — `WorkingIndicator` é a dona única do "agora"; o nó do fio passou a
  dizer **iniciado** (marco) enquanto roda, e **concluiu / interrompido** quando
  termina. O cronômetro da linha é o do trabalho NOMEADO (`deferredLiveLine`),
  o que também consertou o relógio sumido no estado "finalizando com background
  vivo" (o `result` zera o `startedAt` do turno).
- **B2.3** — `deferredLabel` traduz `task_type` (`local_agent` → subagente,
  `local_workflow` → workflow; tipo desconhecido segue cru, traduzir o que não
  se conhece seria inventar); a meta do nó perdeu o `task_type` e a duplicação
  de "em background"; o selo do motor saiu de CADA nó e foi pro cabeçalho do
  agente (`resolveExecutorIdentity` devolve `engine`, preenchido só quando uma
  persona pilota — sem persona o nome já É o motor).
- **B2.4** — o cartão do trabalho não oferece mais "Interromper turno" (que era,
  além de dono errado, no-op silencioso: o `runId` já é `null` depois do
  `result`). A ação do turno mora no Parar do composer, com a copy do D1.4 agora
  no plural certo (`deferredStopWarning`). Subagente comum (`Task`) mantém o
  botão com a explicação de que só existe controle do turno inteiro
  (work-hierarchy).
- **B2.5** — `deferredLiveLine`: `trabalho em background · <nome>` com um,
  `N trabalhos em background · <mais recente>` com vários, lista completa no
  `title` e detalhe real no Fio Vivo.

Testes: `src/store/chat.liveWork.test.ts` (13 casos: rótulo com N, truncamento,
qual trabalho manda no relógio, vocabulário, aviso do Parar) e
`src/components/chat/MessageList.background.test.ts` (9 casos de marcação: o que
a linha mostra em cada estado, o nó como marco, a ação ausente no cartão).

**Furo conhecido, NÃO corrigido:** com o turno em `finalizing` (background vivo
segurando o CLI) não existe caminho real de interromper — o `runId` já foi
zerado no `result`, então o Parar do composer também some. Hoje isso é honesto
(nenhum botão mente), mas a capacidade de matar um turno preso no background
continua faltando; o caminho é o quit avisado do D1.4.

## B3 — Coerência com o que já existe

Isto NÃO é feature nova: é fechar a lacuna entre dois planos já entregues —
`work-hierarchy-plan.md` (Fio Vivo: cada trabalho é nó com ciclo próprio) e
`deferred-work-plan.md` (D1.3: rótulo honesto do turno em hold). O que falta é
**hierarquia visual entre eles**: nó = onde nasceu e o que virou; linha viva =
o que está acontecendo agora. Hoje os dois falam ao mesmo tempo, no mesmo tom.

## Guardas

- Nada de inventar estado: o que a linha diz vem do mesmo `pendingDeferred`/
  `ManagedProcess` que já alimenta o fio.
- Degradação honesta por motor (agy não reporta background: a linha some, não
  mente).
- Replay-safe: o marco no fio sobrevive ao restart; a linha viva não.
