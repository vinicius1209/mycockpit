# Navegador para os agents — plano (mc-browser, Plano 2 do Fio Vivo)

> Status: proposto em 01/08/2026, a partir do incidente "descoberta retornou
> zero navegadores" (Codex, 31/07) e da pergunta "dá pra ter navegador embutido
> na interface?". Pré-requisito já feito: Playwright MCP registrado no escopo
> user do Claude + Chromium instalado (31/07).

## A pergunta e o veredito

"Plugin/navegador embutido na UI, ou o Playwright MCP já resolve?" — resposta
em camadas:

- **B0 (já funciona hoje, zero código):** Playwright MCP roteado pelo control
  plane dá navegador REAL a Claude E Codex — janela headed visível no desktop,
  o usuário assiste o agent navegar. Não é "dentro da UI", mas é funcional e
  agnóstico agora.
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
- [ ] Ligar bindings no painel Integrações MCP (por projeto, Claude e Codex) —
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

- **B2.1** — o app spawna/possui um Chromium com `--remote-debugging-port`
  (processo no ProcessRegistry: órfão honesto, parar, retomar).
- **B2.2** — Playwright MCP conecta nesse browser via `--cdp-endpoint` (flag
  já existente no @playwright/mcp) — o agent pilota o navegador DO APP.
- **B2.3** — painel "Navegador" na UI: screencast CDP (`Page.startScreencast`
  → frames JPEG → canvas) da MESMA aba que o agent dirige, com takeover humano
  (input via CDP). Um navegador, dois pilotos, **um pilota por vez** (mesma
  filosofia dos Especialistas/ADR-026).
- **B2.4** — política por projeto via binding normal do control plane; perfil
  de browser persistente por projeto (login de dev sobrevive entre turnos).

## Guardas

- Agnóstico sempre: a capability chega por MCP; agy (sem MCP) degrada honesto.
- Nada de base64 no banco/Channel; imagem vive em disco, o fio referencia.
- B2 nunca antes de B0+B1 provarem uso real — mecanismo especulativo é contra
  a doutrina (`autonomy.md`).

## Fora de escopo

- Embutir Chromium no processo Tauri (não existe caminho são).
- Browser-use do app ChatGPT (`computer-use` MCP): binário interno do bundle,
  caminho relativo, não portável — documentado como não-suportado, não é rota.
