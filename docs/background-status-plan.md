# Status de trabalho em background — plano (um lugar só, legível)

> Status: proposto em 06/08/2026, do feedback do usuário sobre os builds 181/182:
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
