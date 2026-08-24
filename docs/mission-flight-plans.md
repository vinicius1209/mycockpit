# Planos de voo — workflows visuais executáveis

Data: 2026-08-24

## Decisão de produto

**Plano de voo** é o workflow reutilizável; **Missão** é uma execução concreta
desse workflow em uma conversa e um worktree. Ao lançar uma Missão, a pessoa
escolhe o Plano de voo. O app congela uma cópia profunda da revisão escolhida e
executa exatamente aquele mapa até o pouso.

> O mapa desenhado é o mapa percorrido.

O runtime não acrescenta fases corretivas escondidas e não relê o plano global
durante o voo. Correções, retornos e caminhos alternativos precisam estar
desenhados antes do lançamento.

O contrato detalhado do interpretador, da persistência e dos limites está em
[`mission-graph-engine-v2.md`](./mission-graph-engine-v2.md).

## Modelo de domínio

- `MissionPreset.phases`: configuração de cada membro do time: papel, code
  agent, modelo, effort, retries, instruções e critérios.
- `MissionPreset.graph`: topologia canônica: entrada, nós, conexões, condições
  e limites de travessia.
- `MissionPreset.mode`: preferência de autoria (`linear` ou `graph`), não um
  motor diferente.
- `MissionRun.execution.planSnapshot`: cópia imutável do plano no lançamento.
- `MissionRun.phases`: ledger cronológico das visitas. Um mesmo nó aparece
  novamente quando um retorno é percorrido.
- `MissionRun.execution.transitions`: audit trail das conexões consumidas.

```text
Plano escolhido
  ├── fases: configuração dos agents
  └── grafo: rota executável
             │ snapshot profundo
             ▼
Missão
  ├── visitas cronológicas
  ├── transições percorridas
  ├── gate/recovery pendente
  └── custo, teto e desfecho
```

## Execução

O interpretador é serial e determinístico:

1. começa no `entryNodeId`;
2. executa o agent configurado para a fase do nó;
3. traduz a entrega em `success` ou `failure`;
4. escolhe primeiro uma conexão da condição exata e depois `always` como
   fallback;
5. persiste transição e próxima visita antes de iniciar o próximo agent;
6. termina com sucesso quando um resultado `success` não possui saída;
7. encerra com erro quando um resultado `failure` não possui rota.

Para reviewers, `APROVADO` é `success` e reprovação é `failure`. Os planos de
fábrica já desenham `Revisar → Corrigir → Revisar`, com no máximo duas
travessias por conexão cíclica. Quando o retorno de revisão esgota, a entrega
termina com ressalva explícita.

Retry e recovery não são branches funcionais. Retry pertence à visita;
rate-limit, crédito ou indisponibilidade do CLI abrem recovery e reexecutam a
mesma visita com a escolha do usuário. O teto global continua soberano.

Interromper uma fase manualmente conserva a fase como `aborted`, segura a
Missão e, se a pessoa mandar continuar, segue pela rota de sucesso. Parar a
Missão permanece um gesto terminal separado.

## Validação estrutural

Salvar e lançar são bloqueados quando o grafo viola qualquer invariante:

- IDs de fases, nós e conexões únicos;
- vínculo exato de uma fase para um nó;
- entrada válida e todos os nós alcançáveis;
- source e target existentes;
- no máximo uma conexão por condição em cada nó;
- ao menos um término possível por sucesso;
- toda conexão interna de ciclo com `maxTraversals` inteiro e positivo.

Além dos limites declarados no plano, o interpretador possui uma barreira de
100 visitas por Missão.

## Autoria

### Rota

Editor vertical para uma sequência simples. Permite adicionar, remover,
selecionar e reordenar fases. A alteração reconstrói deliberadamente a cadeia
`success` porque, nessa projeção, a ordem é a execução.

Se o plano tiver condição, branch, retorno, rótulo de conexão ou limite, Rota
fica somente leitura. Assim, editar uma lista nunca apaga uma decisão criada no
Fluxo visual.

### Fluxo visual

Canvas conectável para posicionar nós e criar/remover conexões. Ao selecionar
uma conexão, a pessoa define `Concluiu`, `Falhou` ou `Sempre` e o limite de
travessias. O inspetor de fase continua sendo a única fonte para configurar o
agent.

A mesma topologia alimenta Rota, Fluxo visual, launcher e runtime; não existe
um segundo estado escondido no React Flow.

### Missão em voo

A timeline inclui um mapa somente leitura do snapshot. Nós visitados, nó
corrente, falhas, conexões percorridas e contadores de retorno explicam a rota;
a lista cronológica abaixo preserva cada visita, custo e resultado.

## Persistência e retomada

O `run-state.json` v2 guarda snapshot, identidade de cada visita, transições,
cursor, custos, parecer, gate e recovery pendentes. Na retomada:

- uma transição já persistida não é repetida;
- gate aguarda resposta sem reexecutar a visita anterior;
- recovery conserva e reexecuta a visita atual;
- uma queda durante um agent pode reexecutar aquela visita.

O app não promete `exactly-once` para efeitos externos produzidos pelo CLI.

## Arquivos principais

- `app/src/lib/missionGraph.ts`: validação e interpretador puros;
- `app/src/lib/missionGraphRuntime.ts`: snapshot e resolução de visitas;
- `app/src/lib/missionGraphRunInit.ts`: criação/retomada do ledger;
- `app/src/lib/missionGraphRunTransition.ts`: adaptação do resultado ao store;
- `app/src/lib/missionState.ts`: persistência v2;
- `app/src/store/mission.ts`: efeitos de execução e checkpoints;
- `app/src/components/mission/LinearRouteEditor.tsx`: autoria Rota;
- `app/src/components/mission/MissionPlanCanvas.tsx`: autoria Fluxo visual;
- `app/src/components/mission/MissionRunGraph.tsx`: mapa em voo;
- `app/src/components/mission/MissionLauncher.tsx`: escolha e validação do plano.

## Escopo deliberadamente fora

- execução paralela e merge de ramos;
- condições livres baseadas em texto de LLM;
- gate como nó de primeira classe;
- semântica distribuída `exactly-once` para subprocessos e efeitos externos.
