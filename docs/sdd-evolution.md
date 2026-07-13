# SDD — avaliação honesta + plano de evolução

> Gatilho: features do prime-sales-hub presas em "aguardando /developer" com o
> trabalho JÁ FEITO. Diagnóstico + pesquisa da comunidade (spec-kit, OpenSpec,
> Kiro, BMAD, Agent OS, Taskmaster, ccpm, agent-orchestrator) em 2026-07-13.

## O diagnóstico (causa-raiz do sintoma)
O estágio do SDD é **DECLARADO, nunca DERIVADO**: só avança quando a UI roda a
skill (setPlanStage) ou o agente escreve o manifest. Trabalho feito fora do
trilho (chat Linear, manual) → o manifest mente e a UI acredita. Não há
reconciliação com a realidade (branch/PR/arquivos/testes). Ironia: o `pr_info`
JÁ consulta o estado real do PR via gh — e não o usa pra corrigir a fase.

## O que a comunidade convergiu (2025→2026)
1. **Evidência > declaração.** Os maduros DERIVAM a fase: spec-kit computa de
   existência de arquivos (bash, sem LLM); OpenSpec nem tem arquivo de status
   (varre pastas); BMAD regenera o agregado por scan com merge MONOTÔNICO
   (nunca regride); agent-orchestrator deriva de PR/CI/terminal.
2. **Reconciliação sob demanda, idempotente, append-only** onde derivar é caro:
   Kiro "Sync Files" (marca done o que a realidade mostra pronto) e
   `/speckit.converge` (classifica requisitos missing/partial/contradicts/
   unrequested olhando o estado presente; só APPENDA). Ninguém faz sync contínuo.
3. **Auto-relato do executor é o elo fraco universal**: Agent OS mediu ~50% de
   acerto no checkbox auto-marcado; corrigiu com um subagente CONTÁBIL separado.
   BMAD restringe permissões de escrita por seção.
4. **Pipelines rígidos foram TODOS afrouxados**: Kiro criou Quick Plan sem
   gates; spec-kit tornou clarify/analyze opcionais; BMAD virou scale-adaptive;
   Agent OS APOSENTOU as fases de execução. Padrão: fases núcleo + passos
   opcionais + trilha proporcional ao tamanho. Rigidez só nos gates de verdade
   (testes/review), não na ordem das cerimônias.

## Veredito: o SDD atual está pronto pra generalizar?
**Não como está.** Os ossos são bons — e temos 2 coisas que NENHUM projeto
pesquisado tem (custo por entrega via stage_runs; PR enriquecida via gh) — mas
4 fraquezas estruturais: estado declarativo sem reconciliação (o sintoma),
pipeline fixo de 8 etapas pra tudo (bugfix não precisa de PRD → o usuário fura
o fluxo → gera o próprio drift), acoplamento às skills do seed, e nenhum
escape manual pra corrigir o estado.

## Plano de evolução (por valor/custo)
1. **Fase derivada de evidência; manifest vira cache** (altíssimo/baixo):
   reconciliador DETERMINÍSTICO (sem LLM, Rust): prd.md existe→≥PRD; spec.md
   com matriz→≥SPEC; branch com commits→≥Implementação; testes verdes
   (executados, não lidos)→≥Testes; gh pr→≥PR; merged→Concluído. Roda no load,
   merge monotônico. Manifest mantém intenção/custo/histórico; perde o
   monopólio da fase.
2. **`/reconcile` (converge+sync), append-only** (alto/médio): agente read-only
   compara código vs matriz do SPEC, marca done o que está pronto, appenda
   tasks pros gaps; botão "Reconciliar" na UI, sugerido quando o item 1 detecta
   divergência.
3. **Quem implementa não contabiliza** (alto/baixo): skills param de declarar
   done; o reconciliador (ou um subagente contábil de contexto limpo) confere a
   evidência ao fim do stage.
4. **Trilha proporcional** (médio-alto/baixo): perfis `quick` (Descoberta→
   Impl→PR) e `full` (pipeline atual) escolhidos na criação da feature. Reduz o
   drift NA ORIGEM (trabalho foge do fluxo porque o fluxo é pesado demais).
5. **Intenção imutável + mudança vira delta** (médio/médio): PRD/SPEC de stage
   concluído read-only; mudança posterior vira delta estilo OpenSpec, mergeado
   na conclusão; update em cascata re-planeja o resto.

Fontes: github/spec-kit (converge, check-prerequisites), Fission-AI/OpenSpec,
kiro.dev (Sync Files, hooks), bmad-code-org/BMAD-METHOD (sprint-status por
scan, permissões por seção, issues #1930/#2199/#496), buildermethods/agent-os
(discussion #173: ~50% de acerto no auto-relato), eyaltoledano/claude-task-master,
automazeio/ccpm, AgentWrapper/agent-orchestrator.
