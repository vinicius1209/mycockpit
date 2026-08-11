# Companion Web profissional — plano (visão registrada, execução futura)

> **Status C3 (11/08/2026): ENTREGUE — Conversa.** O fio completo de qualquer
> conversa agora vive no celular:
>
> - **Janela decidida no SERVIDOR** (guarda do fio grande): `/api/conv/{id}`
>   devolve a cauda (default 60 itens, cap 200) + `start`/`total`;
>   `?before=<índice>` pagina pra trás ("Carregar anteriores" na página, com
>   scroll compensado). Medido com a maior conversa REAL desta máquina:
>   1.9MB/1476 itens no SQLite; a cauda de 60 pesa ~68KB. A emenda é pura no
>   core.js (`mergeThreadTail`/`mergeThreadOlder`): a cauda fresca SUBSTITUI a
>   sobreposição (item de tool muta quando o result chega — dedupe por id
>   manteria o velho); buraco entre faixa e cauda descarta o velho; página
>   rasgada é ignorada.
> - **Markdown**: decisão registrada — o app usa react-markdown+rehype, mas
>   embutir isso no cliente vanilla (CSP 'self', zero CDN) custaria um bundle
>   inteiro no binário; ficou um SUBSET PRÓPRIO testado no core.js
>   (`renderMarkdown`): fence com `<pre>` scrollável, headers, listas, tabelas
>   (wrapper com scroll próprio), quote, negrito/itálico/código inline e links
>   SÓ http(s) (path de disco e `javascript:` ficam texto). Levantado dos fios
>   reais do DB (negrito 372×, fences 45×, tabelas 36×, listas 199×); tudo
>   escapado, fixtures reais nos testes. Limitação aceita: lista aninhada vem
>   achatada. Item `advice` (parecer de Especialista) agora aparece (antes era
>   invisível no celular).
> - **Enviar em qualquer conversa com veredito**: o `send_message` da página
>   ganha `actionId` por gesto (infra C2) e o executor devolve action-result
>   honesto (fecha o furo registrado na revisão C2): aceite traz o convId REAL
>   (página sem conversa resolvida adota o fio na hora), CLI deslogada devolve
>   o motivo direto (além do notice persistido), rejeição interna do
>   sendFromDesk não escapa; recusa derruba o eco, devolve o rascunho e mostra
>   o motivo (nunca mensagem fantasma "enviada" no fio). Sem actionId (página
>   antiga) o comportamento pré-C3 fica intacto, inclusive o shape da chamada.
> - **Estado vivo**: "trabalhando há X" com tempo real (`elapsedLabel` +
>   ticker de 5s); conversa aberta que ENTRA em execução refetcha na hora
>   (turno disparado do desktop aparece sem gesto) — o fim de turno e o
>   conv-updated já refetchavam desde C1/G1.
> - **Anexos**: rota nova `GET /api/blob/{attachments|evidence}/{conv}/{file}`
>   (Bearer via guard, allowlist fechada: raiz, pasta hex/uuid, alfabeto de
>   arquivo, extensões dos anexos; `blob_path_parts` puro testado com paths
>   reais). A página busca com fetch AUTENTICADO → objectURL (token nunca em
>   URL de `<img>`); anexo de user e captura de tool aparecem no fio; pdf vira
>   chip com nome; blob sumido (GC) vira "imagem indisponível", nunca ícone
>   quebrado. MANDAR foto do celular já existia (upload multipart C2 + 📷 no
>   composer) e segue pelo mesmo canal.
>
> Testes: `cargo test` 294 ok (32 no módulo companion: janela/paginação/cap,
> allowlist do blob, vocabulário C3); `bun run test` 1830 ok (167 arquivos;
> novos: companion.c3.test.ts 7 casos do veredito, companionWeb.test.ts +23
> casos C3 com fixtures reais do DB); `tsc -b` limpo. Prova manual: página
> real dirigida headless (mock) — briefing → fio com tabela/fence/lista →
> envio → eco → typing com tempo → resposta; screenshots conferidos.
> Registrado (fora do C3): tocar numa imagem para ver em tela cheia ficou de
> fora; o snackbar de veredito ok do send_message só aparece fora do chat
> (dentro, o próprio fio é a confirmação).

> **Status C2 (11/08/2026): ENTREGUE — Ações.** O canal `/api/action` do C1 já
> cobria muito (send_message, answer_gate, answer_interaction, stop_turn,
> stop_mission, dispatch_card, close_card, feedback_lesson); o C2 ESTENDEU:
>
> - **Lançar tarefa** (`launch_task`): tela própria (`#/launch[/<pid>]`) com
>   projeto + piloto (Especialista GLOBAL ou agent) + prompt. O executor cria
>   conversa NOVA pelo MESMO caminho do composer (`registerConversation` →
>   `setConversationPreset` → `sendFromDesk`, persona via
>   `resolveFirstTurnPersona` de sempre) sem roubar a seleção do desktop;
>   título derivado do prompt (régua do deriveTitle). Especialistas de escopo
>   projeto NÃO viajam no snapshot (só existem no projeto carregado; num outro
>   o lançamento falharia) — limitação registrada.
> - **Responder pendências**: perguntas estruturadas agora viajam com
>   `choices` (header/multiSelect/options do AskUserQuestion) e a página
>   renderiza a ESCOLHA de verdade (radio/checkbox + "Outro" livre); o payload
>   sai da decisão pura `buildQuestionAnswer` (core.js) pelo mesmo
>   `answer_interaction`. Aprovar/negar/gate já existiam e seguem.
> - **Parar turno honesto**: turno FINALIZANDO agora aparece em `running[]`
>   com `finalizing: true` (antes sumia) e o Parar vira o motivo
>   ("não dá mais para interromper" — `stopDisposition` no core.js); o
>   executor devolve o veredito real (interrompido / finalizando / já tinha
>   acabado / disputa) — copy espelhada do Stop do app.
> - **Resultado de ação (fail-closed visível)**: novo comando
>   `companion_action_result` → WS `{type:"action-result"}`. O 202 é só
>   "aceitei"; o veredito legível volta pro celular (launch navega direto pro
>   fio criado; fracasso mostra o motivo; snackbar quando a tela já mudou).
> - **Idempotência**: `actionId` (8..64 [A-Za-z0-9-], obrigatório no
>   launch_task, opcional no resto) com dedupe por janela de 5 min no Rust —
>   duplo-toque/retry com o mesmo id vira 202 sem re-emitir; a UI gera UM id
>   por gesto e o reusa no retry.
>
> **Revisão do pareamento (guarda pré-C2)** — modelo atual: token único
> 256-bit (64 hex) gerado no desktop, arquivo 0600 em app_data_dir, viaja só
> no QR (fragment, apagado da URL após guardar no localStorage); Bearer em
> toda /api (`?token=` só no WS), comparação em tempo constante, rate-limit
> 30 req/10s por IP, 401 limpa token+snapshot do aparelho, revogação global
> (revoke + restart do servidor muda o QR). CSRF de site malicioso é bloqueado
> (sem CORS, header Authorization inatingível cross-origin). **Veredito:
> suficiente para as ações em rede local** — o pareamento já exige gesto
> humano no desktop (abrir Settings e mostrar o QR). Registrado como **C4**:
> token POR APARELHO com revogação individual e expiração/rotação; confirmação
> explícita "aceitar aparelho" no desktop. **HTTPS local: limitação ACEITA** —
> certificado self-signed em LAN = aviso agressivo de browser em todo aparelho
> (fricção maior que o ganho); o ganho real (SW/install do Android em contexto
> seguro + cifrar o tráfego LAN) não paga a fricção numa rede doméstica; quem
> precisar pode terminar TLS por conta própria na frente do :14200.
>
> **Revisão C2 (ressalvas do revisor, 11/08/2026)**: (1) CORRIGIDO —
> `sendFromDesk` do launch_task agora em try/catch: rejeição interna (DB no
> load) devolve action-result de erro em vez de só o timeout de 25s no
> celular. (2) CORRIGIDO — a copy "não duplica" agora respeita a janela do
> dedupe: o cliente reusa o actionId só por 4 min (margem sob os 5 do
> servidor, `launchRetryDisposition` puro no core.js); expirada, o id morre e
> o toque vira confirmação em 2 tempos com aviso "pode duplicar". (3)
> CORRIGIDO — dedupe movido pra ANTES do sanitize (retry com anexos já
> consumidos é 202 idempotente, não 400), com rollback do id no 400
> (`forget_action`). (4) REGISTRADO — teto de 256 ids pode ser inundado por
> aparelho autenticado (despeja id pendente); aceito no modelo token-único de
> LAN, proteção real no pareamento v2 (C4). REGISTRADO também: o
> `send_message` mantém o padrão pré-existente sem try/catch próprio no
> `sendFromDesk` — a rejeição cai no catch do listener (aviso nativo no
> desktop), sem canal de resultado pro celular porque a ação não carrega
> actionId na UI; fechar isso é trabalho do C3 (conversa) se doer.
>
> Testes: `cargo test` 288 ok (launch_task/actionId/dedupe/página);
> `bun run test` 1797 ok (166 arquivos; novos: `companion.c2.test.ts` com 15
> casos, `companionWeb.test.ts` +14 casos de rotas/stopDisposition/
> makeActionId/buildQuestionAnswer); `tsc -b` limpo.

> **Status C1 (11/08/2026): ENTREGUE.** Fundação de app no cliente existente
> (página única vanilla, sem framework novo): rotas com history real via hash
> (`#/`, `#/agents/<pid>`, `#/chat/<pid>/<agent>[/<conv>]` — voltar/avançar/F5
> funcionam), PWA (manifest + ícones + service worker que cacheia SÓ o shell,
> `/api` nunca), offline honesto (banner "Sem conexão com o Mac" + carimbo
> "visto há…" do último snapshot restaurado do localStorage, nunca tela branca)
> e reconexão automática com backoff (máquina de estados em
> `app/src-tauri/companion/core.js`, o MESMO arquivo servido ao celular e
> coberto por vitest em `app/src/lib/companionWeb.test.ts`). Canal de dados,
> bind e pareamento intactos. **Limitação registrada**: em `http://` de LAN
> (contexto inseguro) o browser não dá service worker nem install prompt do
> Android — o SW/instalação plena valem em contexto seguro; no iOS o
> Adicionar à Tela de Início + standalone (metas apple) funcionam mesmo em
> http. HTTPS local é conversa do C2 junto com o modelo de pareamento.

> Status: visão registrada em 11/08/2026, palavras do usuário: o companion
> "devia ser muito mais profissional… lançar tarefa, falar com os agentes, ter
> comportamento de um aplicativo mesmo — botão de voltar que volta. Tem que ser
> uma coisa que me ajude a falar com o MyCockpit em qualquer cômodo da casa."
> Este arquivo guarda a visão e o esqueleto; NÃO está em execução — a frente
> ativa é `office-removal-plan.md` (que preserva a ponte de dados de que o
> companion depende).

## O que "profissional" significa aqui (critérios, não adjetivos)

1. **Comportamento de app**: histórico de navegação real (botão voltar do
   browser/gesto do celular funciona), estado sobrevive a refresh, instalável
   como PWA (ícone na home screen, standalone, offline honesto = "sem conexão
   com o Mac", nunca tela branca).
2. **Agir, não só ver**: lançar tarefa num projeto, responder a um agent
   (aprovações/perguntas pendentes), parar um turno. Tudo que hoje exige ir
   até o Mac.
3. **Qualquer cômodo da casa**: mobile-first de verdade (o uso é celular no
   sofá/cozinha), reconexão automática, e o pareamento continua simples.
4. **Honestidade de estado** (doutrina da casa): o que o companion mostra vem
   do mesmo snapshot do app; quando o Mac está inacessível, dizer isso — nunca
   fingir dado vivo.

## Pré-requisitos já verdadeiros

- A ponte de dados (pós `office-removal-plan.md` R1: `lib/fleet/`) é o
  contrato do snapshot — companion já consome.
- O servidor do companion no Rust já serve a web local; falta o canal de
  AÇÕES (hoje o fluxo é majoritariamente leitura + interações pontuais).

## Fases (rascunho — detalhar quando a frente abrir)

- **C1 — Fundação de app**: roteamento com histórico (hash/router), PWA
  manifest + service worker, reconexão com backoff, estados de erro honestos.
- **C2 — Ações**: lançar tarefa (projeto + prompt + preset), responder
  pendências (aprovar/negar/texto), parar turno. Mesmas guardas do app
  (aprovação é gesto humano; nada de auto-despacho).
- **C3 — Conversa**: ver o fio de uma conversa e mandar mensagem nela (o
  "falar com os agentes" completo), com o mesmo render de markdown do app
  onde couber.
- **C4 — Polimento de casa**: dark mode, notificações web push (se o canal
  local permitir), atalhos de tela inicial por projeto. Pareamento v2
  (registrado na revisão do C2): token por aparelho com revogação individual,
  expiração/rotação, confirmação "aceitar aparelho" no desktop.

## Guardas

- Pareamento/autenticação antes de qualquer ação remota (hoje já existe token;
  ações elevam o risco — revisar o modelo antes do C2).
- Nada de expor a web fora da rede local por padrão.
- O companion nunca vira segunda fonte de verdade: toda ação passa pelo mesmo
  caminho do app (stores/commands), nunca atalho próprio.
