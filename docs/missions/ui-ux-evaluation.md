# Avaliação da Missão UI/UX — Decisão

## TL;DR
O relatório tem um viés duplo — "produto pra muitos usuários" + "Fusion = fundir" — que colide de frente com seus dois pilares mais fortes (pessoal-primeiro; seleção≫fusão). O time de avaliação defendeu o núcleo **sem uma única brecha** e rejeitou corretamente toda feature cara de LLM. A colheita real é pequena e 100% zero-LLM: **~1 dia de trabalho** (5 tooltips/dot/notice/1 linha de custo) faz o produto "explicar a própria inteligência" (a tese da §17) sem ganhar 1px de peso. O grosso do relatório é **already-done** (olhou telas velhas) ou **v0.3** (Git/worktrees). Há 2 correções a fazer no próprio parecer dos avaliadores (um "aligned" incoerente e um "defer" mole) e 1 gap ótimo que **ninguém** viu: a vitória da disputa some sem rastro ao voltar pro Linear.

---

## Já feito — o relatório olhou tela velha (NÃO refazer)
Tudo abaixo foi verificado no código atual; o revisor externo descreveu UI anterior ao redesign.

- **FusionVerdict único** (FusionBoard L203-252): racional em largura cheia + ações em linha separada + sugestão do juiz **pré-selecionada** + botão **"Confirmar <agent>"** dinâmico. Resolve §5.4 e §5.6.
- **Estados ortogonais** sugerido (badge brass) / selecionado (ring) / confirmar — separados, Design Principle 5 honrado (§5.6, §5.1 "suggested inline").
- **Spinner some em "deciding"** — `finish(convId)` em fusion.ts L349.
- **AgentSelect unificado** Linear↔Arena; **modal de expandir lane** (Maximize2 → Dialog 85vh); estados terminais pt-BR (concluído/erro/interrompido).
- **Custo com provenance** por-lane + agregado live no Fusion, e **por-turno** no Linear (model/duração/tokens/custo inline, com `~` quando estimado). Cobre §12 quase inteiro.
- **Sinal de confiança honesto**: "✓ concordou nas 2 ordens" (agreement binário da dupla-passada anti-viés) — mais honesto que o "Confidence: High" pedido.
- **Quick-action chips no empty-state** já existem (SuggestionChips), com sugestões dinâmicas pós-turno. Cobre §4.2(b)/§10.
- **Modo ativo** já com `bg-card + shadow` (segmented control Linear/Vercel) — §9 "tornar ativo visível".
- **Painel "No contexto do agente"** (CLAUDE.md/AGENTS.md/.claude com contagens reais) — §7 "Agent Knowledge".

---

## ✅ FAÇA

Base dos arquivos: `/Users/viniciusmachado/projetos/mycockpit/app/src/`

### Onda P0 — o corte enxuto (~1 dia, zero-LLM, zero densidade nova)
Este é o 20% que entrega 80%. Todos tornam o produto legível sem adicionar peso.

1. **Marcar a promoção do Fusion no transcript** *(gap novo — ninguém viu; o melhor item da lista)*
   Hoje `promoteFusion` (`store/chat.ts` L556-578) faz `items: [...cur.items, ...winner.items]` — a vitória da disputa **desaparece**: vira turno Linear comum, sem rastro de que houve juiz/escolha. É o momento-payoff do produto inteiro, invisível.
   **1º passo:** inserir um item `{ kind: "notice" }` antes do spread de `winner.items`. O tipo já existe (chat.ts L47) e já renderiza (MessageList L233). Uma linha. **Arquivo:** `store/chat.ts`. **S.**

2. **Dot "decisão pendente" na sidebar** *(o nugget mais fiel à visão)*
   Ao entrar em `deciding`, `finish(convId)` apaga o spinner da sidebar → uma disputa **já paga e concluída**, esperando seu clique, fica idêntica a uma conversa ociosa. É literalmente "o cockpit te avisa quando um agent espera por você".
   **1º passo:** selector de `useFusion` p/ o Set de convIds com `phase==='deciding'` (mesmo padrão de string-estável do `useRunningConvIds`); no slot fixo da Sidebar (L104-111), render um dot brass/queued com `title="decisão pendente"` quando `deciding && !running`. **Arquivo:** `components/layout/Sidebar.tsx` + `store/fusion.ts`. **S-M.**

3. **Tooltips por modo no ModeSwitcher** *(o win mais limpo do relatório)*
   `TitleBar.tsx` L34 só tem `title` no SDD indisponível; Linear/Fusion sem nada. 3 strings, zero chrome persistente.
   **1º passo:** `title` em cada `<button>` (L24-48). Copy pt-BR — Linear: "Fluxo simples com um agente principal"; **Fusion: "Vários agents respondem, um juiz compara e você confirma o vencedor"** (NUNCA "funde"); SDD: "Fluxo por especificações e etapas — em breve". **Arquivo:** `components/layout/TitleBar.tsx`. **S.**

4. **Tooltip no lock dos pills** *(gap novo)*
   `locked = conv.items.length > 0` (CommandConsole L99) congela agent/model/effort, mas o AgentSelect (ComposerParts L204) e os PillSelect não têm `title` — pills cinzas sem explicação ao voltar numa conversa.
   **1º passo:** `title="Agent e modelo ficam fixos a partir do 1º envio desta conversa"` no SelectTrigger do AgentSelect e nos PillSelect. **Arquivo:** `components/chat/ComposerParts.tsx`. **S.**

5. **Custo total da sessão no Linear** *(único delta real do §12)*
   Só existe custo por-turno; nada soma a conversa (`liveCostOf` é exclusivo do Fusion). Você paga $ real todo dia.
   **1º passo:** somar `costUsd` dos itens `kind==='result'` da ConvState; render muted/tabular-nums `sessão · ~US$X.XXX` no fim da MessageList (prefixo `~` se qualquer parcela for estimada). Reusar `fmtCost`. **Arquivo:** `components/chat/ChatPanel.tsx` (helper em `lib/format.ts`). **S.**

### Onda P1 — legibilidade no ponto de gasto + hierarquia barata
6. **Sparkles com consciência de custo** *(gap novo — o relatório falou de exibir custo, ninguém olhou controlar no ponto de gasto)*
   O ícone Sparkles dispara fan-out de N candidatos = 2+ runs **cobrados na hora**, sem sinalização. Sem modal (violaria minimal) — só tornar o clique informado.
   **1º passo:** `title` dinâmico nomeando liga + runs, ex. "Disputar: Claude + Codex (2 runs)" (ComposerParts L309). **Arquivo:** `components/chat/ComposerParts.tsx`. **S.**

7. **Corrigir a copy do empty-state que mente** *(gap novo)*
   "Abra um chat e coloque seu time…" (ChatPanel L168-172), mas `openProject` **sempre** já abre/cria uma conversa — não há "abrir um chat" a fazer.
   **1º passo:** sub-copy aponta a ação real, 1 linha, sem enumerar capacidades (ex.: "Descreva uma tarefa para seu time de agents em {project.name}."). **Arquivo:** `components/chat/ChatPanel.tsx`. **S.**

8. **Hierarquia do header de candidato (§5.1 legítimo)**
   Header com peso quase igual (status/label/custo todos muted). Subir o nome do agent, rebaixar o resto a metadata. Componente compartilhado → corrige Board **e** Arena de uma vez.
   **1º passo:** promover `c.label` a `text-foreground` (FusionBoard L89), manter statusIcon/custo `tabular-nums` muted. Sem dado novo. **Arquivo:** `components/fusion/FusionBoard.tsx`. **S.**

9. **Abrir disputa na Arena a partir do board embutido (§6.4)** — *valor marginal, mas barato e infra pronta*
   A Arena já lê `byConv[activeId]`; falta só 1 affordance. Útil pra ligas de 3-5 (colunas paralelas), marginal pra 2.
   **1º passo:** link discreto "abrir em tela cheia" no header do board (FusionBoard L167-176) → `setViewMode('fusion')`. **Arquivo:** `components/fusion/FusionBoard.tsx`. **S.**

### Onda P2 — polimento (só com fôlego sobrando)
10. **Microcopy "pré-selecionada" vs "✓ escolhida" (§5.6)** — quando `selected===judge.suggestedId` e o usuário não trocou, o pill diz "pré-selecionada"; vira "escolhida" só após clique manual. Resolve o resíduo de atribuir ao usuário uma escolha do juiz. **Arquivo:** `components/fusion/FusionBoard.tsx`. **S.**
11. **Dedup `project.name` na TitleBar (§4.1 nit)** — aparece 2× (breadcrumb + InstrumentStrip). Manter um. **Arquivo:** `components/layout/TitleBar.tsx`. **S.**

---

## ⚠️ NÃO FAÇA / REPENSAR

### Merge / Fundir — **P0 de NÃO-fazer** (§5.4 "[Merge best parts]", §5.5, §6.3 "[Fundir respostas]", copy "funde" §9/§16)
A evidência é direta: **seleção win-rate 0.81 vs síntese/merge 0.51** — fundir **degrada** qualidade comprovadamente; "o Fusion compara, não funde". Além de pior, custa uma chamada LLM de síntese ($ + latência) pra produzir o resultado inferior. O código já está certo ao proibir (`lib/fusion.ts` L81: *"NÃO combine, NÃO funda, NÃO reescreva… escolha exatamente UM rótulo"*) e ao promover o transcript inteiro do vencedor. O relatório chamar merge de "um dos improvements mais importantes" está **exatamente invertido**.
A escotilha "se um dia entrar, opt-in experimental" é **deferred-bad, não backlog** — não deixar borrar com os `defer` legítimos. Banir o verbo "funde/fundir" de toda copy de Fusion.

**A alternativa que honra o desejo do revisor SEM fundir:** o que ele realmente quer é *entender as duas respostas sem ler tudo* — isso é uma camada de **ENTENDIMENTO da seleção**, não geração de híbrido. Via **zero-custo**: expor o `runnerupId`/`passes[]` que o juiz **já computa** (`lib/fusion.ts`) — ex. um rodapé no veredito "2º: <label>". Dá o sinal comparativo de graça. O semantic-diff caro de 3 colunas ("o que só X disse") fica explicitamente **atrás** de "só se o runnerup se provar insuficiente no uso diário" — não estacionado como Phase-4.

### Features que custam chamada de LLM extra (cada uma = $ + latência, pagos por você antes de decidir)
- **Semantic diff (§5.3), profile tags Strategic/Practical (§5.1), candidate summaries Strengths/Weaknesses (§5.2)** — inventam dado que não existe nos transcripts crus; segunda inferência pra resumir o que o modelo já produziu, atrasando a decisão. **Reject.** (§5.3 fica como `defer` só na variante zero-custo acima.)
- **Confidence numérico do juiz (§5.1/§5.4)** — falsa precisão: o contrato é "pick one"; uma auto-nota do modelo é ruído. O sinal honesto (agreement binário) já está exposto. **Reject.**

### REPENSAR um veredito dos próprios avaliadores
- **§5.1 "tempo decorrido por candidato"** foi marcado **"aligned"** — está incoerente e deve virar **defer**. O próprio rationale admite "imposto de densidade num header já cheio" e "valor marginal". O header na fase `deciding` já tem 6 elementos; um 7º contradiz o item-irmão (§5.1 "header mais forte", que quer *reduzir* pesos concorrentes). **Restrição dura:** nunca no header da lane; no máximo no modal de expandir, e só **depois** do fix de hierarquia (#8). Um selo "aligned" sinaliza "só adiciona" — e isso piora o problema que a §4.1 quer resolver.

### Product-shaped / fora de escopo (contradizem pessoal-primeiro ou são v0.3)
- **Agrupar sidebar em Chats/Tasks/Specs/Fusion runs/Branches (§8)** — não há modelo de "tipo" (`ConversationMeta` = id/title/updatedAt); Fusion vive *dentro* de uma conversa; branches são v0.3. Os "títulos genéricos" (ola/oi) são as **suas próprias palavras** (1º prompt), memória sua — não ruído a corrigir.
- **Grupo "Execution" no painel direito (§7)** — duplicaria InstrumentStrip + MessageList; contradiz a decisão consciente de **status single-source** (comentada em TitleBar L62-63).
- **Status granular no Linear (§11) + stepper de 4 passos do Fusion (§11)** — redundante com os ToolCards (já mostram Read/Bash/Grep ao vivo) e com o header "juiz avaliando…"; heurística frágil ("Running tests" = farejar Bash por `/test/`). E o stepper inventa uma fase ("Comparing answers" não é observável fora do juiz).
- **Seções colapsáveis no ContextPanel (§7)** — YAGNI: o painel já é seccionado e renderiza condicional. Só se provar longo demais no uso diário.
- **Branch no painel (§7) + workspace full-screen / Create branch (§10/§14)** — leitura git e worktrees = **v0.3**.
- **Reescrever o empty-state como pitch de produto (§4.2)** — enumerar "analisar/implementar/revisar/comparar" assume "novo usuário descobrindo o produto"; não existe (ADR-001). A correção certa é o #7 (apontar a ação real), não a vitrine.

---

## ❓ Decisões que preciso do Vini
São as tensões reais; minha recomendação em cada uma.

1. **Até onde vai "entender as duas sem ler tudo"?** Recomendo parar no **sinal zero-custo** (runnerup do juiz no rodapé do veredito). Você topa, ou quer reservar o semantic-diff caro (3 colunas, 1 chamada LLM por disputa) como experimento futuro condicionado a "o runnerup não bastou"? **Minha recomendação: parar no zero-custo até o uso provar que falta.**

2. **Merge: morto de vez ou escotilha experimental?** Recomendo **morto como ação do produto**. Se um dia coçar, não é botão no veredito — é você abrir um turno **novo** no Linear digitando "pegue o melhor de cada das respostas acima". Mantém seleção≫fusão intacto e não cola UI de fusão no caminho primário. Confirma?

3. **Taste calls de copy (pt-BR, suas palavras):**
   - Tooltip Fusion: **"Vários agents respondem, um juiz compara e você confirma o vencedor"** — ok?
   - Notice de promoção: **"Promovido da disputa · juiz sugeriu {X} · você confirmou {Y}"** — ok, ou mais curto ("Vencedor da disputa promovido · {Y}")?
   - Sub-copy empty-state: trocar "Abra um chat e coloque seu time…" por **"Descreva uma tarefa para seu time de agents em {project.name}."** — ok?
   - Custo de sessão: **"sessão · ~US$X.XXX"** vs algo mais explícito?

4. **Dot de decisão pendente cross-project:** `ConversationList` só renderiza sob o projeto ativo — uma disputa pendente em **outro** projeto não aparece nem com o dot. Aceita como **limite conhecido (v0.3)**, ou quer um sinal no nível do projeto também? **Minha recomendação: limite conhecido — baixa frequência no uso solo.**

---

## Sequência recomendada
1. **#1 (marcar promoção)** — comece aqui. Uma linha, e é o momento-payoff do produto inteiro ficando legível. Prova valor imediato.
2. **#2 (dot decisão pendente)** — fecha o gap mais fiel à visão ("o cockpit te avisa quando um agent espera por você"). É o que mais vai *sentir* diferente no uso diário.
3. **#3 + #4 (tooltips de modo + lock)** num só commit — mesma natureza (copy estática), e travam a copy "confirma o vencedor".
4. **#5 (custo de sessão)** — consciência de gasto, você paga $ real.
5. **Onda P1** quando sobrar fôlego (#6 e #7 são os de maior retorno por serem correções de honestidade); **P2** é polimento opcional.

**O que prova valor mais rápido:** #1 e #2. Os dois transformam "explicar a própria inteligência" (a tese da missão §17) de promessa em coisa visível — sem 1px de peso novo. Todo o resto do relatório reprova no filtro: *custa LLM? contradiz seleção≫fusão? é v0.3? já existe?*