# AGENTS.md — o Companion (celular)

Escopo: a página do celular (`app/src-tauri/companion/`), o servidor que a
serve (`app/src-tauri/src/companion.rs`) e as duas metades do lado do app
(`app/src/lib/companion.ts`, `companionAction.ts`, `companionPing.ts`,
`companionTypes.ts`). Regra de repositório mora no `AGENTS.md` da raiz; o backend
do turno tem o dele em `app/src-tauri/src/AGENTS.md`.

Planos e decisões: `docs/companion-plan.md` (C1 a C4 entregues),
`docs/companion-chat-prd.md` (próxima fase: seguro, chat-first, Tailscale),
ADR-036 (tokens em arquivo 0600), ADR-041 (Board fora do Companion), ADR-062
(as duas metades do lado do app), ADR-219 (cara de app e a escala do celular).

## A lei desta camada

> **O celular é uma máquina de fora. Nada que ele manda é aceito em silêncio, e
> nada que ele pede é respondido com otimismo.**

Ação vinda do aparelho passa por whitelist no Rust, executa pelos MESMOS stores
do app e devolve veredito real. O `202` do `POST /api/action` nunca é sucesso.

## A página não tem bundler

- `index.html`, `core.js`, `sw.js` e o manifest são servidos pelo binário
  (`include_str!` em `companion.rs`). Não há build nem import de `app/src/lib`.
- Lógica pura da página mora em `core.js` (UMD, global `CompanionCore`), testada
  por `app/src/lib/companionWeb.test.ts`. Mudou `core.js`? `core.d.ts` acompanha
  no mesmo commit.
- **Não reimplemente regra do app na página.** Frase de recibo, desfecho e
  qualquer texto derivado chegam PRONTOS no snapshot (ex.: `CompanionTurn.frase`
  em `lib/companionTypes.ts`). Reimplementar na página foi a duplicação que o R3
  do recibo veio desfazer.

## As duas metades do lado do app (ADR-062)

- `lib/companion.ts` monta o que o celular **lê** (snapshot). Pedaços puros saíram
  para irmãos quando o arquivo bateu no teto: `companionProjetos.ts` (mesa de cada
  motor e conversas recentes por projeto), `companionEndereco.ts` (info do
  servidor e URL do QR), `companionAparelhos.ts` (aparelhos pareados),
  `companionPlanos.ts` (a cota de cada motor no topo do início, pela mesma
  regra da faixa do app; só leitura, e some com o Mac fora do ar).
- `lib/companionAction.ts` executa o que o celular **manda fazer** e devolve o
  veredito por `companion_action_result`.
- `lib/companionPing.ts` é o único fio compartilhado ("conversa mudou"). Ninguém o
  importa de volta: pôr o throttle em uma das metades fecha ciclo de import.

## Acrescentar uma ação nova

Quatro lugares, sempre juntos, com teste em cada um:

1. `sanitize_action` em `companion.rs`: whitelist, payload reconstruído campo a
   campo, tetos de contagem (payload adversarial não se limita pelo tamanho do
   corpo).
2. `lib/companionAction.ts`: executor pelos stores de sempre (`sendFromDesk`,
   `registerConversation`…), veredito fail-closed com motivo legível e
   `actionId` quando o aparelho espera resposta.
3. `companion/index.html` (e `core.js` se houver regra pura): o botão só aparece
   onde a ação faz sentido; o estado "enviando" espera o veredito.
4. Tipos em `lib/companionTypes.ts` e, se mudar o snapshot, o builder em
   `lib/companion.ts`.

## Telas (R4, ADR-219)

- `#/` (rota `brief`) é o início chat-first: a cara da frota e as conversas.
  `#/painel` é o painel de números. Não mova atenção para o painel: o que pede
  decisão sobe ao topo da lista, na primeira tela.
- Painel, agents e conversa EMPURRAM por cima do início (classe `.in`, animadas
  por `transform`; não volte a usar `hidden` nelas). `#/launch` é rota de folha.
  Folha de decisão e Ajustes não são rota: empilham uma entrada com o mesmo hash
  (`state.sheet`) para o voltar do sistema fechá-las.
- Navegue com `nav()`, `navReplace()` e `goBack()`. Nunca `location.hash =` nem
  `history.back()` direto: a profundidade mora em `history.state.d`, e é ela que
  impede o "‹" de sair do app em quem entrou por URL funda.
- A rolagem é de cada tela (`.scroll`, `#chatScroll`), não da janela. Código que
  acompanha o fim do fio usa `scrollChatEnd()`.
- Cartão de decisão só existe em `attentionCardHtml`; a folha do início e a
  conversa usam a mesma função, e depois de responder chame `rerenderAttention()`
  (redesenha a linha, a folha e a conversa). Pedido sem linha de conversa ganha
  linha própria em `renderConversas`: nunca deixe um pedido inalcançável.
- Cara (`faceFor`): forma por hash do id da conversa, cor por hash do id do
  projeto, via `Core.hashIndex`. Nunca por nome de motor. Olhos dizem estado
  real (roda respira, fora do ar dorme) e param com `prefers-reduced-motion`.
- Ordem das conversas, prévia da linha, pulso da frota, grupo de ferramentas e
  atalhos do campo são regra pura do `core.js` (`homeConversations`,
  `convPreview`, `fleetPulse`, `groupThreadItems`, `parseChatShortcut`); não
  reimplemente na página. A prévia nunca é inventada: sem pedido, sem turno vivo
  e sem `frase` no snapshot, a linha fica sem segunda frase.
- Ícone é SVG inline (`ico`, `ICO`), nunca emoji. Aviso é `showNote`, nunca
  `alert`. Tamanhos de fonte: 13, 14, 15, 16, 17, 20, sem meio-pixel; alvo de
  toque de 42px para cima.
- Mudou algo do shell (`index.html`, `core.js`)? Suba a versão do cache em
  `sw.js`.

## Pareamento e credencial

- Pareamento v2: o QR leva token de **pareamento** de uso único (10 min), no
  fragment. O token definitivo só é cunhado no aceite humano no desktop.
- Fragment `#token=` (v1) nunca instala credencial: há teste no Rust que segura
  esse downgrade fechado. Não reabra.
- Guard: `Authorization: Bearer` em qualquer rota; `?token=` só no `/api/ws`
  (WebSocket do navegador não manda header).
- Revogar derruba os WebSockets na hora; 401 limpa token e snapshot no aparelho.

## Quem chega ao servidor (R1, `companion_rede.rs`)

Regras puras em `app/src-tauri/src/companion_rede.rs`, aplicadas em
`companion.rs`:

- `rede_guard` roda antes de TODA rota (página, assets, `/pair`, `/api`): origem
  fora de rede privada é 403, `Host` que não é IP privado, `localhost`,
  `*.ts.net` ou `*.local` é 421. Rota nova herda isso de graça; não crie rota
  fora do `build_router`.
- Aparelho sem uso há 30 dias vence: sai no start e é recusado (401) no guard.
  O "visto por último" vai para o disco também pelo `/api/state`, senão quem
  nunca abre Configurações venceria em uso. O token legado não expira.
- Rate limit por IP, exceto na loopback (atrás de `tailscale serve`), onde a
  chave inclui o começo do token.
- O arquivo de aparelhos nasce 0600 (`escrever_privado`).
- CSP da página prende o WebSocket ao host da requisição; não volte a `ws: wss:`
  genérico.

## Endereço seguro (R2, `companion_tailnet.rs`)

- A Frota só LÊ a Tailscale (`status --json`, `serve status --json`); nunca liga,
  instala ou roda `tailscale serve`. O comando aparece em Configurações para a
  pessoa rodar.
- O QR usa `https://…ts.net` só no estado `pronta` (HTTPS no painel e um `serve`
  levando à porta 14200); em qualquer outro estado, a rede local. Regra em
  `lib/companionEndereco.ts` (`urlDePareamento`), testada.
- Trocar de endereço muda a origem no celular: o aparelho pareado pela rede local
  precisa parear de novo pelo `ts.net` (a tela avisa).

## Dois Macs (R5, `companion_maquina.rs`)

- Cada Mac é um servidor e uma origem; o celular instala um atalho por Mac. Nada
  na página pode depender de outra origem (sem CORS, sem storage compartilhado).
- O nome do Mac é injetado pelo servidor na página (`<meta name="frota-maquina">`,
  `<title>`, título de atalho do iOS) e no manifest (`name`, `short_name`). Os
  marcadores do `<head>` são conferidos por teste: mexeu neles, ajuste
  `companion_maquina.rs` junto.
- Não corte o `short_name`: dois Macs "MacBook Pro …" viram o mesmo rótulo.
- Notificação nova usa `notifTitle()` (diz de qual Mac veio).

## Transporte (limite conhecido)

Hoje é HTTP puro em `0.0.0.0:14200`. Consequências que não somem com código na
página: service worker e instalação como app exigem contexto seguro, então em
`http://` de LAN o SW não registra; e o token trafega em texto puro na rede.
Certificado autoassinado não resolve (quebra SW). O caminho decidido é
`tailscale serve` com o certificado `*.ts.net` (ver `docs/companion-chat-prd.md`).
Nada de relay, VPS ou Cloudflare sem ADR nova.

## Os testes que seguram isto

- Rust (`companion.rs`, módulo de testes): guard 401/429, `?token=` só no WS,
  pareamento (uso único, expiração, aceite, recusa), downgrade do fragment,
  assets servidos com content-type certo, e os `r1_*` (origem, `Host`, aparelho
  vencido, CSP com host).
- Rust (`companion_rede.rs`): faixas de IP, `Host` e rebinding, vencimento,
  chave do limite, arquivo 0600.
- Rust (`companion_maquina.rs`): limpeza do nome, marcadores presentes na página
  real, escape no HTML, manifest continua JSON.
- Rust (`companion_tailnet.rs`): os cinco estados com saída real da CLI
  (`testdata/tailscale-1.102.4/`); `sonda_real_da_tailscale` (ignorado) roda
  contra a máquina.
- TS: `lib/companion.test.ts`, `companion.c2.test.ts` (ações),
  `companion.c3.test.ts` (conversa), `companion.hooks.test.ts`,
  `companionWeb.test.ts` (núcleo puro da página), `companionAparelhos.test.ts`
  (rótulo de expiração), `companionWeb.cara.test.ts` (cara, pulso, prévia e
  grupo de ferramentas), `companionEndereco.test.ts` (URL do QR e aviso da
  Tailscale), `companionProjetos.test.ts` (mesa e recentes),
  `companion.board.test.ts` (Board fora do Companion), `companionPlanos.test.ts`
  (cota do início).

## Mantenha este arquivo verdadeiro

Mudou transporte, pareamento, uma ação ou o formato do snapshot? Atualize este
arquivo no MESMO commit.
