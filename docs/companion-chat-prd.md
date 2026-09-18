# Companion chat-first, seguro e fora de casa — PRD

## Status (17/09/2026)

**R1 a R5 entregues (17/09/2026).** Em 18/09, o anexo do R4 ganhou o gesto que
faltava: **arrastar arquivo para a conversa**. O Companion também é aberto no
navegador do Mac, e lá arrastar é o primeiro gesto que a pessoa tenta (foi o que
o usuário tentou). O alvo só acende com a conversa aberta (é onde existe
composer), aceita o MESMO que o botão de anexo aceita (imagem e PDF, até 10 MB)
pela mesma triagem em `core.js`, e o que não serve é recusado por escrito. O
botão e o soltar passam a compartilhar uma porta só (`anexarArquivo`). Cache do
service worker foi para `v6`. Isto não tem nada a ver com o C-D1 do capricho,
que é soltar do Finder no composer do APP. Fica para depois o que está em
"Não-objetivos" (seletor de vários Macs num Companion só, TLS no app, Web Push).

O que o R5 fez, e onde divergiu do texto abaixo:
- O nome vem do **servidor**, não do snapshot: o snapshot é opaco para o Rust e
  quem conhece a máquina é o processo que serve a página.
  `companion_maquina.rs` lê o nome amigável uma vez (`scutil --get ComputerName`
  no Mac; `hostnamectl --pretty` ou o hostname no Linux) e o injeta, escapado,
  no `<meta name="frota-maquina">`, no `<title>` e no título de atalho do iOS.
  Renomear o Mac pede reiniciar a Frota.
- O manifest sai com `name` "FROTA Companion · <Mac>" e `short_name` com o nome
  inteiro: cortar em 12 letras fazia "MacBook Pro de Vinicius" e "MacBook Pro da
  empresa" virarem o mesmo "MacBook Pro…". Se os dois Macs tiverem nomes
  parecidos, renomeie um deles no sistema.
- Cabeçalho do celular: "FROTA · <Mac>" com reticências quando não cabe; as
  notificações dizem de qual Mac vieram (`notificationTitle` no `core.js`).
- Configurações → Companion mostram como o Mac aparece no celular.
- Convivência de dois atalhos: cada Mac é uma origem (`https://<mac>.ts.net`),
  então token, snapshot, tema e filtro (`localStorage`) e o service worker são
  separados pelo navegador; nada na página cruza origens. Verificado por leitura
  do código e pela regra de origem do navegador; o teste com os dois Macs reais
  depende de a Tailscale estar no Mac da empresa.
- Aceite: testes no `companion_maquina.rs` (limpeza, marcadores presentes na
  página real, escape, manifest continua JSON) e no `companionWeb.test.ts`
  (nome do meta, título da notificação); cabeçalho verificado no modo `?mock=1`
  em 412 px e 360 px, com nome longo cortado sem estourar a barra.

O que o R4 fez:
- A raiz (`#/`, rota `brief`) virou a tela chat-first: "Nova conversa" (o
  lançamento do C2, com motor ou Especialista), "Pede você" (os cartões de
  aprovação, pergunta, gate e turno mudo) e "Conversas" de todos os projetos, com
  filtro por projeto lembrado no aparelho. O painel de números (em execução,
  turnos, entregas, mesas, custo) foi para `#/painel`.
- Ordem e motor das conversas são regra pura do `core.js`
  (`homeConversations`): pede você, depois rodando, depois a mais recente;
  conversa que nunca rodou abre com o primeiro motor do projeto.
- Dentro da conversa: os cartões de atenção DELA aparecem embaixo do fio (mesmo
  HTML e mesmas ações do início, `attentionCardHtml`) e a barra ganha "Parar"
  quando o turno roda (dois toques, mesma semântica do painel).
- Atalhos no campo (`parseChatShortcut`): `/parar` arma o Parar da barra;
  `/btw <texto>` manda a mensagem marcada como prioridade. Nenhuma ação nova no
  servidor.
- Service worker subiu para `frota-companion-shell-v3` (a estratégia já era rede
  primeiro; a versão nova só limpa o cache antigo).
- Aceite: testes puros no `companionWeb.test.ts` (ordem, filtro, motor, rota do
  painel, atalhos) e verificação da página no modo `?mock=1` num Pixel 7 simulado
  (filtro, abrir conversa, cartão dentro dela, Parar armando por `/parar`,
  aprovar, painel), sem erro de página. Não há teste automatizado de DOM da
  página; o render foi validado no navegador.

O que o R3 fez:
- `CompanionProject.recent`: até 20 conversas por projeto, mais recentes primeiro,
  com `running` e `pedeVoce` (há item em `attention`: aprovação, pergunta, gate ou
  turno parado). Quem roda ou pede você entra mesmo além do teto.
- A montagem dos projetos (mesa de cada motor + recentes) saiu de
  `lib/companion.ts` para `lib/companionProjetos.ts`, puro e testado; a baseline do
  `companion.ts` desceu para 613.
- `companion.test.ts` bateu no teto de teste: o bloco "o Board não existe mais"
  foi para `companion.board.test.ts` com o mesmo preparo (mesmos 142 testes). A
  asserção de projetos do snapshot passou a esperar `recent` (a conversa com
  aprovação e turno rodando chega como `pedeVoce` e `running`).
- A página do celular ainda não usa a lista: isso é o R4. Épico A de
`docs/sprint-ecossistema-2026-09.md`.

O que o R2 fez:
- `companion_tailnet.rs` só LÊ `tailscale status --json` e `tailscale serve status
  --json` (prazo de 3 s, resultado guardado por 20 s porque Configurações pergunta
  a cada 3 s) e devolve um de cinco estados: ausente, desligada, sem HTTPS, sem
  serve, pronta. A CLI é procurada nos caminhos conhecidos antes do PATH, porque o
  app aberto pelo Finder não herda o PATH do Terminal.
- `CompanionInfo.tailnet` leva o estado; com a Tailscale pronta o QR e o "Copiar
  URL de pareamento" usam `https://…ts.net/#pair=…`. Sem serve, a tela mostra o
  comando para copiar; a Frota nunca o roda.
- Fixtures reais em `app/src-tauri/testdata/tailscale-1.102.4/` (e-mail
  anonimizado); sonda real (`sonda_real_da_tailscale`, ignorada por padrão) deu
  `Pronta` no Mac do usuário.
- `CompanionInfo` saiu de `lib/companion.ts` para `lib/companionEndereco.ts` (o
  arquivo estava no teto da catraca; a baseline desceu para 623).
- O navegador do usuário no Android é o **Firefox**: "Instalar app" fica no menu
  do Firefox, não no do Chrome.

O que o R1 fez, e o que mudou em relação ao texto abaixo:
- `companion_rede.rs` novo com as regras puras; `rede_guard` na frente de todas
  as rotas (403 para origem pública, 421 para `Host` de fora).
- `Host` aceita também `*.local` (mDNS só resolve na rede local, sem risco de
  rebinding, e não quebra atalho salvo por nome).
- CSP: em vez de só `'self'`, o WebSocket fica preso ao host da requisição
  (`ws://<host> wss://<host>`). O `ws:` genérico existia porque navegadores de
  celular nem sempre casam WebSocket com `'self'`; tirar só o `ws:` quebraria o
  WebSocket neles.
- Achado na implementação: o "visto por último" só ia para o disco ao abrir
  Configurações. Sem corrigir, o vencimento de 30 dias removeria no reinício um
  aparelho usado todo dia. Agora o `/api/state` também grava (mesmo limite de uma
  escrita por minuto).
- Configurações mostram "expira em N d sem uso"; o acesso antigo avisa que não
  expira sozinho.
- Teste existente ajustado: o fixture de aparelho usava `paired_at: 1` (1970), que
  pela regra nova é vencido; passou a ser "pareado agora", com as mesmas
  asserções.
Mock aprovado pelo usuário ("sensacional, curti tudo"): aba "Companion no
celular" de `docs/mocks/sprint-ecossistema.html`. Double check contra o código na
seção final.

Lê junto: `docs/companion-plan.md` (C1–C4 entregues, pareamento v2),
ADR-036 (tokens em arquivo 0600), ADR-041 (Board fora do Companion).

---

## O problema, nas palavras do usuário

- "eu gosto da ideia do E1 para ser mais seguro, né?"
- "sobre o Tailscale, eu uso Android, como faria daí? não quero nada completo."
- "o aparelho de fora, o Companion, precisa ser de fato um companion, que consiga
  fazer o máximo de coisas possíveis, OU a gente muda pra ser estilo chat com
  agents apenas, estilo GrokBot" → decidido: "poder total, chat first. E quem
  sabe esse chat-first possa acessar os projetos que tenho aqui."
- Contexto: único usuário, dois Macs (pessoal e da empresa), Android.

## Evidência (estado atual)

- **Transporte:** HTTP puro em `0.0.0.0:14200` (`companion.rs:8`, `:40`). O token
  definitivo sai em JSON de `GET /pair/status/{id}` e depois vai em cada header e
  no `?token=` do WebSocket. Num Wi-Fi compartilhado, quem escuta a rede pega o
  token e pode aprovar ferramenta no Mac.
- **Arquivo de aparelhos:** `std::fs::write` e só depois `chmod 600`
  (`companion.rs:499-504`), janela curta com permissão padrão na criação.
- **Poder que já existe** (`lib/companionAction.ts`): `answer_gate`,
  `answer_interaction` (aprovar/negar ferramenta, responder pergunta),
  `stop_mission`, `stop_turn`, `send_message`, `launch_task` (conversa nova num
  projeto, com Especialista opcional), `feedback_lesson`. Anexos por
  `POST /api/attachment`.
- **Leitura que já existe:** snapshot com `attention`, `running`, `missions`,
  `lastTurns`, `deliveries`, `costs`, `projects` (cada um com agentes utilizáveis
  e a conversa "Mesa · motor"), `specialists` (`lib/companionTypes.ts:176-189`).
  `GET /api/conv/{id}` lê **qualquer** conversa em janelas (`companion.rs:1191`).
- **O que falta para chat-first:** a tela é painel (`renderAttention`,
  `renderRunning`, `renderLastTurns`, `renderProjects`, `renderCost` em
  `companion/index.html:1142-1317`); não existe lista de conversas recentes por
  projeto no snapshot (só a Mesa, os turnos recentes e o que roda).
- **Dois Macs:** cada Frota é um servidor próprio; a página não tem CORS, então um
  Companion só não fala com dois Macs hoje.
- **HTTPS:** service worker e instalação como app exigem contexto seguro;
  certificado autoassinado quebra os dois (Chrome recusa registrar SW com erro de
  certificado). Em `http://` de LAN o SW nunca registra (`index.html:2128-2132`).

## Decisões

1. **Fora de casa = Tailscale, do jeito mínimo.** Nada de TLS no app, relay, VPS ou
   Cloudflare nesta etapa. O Mac expõe o Companion com `tailscale serve` e o
   Android abre `https://<mac>.<tailnet>.ts.net`, que tem certificado válido: o
   Chrome instala como app e o service worker funciona.
2. **Chat-first com poder total.** A conversa é a tela; tudo o que o Companion já
   faz continua, mas dentro do chat. Números e missões viram aba secundária.
3. **Projetos acessíveis pelo chat.** Da lista você entra num projeto, vê as
   conversas recentes dele e abre uma nova com o motor ou Especialista escolhido.
4. **Dois Macs, primeiro do jeito simples:** um atalho instalado por Mac (cada um
   com o seu `ts.net`). Seletor dentro de um Companion só fica para depois.
5. **Nada de Telegram/WhatsApp como canal padrão:** o conteúdo passaria pelos
   servidores deles sem cifra ponta a ponta.

## Guia mínimo (Android + Mac), sem código novo

1. Instalar Tailscale no Mac (app do site ou da App Store) e no Android (Play
   Store), entrando com a mesma conta.
2. No painel do Tailscale (admin console → DNS): MagicDNS ligado e **HTTPS
   Certificates → Enable HTTPS**.
3. No Mac, com o Companion ligado na Frota: `tailscale serve --bg 14200`
   (a partir daí `https://<nome-do-mac>.<tailnet>.ts.net` aponta para o Companion;
   `tailscale serve reset` desfaz).
4. No Android, Firefox (ou Chrome) → abrir esse endereço → parear pelo fluxo de
   sempre → menu ⋮ → **Instalar** / **Adicionar à tela inicial**.
5. No Mac da empresa, só se a TI permitir VPN pessoal. O Android mantém uma VPN
   ativa por vez (a VPN corporativa do celular, se houver, conflita).

**Spike S3 feito (17/09/2026, Mac do usuário + Samsung S24):** Tailscale 1.102.4
no Mac, `tailscale serve --bg 14200` aceito, certificado Let's Encrypt emitido na
primeira requisição (ela falha enquanto o certificado nasce; a seguinte responde).
Página, service worker e manifest com 200 por `https://…ts.net`; API e WebSocket
chegam ao Companion (401 sem token). Com o build do R1, a CSP saiu presa ao host
`ts.net`, `Host` estranho deu 421 e a LAN seguiu com 200. Pareado pelo celular:
arquivo de aparelhos em 0600, "visto por último" carimbado e duas conexões vivas
pela loopback (o `serve`), ou seja, o WebSocket atravessa o proxy. O nome do Mac
aparece em logs públicos de certificado (Certificate Transparency).

## Requisitos

### R1 · Só rede privada e aparelho que expira (P/M)
- Recusar conexão cuja origem não seja loopback, RFC1918, CGNAT do Tailscale
  (100.64.0.0/10), link-local ou ULA IPv6.
- Aceitar só `Host` conhecido (IP da LAN, IP 100.x, nome `ts.net`, localhost).
  Atrás de `tailscale serve` a conexão chega de 127.0.0.1: o limite por IP precisa
  de chave própria (principal autenticado) para não virar balde único.
- Aparelho sem uso há 30 dias é removido; "visto há" e "expira em" nas
  Configurações. Token legado único ganha aviso de migração.
- Arquivo de aparelhos criado já com 0600 (`OpenOptions` com `mode`).
- CSP: `connect-src 'self'` em vez de `ws:` genérico.
- **Aceite:** teste do guard com `MockConnectInfo` (8.8.8.8 → 403; 192.168.0.42 com
  token → 200; `Host: evil.example` → recusado); aparelho vencido → 401 e some do
  arquivo; testes existentes do guard intactos.

### R2 · Companion mostra o endereço seguro (P)
- Configurações → Companion detecta Tailscale (interface 100.x e
  `tailscale status --json` → `Self.DNSName`) e, quando houver, oferece o QR com o
  endereço `https://…ts.net` e o comando `tailscale serve --bg 14200` para copiar.
  A Frota não roda o comando por você.
- Sem Tailscale: a seção explica em uma frase e segue com o endereço da LAN.
- **Aceite:** com Tailscale ausente, nenhum QR de tailnet; com Tailscale presente,
  o QR aponta para o nome `ts.net`; teste da detecção com saída real de
  `tailscale status --json`.

### R3 · Lista de conversas por projeto no snapshot (P/M)
- `CompanionProject` ganha `recent: { convId, title, agent, updatedAt, running,
  pendingApproval }[]` (teto por projeto, ex. 20), vindo dos stores que já
  alimentam a sidebar. Sem tabela nova.
- **Aceite:** teste do builder do snapshot com fixture de conversas reais; a Mesa
  continua presente; nada de nome de motor em código genérico.

### R4 · Tela chat-first (M/G)
- **Início:** conversas que pedem você no topo ("pede você"), depois as recentes;
  filtro por projeto; botão "Nova conversa" que escolhe projeto e motor ou
  Especialista (`launch_task`).
- **Conversa:** balões (fio via `/api/conv`, já janelado), aprovação e pergunta
  como cartão dentro da conversa (`answer_interaction`), linha de progresso do
  que roda, "Parar" (`stop_turn`), campo com foto (`/api/attachment`), atalhos
  "/parar" e "/btw" (este vira mensagem marcada como prioridade, não ação nova).
- **Aba secundária:** custos, missões, entregas (o que o painel mostra hoje).
- Offline e reconexão continuam honestos (regras do C1).
- **Aceite:** aprovar pelo celular chega ao mesmo `answer_interaction` de hoje (sem
  ação nova no servidor); testes de render (`companionWeb.test.ts`) dos estados
  pede você / rodando / falhou / offline; pareamento e revogação sem mudança.

### R5 · Dois Macs (P, depois de R2)
- Nome da máquina no topo do Companion (vem do snapshot) para você saber em qual
  Mac está. Um atalho instalado por Mac.
- **Aceite:** dois Companions instalados convivem (origens diferentes, tokens
  diferentes) sem um derrubar o outro.

## Não-objetivos (agora)

- TLS dentro do app, relay próprio, VPS, Cloudflare Tunnel.
- Papel "só leitura" e `/api/info` com capabilities (sem outra pessoa, sem versões
  diferentes; ficam no fim da fila).
- Web Push com o celular fechado.
- Seletor de vários Macs dentro de um Companion só (CORS + tokens por Mac).
- Telegram, WhatsApp ou qualquer bot de mensageiro como canal.

## Ordem de entrega

1. R1 (independe de tudo, reduz risco já).
2. Spike S3 no seu Mac e Android (guia acima).
3. R2 e R3.
4. R4.
5. R5.

## Riscos

- `tailscale serve` na variante da App Store do macOS: a documentação limita
  servir arquivos à variante open source; proxy de porta precisa ser confirmado.
- Mudar do endereço da LAN para o `ts.net` muda a origem: o aparelho precisa
  parear de novo (o token mora no `localStorage` da origem).
- Filtrar por IP privado não protege contra o próprio Wi-Fi compartilhado: a UI
  deve recomendar o endereço `ts.net` sempre, inclusive em casa.

## Arquivos que mudam

`app/src-tauri/src/companion.rs` (guard, rate limit, devices, CSP; já com 2697
linhas: R1 deve nascer num módulo irmão, ex. `companion_rede.rs`),
`app/src-tauri/companion/index.html` e `core.js` (R4), `app/src/lib/companion.ts`
e `companionTypes.ts` (R3), `app/src/components/settings/CompanionSettings.tsx`
(R2, R5).

## Double check (17/09/2026)

Conferido no código: bind e porta (`companion.rs:8`, `:40`); `chmod` depois do
`write` (`:499-504`); `get_conv` lê qualquer conversa com janela (`:1191-1231`);
ações e `launch_task` com projeto (`companionAction.ts:321-370`); formato do
snapshot e de `CompanionProject` (`companionTypes.ts:125-189`); ausência de
`Access-Control` no `companion.rs`; funções de render do painel
(`index.html:1142-1317`). Não conferido (depende de rodar): WebSocket via
`tailscale serve` e variante do Tailscale no Mac (spike S3).
