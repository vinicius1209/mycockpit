# Proveniência

`capture-screenshot-png.json`: resposta integral de `Page.captureScreenshot`
(`format: "png"`, `fromSurface: true`, `captureBeyondViewport: false`) do
Chromium do Playwright 1.61.1, capturada em 17/09/2026 nesta máquina por uma
sessão CDP, numa página local de 96×60 com o texto "Jornal". Envelope `{id,
result}` como chega pelo WebSocket; nada editado.

`marcacao.json`: respostas integrais de `Page.getLayoutMetrics`,
`DOM.getNodeForLocation` (no centro do botão e num ponto de fundo) e
`Runtime.callFunctionOn` com a função de `src/browser_marcacao_descrever.js` (o MESMO
arquivo que o app injeta), capturadas em 17/09/2026 por uma sessão CDP do Chromium do
Playwright 1.61.1 numa página de loja de teste 1280×800 (título, campo de e-mail,
botão "Finalizar pedido" com `<span>` dentro, link de ajuda). A caixa do botão medida
pelo Playwright vai junto para conferência.
