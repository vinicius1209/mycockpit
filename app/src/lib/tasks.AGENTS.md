# Planos e etapas: a leitura do fim do turno

Escopo: `tasks.ts`, `TaskChecklist`, `LivePlanCard`, marcos de plano em
`MessageList` e etapas em `ConversationMapPanel`. Regras gerais ficam no
`AGENTS.md` da raiz. Decisão: ADR-171.

## Contrato

- `TaskCreate` e `TaskUpdate` são a evidência do agente. O transcript permanece
  intacto; só um update explícito pode concluir uma etapa.
- `deriveTaskPlans` segmenta por pedido. Terminal (`result`, `error`,
  `cancelled`, `limit`) ou pedido posterior deixa as etapas incompletas como
  `unsettled` na projeção. Isso significa "sem conclusão registrada".
- `TaskChecklist` exige `live` para animar `in_progress` ou mostrar o
  `activeForm`. Sem processo vivo, `taskStatusForDisplay` também deixa o replay
  sem terminal estático. O default de `live` é `false`.
- O card junto ao composer exige plano corrente sem terminal e runtime em
  execução/finalização. O marco histórico usa o mesmo plano derivado. A sidebar
  usa `deriveTasks`; um novo turno nunca reanima etapas do anterior.
- `taskPlansOf` compartilha a leitura por identidade do array. Consumidores
  não podem mutar os planos ou as tarefas retornadas.

## Evidência e limites

`tasks.terminal.test.tsx` usa os eventos reais do incidente 4/7 em
`__fixtures__/plano-encerrado-4-de-7.json`. Cobre terminal, pedido novo,
replay sem processo e preservação da contagem.

Este contrato independe do provider. A capacidade de emitir `mc-work` continua
vindo do registry de capabilities. A reconciliação visual não habilita canal
de trabalho em um motor que ainda não o possui.

Agy pode emitir pelo cadastro global confirmado e pelo socket do run (ADR-173).
Isso disponibiliza ferramentas, não prova atividade: sem chamada real a
`work_plan`/`work_update`, as três superfícies não inventam plano ou progresso.
