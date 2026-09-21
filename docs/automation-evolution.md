# Automações & Cockpit — rota de evolução (F6–F8)

> Continuação de docs/product-evolution.md (F1–F5 entregues). Gatilho: screenshot
> do app Codex (sidebar com Nova tarefa · **Agendado** · Plugins · Sites ·
> **Pull requests** · Chat) + pedido de agendamento/automação estilo CRON.
> Data: 2026-07-20.

## O que o app do Codex ensina

A sidebar dele é orientada a OBJETOS globais, não só a conversas: "Agendado" e
"Pull requests" são coleções cross-project de primeira classe, acima da lista de
projetos. Na Frota de hoje, a sidebar só conhece projeto→conversa/feature; o
que é global vive escondido no switcher (Painel) ou não existe (agendamentos).
A lição NÃO é copiar o menu — é reconhecer que **trabalho recorrente e PRs são
entidades do cockpit**, tanto quanto conversas.

## F6 — Agendado: automações estilo CRON (o coração)

**Conceito.** Uma automação = prompt (ou missão) + projeto + agent/modelo +
recorrência + modo de permissão. "Toda manhã 8h: resuma PRs abertas e falhas de
CI" · "Toda noite: rode os testes e me avise se quebrar" · "Sexta 17h: faxina de
temporários e imagens penduradas".

**Dados.** Tabela `schedules` (SQLite): id, name, project_id, agent, model,
prompt, permission, recurrence (cron de 5 campos OU presets diário/semanal),
next_run, last_run_at, last_run_status, enabled, created_at. Histórico em
`schedule_runs` (schedule_id, started_at, status, cost, conv_id).

**Motor (decisão de arquitetura).** In-app scheduler: loop tokio no Rust checa a
cada 60s os `next_run <= now` e dispara o run normal (mesmo caminho do run_agent,
aparece em "Rodando agora", custo contabilizado). Limitação honesta e documentada:
**app fechado = não roda**; no boot, catch-up explícito — card "2 execuções
perdidas enquanto o app estava fechado — rodar agora / pular". Alternativa
launchd/plist descartada na v1: rodar headless fora do app perde aprovação
(socket), custo e histórico — exatamente o que o cockpit existe pra dar.

**Segurança.** Default **Leitura** (relatórios/varreduras — 90% dos casos).
Elevar pra Padrão exige escolha explícita na criação; Liberado nem aparece.
Falha/limite → notificação no sino, nunca retry infinito (1 retry, depois pausa
com aviso).

**UI.** Sidebar ganha seção global "Agendado" (F7): lista com nome, projeto,
próxima execução, custo médio; ações rápidas pausar/rodar agora; "+ Nova
automação" (prompt + projeto + recorrência com presets + permissão). No Painel,
o Launchpad mostra as 2 próximas agendadas.

**Semente já plantada:** o curador de modelos (semanal) e o check de updates
(diário) são automações hardcoded hoje — quando o F6 existir, migram pra
`schedules` como automações de fábrica (visíveis, pausáveis).

### Recorrência "Uma vez" (compromisso, não recorrência)

"Hoje às 18:30 faz o merge da PR da release" não é recorrência. Cron não
expressa isso (`30 18 * * *` roda todo dia e obriga o usuário a lembrar de
desligar) e a data no prompt é inerte — o agent roda quando o DISPARO acontece.
Daí o quarto kind: `{ kind: "once", at }` (epoch ms), com `computeNextRun`
devolvendo `at` enquanto ele é futuro e `null` depois — nunca re-dispara.

- **Encerramento, não exclusão.** Ao disparar (inclusive via "Rodar agora", pra
  o merge não sair duas vezes), o motor grava `schedules.completed_at`,
  desabilita e zera o `next_run`. A automação FICA na lista, marcada como
  concluída e com "Reagendar": apagar não deixaria rastro de que rodou nem da
  conversa que produziu, e o histórico é o que o usuário valoriza.
- **Três estados distintos na lista** (`scheduleLifecycle`): `concluída` (rodou
  e se encerrou), `pausada` (o usuário desligou) e `não vai rodar` (ligada sem
  próximo disparo: horário perdido com o app fechado, ou cron que nunca casa).
  Confundi-los faria o usuário achar que algo ainda vai rodar.
- **Guardas de horário no passado**: no form (o botão Criar não habilita) e no
  store (create e reschedule lançam) — automação que nasce morta é teatro.
- **Persistência**: `recurrence` já era JSON livre, então o kind novo não pede
  nada. `completed_at` entrou por `addColumn` no `ensureScheduleTables` (a
  tabela nasce do frontend); **nenhuma migration no lib.rs** — v25/v26 seguem
  reservadas pros presets.

## F7 — Sidebar: seções globais acima de Projetos

Rail compacto no topo da sidebar (sem virar árvore de menus):
- **Agendado** (F6) — badge com "próxima em 2h" quando houver.
- **Pull requests** (F8) — badge com nº de PRs abertas suas.
- (futuro) **Skills/Plugins** — quando o seed de skills virar gestão.
Princípio: cada seção é uma COLEÇÃO com dono claro; nada de item de menu que
abre tela vazia. Projetos continuam sendo o corpo da sidebar.

## F8 — Pull requests: coleção cross-project

Lista viva de PRs abertas nos repos dos projetos (via `gh` multi-conta que já
existe: gh_pr_view + run_gh_any_account): título, repo, checks ✓/✗, +X −Y,
idade, review. Clique = browser (decisão do Painel vale aqui). É o "Precisam de
você" expandido de 1 PR-por-feature-SDD pra TODAS as PRs — inclusive as que não
nasceram no app.

## Ações a mais no Painel (quick wins, sem esperar F6)

1. **Retomar onde parei** — atalho pro último conv ativo (o cockpit lembra).
2. **Atualizar CLIs do Launchpad** — badge de update vira ação: roda o comando
   de update num terminal/subprocess com output visível (não só copiável).
3. **Próximas agendadas** no Launchpad (quando F6 existir).

## Ordem recomendada

F6 primeiro (é o pedido e o maior valor — automação é a alma de um cockpit),
com F7 junto no mínimo necessário (a seção "Agendado" precisa morar em algum
lugar). F8 em seguida reusa a ponte gh pronta. Quick wins do Painel entram de
carona na F6 (Launchpad já vai ser tocado).

## Estado atual (04/09/2026, ADR-161)

O F6 entregue diverge do texto acima em três pontos, e a diferença é decisão
escrita, não deriva:

- **O motor roda no FRONT**, não em loop tokio no Rust (`lib/scheduleEngine`,
  tick de 60s no `App.tsx`). O resto do parágrafo continua valendo: mesmo
  caminho do `run_agent`, conversa visível, custo contabilizado.
- **Zero retry**, não "1 retry, depois pausa". Falha marca `failed` com o
  MOTIVO real na linha do histórico e no sino; re-rodar é gesto humano
  ("Rodar agora"). Retry automático continua fora até a dor ser real: um
  disparo que já escreveu no repositório não pode ser repetido sozinho.
- **A automação também dispara um Plano de voo** (`kind: "mission"`), que é o
  "(ou missão)" do conceito lá em cima, agora ligado. Nesse fluxo o
  agent/modelo/esforço são POR FASE e moram no plano; o que a automação
  escolhe é o plano, o projeto, a permissão e o horário. As três pausas que só
  fazem sentido com gente na frente (gate, recuperação, confirmação de
  worktree) são fechadas pelo DISPARADOR, em `lib/scheduleMission`.

O que segue igual e é limitação honesta: **app fechado não roda**, e o que
venceu há mais de 5 minutos vira notificação em vez de disparar sozinho.

## Anti-metas

- Rodar automação com app fechado via launchd (v1 não; revisitar se a dor for real).
- Cron expression obrigatória na UI (presets primeiro; cron é o modo avançado).
- Automação com permissão Liberado (nunca, nem como opção).
