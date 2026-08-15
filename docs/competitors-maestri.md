# Concorrente: Maestri (themaestri.app) — anatomia e lições

> Estudo de 14/08/2026, por leitura do SITE público (pt-BR) — o Maestri é
> fechado (Swift/SwiftUI, macOS 15.4+ Apple Silicon), então aqui não há
> file:line deles, só as REGRAS que o produto deixa ver. Complemento empírico:
> o Maestri instala skills no Claude Code da máquina (`maestri`,
> `maestri-manager`, `maestri-portal`, `maestri-portal-devices`,
> `maestri-routines`, `maestri-workspace`) — observadas ao vivo nesta sessão.
> Os file:line abaixo são todos NOSSOS: apontam onde cada lição encosta no
> Frota.

## O que o Maestri é

Canvas infinito nativo (AppKit + Metal, "Liquid Glass") onde agentes são
objetos espaciais: terminais (Claude Code, Codex, OpenCode ou shell), notas
adesivas conectadas a terminais, portais de dispositivo (browser, simulador
iOS, emulador Android, aparelho físico — o agente lê árvore de elementos,
não pixels), desenhos à mão, "Andares" (clones copy-on-write de workspace
via APFS) e "Partitur" (arranjos completos salvos para reuso). Sobre tudo
isso, o **Ombro**: companheiro de IA on-device (Apple Foundation Models) que
vigia os agentes, resume a tarefa concluída e sugere o próximo passo numa
janela flutuante fora do app.

Comercialmente, valida a nossa tese sem nos ameaçar nela: grátis + Pro de
R$95 **pagamento único**, sem conta, zero telemetria, config em JSON plano e
notas em Markdown — o mesmo posicionamento local-first/compra única que já
escolhemos. A diferença é de tese de produto: o Maestri é um **espaço para
observar** agentes; o Frota é um **fio para decidir** com agentes
(`docs/STYLEGUIDE.md` §"cockpit de decisão", ADR-037). E macOS-only vs nosso
Mac/Linux.

## Os achados

### 1. Ombro: o fim de tarefa conta O QUE aconteceu — nosso gap mais real
Quando um turno nosso termina em background, a notificação diz literalmente
`"turno concluído"` / `"turno falhou"` (`app/src/lib/notify.ts:131-135`).
Síntese do que o agente fez só existe em Missão (`DoneSummary.tsx`,
`PhaseReceipt.tsx` lendo `HandoffDoc.decisions[]`); no chat comum, zero. As
sugestões de próximo passo existem mas são rasas: 3 chips de ≤6 palavras,
contexto de 6 mensagens (`app/src/lib/suggestions.ts:16-19`). O Ombro prova
que o momento "agente terminou" merece conteúdo, não só evento. **A forma
deles (janela flutuante) é redundante para nós** — já temos sino + nativa +
tray + Companion (ADR-013: 3 canais, nenhum silencioso); um 4º flutuante
seria ruído. A alma (resumo + próximo passo NO canal que já temos) é o que
falta.

### 2. On-device é arquitetura E marketing — e nós já temos o molde
"100% on-device, Apple Foundation Models" vende privacidade e custo zero
marginal — argumento forte num público que paga por token. Limites que o
site não diz: o modelo é pequeno (~3B), exige macOS recente com Apple
Intelligence, e prende no Mac. Nosso único on-device hoje é o ditado
(`app/src-tauri/stt/main.swift`, SFSpeechRecognizer pt-BR, ADR-034) — que é
exatamente o precedente de sidecar Swift que um "resumidor" on-device
seguiria. Mas miramos Linux também: o caminho primário é o helper que já
existe (`helperModel`, haiku one-shot); on-device é otimização posterior com
fallback, nunca o ponto de partida.

### 3. Abrir no editor: um clique para VS Code/Zed/Xcode
No Frota **não existe** (grep exaustivo): o opener só abre URL de PR,
evidência no app padrão e "mostrar na pasta" (`app/src/lib/contextMenu.ts:76`,
`src-tauri/src/evidence.rs:238-245`). A matéria-prima está toda pronta —
path do projeto, worktree por conversa/missão, `files_touched` do handoff
(`app/src/lib/missionHandoff.ts:18-32`), diff com arquivo e linha
(`DiffPanel.tsx`). Falta só o gesto (`vscode://file/<abs>:<linha>`,
`zed://file/...`, fallback `open -a`). Melhor razão valor/custo do estudo.

### 4. Notas adesivas escritas por agentes — a forma é deles, a alma já é nossa
"Conecte um terminal a uma nota e deixe o agente escrever nela" é texto
livre espacial. Nosso equivalente em Missão é SUPERIOR: `HandoffDoc` tipado
(intenção, decisões choice/rejected/reason, pendências) gravado em disco e
exibido no recibo da fase (`9c9abf9`). O que a comparação expõe: (a) no chat
comum não há registro nenhum; (b) a nota que o USUÁRIO escreve no
`TurnFeedback` é descartada após virar `lessons.rule` — anotação ancorada em
mensagem não existe.

### 5. O app se oferece como ferramenta AO agente
O achado mais sutil, visto ao vivo: o Maestri instala skills no Claude Code
para o agente pilotar o canvas — falar com outro agente, escrever nota,
criar workspace/andar, agendar rotina, dirigir simulador. A integração é
bidirecional: o app não é só host do agente, é ferramenta dele. Nosso
paralelo é embrionário: `.mycockpit/commands/*.md` dá slash commands, mas o
Frota não expõe capacidades próprias (agendar, registrar decisão, escrever
no fio) como tools/skills que o motor invoque.

### 6. Delegação agente-a-agente "sem você mover um dedo" — anti-doutrina
Terminais conectados delegam, perguntam e passam trabalho adiante sozinhos.
É exatamente o "despacho por LLM" que decidimos NÃO absorver do MyPeople:
nossa passagem de trabalho é handoff tipado entre fases com gate humano
(ADR-021/030), e run desassistido responde fail-closed
(`app/src/lib/watchdog.ts`, `checkUnattendedInteractions`). Não é gap, é
escolha — manter.

### 7. Andares (APFS) e Partitur — ideias validadas, idiomas diferentes
Clone copy-on-write de workspace inteiro ≈ nosso worktree por
missão/conversa (e R4 do roadmap: worktree por sessão). A ideia comum é
"isolamento barato por experimento"; nosso idioma é git, não filesystem.
Partitur (arranjo salvo de agentes+papéis+notas) ≈ nossos presets/personas
versionados por digest + agendamentos. Paridade — nada a copiar.

### 8. Portais de dispositivo com árvore de elementos
"O agente lê a árvore real, não adivinha pixels" — mesma regra do nosso
browser B0/B1 (ADR-029). O que eles têm a mais é simulador iOS/emulador
Android embutido. Nosso `browser-plan` B2.3 (painel embutido) é condicional
por decisão — "só se a demanda provar". O Maestri é um ponto de demanda a
anotar, não a razão para antecipar.

## Trazer pro Frota (ranqueado)

**M1 — Abrir no editor (altíssimo / baixíssimo).** Probe de editores
instalados (mesmo padrão do Setup Guide, ADR-039), URL scheme com arquivo e
linha, fallback `open -a`. Superfícies: header do projeto, `DiffPanel`,
recibo de fase (`files_touched`), menu de contexto próprio (ADR-042 — o F2
já mira bloco de texto; caminho de arquivo é o alvo seguinte natural).

**M2 — Recibo de turno: o fim de turno diz o que fez (alto / baixo).**
Estender o pipeline existente de sugestões (debounce + token de invalidação
em `store/chat.ts`, motor puro em `suggestions.ts`): além dos 3 chips, gerar
1 frase de resumo do turno, e usá-la como corpo em TODOS os canais que já
temos — nativa (`notify.ts:131-135` deixa de dizer só "turno concluído"),
sino, tray, Companion. Mesmo knob (`helperModel: null` = desligado, custo
zero para quem não quer). Fase 2 opcional, não bloqueante: sidecar Swift
FoundationModels no molde do `stt/main.swift`, com fallback no helper — Mac
ganha on-device, Linux segue no helper.

**M3 — Quote-reply no fio (médio / médio).** Responder/citar uma mensagem
específica, estilo Slack SEM thread: campo opcional `replyTo?: { itemId }`
no `ChatItemBody` — padrão da casa (`reactions?`, `advisorTo?` em
`store/chat.ts`), sem migração de banco (o fio é blob JSON em
`conversations.items`), ancorado na invariante de id único
(`threadWindow.ts:23-28`). Render: chip de citação acima da mensagem, clique
rola até a original. A ordem cronológica NÃO muda — as invariantes de perf
(`windowStartIndex`) sobrevivem. Pré-requisito de rito: mock antes de
código, porque o fio está sob auditoria ativa de densidade
(`fio-poluicao-2.md`, ADR-037).

**M4 — Frota como ferramenta do agente (médio / médio, depois do registry).**
Expor capacidades do app ao motor (registrar decisão, agendar, anotar) como
tools/skills — o padrão que o Maestri prova em produção. Depende de decidir
a superfície (MCP server próprio? skills geradas por engine?) e esbarra no
capability registry — sequenciar depois dele.

## Onde somos melhores

- **Registro de decisões tipado** (choice/rejected/reason, injetado na fase
  seguinte) vs nota adesiva de texto livre.
- **Gates humanos + fail-closed + watchdog testado** vs delegação "sem mover
  um dedo".
- **Custo é feature central** (turn_costs, CostAudit, heatmap US$/h, medidor
  de janela ADR-038) — o site do Maestri não fala de custo em lugar NENHUM.
- **Mac/Linux** vs macOS 15.4+ Apple Silicon only.
- **Companion no celular** via LAN com pareamento por aceite (C1–C4).
- **Especialistas** com preset versionado por digest e parecer read-only vs
  "roles" de instrução reutilizável.

## NÃO trazer

Canvas infinito como superfície (ADR-037 é a aposta oposta e deliberada:
"o passado recolhe, o vivo respira") · editor de código embutido (nem o
Maestri, 100% nativo, construiu um — fez o atalho; cockpit de decisão não é
IDE) · janela flutuante como 4º canal de aviso · delegação livre
agente-a-agente · notas adesivas como forma (a alma já existe tipada em
Missão; o gap do chat comum se resolve com M2/M3, não com canvas) ·
simulador embutido agora (B2.3 segue condicional — anotar o Maestri como
sinal de demanda).
