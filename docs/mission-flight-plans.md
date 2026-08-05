# Planos de voo — fundação do Workflow Engine

Data: 2026-08-04

## Vocabulário do produto

- **Plano de voo**: template reutilizável e exportável. Define a rota, o time,
  os agents/modelos, os critérios e os limites.
- **Missão**: uma execução concreta de uma versão do plano numa conversa e num
  worktree.
- **Fase/nó**: um papel (`planner`, `executor` ou `reviewer`) associado a um
  code agent, modelo, effort, retries e guardrails.
- **Time**: os membros configurados nas fases. O time pertence ao plano, mas
  não é sinônimo do plano: a rota também carrega ordem, gates e orçamento.

## Compatibilidade

`MissionPreset.mode` é opcional. Ausente significa `linear`, portanto todos os
presets já salvos no `mc.app` continuam funcionando sem migração. O runtime
segue consumindo `preset.phases`; o canvas v1 mantém essa projeção sincronizada
com o grafo e não cria estado paralelo de execução.

```text
Plano linear ─┐
              ├─ preset.phases ─ missionEngine ─ MissionRun
Plano canvas ─┘
```

Essa escolha permite evoluir a autoria sem reescrever de uma vez o budget
hard, recovery por limite, gates humanos, retomada, handoffs e o loop de
correção que já estão provados no motor atual.

## Contrato do canvas v1

`MissionPlanGraph` é um schema de domínio independente do React Flow:

- `version: 1`;
- `entryNodeId`;
- nós que referenciam uma `MissionPhaseDef` por `phaseId` e guardam posição;
- arestas com `condition` (`success`, `failure`, `always`), rótulo opcional e
  `maxTraversals` reservado para loops limitados.

O editor entregue habilita somente uma cadeia de arestas `success`. É possível:

- criar um plano linear ou diretamente no canvas;
- abrir um plano linear existente no canvas sem mudar sua execução;
- arrastar nós para organizar o mapa;
- reordenar a rota com os controles do nó selecionado — isso muda a ordem real
  em `preset.phases`;
- editar agent, modelo, effort, tentativas, gate e teto;
- definir critérios de entrada e saída por fase; eles são injetados no prompt
  como checklists verificáveis;
- duplicar, importar e exportar o plano em JSON versionado.

## Superfície de autoria

“Planos de voo” é um workspace global do MyCockpit, acessível em **Geral ▸
Planos de voo** na barra lateral. A autoria não acontece dentro do modal de
Configurações: a biblioteca ocupa a coluna esquerda, o canvas é o instrumento
central e o nó selecionado alimenta um único inspetor na direita.

**Configurações ▸ Missões** mantém apenas o toggle do recurso e um atalho para a
prancheta. Essa separação é visual, não arquitetural: workspace, launcher e
runtime continuam lendo o mesmo `GlobalSettings.missionPresets`, sem duplicar
estado e sem criar uma segunda aplicação.

## Limite honesto da v1

Ramificações e loops ainda não são executados. Um JSON importado com fan-out,
ciclo, nó desconectado ou condição diferente de `success` é rejeitado com uma
mensagem explícita. Liberar isso apenas na UI faria o plano parecer executável
sem que budget, recovery, gate e retomada soubessem qual aresta percorrer.

O próximo marco do motor deve trocar o contador `current` por um cursor de nó e
registrar cada transição no run-state. Antes de habilitar a conexão livre no
canvas, precisa definir:

1. contrato de avaliação de critérios/condições sem depender de texto mágico;
2. limite obrigatório por ciclo (`maxTraversals`) e budget global;
3. semântica de recovery e retry por nó versus por aresta;
4. retomada determinística após crash com histórico de transições;
5. política de merge quando ramos paralelos voltarem ao mesmo nó.

## Arquivos principais

- `app/src/lib/missionTypes.ts`: tipos persistidos e schema do grafo;
- `app/src/lib/missionPlans.ts`: compatibilidade, sincronização, validação e
  import/export;
- `app/src/components/mission/MissionPlanCanvas.tsx`: adapter visual;
- `app/src/components/mission/FlightPlansView.tsx`: workspace de autoria;
- `app/src/components/settings/MissionSettings.tsx`: toggle e acesso ao
  workspace;
- `app/src/lib/mission.ts`: critérios injetados no prompt;
- `app/src/lib/missionEngine.ts`: motor linear preservado.
