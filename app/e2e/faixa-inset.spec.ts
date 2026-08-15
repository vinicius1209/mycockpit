// A faixa de status não pode encostar na borda da janela.
//
// No build 207 ela era o ÚNICO elemento com folga zero: todo o resto flutuava
// 8px pra dentro e ela ficava colada no fundo. O canto da janela do macOS tem
// raio de 10px, então os 10px de baixo da faixa caíam dentro do arco que o
// sistema recorta — e o relato ("parece cortada, veja as extremidades") era
// geometria, não impressão.
//
// A prova é feita pelo NÚMERO que importa: quanto o arco do canto invade
// horizontalmente na altura mais baixa da faixa. Encostada, invade os 10px
// inteiros; com 8px de folga, invade 0,2px. Por isso o teste afirma a folga, e
// não "o texto está visível" — texto visível passaria nos dois casos.

import { test, expect } from "@playwright/test"

/** Raio do canto da janela no macOS (o mesmo que a moldura de risco usa). */
const RAIO = 10

test("a faixa de status respeita o inset da janela, como todo o resto", async ({
  page,
}) => {
  await page.goto("/")
  const faixa = page.locator('footer[aria-label="Telemetria do app"]')
  await expect(faixa).toBeVisible()

  const m = await page.evaluate((raio) => {
    const bar = document.querySelector(
      'footer[aria-label="Telemetria do app"]',
    ) as HTMLElement
    const b = bar.getBoundingClientRect()
    const folga = window.innerHeight - b.bottom
    // Invasão horizontal do arco na altura mais baixa da faixa.
    const dy = raio - folga
    const invasao = dy > 0 ? raio - Math.sqrt(raio * raio - dy * dy) : 0
    return { folga, invasao, altura: b.height }
  }, RAIO)

  // A faixa continua com 24px de conteúdo: a folga veio de margem, não de
  // padding (padding num h-6 comeria a altura do texto).
  expect(m.altura).toBe(24)
  // O vão de baixo é o MESMO inset do conteúdo (8px). Não "algum" vão: o mesmo,
  // senão a faixa vira um terceiro alinhamento na janela.
  expect(m.folga).toBeGreaterThanOrEqual(8)
  // E o que isso compra: o arco praticamente não alcança a faixa.
  expect(m.invasao).toBeLessThan(1)
})
