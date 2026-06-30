# MISSÃO — Modo SDD (feature delivery cockpit)

> **Status:** em construção (spike validado contra dados reais). Abre 2026-06-29.
> **Norte:** Linear = perguntar e executar rápido · Fusion = comparar e decidir melhor · **SDD = planejar, contratar, implementar, verificar, revisar e entregar com rastreabilidade.**
> **Fonte do fluxo:** `vinicius1209/skills` (brief completo do fluxo real) + os 20 planos reais do prime-sales-hub. **Decisão:** seleção≫fusão e PRD-é-o-único-gate continuam valendo.

Esta missão nasce de um prompt de design de outra LLM (arquivado abaixo) — **corrigido** contra o fluxo real. As correções são a parte importante.

---

## 1. O conceito (o que o SDD É no cockpit)
SDD é a **linha de montagem** do usuário ("assembly line for AI-assisted feature development"). A unidade NÃO é a mensagem — é o **feature plan**, materializado no `manifest.json` sob `.claude/plans/{slug}/`. Cada estágio do pipeline = **um run headless** de uma skill (`/discovery`→`/prd`→`/spec`→`/developer`→`/test-suite`→`/code-review`→`/pr`) por um agente fixo (architect/dev/dba/tester/code-review/qa-smoke). O cockpit **reusa o AgentRunner** pra dirigir + **vigia o manifest no disco** pra refletir o estado.

**Filosofia herdada (não negociável):**
- **Manifest = verdade no disco.** O cockpit é **file-watcher primeiro, driver depois** — fica correto mesmo se um estágio rodar no CLI cru.
- **PRD é o ÚNICO gate humano duro.** SPEC é automático (self-check ≤1500 linhas + matriz sem células vazias). NÃO inventar gate de SPEC.
- **A Matriz de Cenários é o artefato-assinatura** (persona×estado; "célula vazia = bug futuro"; ≥3 linhas). É o **herói** da tela.
- **Estado honesto:** verification é **tri-state** (true/false/null = passou/falhou/não-rodou). null ≠ falha.
- **Hooks são informativos** (não mutam o manifest; só `check-pr-state` bloqueia). Skills mutam o manifest.

## 2. O state model (o que o cockpit renderiza) — schema REAL + extras observados
`.claude/plans/{slug}/manifest.json`. Campos: `slug, title, sponsor, branch (feature/…), created_at, stage, stages_completed[], artifacts{prd{path,approved,approved_at}, spec{path,approved_at}, migrations[], source_files[], tests[]}, promised_in_spec{scenario_matrix[{persona,input,ui[],backend}], navigation_surfaces[], consistency_anchors[{category,canon_file,reference_doc}]}, verification{...tri-state}, links{pr_url,issue_url}`.
**Extras vistos no dado real (tolerar/renderizar dinâmico):** `verification.lint_passing` (7º gate; `consistency_check_passed` VEM preenchido no live); `links.discussion_url`, `links.merge_commit`; top-level `merged_at`. **Stages reais vistos:** só `done`/`pr` (planos antigos), mas normalizar `developer→implementation`, `test-suite→test`, `code-review→review`, `release→(pós-pr)`. **5/20 pastas sem manifest** (operacionais) → pular graciosamente.

Pipeline canônico (8 nós): `discovery → prd → spec → implementation → test → review → pr → done`.

## 3. As correções ao prompt da outra LLM (o que estava errado)
| # | Erro do prompt | Correção |
|---|---|---|
| 1 🔴 | Inventa **gate de aprovação do SPEC** ("block until SPEC approved") | PRD é o **único** gate humano. SPEC self-checa e avança auto. |
| 2 | Type com campos errados (`spec.approved`, `scenario.ui:string`, `consistency_anchors:string[]`, `links.branch`) | Usar o **schema real** (ui é `string[]`, anchors são objetos, branch é top-level). Renderizar verification **dinâmico** (7 gates reais, não 6 fixos). |
| 3 | Fusion "merge"/"juiz decide gates" | Merge **morto**. Gates são **determinísticos** (não julgamento). "Fusion Review" só pra comparar 2 PRDs/SPECs/estratégias. |
| 4 | Driver-first | **Watcher-first** (manifest=verdade no disco). |
| 5 | Drift super-promete ("2 de 4 superfícies") | Drift real = `detect-stale-plans` (branch mergeado mas stage≠done). Análise rica = "a construir", não fingir que existe. |
| + | Não menciona **custo** | Custo por-estágio vem **de graça** do AgentRunner (já temos cost provenance). Mostrar (o usuário liga pra isso). |
| + | Sub-pondera **Matriz de Cenários** e ignora **LOG.md** | Matriz = herói. LOG.md = feed de atividade. `sdd-next-step.sh` já computa o "próximo passo" → surfar o sinal, não recalcular. |

## 4. A forma (distinta de Linear/Fusion): a Linha de Montagem
```
┌ Feature: <título> · stage atual · próximo passo (do sdd-next-step) ──────┐
├ ●discovery ─ ●prd ─ ◉spec ─ ○impl ─ ○test ─ ○review ─ ○pr ─ ○done ───────┤
├ Estágio ativo (workspace) ───────────────┬ Contrato da SPEC ─────────────┤
│  artefatos (PRD.md ✓ · SPEC.md) ·        │  Matriz de cenários (HERÓI)   │
│  rodar o agente da etapa (AgentRunner) · │  Superfícies afetadas          │
│  custo/tempo do estágio                  │  Âncoras de consistência       │
├ Gates de verificação (tri-state, dinâmico) ──────────────────────────────┤
│  ✓ testes  ✓ build  ✓ types  ✓ lint  ○ cenários  ○ superfícies           │
├ Links · branch · PR · merged_at · drift badge · LOG.md (atividade) ───────┤
└──────────────────────────────────────────────────────────────────────────┘
```
Microcopy pt-BR amigável (esconder `promised_in_spec`/`scenario_matrix` etc.): "Contrato da SPEC", "Matriz de cenários", "Gates de verificação", "Etapa atual", "Aguardando aprovação", "Drift detectado".

## 5. Comportamento: copiloto por padrão, autopilot guardado
Copiloto = o cockpit sugere o próximo passo, você confirma. Autopilot guardado (opt-in) = avança sozinho até um **gate** (aprovação de PRD, falha de verificação, drift). **Pausa obrigatória antes de:** aprovar PRD, criar PR, marcar done, sobrescrever gate falho, ignorar drift. (SPEC NÃO é pausa de aprovação — é auto.)

## 6. Reuso vs novo
**Reusa:** AgentRunner (cada estágio = 1 run), cost provenance, os cards de tool/result, permissões-por-projeto (respeitar read-only do code-review/qa-smoke). **Novo:** o watcher/parser do manifest, a pipeline view, os gates tri-state, a matriz, o drift badge.

## 7. Sequência de build (incremental, spike-first, build-verificado)
- **S0 spike** ✅ — escaneados os 20 planos reais; mapeada a variedade (7 gates, extras, 5 sem-manifest, matriz preenchida). Parser validado mentalmente.
- **v1 — dashboard WATCHER read-only:** `read_sdd_plans` (Rust) + `lib/sdd.ts` (normalizer defensivo) + `SddView` (lista de planos + pipeline + gates + matriz + artefatos + LOG). **Sem dirigir nada.** Vê o estado dos 20 planos.
- **v2 — dirigir 1 estágio:** `/{stage} {slug}` via AgentRunner + o **gate do PRD** como ação real (o cockpit escreve `artifacts.prd.approved` — novo mutador, com cuidado).
- **v3 — autopilot guardado** + drift badge + PR state + captura dos findings do code-review (que hoje não são persistidos).

## 8. Riscos a absorver
Stage-vocabulary drift (normalizar) · tri-state (null≠falha) · campos extras (render dinâmico) · pasta sem manifest (pular) · dados que não existem (findings do code-review, telemetria por-estágio) → o cockpit **gera/captura** isso, não finge que o backend tem.

---

## Anexo — prompt original da outra LLM (referência, NÃO seguir cego)
Ver histórico da conversa. Resumo: propôs SddModeView/SddPipeline/SddStageNode/SddVerificationGates/SddManifestInspector etc., layout header→pipeline→estágio→contrato→gates→links, copiloto+autopilot, reuso do AgentRunner, microcopy amigável, 5 fases. **Bom (~80%), mas com os 5 erros da §3** — usar como inventário de componentes + checklist de aceite, com as correções acima sobrepostas.
