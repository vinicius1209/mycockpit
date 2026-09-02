# Navegador para os agents — plano (mc-browser, Plano 2 do Fio Vivo)

> Status: **B1 e B2.1-B2.4 entregues em 30/08/2026**. O navegador é possuído
> pela Frota, nasce em segundo plano somente após gesto explícito, aparece num
> painel próprio e tem arbitragem de um piloto por projeto.

> **Correção de policy (01/09/2026):** marcar um binding como `browser` escolhe
> a instância possuída pela Frota, mas só `required` torna essa capability
> obrigatória. Sem navegador vivo, binding opcional fica fora do turno;
> binding exigido cria um gate antes do spawn. Em nenhum caso há queda para um
> navegador aberto pelo MCP. A decisão específica do projeto continua vencendo
> endpoints e flags conflitantes da origem.

## A pergunta e o veredito

"Plugin/navegador embutido na UI, ou o Playwright MCP já resolve?" — resposta
em camadas:

- **B0 (fundação):** um MCP de automação compatível pode ser roteado pelo
  control plane para qualquer adapter com materialização forte por run.
- **B1 (barato, alto valor): evidência visual NO FIO.** O que falta pra
  "validar coisas" não é o navegador — é VER o que ele viu. Screenshots de
  tool_result renderizados no fio fecham 80% do caso de uso.
- **B2 (o embutido de verdade): mc-browser.** Painel de navegador na UI com o
  app como DONO do browser (mesmo movimento do mc-work para processos). Só
  vale construir se validação visual virar rotina — B0+B1 provam a demanda.

**Por que NÃO iframe/webview Tauri:** iframe morre em `X-Frame-Options`/CSP na
maioria dos sites; a webview do Tauri (WKWebView) não expõe CDP — seria um
navegador que o agent NÃO controla, o inverso do pedido. O padrão da indústria
para "embutido + controlável" é screencast via CDP (frames → canvas), não
embutir o Chromium no processo.

## B0 — Roteamento (feito o grosso; falta o gesto)

- [x] `claude mcp add --scope user playwright -- npx @playwright/mcp@latest`
- [x] `npx playwright install chromium`
- [ ] Ligar bindings no painel MCPs (por projeto e adapter compatível) —
  gesto do usuário; lembrar da semântica: 1º binding = modo gerenciado.
- [ ] Config recomendada do binding (quando B1 chegar): `--output-dir` no
  scratch da conversa + `--caps vision`.

## B1 — Evidência visual no fio (FEITO, 01/08/2026)

Hoje o adapter resume tool_result a TEXTO; bloco `image` é descartado. Um
screenshot do Playwright volta base64 e ninguém vê (adapters.rs, tool_result →
`ToolCallFinished.summary`).

- [x] **B1.1** — Rust: tool_result com blocos `image` vira referência de imagem
  no evento normalizado (`ToolResult.images: Vec<String>`). `evidence.rs`:
  base64 → arquivo em `app_data_dir/evidence/<convId>/<toolId>-<idx>.<ext>`,
  nome determinístico, nunca base64 no Channel/SQLite (padrão dos anexos, path
  RELATIVO). Sink plugado no ClaudeAdapter, no Codex `exec` (se o item trouxer
  `result.content` MCP) e no Codex app-server (mcpToolCall — que também parou
  de despejar o JSON cru com base64 no texto do cartão). Wipe da conversa
  apaga `evidence/<convId>` junto.
- [x] **B1.2** — TS: `ChatItem` tool ganha `images?: string[]` (reducer
  preserva, snapshot persiste → replay-safe); MessageList renderiza thumbnails
  clicáveis na linha da tool + meta "N capturas" (`evidenceMeta`); lightbox
  único (`store/lightbox.ts` + `Lightbox.tsx`, host global no App) com Esc/
  clique-fora/←→ e "Abrir no app padrão" (comando Rust com contenção). O MESMO
  lightbox abre os anexos de imagem do usuário (feedback: "depois de enviada
  eu não consigo abrir"). Leitura via invoke `read_evidence` → object URL
  (padrão da casa, attachments.ts) — sem assetProtocol/convertFileSrc.
- [x] **B1.3** — Capability agnóstica (2 shapes: Anthropic `source.base64` e
  MCP `data`+`mimeType`); degradação honesta: sem imagem/sem sink → evento e
  render idênticos aos de antes; arquivo apagado do disco → placeholder
  "evidência removida", nunca imagem quebrada. agy segue sem (transporte não
  reporta).

## B2 — mc-browser (o embutido, quando a demanda provar)

Espelho do mc-work: o app é dono do substrato, qualquer motor MCP usa, a UI
tem visibilidade de primeira classe.

- [x] **B2.1** — o app spawna/possui um Chromium com `--remote-debugging-port`
  (processo no ProcessRegistry: órfão honesto, parar, retomar). **FEITO em
  06/08/2026** (`browser.rs`): descoberta do binário (Chromium do Playwright
  pela maior revisão, fallback Chrome/Chromium do sistema, mensagem apontando
  `npx playwright install chromium`), `--remote-debugging-port=0` +
  `--user-data-dir` por projeto (perfil persistente; o Chrome 136+ recusa
  debug no profile padrão), endpoint lido do `DevToolsActivePort` com a linha
  `DevTools listening on ws://…` do stderr como fonte secundária, e health
  `GET /json/version` antes de declarar vivo. Comandos `browser_start` /
  `browser_stop` / `browser_status` + evento `browser_state` no canal
  `work://event`.
  **Eixo de posse = PROJETO** (não conversa/run): o `ProcessRegistry` é
  indexado por conversa, então `conv_id` e `run_id` são sintéticos
  (`browser:<project_id>` / `browser-<project_id>`). Efeito colateral
  desejado: o reducer do chat ignora esses eventos de processo (nenhuma
  conversa tem esse id), e o `kill_all` do quit mata o navegador junto.
- [x] **B2.2** — Playwright MCP conecta nesse browser via `--cdp-endpoint` (flag
  já existente no @playwright/mcp) — o agent pilota o navegador DO APP.
  **FEITO em 06/08/2026**. Identificação por BINDING, nunca por nome de
  fornecedor: **migração 35** (`mcp_bindings.browser`, a máxima anterior era
  34). A injeção acontece no plano efêmero do run, DEPOIS do health, então o
  preflight (`probe_stdio`) roda com os args de origem; a policy de recurso é
  aplicada depois e antes do spawn. `--cdp-endpoint`, `--browser` e
  `--headless` da origem saem da cópia efêmera quando o endpoint do projeto
  entra, com registro no manifesto. Sem navegador vivo, o servidor opcional é
  omitido; o exigido pede decisão no composer. Assim uma configuração que
  promete o navegador do projeto nunca abre outro Chrome ou Firefox por conta
  própria.
  Fingerprint do plano só hasheia nomes → sem re-anúncio espúrio (com teste).
- [x] **B2.3** — painel "Navegador" na UI: inventário sanitizado de páginas,
  screencast CDP (`Page.startScreencast`) da mesma aba e takeover humano por
  token com heartbeat. O backend guarda somente o frame JPEG mais recente em
  memória; eventos levam apenas revisão, nunca base64 ou WebSocket. Clique,
  scroll, teclado, texto, endereço e histórico passam pelo CDP somente depois
  de validar a posse. Run, chamada de plugin e pessoa disputam uma lease única
  por projeto; observação continua livre. A lease do run/plugin acompanha seu
  lifetime por RAII, e a humana expira se o painel desaparecer. Inventário
  público nunca recebe a URL bruta, preview é coalescido a no máximo 10 avisos
  por segundo e o frontend impede pulls concorrentes.
- **B2.4** — política por projeto via binding normal do control plane; perfil
  de browser persistente por projeto (login de dev sobrevive entre turnos).
  Perfil persistente já entrou junto com o B2.1.

### Superfície de Configurações (30/08/2026)

O ciclo de vida do Chromium saiu de MCPs e agora vive em **Navegador e
desktop**. MCPs continua mostrando e editando a entrega por binding, porque o
transporte ainda mora ali; o recurso mostra processo, perfil, posse e o elo que
falta. Integrações globais do provider que podem abrir outra janela aparecem
separadas como advisory. Ligar o Chromium nunca mais sugere que todas as tools
do provider foram redirecionadas para ele.

Tools de plugin seguem a mesma posse com uma regra adicional: o catálogo só as
publica quando o recurso pedido já está pronto, e a chamada recebe uma lease
efêmera. Aprovar ou habilitar plugin nunca liga o Chromium. Pedido de
`external-browser` é recusado, sem abrir segunda janela; `desktop-control`
permanece bloqueado até existir broker nativo.

### Hardening posterior, fora do contrato entregue

- **Reaproveitar sessão órfã entre reinícios do app**: hoje o registry de
  sessões vive só em memória, então reiniciar a Frota perde o ponteiro
  para um Chromium que continue vivo (o perfil por projeto está no disco, mas
  o `DevToolsActivePort` daquela instância não é reconciliado no boot). Nada
  mente: o painel diz "desligado" e ligar de novo abre um novo. Reconciliação
  no boot fica para a frente de recuperação pós-crash.
- **Watchdog do navegador**: a morte da janela só é percebida na próxima
  consulta (abrir o painel ou montar o plano de um run). Não há ticker vigiando
  o endpoint; a UI não anuncia vida que não confirmou, mas também não avisa
  sozinha no instante em que o navegador cai.
- **`--output-dir` no scratch da conversa + `--caps vision`** (config
  recomendada do binding no B0): continua gesto manual do usuário.

O Chromium agora nasce com `--headless=new` por padrão, portanto "Ligar" não
abre uma janela externa. O painel da Frota é a superfície visual. O processo,
perfil persistente e endpoint continuam reais; só a apresentação mudou.
Ligar e desligar são serializados por projeto, e o endpoint declara
explicitamente `127.0.0.1`; dois gestos concorrentes não criam um segundo
processo no mesmo perfil.

### Homologação efetiva em 30/08/2026

Um Chromium for Testing foi iniciado em modo headless com perfil temporário e
controlado diretamente por CDP. O smoke test enumerou duas páginas, recebeu um
frame real de screencast, inseriu o texto `Frota` e confirmou que o WebSocket
permaneceu em loopback. O processo foi encerrado e o perfil temporário enviado
à Lixeira. Nenhum Chrome ou Firefox visível foi aberto durante a validação.

## Guardas

- Agnóstico sempre: a capability chega por MCP; agy (sem MCP) degrada honesto.
- Nada de base64 no banco/Channel; imagem vive em disco, o fio referencia.
- B2 nunca antes de B0+B1 provarem uso real — mecanismo especulativo é contra
  a doutrina (`autonomy.md`).

## Fora de escopo

- Embutir Chromium no processo Tauri (não existe caminho são).
- Browser-use do app ChatGPT (`computer-use` MCP): binário interno do bundle,
  caminho relativo, não portável — documentado como não-suportado, não é rota.

---

## Estudo de viabilidade (04/08/2026) — 3 frentes, e o que elas mudam

> Time de pesquisa: (a) APIs do Tauri 2 + PiP no macOS, (b) como o mercado faz,
> (c) prontidão do repo. Gatilho: o usuário viu o navegador embutido com
> picture-in-picture do app do ChatGPT mostrando o PRÓPRIO dev server dele
> (`Frota — 127.0.0.1:1420`) e perguntou se dá pra ter isso aqui.

### O achado que reorganiza a decisão

**Todo mundo que tem "navegador embutido controlável" é Electron** — e dirige o
próprio `WebContentsView` por CDP. Ninguém embute Chromium num app
não-Chromium. Evidência forense do `/Applications/ChatGPT.app` da máquina:
Electron com **Chromium 150** embutido, bundle id `com.openai.codex`,
Developer ID da OpenAI, app group `…com.openai.sky.CUAService` e um runtime
Node dedicado (`Resources/cua_node/`). O "computer use" dele **não** é controle
de SO: é CDP contra conteúdo web que o app já possui — **zero permissão TCC**.

E o caminho nativo difícil tem veredito: o **Atlas/OWL** (Chromium headless +
Mojo + `CALayerHost`, que é **API privada** da Apple) **será desligado em
09/08/2026**. A OpenAI construiu a integração nativa mais sofisticada que
existe e migrou para Electron + extensão. Esse caminho está fora de cogitação
aqui.

**Correção de rumo do plano:** a conclusão original ("não iframe/webview
Tauri") continua CERTA, mas por uma razão parcialmente errada. O motivo real
não é só "WKWebView não expõe CDP" — é que **o Tauri está fora do clube do
Electron**, e o screencast é a saída de quem não pode embutir Chromium.

### Por que a webview embutida não serve como painel principal

Achado técnico independente, e definitivo: no macOS a child webview do Tauri
(`window.add_child`, feature `unstable`) é uma **`NSView` irmã**, não um nó do
DOM — ela flutua ACIMA de tudo que o React desenha. Dropdown, modal, tooltip e
o **lightbox de evidência (B1.2)** ficariam ocultos sobre o retângulo do
navegador. É a mesma limitação do `BrowserView` do Electron. Somado a isso:
sincronizar bounds em drag de splitter produz descolamento visível, e a feature
é `unstable` (breaking change documentado em minor).

O screencast CDP resolve isso **de graça**: o frame vira pixels no `<canvas>`,
a UI volta a ser UI, e o PiP vira uma janela normal — sem child webview, sem
`unstable`, sem sincronia de retângulo.

### Permissões do macOS: o ponto que decide tudo

**Dirigir web content por CDP não exige NENHUMA permissão TCC.** Mecanicamente:
transporte é HTTP+WS em loopback (isento até do Local Network do macOS 15);
`Input.dispatchKeyEvent` sintetiza evento DENTRO do Chrome (nunca `CGEventPost`
→ sem Accessibility); `Page.captureScreenshot` lê o compositor da aba (não o
framebuffer → sem Screen Recording).

O caminho OS-level custaria: Screen Recording com **re-consulta mensal
insuprimível** (Sequoia/macOS 26), Accessibility (incompatível com App
Sandbox), e — o que morde no dia a dia — **assinatura ad-hoc não tem
Designated Requirement estável, então TODO rebuild perde os grants** (resposta
do DTS da Apple). Isso explica retroativamente o ADR-013: a notificação nativa
que "nunca funcionou" é a mesma classe de problema.

### Recomendação revisada (substitui a ordem original do B2)

1. **B2.1 + B2.2 primeiro, e sozinhos** — o app spawna e possui um Chromium com
   `--remote-debugging-port` (o `ProcessRegistry` do mc-work já dá process
   group, tail, TERM/KILL e órfão honesto); o Playwright MCP conecta com
   `--cdp-endpoint` (flag já existente; a injeção é ~10 linhas no plano
   efêmero do run, e o fingerprint do plano só hasheia NOMES, então não dispara
   re-anúncio espúrio). Entrega o ganho central sem depender de painel nenhum:
   a janela headed já é visível.
2. **B2.3 (screencast no painel/PiP) depois**, quando o uso provar rotina.
   Referência de implementação: `vercel-labs/agent-browser`. Default sugerido:
   qualidade 20-40 em 640×360 (~9 KB/frame), subindo sob demanda.
3. **PiP como janela própria** reusando a receita que já existe no repo
   (`tray.rs:477-495`: sem decoração, transparente, always-on-top, visível em
   todos os Spaces, com posicionamento multi-monitor já resolvido). Limite
   honesto: flutuar sobre app em **fullscreen** o Tauri não faz (issue fechada
   como "not planned") — exigiria `NSPanel` via plugin de terceiro.

### Cortado do escopo (com razão registrada)

- **CEF** (Chromium embutido de verdade): +170 MB no bundle, init de até ~2s,
  punch-out de `NSView` e override de hit-testing. Resolve um problema que não
  é o nosso.
- **Computer use de SO**: permissão pesada + nag mensal + dívida de assinatura,
  para um caso que o CDP resolve com zero permissão. A própria doutrina da
  Anthropic põe screen control como último recurso ("reserved for things
  nothing else can reach").
- **Descobrir/lançar o Chrome do usuário**: o Cursor tentou e REMOVEU em
  fev/2026, recomendando `playwright/mcp` no lugar.

### Dois ganhos baratos que a pesquisa achou

- **Reusar o dev server já rodando** em vez de subir duplicado (padrão Cursor).
  Pré-requisito que falta: o app sabe RODAR dev server (`process_start` do
  mc-work) mas **não lê a porta** — a linha "Local: http://localhost:5173"
  chega inteira no tail e é ignorada. Regex no tail ou `lsof` no process group.
- **Verificar no INÍCIO da sessão**, não só depois de implementar: pega
  regressão de sessão anterior que review de código não pega.

### Padrões de permissão a copiar (Claude in Chrome)

- Permissão **por invocação, não por nome de tool**: tool read-only com flag
  mutante também pede aprovação; batch degrada para o membro mais estrito.
- Grant por recurso com 3 opções (uma vez / sempre / negar), por site
  **incluindo subdomínios**; **localhost e arquivos do projeto pré-confiados**
  para o loop de verificação nunca perguntar.
- Perfil de browser **separado** do pessoal (é o que o ChatGPT faz: sem herdar
  logins), e excluir o próprio terminal/app do que o agent observa, pra o
  contexto não se realimentar.
