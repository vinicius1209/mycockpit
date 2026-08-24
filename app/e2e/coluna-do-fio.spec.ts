// A coluna do fio tem a MESMA largura física em toda escala de zoom.
//
// ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
// O defeito que ele pega não aparece em teste de unidade nem em revisão de
// código: a aritmética `widthPercent * scale === 100` estava CERTA e a coluna
// mesmo assim mudava de tamanho. Em Chrome moderno, `zoom` é padronizado e uma
// porcentagem resolve contra o bloco contentor JÁ AJUSTADO pelo zoom do próprio
// elemento — então compensar a largura pelo inverso da escala compensa DUAS
// vezes.
//
// Medido aqui, com pai de 760px:
//   escala 0,8 → pintava 950px (transbordando o pai)
//   escala 1,3 → pintava 585px (coluna encolhendo)
//
// ── O QUE ELE COBRE, E O QUE NÃO ───────────────────────────────────────────
// Cobre o CONTRATO DE CSS (as duas caixas, o zoom e a largura), reproduzido
// aqui porque o transcript só renderiza com conversa real e semear isso no e2e
// custaria mais do que vale. NÃO cobre a fiação do componente — dessa parte
// cuida `conversationScale.test.ts`, que fixa `width: "100%"` e quebra se
// alguém reintroduzir a compensação.
//
// A medida é `elementFromPoint` varrendo o eixo x: ela devolve o que está
// PINTADO naquele pixel. `getBoundingClientRect` não serve — ele responde no
// espaço SEM zoom e diria "950" com o elemento ocupando 760 na tela, ou o
// contrário. Foi por isso que o defeito passou.

import { test, expect, type Page } from "@playwright/test"

const COLUNA = 760
const HOST = 1200

async function larguraPintada(page: Page, escala: number): Promise<number> {
  await page.setContent(`
    <body style="margin:0"><div style="width:${HOST}px">
      <div id="fora" style="margin:0 auto;width:100%;min-width:0;max-width:${COLUNA}px">
        <div id="dentro" style="width:100%;zoom:${escala}">
          <p id="linha" style="margin:0">medindo a coluna</p>
        </div>
      </div>
    </div></body>`)
  return page.evaluate((largura) => {
    let esq = -1
    let dir = -1
    for (let x = 0; x < largura; x++) {
      const el = document.elementFromPoint(x, 8)
      if (el?.id === "dentro" || el?.id === "linha") {
        if (esq < 0) esq = x
        dir = x
      }
    }
    return dir - esq + 1
  }, HOST)
}

test("a largura física da coluna não muda com o zoom", async ({ page }) => {
  await page.setViewportSize({ width: HOST, height: 400 })
  for (const escala of [0.8, 0.9, 1, 1.15, 1.3]) {
    const largura = await larguraPintada(page, escala)
    // Folga de 1px pro arredondamento de subpixel; além disso é a coluna
    // respirando com o zoom, que é exatamente o defeito.
    expect(
      Math.abs(largura - COLUNA),
      `escala ${escala} pintou ${largura}px em vez de ${COLUNA}px`,
    ).toBeLessThanOrEqual(1)
  }
})

test("compensar a largura pelo inverso QUEBRA — a prova de que o teste morde", async ({
  page,
}) => {
  // Sem isto, o teste acima passaria mesmo se alguém removesse o zoom inteiro.
  // Aqui reproduzimos a versão ERRADA e exigimos que ela falhe.
  await page.setViewportSize({ width: HOST, height: 400 })
  await page.setContent(`
    <body style="margin:0"><div style="width:${HOST}px">
      <div style="margin:0 auto;width:100%;min-width:0;max-width:${COLUNA}px">
        <div id="dentro" style="width:${100 / 0.8}%;zoom:0.8">
          <p id="linha" style="margin:0">medindo a coluna</p>
        </div>
      </div>
    </div></body>`)
  const largura = await page.evaluate((h) => {
    let esq = -1
    let dir = -1
    for (let x = 0; x < h; x++) {
      const el = document.elementFromPoint(x, 8)
      if (el?.id === "dentro" || el?.id === "linha") {
        if (esq < 0) esq = x
        dir = x
      }
    }
    return dir - esq + 1
  }, HOST)
  expect(largura).toBeGreaterThan(COLUNA + 100)
})
