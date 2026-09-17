# Sprint "Ecossistema e capricho" (proposta revisada, 17/09/2026)

> Status: **corte da sprint entregue em 17/09**. Da próxima sprint, já saíram
> C-Q3 (↳ leva à original), C-T2 (seleção de tabela como planilha, clique duplo) e
> B6 (vigia do navegador e navegador órfão no boot), C-D2 (colagem grande vira
> pílula), B4 (qualquer MCP de navegador, corrige K5) e B3 (marcar e enviar ao
> agente). Correções K6 e K7 entregues em 17/09 (aba do navegador que fechava
> sozinha, mensagem longa que vinha paginada sem formatação). Épico D: R1, R2 e R4 do PRD entregues em 17/09 (D2, D4). Épico C: R1, R3, R4 e R6 do PRD entregues em 17/09
> (C-T1, C-Q1 e C-Q2, C-D1). Épico B: R1 a R3 do PRD entregues em 17/09 (B1 aba,
> B1b flutuante, B2 anexar e copiar). Correções K1 a K4 entregues em 17/09 (K4 dentro do
> R1 do Companion). Épico A: R1 a R5 do PRD entregues em 17/09 (A1, A4
> sem modo "só Tailscale", A7 e A8 do jeito simples, um atalho por Mac); o resto
> segue como proposta para decisão. Revisão 2: incorpora as
> respostas do usuário (17/09) e um double check de cada afirmação no código.
> Mock funcional de todos os pontos: `docs/mocks/sprint-ecossistema.html`.
>
> **PRDs (17/09, com double check no código):**
> A · `docs/companion-chat-prd.md` · B · `docs/navegador-na-frota-prd.md` ·
> C · `docs/capricho-fio-composer-prd.md` · D · `docs/revezamento-de-motor-prd.md`.
> Os PRDs mandam sobre as tabelas abaixo quando divergirem (ex.: o usuário usa
> Android; Tailscale entra no modo mínimo, sem TLS no app).
> Estimativa: **P** até 1 dia · **M** 2 a 3 dias · **G** 4 dias ou mais.

## 0. O que mudou com as suas respostas

| pergunta | sua resposta | efeito na sprint |
|---|---|---|
| 1. Tailscale? | Sim. Só você usa, no Mac pessoal e no Mac da empresa; talvez nunca comercialize | Tailscale vira o caminho oficial. "Papel só leitura" cai para o fim da fila (não há outra pessoa). Entra "dois Macs no mesmo Companion". Preço e Windows saem do radar |
| 2. Navegador | Quer o navegador **dentro** da Frota, ou um stream ao vivo do navegador externo numa vista tipo pop-up | O stream **já existe** (ver §2): a sprint o tira da janela separada e o põe numa aba e numa janela flutuante dentro da Frota |
| 3. Mock | Completo e funcional, com citar trecho | Feito: `docs/mocks/sprint-ecossistema.html` |
| 4. Companion | Ou faz o máximo possível, ou vira chat com os agentes (estilo Grok Bot) | Pesquisa em §3: recomendo **chat-first com poder total**, que é as duas coisas |
| 5. Revisar tudo | Double check | §1 lista o que confirmei e o que corrigi |

## 1. Double check (confirmado no código em 17/09)

Confirmado:
- Revezamento de motor existe: `IdentityPicker.tsx:199` ("Revezar para X no próximo
  envio"), handoff com `HANDOFF_RECENT_BUDGET_CHARS = 6_000` (`lib/handoff.ts:16`).
- "Citar arquivo no chat" substitui o rascunho: `DiffTab.tsx:54` chama `setText`,
  que troca o texto inteiro (`store/composerDrafts.ts:116-119`).
- Comparação por nome de motor: `IdentityPicker.tsx:33`
  (`new Set(["claude-code", "codex"])`).
- Gate do composer liga o navegador com janela: `mcpPreflightRetry.ts:35`
  (`startProjectBrowser(projectPath, true)`).
- Companion em `0.0.0.0:14200`, HTTP puro (`companion.rs:8`, `:40`); arquivo de
  aparelhos gravado e só depois `chmod 600` (`companion.rs:499-504`).
- Injeção do navegador fixa em `--cdp-endpoint` (`mcp_control.rs:713`).
- `dragDropEnabled` não está no `tauri.conf.json` (vale o padrão, true) e nenhum
  `onDragDropEvent` no app.
- O painel do navegador é uma janela separada (`browser_panel.rs:29-61`).
- O Companion já tem as ações de um chat: `send_message`, `launch_task`,
  `answer_interaction` (aprovar), `stop_turn` (`companion/index.html:672-711`).
  Não tem CORS (um app só não fala com dois Macs hoje).

Corrigido em relação à revisão 1:
- **Copiar tabela já existe** (botão no hover, copia TSV: `Markdown.tsx:81-107`).
  A história fica menor: acrescentar HTML e Markdown, escapar tab/quebra/`|` e
  a seleção que cruza tabela.
- **Papel só leitura** (A2) e `/api/info` (A3) deixam de ser prioridade: servem a
  cenários com outras pessoas e versões diferentes, que não existem para você.

## 2. Navegador: o que existe e o que muda

**Hoje:** a Frota liga um Chromium próprio por projeto, sem janela (headless), e
controla por CDP. O que você vê é um **stream ao vivo** dessa página (screencast,
até ~10 quadros por segundo), numa **janela separada** que só abre por
Configurações. Você pode clicar e digitar nela; o agente pilota pelo MCP de
navegador. O perfil é persistente por projeto (logins ficam).

**As duas ideias que você descreveu:**

| | navegador de verdade dentro da Frota | stream ao vivo dentro da Frota |
|---|---|---|
| como | webview nativo do Tauri (WebKit) na área do app | o screencast que já existe, desenhado numa aba ou numa janela flutuante do próprio app |
| agente consegue pilotar | não (WebKit não fala CDP; Playwright e DevTools MCP não conectam) | sim, é o mesmo Chromium que o agente usa |
| marcar região, recortar, copiar | difícil (a view nativa fica por cima de tudo, até de menus e modais) | fácil (o quadro é uma imagem na tela, dá para desenhar por cima) |
| Mac e Linux | exige feature instável do Tauri, com bugs abertos de posição e camadas | igual nos dois |
| rolagem e fluidez | nativas | boas, com leve atraso e compressão JPEG |

**Recomendação:** stream dentro da Frota. É exatamente o seu "streaming em tempo
real do navegador externo, estilo pop-up", sem perder o agente pilotando. No mock:
aba **Navegador** ao lado de Conversa, botão **Flutuar sobre a conversa** (janela
arrastável e redimensionável dentro do app), **Marcar e enviar ao agente**,
**Anexar a página**, **Copiar imagem** e o seletor "Você pilota / Agente pilota".

## 3. Companion: máximo de coisas ou chat com os agentes?

**O que é o Grok Bot (xAI, agosto de 2026):** cada tarefa ganha um agente sempre
ligado, com o próprio computador na nuvem; você entrega trabalho "como para um
colega", por chat. Na mesma linha, o `grok-telegram-bot` controla o CLI do Grok
pelo Telegram: lista projetos, retoma sessões, mostra diffs, aprova ferramenta com
botão, fila de mensagens e `/btw` para urgência. O OpenClaw (ex-Clawdbot) faz o
mesmo por WhatsApp, Telegram e iMessage.

**O que serve para a Frota:** a forma (a conversa é a tela, aprovação vira botão
dentro do chat, progresso em linha, fila, "/btw"), não a nuvem (a Frota é local e
agente na nuvem fica fora da doutrina). E a forma cabe no que já existe: o
Companion já envia mensagem, lança tarefa, aprova e para. Falta a tela ser chat.

**Recomendação: chat-first com poder total.** Abre na lista de conversas (com
"pede você" em destaque), dentro da conversa você lê, responde, aprova, para,
anexa foto e usa atalhos; números e missões viram uma aba secundária. No mock,
aba "Companion no celular": à esquerda o de hoje, à direita a proposta.

**Telegram em vez de PWA?** Descartado como padrão: o conteúdo das conversas
passaria pelos servidores do Telegram (bots não têm cifra ponta a ponta) e seria
mais um processo rodando fora do app. Pode ser experimento pessoal, não produto.

**Dois Macs:** cada Frota é um servidor próprio. Caminho simples: um atalho de
Companion por Mac (cada um com seu endereço `ts.net`). Caminho elegante: um
Companion só com seletor "Mac pessoal / Mac da empresa" (exige CORS entre os dois
e um token por Mac). **Atenção no Mac da empresa:** instalar Tailscale pode esbarrar
na política de TI, e o Android só mantém uma VPN ativa por vez.

## 4. Achados que viram correção (independem do resto)

| # | achado | tam. |
|---|---|---|
| K1 | "Citar arquivo no chat" apaga o que você já escreveu (passar a acrescentar) · **entregue**: `appendText` no rascunho, também em "Enviar comentários" e "Pedir correção" | P |
| K2 | Comparação por nome de motor no seletor de identidade vira capability · **entregue**: `modelo_livre` / `modeloLivre` com teste-gêmeo | P |
| K3 | Gate do composer liga o navegador com janela visível, contra a ADR-131 · **entregue**: liga sem janela, como Configurações | P |
| K4 | Arquivo de aparelhos do Companion nasce com permissão padrão antes do 0600 · **entregue** no R1 (`escrever_privado`) | P |
| K6 | Voltar para a conversa fechava a aba do navegador e perdia o trabalho em andamento · **entregue**: pastilha do navegador fica na tira, com "×" próprio; endereço sem esquema passa a navegar | P |
| K7 | Mensagem acima de 16 KB virava texto cru paginado, mesmo sendo normal · **entregue**: só o trecho com linha pesada perde formatação, a mensagem sai inteira e em ordem (ADR-210) | P |
| K8 | Marcação de região despejava a descrição como texto no composer · **entregue**: vira bloco do rascunho (pílula com prévia), como citação e colagem | P |
| K5 | Injeção do navegador só entende Playwright (Chrome DevTools MCP não conecta) · **entregue** no B4: forma de conexão no binding (`cdp-endpoint`, `browser-url`, `ws-endpoint`) | M (B4) |

## 5. Spikes de 30 minutos (antes de estimar em definitivo)

- **S1** ⌘C numa tabela do fio já entrega colunas separadas por tab no WebKit?
- **S2** Com `dragDropEnabled` ligado, arrastar por HTML5 dentro do app funciona? A reordenação da sidebar funciona no build atual?
- **S3** `tailscale serve` no Mac (Tailscale ainda não está instalado neste Mac): o Android em 4G abre a PWA em `https://…ts.net` com service worker e WebSocket?
- **S4** Ramo com outro motor enxerga as alterações não commitadas da conversa original?
- **S5** Mac da empresa: a política permite Tailscale? (pergunta para você, não código)

## 6. Épicos e histórias

### Épico A · Companion seguro, chat-first, nos dois Macs

| id | história | tam. | depende |
|---|---|---|---|
| A1 | **Só rede privada e aparelho que expira**: recusar origem fora de LAN/Tailscale, lista de `Host` permitidos, aparelho parado há 30 dias sai, arquivo nasce 0600 (K4), CSP sem `ws:` genérico, "visto há" na tela | P/M | – |
| A4 | **Fora de casa via Tailscale, guiado pelo app**: detecta Tailscale, QR com o endereço `ts.net`, modo "só Tailscale", mostra o `tailscale serve` para você rodar, ADR "Tailscale sim; relay, VPS e Cloudflare não" | M | A1, S3 |
| A7 | **Companion chat-first**: lista de conversas com "pede você", conversa em balões, aprovação e parar como botões na conversa, anexar foto, atalhos ("/parar", "/btw"), números e missões numa aba secundária; usa só ações que já existem | M/G | A1 |
| A8 | **Dois Macs**: um atalho por Mac (simples) ou seletor dentro do Companion (CORS + token por Mac) | M | A4 |
| A5 | TLS no próprio app com o certificado do `ts.net` (tira o `serve` do caminho) | G | A4 |
| A6 | Aviso com o celular fechado (Web Push saindo do Mac, opt-in) | M/G | A4 |
| A2 | Papel "só leitura" por aparelho | M | fim da fila |
| A3 | `/api/info` com capabilities | P/M | fim da fila |

Critérios-chave: A1 com teste do guard (IP público recusado, `Host` estranho
recusado, aparelho vencido 401); A4 com spike registrado em iPhone e Android fora
de casa; A7 com aprovação pelo celular chegando ao mesmo `answer_interaction` de
hoje (sem ação nova no servidor) e teste de render dos estados (pede você, rodando,
falhou).

### Épico B · Navegador dentro da Frota

| id | história | tam. | depende |
|---|---|---|---|
| B1 | **Aba Navegador** ao lado de Conversa e Alterações, com o stream ao vivo; pausa quando fora de vista; "nova aba"; resolve quem assiste o preview (janela e aba não se derrubam) | M | – |
| B1b | **Flutuar sobre a conversa**: janela arrastável e redimensionável dentro do app, com o mesmo stream | P/M | B1 |
| B2 | **Anexar a página e copiar imagem** (PNG em resolução real + URL limpa) | P | B1 desejável |
| B3 | **Marcar e enviar ao agente**: congela o quadro, você marca a região, a Frota recorta e acha os elementos reais por CDP (seletor, papel, nome) e anexa ao composer | G | B2 |
| B4 | Qualquer MCP de navegador (Playwright ou Chrome DevTools), corrige K3 e K5 | M | – |
| B6 | Watchdog do navegador e recuperação no boot | P | – |
| B5 | User agent e dispositivo por projeto | P/M | fim da fila |

### Épico C · Capricho no fio e no composer

| id | história | tam. | depende |
|---|---|---|---|
| C-T1 | **Tabela em três formatos**: o botão que já existe ganha menu (planilha com TSV + HTML, Markdown com `\|` escapado); célula com tab ou quebra sai íntegra | P | S1 |
| C-T2 | Seleção que cruza tabela sai como planilha; clique duplo seleciona a célula | P | C-T1 |
| C-Q1 | **Pílula "Citar"** na seleção dentro de uma mensagem, e "Citar trecho" no menu de contexto | M | mock aprovado |
| C-Q2 | **Citação no rascunho e no prompt** (moldura "é dado, não instrução"; vai também no revezamento); corrige K1 | M | C-Q1 |
| C-Q3 | Linha "↳ autor · hora · «trecho»" na mensagem enviada, que rola até a original | P/M | C-Q2 |
| C-D1 | **Soltar arquivos do Finder** no composer: imagem e PDF viram anexo com tamanho e miniatura, outros viram `@caminho`, recusa visível quando o motor não aceita | M | S2 |
| C-D2 | **Colagem grande vira pílula** com prévia e "inserir como texto" | M | modelo de blocos (C-Q2) |
| C-D3 | Arrastar de dentro do app (arquivo da árvore, trecho do diff, imagem do fio, saída dos Bastidores), sempre com ação equivalente por teclado | G | C-D1 |

### Épico D · Continuar em outro motor

| id | história | tam. | depende |
|---|---|---|---|
| D2 | **Revezamento com memória por significado** (a mesma do `/compactar`, orçada pela janela do motor de destino) e custo estimado dito antes de enviar | P/M | – |
| D1 | **Abrir ramo com outro motor**: a conversa original fica intacta com a sessão dela | M | S4 |
| D4 | Capability no lugar da comparação por nome (K2) | P | – |
| D3 | Voltar ao motor anterior retomando a sessão dele | G | D2 |

## 7. Corte proposto para a sprint (~2 semanas)

1. **Correções** K1, K2/D4, K3, K4 (P cada).
2. **Companion**: A1 + A4 (seguro e fora de casa) + A7 (chat-first).
3. **Navegador**: B1 + B1b + B2 (aba, flutuante, anexar e copiar).
4. **Capricho**: C-T1, C-Q1 + C-Q2 (citar trecho completo), C-D1 (soltar do Finder).
5. **Motores**: D2 (revezamento com memória boa).

Próxima sprint: B3 (marcar e enviar), C-Q3, C-D2, C-D3, C-T2, D1, D3, A8, A5,
A6, B4, B6. Fim da fila: A2, A3, B5.

Risco de caber: o corte tem 3 histórias M/G em frentes diferentes (A7, B1, C-Q).
Se apertar, B1b e C-D1 descem primeiro.

## 8. Decisões que ainda são suas

1. **Mock**: o que ajustar em citar trecho, tabela, soltar, colagem, revezamento, navegador e Companion?
2. **Companion chat-first** (A7) como proposto?
3. **Dois Macs**: um atalho por Mac, ou seletor dentro do Companion?
4. **Mac da empresa**: Tailscale é permitido lá (S5)?
5. **Corte** do §7 ou outra ordem?

## Fontes

- Grok Bot: [Layer3 Labs](https://www.layer3labs.io/guides/what-is-grok-bot) · [Trending Topics](https://www.trendingtopics.eu/grok-bot-spacexai/) · [grok-telegram-bot](https://github.com/artickc/grok-telegram-bot) · [OpenClaw](https://openclaw.ai/)
- Maestri: [changelog](https://www.themaestri.app/pt-br/changelog) · [Wire](https://www.themaestri.app/pt-br/docs/wire) · [Remote](https://www.themaestri.app/pt-br/remote)
- Companion: [Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) · [SW e certificado autoassinado](https://github.com/w3c/ServiceWorker/issues/1514) · [Tailscale HTTPS](https://tailscale.com/kb/1153/enabling-https) · [Tailscale Serve](https://tailscale.com/kb/1312/serve) · [Web Push no iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- Navegador: [WebviewBuilder (unstable)](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html) · [issue #9798](https://github.com/tauri-apps/tauri/issues/9798) · [CDP DOM](https://chromedevtools.github.io/devtools-protocol/tot/DOM/) · [Playwright MCP](https://github.com/microsoft/playwright-mcp) · [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp/)
- Fio e composer: [Async Clipboard no WebKit](https://webkit.org/blog/10855/async-clipboard-api/) · [ClipboardItem](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem) · [Tauri onDragDropEvent](https://v2.tauri.app/reference/javascript/api/namespacewebview/) · [issue #14373](https://github.com/tauri-apps/tauri/issues/14373)
