# MISSÃO — UI/UX Improvement (Frota)

> **Status:** ✅ CONCLUÍDA — avaliada por um time de 10 agents (ver `ui-ux-evaluation.md`); Ondas **P0 + P1 + P2** implementadas (commits 117ed22 / 9ad558d / este). Merge e features caras de LLM (semantic-diff/tags/summaries/confidence) **reprovadas com justificativa**.
> **Aberta:** 2026-06-28 · **Fonte:** relatório de um revisor externo de UI/UX.
> **Regra:** cada ponto deve ser avaliado criticamente contra (a) o código atual, (b) a visão do produto + decisões já tomadas, (c) viabilidade na arquitetura CLI-driven, (d) o princípio "minimal/elegante". Pontos que contradizem decisões já validadas (ex.: **seleção ≫ fusão**) devem ser sinalizados, não implementados às cegas.

---

## 1. Context

Frota é um cockpit desktop/web-like para trabalhar com agents de código em vários projetos. Três modos: **Linear** (single-agent conversacional), **Fusion** (multi-agent: N candidatos respondem, um juiz avalia, o usuário escolhe/confirma), **SDD** (spec-driven, futuro). A UI já tem direção visual forte (minimal, premium, tipo Linear/ChatGPT), mas precisa de mais clareza de UX, hierarquia, comunicação de estado e uma experiência de decisão do Fusion mais poderosa. **Não é redesign do zero** — melhorar preservando a identidade.

## 2. Product Vision

Deve parecer um workspace sério para orquestrar agents, não só mais um chat. "O usuário começa simples, trabalha linearmente, e escala para workflows mais profundos quando precisa." O sistema deve deixar óbvio: projeto/tarefa/modo ativo, qual agent trabalha e o quê, o que fazer a seguir, quando agents discordam, por que uma resposta é recomendada, o que acontece após confirmar.

## 3. Current Strengths
1. Estilo visual limpo (minimal, premium, calmo).
2. Fundação estrutural boa (sidebar projetos/conversas │ centro │ painel de contexto).
3. Conceito Fusion forte (comparar Claude/Codex; juiz reduz fadiga de decisão; escolher vencedor dá desfecho claro).
4. Fusion dentro do Linear é bom padrão (progressive disclosure: simples por default, poderoso quando preciso).

## 4. Main UX Problems

### 4.1 Hierarquia visual fraca
Projeto/modo/status/headers de agent/custos/CTAs com peso visual quase igual. Melhorar hierarquia sem deixar pesado; info escaneável em 2–3s; usar espaçamento, peso de tipo, contraste, badges, bordas, agrupamento.

### 4.2 Empty state não explica o produto
"Boa noite, Vinícius" é amigável mas não comunica valor. Guiar para ação.
- Copy: "Boa noite, Vinícius. Escolha um projeto, descreva uma tarefa e deixe os agentes ajudarem a analisar, implementar, revisar ou comparar soluções."
- Quick actions: Explicar o projeto · Revisar código · Criar uma SPEC · Comparar agentes · Rodar testes · Criar uma branch · Continuar última tarefa.

### 4.3 Fusion deve virar experiência de DECISÃO, não só comparação
Hoje depende do usuário ler respostas longas. Problemas: 2 respostas longas lado a lado = sobrecarga; comparação manual; recomendação do juiz pouco estruturada. Fluxo ideal: pergunta → candidatos geram → resumo de cada → juiz compara → UI mostra diferenças/concordâncias/contribuições únicas → recomenda vencedor → usuário pode confirmar / escolher outro / **fundir as melhores partes** / pedir resposta refinada / descartar.

## 5. Fusion UX Requirements

### 5.1 Candidate cards (header mais forte)
Metadata: agent, status, modelo, custo, tempo decorrido, score/recomendação do juiz, tag de perfil. Ex.: "Claude · Suggested by judge · US$0.358 · 2m14s · Strategic · More complete" / "Codex · US$0.099 · 1m02s · Practical · More direct". Tags: Strategic, Practical, Safer, More technical, More complete, More concise, Better for implementation, Better for architecture.

### 5.2 Candidate summary (antes da resposta cheia)
Resumo compacto: Strengths / Weaknesses / Best use. Colapsável ou fixo acima da resposta.

### 5.3 Semantic diff entre candidatos
Camada de comparação: "Where they agree" / "Only Claude mentioned" / "Only Codex mentioned". **Crítico** — transforma "leia as duas" em "entenda a decisão".

### 5.4 Judge recommendation block
Mais importância visual + estrutura: "Suggested winner: Claude · Why: (bullets) · Confidence: High · Actions: [Confirm Claude] [Choose Codex] [Merge best parts] [View detailed comparison] [Discard]". Claro mas não pesado.

### 5.5 Add "Merge best parts"
Como o modo é Fusion, não terminar só em escolha binária. Ações: Merge best parts / Generate final merged answer / Use Claude as base + Codex checklist / etc. Comportamento: gera resposta final usando um candidato como base + partes valiosas do outro. "Um dos improvements mais importantes."

### 5.6 Clarify candidate states
"sugerido", "escolhida", "escolher esta" confundem. Definir explícito: **Sugerido pelo juiz** (recomendação, não confirmado) · **Selecionado** (seleção temporária do usuário) · **Confirmado** (decisão final). Copy: "Sugerido pelo juiz", "Selecionado", "Confirmado", "Escolher esta", "Confirmar Claude", "Confirmar Codex". Não misturar "sugerido"/"escolhida" de forma ambígua.

## 6. Fusion Inside Linear
- 6.1 Modelo mental: Linear é o default; Fusion dentro do Linear é ação contextual, não troca de modo. Labels: "Comparar com outro agente", "Pedir segunda opinião", "Abrir disputa", "Rodar em Fusion", "Validar resposta com Fusion".
- 6.2 Esclarecer diferença Linear vs Fusion mode (Fusion existe como modo E como ação) via tooltip/onboarding.
- 6.3 Card Fusion embutido no Linear = card de decisão compacto (resumos + expandir, não 2 respostas gigantes por default). "[Confirmar Claude] [Fundir respostas] [Abrir em tela completa]".
- 6.4 Abrir Fusion no workspace cheio a partir do card embutido ("Abrir em Fusion"/"Expandir disputa"). Hierarquia: Linear embedded = review compacto; Fusion mode = workspace cheio.

## 7. Right Context Panel
Poderoso mas denso. Agrupar em grupos colapsáveis: **Project** (nome/path/branch) · **Execution** (agent ativo/modelo/permissões/custo/status) · **Agent Knowledge** (CLAUDE.md/AGENTS.md/.claude) · **Personas** · **Specs** (com badges de status). Mais importantes expandidos por default; badges claros; menos texto secundário no mesmo nível.

## 8. Sidebar
Lista de conversa/tarefa genérica demais ("ola", "oi", "você e o codex?" não comunicam tipo/status). Agrupar (Chats/Tasks/Specs/Fusion runs/Branches) ou ao menos indicadores de tipo/status: Chat/Task/Fusion/Done/Running/Error/Waiting-for-review (ícone + status dot + badge + timestamp + agent). Ex.: "🟡 Fusion · você e o codex?" / "✓ Spec · Lead history audit" / "○ Chat · ola".

## 9. Mode Switcher
Distinção mais clara: tooltips/descrições, modo ativo mais visível, mostrar propósito do modo perto do input/header, "SDD soon" desabilitado mas informativo. Tooltips: Linear ("Fluxo simples com um agente principal"), Fusion ("Múltiplos agentes respondem, um juiz compara, você escolhe ou funde o melhor"), SDD ("Fluxo estruturado por especificações e etapas").

## 10. Input Area
Sentir-se como command center. Ações: Explain project / Run tests / Create branch / Create SPEC / Compare agents / Review code / Continue last task. Placeholders por modo: Linear ("Ask, plan, implement, or review…"), Fusion ("Ask something and compare multiple agents before choosing…"), SDD ("Create or continue a structured specification").

## 11. Status & Feedback
Sempre comunicar o que acontece: Thinking / Reading project context / Searching files / Running tests / Comparing candidates / Judge evaluating / Waiting for confirmation / Confirmed / Failed / Cancelled. Fusion: 1. Generating candidates 2. Comparing answers 3. Judge evaluating 4. Waiting for your decision (progress indicator).

## 12. Cost Display
Mais compreensível + hierarquia: "Claude · US$0.358 / Codex · US$0.099 / Fusion total · US$0.457". Linear: "This response: US$0.314 / Session total: US$0.457". Subtle mas mais claro.

## 13. Design Principles
1. Não deixar pesado (preservar minimal/premium). 2. Clareza > decoração. 3. Progressive disclosure (resumo primeiro, expandir depois). 4. Fusion decision-first (escolher/fundir/finalizar, não só exibir). 5. Separar recomendação do sistema da decisão do usuário ("Sugerido" ≠ "Confirmado"). 6. Sentir-se como cockpit (no controle de agents/tarefas/contexto/desfechos).

## 14. Prioritized Implementation Plan (proposto pelo revisor)
- **Phase 1 — Quick UX wins:** empty state copy + quick actions; mode switcher active state + tooltips; hierarquia projeto/tarefa; status labels de agent; labels de custo; CTAs mais visíveis.
- **Phase 2 — Fusion decision layer:** candidate summaries; metadata; judge block; estados explícitos; "Merge best parts"; "Open in Fusion" do card embutido.
- **Phase 3 — Right panel & sidebar:** grupos colapsáveis; hierarquia; tipos/status na sidebar.
- **Phase 4 — Advanced Fusion:** semantic diff; "where they agree"; "only X mentioned"; judge confidence; resposta consolidada; workspace full-screen.

## 15. Acceptance Criteria
1. Novo usuário entende o que fazer pelo empty state sem explicação. 2. Projeto/modo/tarefa ativos óbvios. 3. No Fusion, entender qual é recomendado sem ler as duas respostas. 4. Distinguir sugerido/selecionado/confirmado. 5. Juiz explica claramente o porquê. 6. Fundir melhores partes. 7. Fusion no Linear = ação contextual, não troca confusa. 8. Painel direito organizado. 9. Sidebar comunica status melhor que títulos genéricos. 10. UI continua minimal/premium.

## 16. Suggested PT-BR Copy
(Empty state, mode descriptions, Fusion actions, Fusion states, judge block — ver seções 4.2, 9, 5.x, 6 acima.)

## 17. Final Direction
Preservar a identidade visual. Próximo passo: fazer o produto **explicar melhor a própria inteligência**. Shift de UX: de "aqui estão duas respostas, leia e escolha" para "aqui estão os candidatos, como diferem, o que o juiz recomenda, e as melhores próximas ações". Sentir-se como um verdadeiro cockpit de trabalho com IA: calmo, poderoso, explicável, orientado a decisão.
