# Navegador dentro da Frota — PRD

## Status (17/09/2026)

**R1 a R3 entregues (17/09/2026, ADR-204). R6 (ADR-207) e R5 (ADR-208) entregues em
seguida.** R4 (marcar e enviar) segue para a próxima sprint.

R5: migração 50 (`mcp_bindings.browser_conexao`, padrão `cdp-endpoint`, então o
Playwright segue idêntico e os testes dele não mudaram). `browser_conexao.rs` aplica
`--browserUrl <http>` ou `--wsEndpoint <ws>` (o WebSocket vem do `/json/version`, só
em loopback) e tira da origem o que abriria outro navegador; as flags vieram do
`--help` do chrome-devtools-mcp 1.9.0 (`testdata/chrome-devtools-mcp/`).
Configurações → MCPs mostra a forma ao lado de "usar navegador". Provado de ponta a
ponta: o chrome-devtools-mcp 1.9.0 conectado por `--browserUrl` e por `--wsEndpoint`
a um Chromium lançado com as flags da Frota listou a página dele pelo MCP.

R6, e onde divergiu: a queda NÃO é sondada no ticker do `watchdog.ts`; o
`ProcessRegistry` já emite `process_exited`, e o vigia (`lib/vigiaDoNavegador.ts`)
reage a ele, com um aviso por processo e "Ligar de novo" (parada pedida chega como
`stopped` e não avisa). A aba e o card de Configurações reconsultam o status nessa
hora. No boot, `browser_orfaos.rs` acha Chromium de perfil da Frota sem sessão viva
(pelo pid ou pelo grupo de processos, porque o app lança por `zsh -lc`) e o app
oferece "Encerrar"; **não adota** o processo órfão, porque o ciclo de vida do
navegador mora no `ProcessRegistry`, que não teria o handle dele. Fixture real de
`ps` em `testdata/chromium-ps/`.
Épico B de `docs/sprint-ecossistema-2026-09.md`.

O que foi feito, e onde divergiu do texto abaixo:
- R1: `MainTab` ganhou `navegador`; a aba abre pelo "+" ("Abrir navegador") e por
  "Observar e pilotar" em Configurações, que agora leva ao projeto e fecha o
  dialog em vez de abrir a janela do sistema. `BrowserPanel.tsx` virou
  `useNavegadorDoProjeto` (lógica) + `NavegadorVista` (só props) + contêineres
  (`NavegadorTab`, `NavegadorFlutuante` e a própria janela, que continua
  existindo sem entrada na UI). Páginas abertas saíram da coluna lateral para um
  seletor na barra. Desligado, a aba oferece "Ligar navegador" sem janela.
  "Recarregar" reenvia a navegação para a URL da página (não há `Page.reload` no
  input). Aba estreita: controle vira ícone.
- R2: janela dentro do cartão central, arrastável pela barra e redimensionável
  pelo canto, presa ao cartão (`lib/navegadorFlutuante.ts`, testado). Nasce no
  canto de cima sem cobrir o composer; posição e tamanho lembrados por projeto
  (`store/navegadorFlutuante.ts`, só a geometria persiste). Divergência da
  decisão 3: em vez de "sendo exibido em outro lugar · trazer para cá", o AppShell
  nunca monta as duas; abrir a aba esconde a flutuante e fechar a aba a traz de
  volta. Para a troca não cortar o stream, a parada do preview espera 400 ms e
  desiste se outra vista do projeto montou.
- R3: `browser_capture.rs` com `browser_capture_attach` (anexo pelo mesmo núcleo
  do colar, mais a linha `Página "título" (url):` no rascunho) e
  `browser_capture_copy` (clipboard pelo Rust, sem mudar permissão do front).
  Teto de anexos respeitado. Fixture real de `Page.captureScreenshot` em
  `testdata/chromium-cdp/`.
- Verificado: testes puros e de Rust; vista, aba estreita, menu de páginas, erro,
  flutuante (arrastar para fora, redimensionar além do cartão, geometria salva,
  parada do preview ao fechar) num harness com Tauri simulado no Chromium. Não
  verificado no app de verdade (precisa de build): quadro ao vivo na aba,
  captura e clipboard contra o Chromium do projeto, CPU com a aba aberta.
Já entregue (17/09, K3): "Ligar navegador" do bloqueio do composer liga sem
janela, como Configurações (`mcpPreflightRetry.ts`, teste ao lado); a evidência
de `mcpPreflightRetry.ts:35` abaixo é do estado anterior. K5 segue no B4.
Mock aprovado: aba "Navegador", "Flutuar sobre a conversa" e "Marcar e enviar ao
agente" em `docs/mocks/sprint-ecossistema.html`. Double check na seção final.

Continua `docs/browser-plan.md` (B1 e B2.1 a B2.4 entregues em 30/08) e respeita
ADR-131 (um piloto por navegador, observadores livres), ADR-147 (preflight não é
execução) e ADR-029 (evidência é cache, a UI não mente).

---

## O problema, nas palavras do usuário

- "gosto da ideia de um navegador embutido aqui para que tudo fique de fato no
  ecossistema do Frota"
- "eu pensei em um navegador DENTRO do Frota, não uma janela separada, saca? ou
  que por dentro do Frota fosse possível ter um streaming em tempo real do uso do
  navegador externo, estilo pop-up view" → decidido: stream dentro da Frota.

## Evidência (estado atual)

- **O navegador já existe e já é stream.** A Frota sobe um Chromium próprio por
  projeto, headless, com perfil persistente, e controla por CDP
  (`browser.rs`, 692 linhas). O que se vê é screencast JPEG por CDP guardado como
  último quadro e buscado pelo front (`browser_cdp.rs:230-383`).
- **Mas mora numa janela separada.** `browser_panel_open` cria uma
  `WebviewWindow` com `browser.html` (`browser_panel.rs:29-61`); a única entrada é
  "Observar e pilotar" em Configurações (`ProjectBrowserCard.tsx`). A aba
  principal só conhece `conversa | arquivo | diff` (`lib/mainTabs.ts:19-30`).
- **O front já fala por caminho do projeto.** `browser_preview_start`,
  `browser_preview_frame`, `browser_preview_stop`, `browser_input` e o piloto
  (`acquire`/`heartbeat`/`release`) recebem `projectPath` (`lib/browser.ts:107-176`).
  Só `browser_panel_context` depende do rótulo da janela
  (`browser_panel.rs:63-75`, usado em `BrowserPanel.tsx:146`).
- **Um preview por projeto.** O registry de preview é indexado por projeto
  (`browser_cdp.rs:100-120`) e fechar a janela para o screencast. Janela e aba ao
  mesmo tempo disputariam a mesma sessão.
- **Gate do composer abre janela visível** (`mcpPreflightRetry.ts:35`,
  `startProjectBrowser(projectPath, true)`), enquanto Configurações liga sem
  janela: contradição com a intenção da ADR-131.
- **Injeção só serve ao Playwright.** O endpoint vai sempre como `--cdp-endpoint`
  (`mcp_control.rs:713`); o Chrome DevTools MCP usa `--browser-url`/`--wsEndpoint`.
- **Por que não webview nativo** (já registrado em `browser-plan.md`): WKWebView
  não fala CDP (o agente não pilotaria), a view nativa fica por cima de menus e
  modais, e webview filho exige a feature `unstable` do Tauri com bugs abertos de
  posição e camadas (#9798, #10420, #11376, #13071).

## Decisões

1. **Stream dentro da Frota, não webview nativo.** O quadro é imagem no DOM: dá
   para flutuar, desenhar por cima, recortar e copiar, igual no Mac e no Linux.
2. **Duas apresentações do mesmo stream:** aba principal "Navegador" e janela
   flutuante dentro do app (sobre a conversa, arrastável, redimensionável). A
   janela separada do SO deixa de ser o caminho padrão.
3. **Um espectador por vez por projeto** no primeiro corte: abrir a aba ou a
   flutuante assume o preview; a outra vista mostra "sendo exibido em outro
   lugar · trazer para cá". Contagem de espectadores fica para depois se fizer
   falta.
4. **Ferramentas do agente continuam vindo de MCPs prontos** (Playwright MCP,
   Chrome DevTools MCP). A Frota é dona do processo, do piloto, da tela e da
   evidência; não criamos `mc-browser` de ferramentas.

## Requisitos

### R1 · Aba Navegador (M)
- `MainTab` ganha `{ kind: "navegador" }`; aparece na tira de abas quando o
  navegador do projeto está ligado (ou por "Abrir navegador" no menu de ações).
- Conteúdo: barra (voltar, avançar, recarregar, URL, "ao vivo", seletor de
  página), quadro com clique e digitação quando você é o piloto, estado do piloto
  ("Você pilota" / "Agente pilota") pela vaga da ADR-131.
- O screencast só roda com a aba visível; trocar para a conversa pausa.
- `BrowserPanel.tsx` (484 linhas) se divide em apresentação (props) e contêiner;
  a janela separada passa a usar a mesma apresentação, recebendo `projectPath`
  pelo contêiner em vez de `browser_panel_context`.
- Liga o navegador **sem janela** também pelo gate do composer
  (`mcpPreflightRetry.ts:35`).
- **Aceite:** com o navegador ligado, abrir a aba mostra o quadro sem abrir janela
  do SO; sair da aba pausa o screencast; dropdowns e Lightbox aparecem por cima do
  quadro; gate do composer não abre janela; nenhuma comparação de nome de motor;
  suítes verdes.

### R2 · Flutuar sobre a conversa (P/M)
- "Flutuar" leva o mesmo stream para uma janela dentro do cartão central, com
  barra arrastável, canto redimensionável e botões "voltar para a aba" e "fechar".
  Posição e tamanho lembrados por projeto.
- Não cobre o composer por padrão; nunca sai do cartão central.
- **Aceite:** arrastar e redimensionar sem vazar do cartão; flutuante e aba não
  exibem o stream ao mesmo tempo (decisão 3); `prefers-reduced-motion` sem
  animação de entrada.

### R3 · Anexar a página e copiar imagem (P)
- Comando Rust novo (arquivo próprio, ex. `browser_capture.rs`) com
  `Page.captureScreenshot` em PNG na resolução real; bytes vão direto para o
  armazenamento de anexos, sem base64 no Channel.
- "Anexar à conversa" cria anexo de imagem no rascunho da conversa ativa + a URL
  limpa (mesma limpeza de `sanitize_page_url`). "Copiar imagem" usa o plugin de
  clipboard.
- **Aceite:** anexo com a resolução real da página; URL com query sensível sai
  limpa; sem conversa ativa o botão explica; funciona no Linux; teste com payload
  real de `captureScreenshot`.

### R4 · Marcar e enviar ao agente (G, próxima sprint)
- Congela o quadro, você arrasta um retângulo; a Frota recorta com
  `Page.captureScreenshot` (`clip`) e acha elementos com `DOM.getNodeForLocation`
  (amostras na região) + `DOM.describeNode`/`getBoxModel`; `Accessibility` é
  opcional (domínio experimental, falha aberta).
- Vira dois blocos no composer: a imagem recortada com o traço e o texto "Página,
  viewport, região, elementos (papel, nome, seletor)". Motor sem imagem recebe só
  o texto (capability do registry).
- **Aceite:** marcar um botão numa página de fixture devolve o elemento cujo box
  contém o centro do traço; página que muda no meio cancela com aviso; fixtures de
  CDP real.

### R5 · Qualquer MCP de navegador (M, próxima sprint)
- Forma de conexão declarada no binding (`cdp-endpoint`, `browser-url`,
  `ws-endpoint`) com a lista de flags conflitantes de cada forma. Migração só
  depois de conferir a versão máxima real em `lib.rs`. ADR nova.
- **Aceite:** binding `browser-url` gera `--browser-url http://127.0.0.1:<porta>`;
  Playwright idêntico (testes existentes intactos).

### R6 · Watchdog e recuperação (P, próxima sprint)
- Sonda do navegador no ticker único (`lib/watchdog.ts`), um aviso por episódio;
  no boot, adota Chromium vivo só com prova (PID + `user-data-dir`), senão órfão
  com ação de encerrar.

## Não-objetivos

- Webview nativo, iframe ou CEF.
- Usar o Chrome pessoal da pessoa.
- Simulador iOS e emulador Android (nota de viabilidade apenas: `mobile-mcp`).
- User agent e dispositivo por projeto (fim da fila).

## Ordem de entrega

Sprint atual: R1, R2, R3. Próxima: R4, R5, R6.

## Riscos

- CPU do screencast com a aba aberta por muito tempo (medir; pausar fora de vista
  é requisito).
- Divisão de `BrowserPanel.tsx` perto do teto de tamanho: dividir antes de somar.
- Imagem de página inteira acima de 10 MB (limite de anexo): capturar viewport
  por padrão.

## Arquivos que mudam

`app/src/lib/mainTabs.ts`, `app/src/components/layout/MainTabs.tsx`,
`app/src/components/layout/AppShell.tsx`, `app/src/components/browser/*`
(divisão), `app/src/lib/browser.ts`, `app/src/lib/mcpPreflightRetry.ts`,
`app/src-tauri/src/browser_cdp.rs` (espectador), novo
`app/src-tauri/src/browser_capture.rs` (R3/R4), `app/src-tauri/src/lib.rs`
(registro de comandos).

## Double check (17/09/2026)

Conferido no código: janela separada em `browser_panel.rs:29-61` e contexto preso
ao rótulo (`:63-75`); comandos de preview por `projectPath` (`lib/browser.ts:107-176`);
registry indexado por projeto (`browser_cdp.rs:100-120`); screencast
(`browser_cdp.rs:230+`); `MainTab` com três variantes (`mainTabs.ts:19-30`); gate
com janela visível (`mcpPreflightRetry.ts:35`); flag fixa (`mcp_control.rs:713`);
racional contra webview já em `browser-plan.md` ("Por que NÃO iframe/webview
Tauri"); ADR-131 em `decisions.md:4964`. Não conferido: consumo de CPU do
screencast com a aba aberta (medir no R1).
