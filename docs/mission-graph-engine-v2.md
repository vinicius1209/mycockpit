# Missões executáveis por Plano de voo — contrato v2

Data: 2026-08-24

## Objetivo

Um **Plano de voo** é um grafo canônico, versionado e reutilizável. Uma
**Missão** executa, de forma serial e determinística, um snapshot imutável do
plano escolhido no lançamento.

O compromisso de produto é simples: **o mapa desenhado é o mapa percorrido**.
Não podem existir fases ou desvios inventados pelo runtime e uma edição feita
no plano depois da decolagem não pode alterar uma missão em voo.

## Escopo desta versão

- execução serial de nós de agent;
- transições por `success`, `failure` e fallback `always`;
- ramificações determinísticas;
- ciclos somente com limite explícito de travessias;
- teto de custo soberano a qualquer transição;
- recovery de infraestrutura reexecutando a mesma visita;
- gate humano como efeito pós-nó, preservando o comportamento atual;
- snapshot, histórico de visitas e transições persistidos para retomada;
- duas projeções de autoria sobre o mesmo grafo: **Rota** e **Fluxo visual**.

Ficam fora deste marco: execução paralela, merge de ramos, condições livres
baseadas em texto e gate como tipo próprio de nó.

## Fonte de verdade

```text
MissionPreset.phases ── configuração dos agents
          │
MissionPreset.graph  ── topologia canônica
          │ snapshot profundo no lançamento
          ▼
MissionRun.execution.planSnapshot
          │
          ├── MissionRun.phases[]       visitas cronológicas
          └── execution.transitions[]   arestas percorridas
```

Cada nó referencia exatamente uma fase por `phaseId`. A posição do nó serve
somente ao layout; a execução é definida exclusivamente por `entryNodeId` e
pelas arestas.

`mode` deixa de escolher um motor. Ele registra apenas a projeção de autoria
preferida (`linear` ou `graph`). Ambos os modos editam o mesmo contrato.

## Semântica de execução

1. A missão cria uma visita para o nó de entrada.
2. O agent da fase referenciada pelo nó é executado com retry e orçamento.
3. Uma execução técnica bem-sucedida produz `success`; falha normal, depois de
   retries, produz `failure`.
4. Para reviewer, parecer aprovado produz `success` e parecer rejeitado produz
   `failure`.
5. O motor escolhe primeiro a aresta da condição exata e, se ausente, a aresta
   `always`.
6. A transição consumida e a próxima visita são persistidas juntas antes da
   execução do próximo nó.
7. Sem aresta: `success` conclui a missão; `failure` encerra com erro. Quando o
   reviewer esgota um retorno limitado, a entrega termina com ressalva explícita.

Falhas de infraestrutura não são resultados funcionais. Rate limit, crédito,
sessão indisponível ou CLI indisponível abrem recovery e conservam a visita
atual. O teto global encerra a missão e nunca pode ser contornado por uma
aresta.

O motor limita também a missão a 100 visitas, como segunda barreira contra
grafos malformados ou corrupção de estado.

## Invariantes do grafo

O plano só pode ser salvo e lançado se:

- IDs de fases, nós e arestas forem únicos;
- cada fase tiver exatamente um nó e cada nó apontar para uma fase existente;
- houver uma única entrada válida e todos os nós forem alcançáveis a partir dela;
- source e target de toda aresta existirem;
- cada nó tiver no máximo uma aresta por condição;
- `always` funcionar apenas como fallback, nunca disputar com outra `always`;
- cada aresta interna de um ciclo declarar `maxTraversals` inteiro e positivo;
- existir ao menos um término alcançável;
- não houver execução paralela.

Ao atingir `maxTraversals`, o motor não escolhe silenciosamente outra aresta da
mesma condição. Ele produz um desfecho explícito de limite esgotado.

## Visitas, transições e identidade

Um nó pode ser visitado várias vezes. Por isso, os artefatos de runtime usam
uma identidade de visita, e não a posição estática do nó:

```ts
interface MissionPhaseRun {
  visitId: string
  nodeId: string
  enteredViaEdgeId: string | null
  // status, tentativa, custo, itens e timestamps
}

interface MissionTransition {
  edgeId: string
  sourceNodeId: string
  targetNodeId: string
  sourceVisit: number
  targetVisit: number
  outcome: "success" | "failure"
  at: number
}
```

Handoffs, cancelamento e ledger usam o índice cronológico da visita, que é
monotônico e único; `visitId` fornece a identidade persistida para UI e futuras
integrações. Assim, duas passagens pelo mesmo reviewer nunca compartilham o
mesmo arquivo, run id ou registro de custo.

## Snapshot e retomada

No lançamento, a missão grava `planId`, `planRevision` e `planSnapshot` por
cópia profunda. O arquivo de estado persiste ainda:

- visita ativa e histórico de visitas;
- transições consumidas e seus contadores;
- gate ou recovery pendente;
- veredito da última revisão;
- custo e teto globais.

Uma transição concluída não é repetida depois de reiniciar. Se o processo cair
durante a execução de um agent, a mesma visita é oferecida para reexecução. Não
há promessa de `exactly-once` para efeitos externos do CLI; essa limitação deve
ser explícita na interface.

Os checkpoints e o ponteiro de retomada são gravados de forma serial e atômica
a cada marco. Uma falha de I/O não derruba o agent em execução, mas deixa de ser
silenciosa: a missão recebe `checkpointWarning` e a UI mostra **retomada sem
garantia** até uma gravação posterior restabelecer os dois arquivos.

## Autoria

### Rota

Projeção vertical para planos que formam uma sequência. Permite editar fases,
reordenar, configurar time e abrir o mesmo plano no fluxo visual. Se o usuário
criar uma ramificação ou retorno, a projeção Rota vira somente leitura e explica
por que a edição estrutural continua no Fluxo visual.

### Fluxo visual

Canvas conectável com criação e remoção de arestas. A conexão possui condição,
rótulo e, quando participa de ciclo, limite de travessias. Erros estruturais
bloqueiam salvar e lançar; avisos permanecem informativos.

O término bem-sucedido, implícito no contrato do motor, é materializado como
**Missão concluída** para a rota não terminar visualmente no vazio. Retornos
usam portas paralelas e rótulos semânticos; **Reorganizar** reaplica o layout
serial sem alterar a topologia executável.

Planos de fábrica carregam `factoryRevision`. Uma atualização automática só
substitui uma base intacta; se `revision` for maior que `factoryRevision`, o
plano foi personalizado e permanece intocado.

### Durante o voo

O mapa mostra nó atual, arestas percorridas e contagem de retornos. A timeline
abaixo virou um **diário de bordo** cronológico e registra cada visita
separadamente, sem repetir o grafo numa segunda espinha vertical. O mapa explica
**a estrutura**; o diário prova **o que aconteceu**.

Como o grafo cria visitas sob demanda, a UI não apresenta denominadores falsos
como `visita 1/1` ou `fase 1 de 1`. O cabeçalho usa o ordinal real da visita e o
mapa informa quantas fases distintas já foram alcançadas.

## Estado da entrega

O contrato, persistência v2, runner serial, escolha no launcher, autoria Rota e
Fluxo visual e mapa da missão em voo estão implementados. A validação
automatizada fica registrada pelos testes de `missionGraph`,
`missionGraphRuntime`, `missionState`, `missionPlans` e pelas suítes do store de
Missões. A apresentação do grafo é testada isoladamente em
`missionGraphPresentation`; a reconciliação de fábrica e as falhas de checkpoint
têm suítes próprias.
