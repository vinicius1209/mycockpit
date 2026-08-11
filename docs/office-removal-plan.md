# Remoção do Escritório — plano (foco de produto)

> Status: aprovado pelo usuário em 11/08/2026. Decisão de produto: o Escritório
> é "perfumaria" — bonito, sem ganho prático (o usuário vive na aba Trabalho, e
> a superfície chegou a degradar a digitação via ticker do Pixi). Rumo maior:
> produto de compra única, Mac/Linux — cada superfície mantida paga seu custo.
> Docks NÃO migram: mandar tarefa / ver retry / estado vivo já existem no
> Trabalho (segunda porta = custo dobrado, polimento pela metade).

## O que fica (e por quê)

- **A ponte de dados** — `office/bridge/derive.ts`, `office/bridge/send.ts`,
  `engine/types.ts`, `engine/perf.ts` — NÃO é perfumaria: é o contrato "o que
  a frota faz agora", e o **Companion Web depende dela** (companion.ts importa
  send/types/perf sem o office montado). Migra para `lib/` (nomes neutros:
  nada de "office" no caminho novo; ex. `lib/fleet/…`).
- O Companion Web inteiro fica — a visão do usuário é o CONTRÁRIO de cortá-lo
  (ver `companion-plan.md` quando existir: virar "aplicativo de verdade").

## R1 — Divórcio da ponte

- Mover derive/send/types/perf para `lib/fleet/` com os testes juntos.
- Atualizar consumidores de fora: `companion.ts` (send/types/perf),
  `chat.ts` (perfSpan), `Sidebar.tsx` (OfficeRailContent — some junto com a
  UI, ver R2). Nenhuma mudança de comportamento nesta fase.

## R2 — Corte da superfície

- `App.tsx`: aba "Escritório" (viewMode `office`), lazy mount, `officeVisited`,
  atalhos de teclado ligados ao office.
- `Sidebar.tsx`: `OfficeRailContent`.
- `app/src/office/` inteiro (cena Pixi, OfficeMode, docks, HUD, BossCenter,
  Prompts, sim-data) — exceto o que R1 já moveu.
- `pixi.js` sai do `package.json`.
- Consumidores de ditado do office (`office/bridge/voice.ts` → DeskDock/
  MissionDock): somem com os docks. Conferir que o ditado do composer
  (MicButton) não referencia nada do office.
- **Configurações**: varrer o dialog inteiro — não pode sobrar menção órfã
  (achado prévio: `CostMaintenance.tsx:75` cita "Escritório" na copy). Missões
  e Companion ficam; qualquer ajuste que só servia ao office sai.
- Tray/TitleBar/atalhos: conferir menções.

## R3 — Registro e limpeza

- ADR no `docs/decisions.md`: por que saiu, o que ficou (ponte), e o caminho
  de volta (renascer como visão do Companion Web lendo o feed — só sob
  demanda).
- `docs/agent-office.md`: marcar como histórico (não apagar — é a memória do
  desenho da ponte).
- Suítes: testes do office somem com o código; os da ponte migram junto e
  seguem verdes. Full suites (cargo + vitest + tsc) + boot e2e.

## Guardas

- Companion Web funcionando IGUAL antes e depois (é o principal risco do R1 —
  os testes de `send.test.ts`/`companion.test.ts` são o contrato).
- Nenhum resto: `grep -ri office` no fim não pode devolver nada funcional
  (docs históricos ok).
- Commit por fase (ADR-031), sem push até o reviewer passar.
