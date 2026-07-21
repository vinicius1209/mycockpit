# Agent Office — escritório virtual interativo

> Design doc v2 (revisado por painel adversarial: game feel, integração, performance).
> Evolução do spike `office-web/` (M0, SVG estático) para uma superfície interativa
> dentro do app. O spike permanece como **spec visual**; o código novo vive em
> `app/src/office/`.

## 1. Visão

O Office é uma **segunda superfície** do MyCockpit/Frota: um escritório isométrico
onde cada **projeto é uma sala**, cada sala tem **mesas para os agents** (Claude,
Codex, Antigravity), e o usuário é o **boss** — um avatar que anda pelo escritório
(WASD/setas + click-to-move), entra nas salas e vai até a mesa de um agent para
conversar (texto ou ditado por voz). A conversa é **real**: dispara um turno de
agent no runtime existente. Atividade real (turnos, missões, aprovações pendentes)
aparece **ao vivo** na cena: agent digitando, pensando, levantando a mão.

Não é um dashboard com skin de jogo; é uma interface alternativa de comando com
game feel de verdade (60fps, câmera, colisão, proximidade).

## 2. Decisões de arquitetura

| # | Decisão | Racional |
|---|---|---|
| O1 | **Modo dentro da webview principal** (`viewMode: "office"`), lazy-loaded — não segunda janela, não app separado | O stream de `AgentEvent` é `Channel` por-invoke (invisível a outras webviews) e todo o motor de conversa/missão vive nos stores zustand da janela main. Latência zero, zero ponte nova (camada fina). Porta aberta para janela própria depois (padrão `tray.html`) desde que o módulo office não importe UI do App. `viewMode: "office"` **não persiste** — rehidrata como `"linear"`. |
| O2 | **PixiJS v8 (≥8.5), renderer WebGL forçado, uso imperativo** (sem `@pixi/react`) | WKWebView não expõe WebGPU. `Application` com `resolution = min(devicePixelRatio, 2)`, `autoDensity`, `antialias: true` (MSAA barato em GPU Apple TBDR), `ticker.maxFPS = 60`. Init async com token de cancelamento (StrictMode monta 2×) + `import.meta.hot.dispose` destruindo a Application (vazamento de contexts WebGL no HMR). |
| O3 | **Sim em passo fixo 60Hz**; mundo mutável fora do React; zustand só recebe **transições discretas** | Clamp de 250ms no acumulador; pausa em `visibilitychange`; blur limpa teclas. **Boss renderiza sem interpolação** (snap ao estado da sim — latência de input mínima); interpolação só para NPCs e câmera. |
| O4 | **Projeção diamond 2:1** (`TILE_W=64`, `TILE_H=32`), coordenadas contínuas em tiles (float), y-sort por escalar (`screenY` dos pés) | Fórmulas fechadas world↔screen p/ picking. Mesas fatiadas **base + tampo**; segmentos de parede lateral na camada dinâmica (ocluem o boss corretamente). Velocidade constante em **espaço de mundo**, vetor de input normalizado (mesma |v| nas 8 direções — teste de engine). |
| O5 | **Grid global `Uint8Array`** com bitflags (`WALK\|DOOR\|INTERACT`), A* 8-direções próprio (heap binário, octile, sem corner-cutting) + string-pulling; move-and-slide com AABB nos pés | Salas pequenas; lib de pathfinding é dependência desnecessária. Clique em tile bloqueado clampa para o walkable alcançável mais próximo. |
| O6 | **Visual = spec do spike**, portado como `Graphics`/`GraphicsContext` programáticos | Paths do spike não têm arcos (só M/L/h/v/c/Z) — portam direto. Sombras = elipses alpha (sem filtros); glow de lâmpada = elipses alpha empilhadas (sem radial gradient obrigatório). Avatar decomposto em **partes com pivot** (corpo/braços/cabeça/props de estado); partes monocromáticas em geometria branca + `tint` por instância. Animação só transform/alpha, **fase aleatória por instância** (nada de uníssono), 2–3 variações de idle. Boss: bob vertical ao andar + flip por direção + squash ao parar. `prefers-reduced-motion` ⇒ poses estáticas. |
| O7 | **Envio de mensagem via `office/bridge/send.ts`** compondo APIs exportadas — ChatPanel intocado. Pré-requisitos fora de `office/` (§6.1) | A coreografia completa está em §5.6 — inclui as guardas e as peças de continuidade que o `handleSend` real tem. Testes de paridade com lista fechada (§9). |
| O8 | **Funciona no browser puro (vite dev) com dados simulados** — tudo que toca Tauri passa por `isTauri()` e tem fixture (`bridge/sim-data.ts`) | Desenvolvimento e verificação visual sem subir o Tauri; o spike já era "simulação". |

## 3. O mundo

- **Planta**: corredor horizontal central; salas em **duas fileiras** (acima e
  abaixo), uma por projeto (ordem de `listProjects`; alvo O-1: até 8 projetos).
  Sala 12×8 tiles, porta de 2 tiles para o corredor, faixa de estações ao norte,
  circulação central livre e apoio/verde restrito ao perímetro. Com 1 projeto, o corredor
  encolhe ao tamanho da sala (nada de maquete vazia).
- **Sala**: 3 estações (claude-code, codex, agy) recuadas da parede, com faixa
  técnica para cadeiras, atendimento frontal e corredor transversal contínuo;
  plantas e apoios ficam restritos aos nichos periféricos, e o nome do projeto aparece na parede
  (cor do projeto). CLI não detectado ⇒ mesa apagada; hover/clique explica
  ("Codex não detectado") e aponta para settings. Zero projetos ⇒ CTA de adicionar.
- **Paredes**: sala vista de dentro — paredes norte/oeste altas (fundo), lados
  sul/leste **baixos** (nunca ocluem atores). Segmentos que podem ocluir vivem na
  camada dinâmica com zIndex próprio.
- **Boss**: avatar próprio (linguagem visual dos agents, cor brass). Spawn no
  corredor. WASD/setas em espaço de **tela** convertido pra mundo; click-to-move
  com A*; WASD cancela click-to-move.
- **Câmera — máquina de estados**: `follow` (deadzone + suavização exponencial) ·
  `inspect` (entrado por R/badge do HUD; sai no primeiro input de
  movimento do boss, com lerp de retorno). Zoom 0.5–2.5 em torno do cursor;
  durante o gesto de zoom o alvo do follow congela. Dock aberto desloca o centro
  de framing pela metade da largura do painel. Clamp aos limites do mundo.
- **LOD**: abaixo de zoom ~0.8, labels escondem o texto (fica beacon/cor de
  estado); estado agregado por sala vira **luz da porta** (linguagem de semáforo
  do app) para leitura de relance em zoom-out.

## 4. Estados ao vivo (fonte → cena)

Derivação **discreta** em `office/bridge/derive.ts`, assinando os stores:

| Fonte real | Na cena |
|---|---|
| Turno rodando (`useChat`, por projeto+agent) | Agent **digitando** (`text_delta`/`tool` recente) ou **pensando** (silêncio) |
| Missão (`useMission.byConv`): fase corrente | Mesa do agent da fase acesa + persona no label; demais mesas da sala em espera |
| Gate humano de missão (`byConv[convId].gate`) | Agent **levanta a mão** + beacon; responder via dock (fonte única = store, sem fila duplicada) |
| `interaction://request` | Approval de turno linear mapeia runId→convId via `useChat`; approval de missão mapeia pelo prefixo `missionId::` do run_id; `question` **não tem run_id** — sem mesa, fica só no host global (§6.1). Mapeável ⇒ mão levantada na mesa. |
| Fim de turno | Balão curto de entrega sobre a mesa (resumo do result) |
| Ocioso | Variações de idle (café, alongar, olhar em volta), fases dessincronizadas |
| Custo | `loadLedger` (une turn_costs/deliveries/stage_runs por projeto) + `useMission.byConv[*].costTotal` das missões correntes |

**HUD**: fileira de badges por sala (agregado: gate pendente / rodando / ocioso);
clique = câmera vai à sala (modo `inspect`). Gate fora da tela nunca fica invisível.

## 5. Interação na mesa

1. **Proximidade com histerese**: entra em alcance a distância ≤1.0 do tile
   `INTERACT` (coords contínuas dos pés), sai a >1.5. Alvo **único** (mesa mais
   próxima; troca só com epsilon de diferença) + highlight.
2. **Menu-balão de proximidade** (v2 — "conversa como cena"): chegar em alcance
   abre um balão contextual ancorado na mesa (DOM, ponteiro para a mesa), não
   um prompt seco. Conteúdo por estado da mesa: ocioso ⇒ "Conversar" (+
   "Continuar · {título}" se houver conversa da mesa); turno rodando ⇒
   mini-status vivo (ferramenta corrente, tempo, custo do turno) + "Abrir" +
   "Parar"; gate/aprovação ⇒ "✋ Responder" (abre o dock direto no card);
   missão em fase ⇒ persona + "Acompanhar". `E` aciona a ação primária do
   balão. Sair do raio fecha o balão.
3. **Clique é o gesto primário**: hit-test na mesa/agent (hover acende highlight
   e muda cursor) ⇒ A* até o tile INTERACT + **abre o menu-balão na chegada**
   (dock abre pela ação do balão ou por `E`; cancelável por WASD).
4. **Falas na cena**: ao enviar, a mensagem vira balão curto sobre o BOSS
   (~3s); a resposta do agent streama num balão vivo sobre a cabeça dele
   (snippet coalescido ≤10Hz, sempre que houver turno da mesa rodando — não só
   com dock minimizado), com o texto completo no dock; fim de turno mantém o
   balão de entrega. Com o dock aberto, o avatar do agent **flipa na direção do
   boss** e volta ao monitor quando a conversa fecha.
5. **Conversa da mesa** = a mais recente que é DA MESA daquele (projeto,
   agent): `meta.agent === agent` **e** título começando com `"Mesa · "`
   (requer `agent` nas metas — §6.1). Senão `registerConversation` nova em
   background, **já carimbada com o agent** (meta + byId + banco), sem roubar
   a seleção da UI principal. A mesa **nunca adota threads do usuário**: a
   coluna `agent` é `NOT NULL DEFAULT 'claude-code'` (migração v10), então
   "agent null = livre" não existe — uma conversa em branco pareceria livre e
   seria sequestrada pela mesa do claude-code.
6. **Dock** (painel React à direita, chrome do design system, **opaco** — sem
   backdrop-blur sobre canvas vivo): cabeçalho com retrato vetorial do agent +
   linha de atividade AO VIVO (ferramenta/persona corrente); histórico,
   composer com mic, streaming; vazio inicial vira **chips de sugestão**
   ("Status do projeto", "Continuar a tarefa", …). Dock aberto **não trava
   movimento**; sair do raio com draft vazio e sem turno ⇒ fecha; com draft ou
   turno ativo ⇒ **minimiza para chip no HUD** (clique restaura), streaming
   continua como balão sobre o agent. Nunca descartar draft silenciosamente.
7. **Voz**: `voice.ts` é o dono único do mic no office (não inicia se já houver
   gravação global); parciais de `stt://partial` viram legenda no balão **só
   quando o office é o solicitante**; texto final cai no composer para revisão,
   Enter envia.
8. **Envio (`send.ts`) — coreografia completa**: `ensureConversationLoaded` (+
   metas do projeto carregadas — o persist preserva título por elas) → guardas
   (corrupt bloqueia; missão rodando bloqueia; running/finalizing ⇒ `enqueue`;
   agent travado da conversa vence o da mesa) → `cancelAutoResume` →
   `invalidateSuggestions` → `start` → **lições** (`buildLearningBlocks` +
   `markLessonsUsed`, como o ChatPanel) → `runAgent` com `sessionId` da
   conversa, `planFirst` da conversa, e continuidade por agent (agy ⇒
   `buildMemoryPrompt`/`exportConvContext`; claude/codex com sessão ⇒
   `buildResumeFallback`) → `handleEvent` por evento → `finally`: `finish` +
   `persist` + **drena a fila** (dequeue + reenvio coalescido, inclusive
   mensagens enfileiradas pela outra superfície) + **auto-resume** (mesma
   política do ChatPanel quando o turno bate em rate limit; a notificação segue
   o agendamento) + `notifyTurnEnd` + `scheduleSuggestions`.
9. **Missões**: v1 reflete missões e responde gates pelo dock. Lançar missão do
   office é onda 2 — via `useMission.launch` direto (não `requestMissionLaunch`,
   que depende do CommandConsole dentro do ChatPanel oculto).

**Teclado — roteamento**: `input.ts` descarta keydown vindo de
input/textarea/contentEditable e devolve Tab à navegação de foco.
`WASD`/setas move · `E` interage · `R` cicla salas
(preventDefault) · `+/-`/wheel zoom. **Esc — coordenador único com prioridade**:
gravando ⇒ cancela ditado; dock aberto ⇒ fecha dock; senão ⇒ nada (sair do
office é pelo ModeSwitcher/⌘K). Teste de engine: tecla vinda de campo de texto
nunca vira movimento.

## 6. Estrutura de módulos (`app/src/office/`)

```
office/
  engine/    # TS puro, zero deps de Pixi/React — 100% testável
    iso.ts grid.ts astar.ts camera.ts sim.ts loop.ts input.ts types.ts
  scene/     # Pixi: camadas chão / dinâmica y-sorted / labels (escala de tela) / anchors
    stage.ts props.ts avatars.ts rooms.ts labels.ts effects.ts
  bridge/    # integração (ÚNICO lugar que importa stores/lib do app)
    derive.ts layout.ts send.ts voice.ts sim-data.ts
  ui/        # React overlay (DOM absoluto sobre o canvas)
    OfficeMode.tsx Hud.tsx DeskDock.tsx Prompts.tsx
```

Regras de dependência: `engine` não importa nada; `scene` importa `engine`;
`bridge` é o **único** lugar que importa stores do app (importa também lib +
`engine/types`); `ui` importa `bridge` + `scene` + `engine` (o `OfficeMode` é a
raiz de composição — cria mundo/loop/input) e as utilidades sancionadas do app
(`cn`, `Markdown`); stores do app na `ui` só via hooks do `bridge`. Nada fora
de `office/` importa de dentro (exceto o lazy `OfficeMode`, o comando do ⌘K e
a ponte do Companion Web — `src/lib/companion.ts`, §6.1 item 5).

**Labels** (nome/estado): Pixi `Text` na camada própria, **escala inversa ao zoom**
(texto sempre nítido, padrão Gather), `resolution = DPR`, criados após
`document.fonts.ready`. DOM fica só para dock, balões ricos e prompts.

**Overlays DOM por frame**: raiz com `pointer-events: none`, posicionamento só por
`translate3d` escrito no mesmo callback de rAF depois do update da câmera (mesma
transform interpolada — zero wobble), opacos, tamanho de tela fixo (só o anchor
projeta).

### 6.1 Mudanças fora de `office/` (lista fechada)

1. `useApp.viewMode` ganha `"office"` (união + `setViewMode`); **partialize
   grava `"linear"`** quando o modo é office. ModeSwitcher ganha a aba
   "Escritório"; comando no ⌘K. `App.tsx`: lazy mount do `OfficeMode` (montado
   uma vez, `hidden` + loop parado ao sair) e **incluir `"office"` nas condições
   de `hidden`** do ChatPanel/ContextPanel.
2. `useChat`: exportar `ensureConversationLoaded(projectId, convId)` (promove a
   closure `ensureLoaded` — sem roubar seleção).
3. `db.ts`: `listConversations` passa a selecionar a coluna `agent` (já existe
   na tabela) e `ConversationMeta` ganha `agent`.
4. `InteractionHost` sobe do ChatPanel para o `App.tsx` (host global único —
   funciona em qualquer modo; office adiciona só o beacon na mesa quando o
   request é mapeável). Sem segunda fila de interações.
5. **Companion Web** (§8): `src/lib/companion.ts` é importador SANCIONADO do
   `office/bridge/send` (`ensureDeskConversation`/`sendFromDesk`/
   `cancelDeskTurn`) — o celular envia turnos às mesas pelos MESMOS fluxos e
   guardas da mesa (nenhum caminho novo de envio). `App.tsx` importa
   `@/lib/companion` por efeito (liga o push de estado + executor de
   `companion://action`).

## 7. Performance (orçamento de frame)

- Sim 60Hz fixa; render no ticker (`maxFPS=60`); boss sem interpolação, NPCs e
  câmera com.
- Posições **nunca** passam pelo React; espelho de UI coalescido a ≤10Hz.
- Re-sort da camada dinâmica só quando um `zIndex` quantizado muda.
- Cenário estático = `Graphics` batchado **sem** `cacheAsTexture` (fills sólidos
  flat batcham em pouquíssimos draw calls; medir antes de cachear qualquer
  coisa; se um dia precisar: só chão+parede norte, resolução 1×DPR, regeneração
  com debounce fora do gesto de zoom).
- Estados dinâmicos (mesa acesa/apagada, highlight, luz da porta, placa do
  projeto) são objetos próprios fora de qualquer cache.
- Office oculto ⇒ `loop.stop()` + ticker parado. Blur ⇒ limpa teclas.
- Probe de refresh no boot (mediana de deltas de rAF) no HUD de debug.

## 8. Ondas

### Harness semântico de mobiliário

- Móveis compostos não dependem apenas de pixels. A fonte única em
  `engine/furniture.ts` descreve footprint, tampos, itens apoiados, assentos,
  direção e eixos de uso; layout e renderer consomem a mesma especificação.
- `validateFurnitureAssembly` falha quando um tampo sai do footprint, superfícies
  se desconectam, equipamento fica sem apoio, cadeira escapa da colisão, posto de
  trabalho perde o eixo ou assentos deixam de olhar para o alvo.
- O teste negativo preserva o defeito conhecido (monitor deslocado em relação à
  cadeira) como regressão detectável, em vez de comparar duas implementações.
- A camada visual usa viewport, DPR, animação e relógio fixos e recortes E2E por
  conjunto. Snapshots pixel a pixel entram somente para clipping e z-order; as
  regras de arquitetura e ergonomia continuam geométricas para reduzir falsos
  positivos.

### Diretoria e Central do Boss

- Referência conceitual gerada com GPT Image:
  [`docs/visual-reference/office-boss-room-concept-v2.png`](visual-reference/office-boss-room-concept-v2.png).
  A imagem orienta hierarquia, proporção e composição; o runtime continua
  code-native para preservar y-sort, colisão, tema e acessibilidade.
- O boss nasce em uma sala própria e determinística, com mesa executiva,
  assento, quadro, estante e circulação preservada pelo mesmo grid de colisão do
  restante do escritório.
- A **Central do Boss** é uma projeção do `OfficeSnapshot`: atenção pendente,
  agents ativos, entregas recentes, custo por projeto e composição das equipes.
  Ela não inventa atividade nem faz chamadas adicionais aos agents.
- Delegar para um agent abre o `convId` exato da mesa. **Nova missão** abre a
  mesa de missão existente. Assim, texto, voz, escolha de modelo e effort
  continuam usando os fluxos reais e suas guardas de segurança; a Central não
  envia nem aprova ações automaticamente.
- **Central-standup**: o topo da Central é uma linha-narrativa humana derivada
  do `bossBriefing` ("3 precisam de você · 2 rodando · 1 entrega recente ·
  US$ 15,00 hoje"), escondendo termos zerados — zero chamadas novas. O quad de
  stats vira secundário (Atenção · Ativos · Entregas; o custo mora só na
  narrativa) e o stat **Atenção** é clicável: voa até a primeira mesa com a mão
  levantada. Delegar é enxuto: CTA "Nova missão" + um seletor compacto
  "Falar com…" (projeto × agent) no lugar da antiga grade de botões.
- **Posto de comando físico**: a mesa executiva da diretoria é um interactable
  (`BOSS_DESK_ID`, mesmo padrão da `MISSION_TABLE_ID`) — proximidade mostra o
  menu-balão "Abrir Central" e E/clique abre a Central (`requestBossCenter` no
  store, consumido pelo OfficeMode). Andar até a própria mesa = abrir o próprio
  briefing; o posto de comando é um LUGAR, não só um botão no HUD.
- Visitas físicas ficam para a próxima onda e devem refletir um evento real por
  uma máquina de estados explícita (`seated -> walking-to-boss -> waiting ->
  returning`), com A*, fila, timeout e retorno à mesa. Movimento decorativo não
  pode sugerir que existe uma solicitação ou entrega inexistente.

- **O-1 (esta)**: engine + cena + salas por projeto (2 fileiras) + boss + câmera
  (máquina de estados) + estados ao vivo + dock de conversa real (texto e voz) +
  gates de missão + beacons de approval + HUD com badges + LOD + onboarding
  (overlay de controles no primeiro uso, some ao primeiro input) + empty states.
  Testes de engine e bridge (vitest, PT).
- **O-2**: lançar missão da sala de reunião (`useMission.launch`); balões de
  entrega ricos; sons discretos; segunda janela (multi-monitor) com fan-out de
  eventos (`emit_to`).
- **O-3**: minimapa; quadro de avisos (schedules); presença do Fusion.

**Backlog (aprovado, aguardando onda):**
- Reserva de mesa-ALVO nos comportamentos: a visita do reviewer mira a mesa do
  executor, mas nada impede o executor de sair pro café no meio — o reviewer
  revisa uma cadeira vazia. Fix: comportamento com alvo reserva a mesa visitada
  (cancela/bloqueia café do alvo enquanto durar; prioridade da visita já é
  maior). Teste: cenário exato da screenshot de 21/jul. [EM ANDAMENTO — onda
  gate-reunião]
- Aprovações CONTEXTUAIS: o GlobalInteractionHost (canto inferior direito) é
  cego ao contexto — no Trabalho com a conversa dona do pedido VISÍVEL (ex.:
  timeline de missão aberta), o card deveria renderizar INLINE no fluxo (no
  card da fase que pediu), e o toast global ficar só para pedidos de outra
  conversa/modo. Contextual quando você olha; global quando não.
- COMPANION WEB (celular na mesma rede) — design aprovado em conceito,
  planejar após o gate-reunião: espelho + controle remoto do app ABERTO
  (nunca segundo cérebro — o motor vive na webview main; missões morrem com o
  app, e isso não muda). Padrão da ponte = tray-snapshot/tray-action escalado:
  servidor HTTP+WS pequeno no Rust; estado OUT = bossBriefing/snapshot que já
  existem; ações IN = POST → `companion://action` → webview main executa pelos
  MESMOS answerGate/answerInteraction/abort (guardas intactas). Pareamento por
  QR nas Settings (token; LAN only). Sinergia: gate rico + celular = responder
  gate anexando FOTO da câmera. Padrões absorvidos do estudo MyPeople
  (~/projetos/mypeople): ping de eventos (WS + Web Notifications), watchdog
  anti-abandono (gate mudo re-notifica), auth honesta (socket sem heartbeat
  não é "conectado"). ESCOPO v1 DECIDIDO (21/jul): triagem + CHAT COMPLETO
  (enviar turnos a qualquer mesa do celular — reusa sendFromDesk com todas as
  guardas; o módulo companion entra na lista sancionada de importadores do
  office/bridge). [ENTREGUE ondas 1-3 + fix WS + UX do chat]
- COMPANION v2 — "POSTO DE TRABALHO REMOTO" (visão do Vinícius, 21/jul: "servir
  pra quando estou longe do Mac — conseguir trabalhar, seguir uma atividade em
  andamento"): (a) MISSÃO AO VIVO no celular — tela de detalhe da missão
  (fases, tool corrente, custo subindo, gate inline) a partir de
  snapshot.missions, não só o card de "Em execução"; (b) LANÇAR MISSÃO do
  celular (projeto + tarefa ditada/digitada + preset — reusa launchTableMission
  via ação nova na whitelist); (c) RECUPERAÇÃO no celular — rate-limit em fase
  vira card de atenção com troca de agent/modelo (resolveRecovery na
  whitelist); (d) PWA-like: manifest + ícone "adicionar à tela inicial".
  VERDADE DE REDE (documentar na UI): o servidor é LAN-only por design; "longe
  de casa" = Tailscale na frente (zero código: mesma porta pelo IP da
  tailnet; `tailscale serve` ainda dá HTTPS com cert válido — o que TAMBÉM
  destrava Web Notifications/PWA, bloqueados em origem http insegura pelos
  browsers). Não construir relay em nuvem próprio (fere o local-first). Onda 2-3 (settings+QR+wiring)
  PRONTA: setting `companionEnabled` (opt-in, default false, persistido) gate
  REAL da ponte + do servidor (boot religa sozinho; toggle off para os dois);
  Configurações ▸ Companion com QR de pareamento (`urlLan#token=…`) renderizado
  por encoder QR CASEIRO (`lib/qr.ts`, byte-mode ECC M v1–10, zero dep de
  runtime, validado por round-trip contra o decoder jsQR em teste), URL em
  texto + copiar, status honesto (`connectedCount` = sockets WS vivos, novo no
  CompanionInfo do Rust), aviso da permissão de rede do macOS e "Gerar novo
  token" (stop → `companion_revoke_token` novo no Rust → start com retry).
- Roles com DIGEST (padrão MyPeople): presets de missão como bundle
  versionado por hash (personality+skills+policy), resolução fail-closed —
  a versão madura dos "agents por projeto". Estudar quando presets evoluírem.

### Onda "escritório vivo" — 16 features (estado REAL, nunca teatro)

Regra dura da onda: **todo movimento reflete estado real do runtime** (sinais
do `OfficeSnapshot` com TTL + memória de módulo no derive, ou o relógio de
verdade). Nada de atividade inventada.

Movimento/pessoas (packs de comportamento + walkers):

1. **Kickoff de missão** — `kickoffs` (ausente/queued→running): reunião nas
   mesas dos agents das fases.
2. **Celebração** — `celebrations` (transição real →done na sala do projeto).
3. **Bastão de revezamento** — `batons` (agent de uma conv COM items mudou):
   courier mesa→mesa.
4. **Chegada ao escritório** — `arrivals` (mesa off→disponível: CLI detectado).
5. **Entrega ao Boss** — `bossDeliveries` (result de fim de turno): courier
   leva o documento até a mesa executiva.
6. **Handoff físico** — `handoffs` (fase done → próxima com agent diferente).
7. **Pausa pro café** — viagem à cozinha da sala comum (idle real, cap de
   walkers, aborta se o estado muda).
8. **Descanso no sofá** — `desk.restUntil` (auto-resume agendado): o agent
   espera no lounge até o `nextAt`.
9. **Guerra do Fusion** — `room.war` (disputa ativa): candidatos reunidos; o
   vencedor entrega ao Boss.
10. **Micro-vida do idle** — agenda determinística por seed (alongar/olhar/gole
    demorado; PRNG semeado, nunca `Math.random` solto).

Ambiente/prédio (`scene/environment.ts` + `rooms.ts`/`props.ts`):

11. **Dia/noite real** — fase pela hora local (manhã fria 6–11 · meio-dia
    neutro · tarde quente 15–19 · noite 19–6 escurecida com luminárias âmbar).
    Um quad de tint por sala + tint do corredor + boost das lâmpadas — só
    tint/alpha (nunca re-tesselar), checado 1×/min em `rooms.tick`.
12. **TV da sala comum viva** — custo total do dia + 3 barrinhas (maiores
    custos por sala, cor do projeto), plano cisalhado na parede; redesenho
    discreto no `applySnapshot` (nunca por frame).
13. **Whiteboard = kanban da missão** — `room.mission`: um cartão por fase
    (done=verde · running=azul pulsante · queued=cinza · erro/abortada nos
    tons de status), risco sob a fase corrente; sem missão, os rabiscos baked
    voltam.
14. **Caixas de mudança** — sala que aparece DEPOIS do boot (projeto novo)
    ganha caixas de papelão perto da porta por ~2min com fade; memória de
    módulo das salas já vistas sobrevive à recriação do stage.
15. **Cadeira vazia** — mesa "off" mostra a cadeira levemente girada no lugar
    do avatar (o pack pessoal esconde o sentado; a caneca é prop do avatar e
    some junto). Tela do monitor apagada + tampo esmaecido continuam.
16. **Pilha de entregas do boss** — até 8 papéis empilhados no braço livre do
    tampo executivo refletindo entregas não vistas (`bossDeliveries` do
    snapshot; troca para `useOfficeUi.unseenDeliveries` quando o pack missão o
    publicar — ver `[REGIÃO AMBIENTE]` no `applySnapshot`).

Toda animação nova respeita `prefers-reduced-motion` (estática/desligada).

## 9. Testes de paridade do send.ts (lista fechada)

Comparar com o `handleSend` do ChatPanel: corrupt bloqueia · missão rodando
bloqueia · running ⇒ enqueue (e drena no finally, coalescido) · agent travado
vence · sessionId propagado · lições ativas injetadas no prompt
(`buildLearningBlocks` + `markLessonsUsed`, best-effort) · memória do agy
injetada · `buildResumeFallback` p/ claude/codex com sessão · planFirst
respeitado · cancelAutoResume · invalidateSuggestions · finish+persist sempre
(mesmo com erro) · auto-resume em rate limit agendado no finally (mesma
política do `maybeScheduleAutoResume`: settings + cap de tentativas + handoff;
ao agendar, notifica mas segura as sugestões) · notifyTurnEnd ·
scheduleSuggestions. Engine: |v| igual nas 8 direções · histerese 1.0/1.5 ·
tecla de campo de texto nunca move · A* sem corner-cutting · clamp de clique
bloqueado · zoom mantém ponto sob o cursor.

## 10. Riscos aceitos

- Duplicação parcial da coreografia de envio (O7) — mitigada pelos testes §9;
  extração para serviço único fica para quando o office estabilizar.
- Persistência concorrente (UPSERT de linha inteira): o dock nunca roda turno
  numa conversa `running` de outra superfície (mesma guarda do app).
- `question` de interação sem run_id no payload: fica sem mesa na O-1 (host
  global cobre); incluir conv_id no payload é mudança de Rust adiada.
- `BlockedDirBanner` (gate de diretório) segue só no ChatPanel: o dock da mesa
  não mostra o "Liberar e reenviar" na O-1 (gap aceito). O estado `blockedDir`
  continua marcado no store — abrir a conversa no app mostra o banner.
