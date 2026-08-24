// Dialog não pode ficar EMBAÇADO nem ser CORTADO sem escapatória.
//
// Os dois defeitos vinham da mesma linha: centralizar com
// `translate: -50% -50%` sem `max-h` nenhum.
//
//  1. EMBAÇADO — metade de uma altura ÍMPAR é offset FRACIONÁRIO. Medido no
//     modal "Nova automação": altura 807,625 → translate de -403,8125px. O
//     elemento é rasterizado fora da grade de pixels e TODO o texto dentro
//     dele sai borrado. Como a altura vem do conteúdo, o defeito ia e vinha
//     conforme o formulário, e parecia "bug de foco".
//
//  2. CORTADO — 807px de form numa janela de 720px, centrado por translate:
//     `top: -43,8` e o rodapé além da tela. E `scrollHeight === clientHeight`,
//     ou seja, NEM ROLANDO dava pra alcançar o botão de confirmar.
//
// A prova aqui é GEOMETRIA MEDIDA em navegador de verdade, não string de
// classe: classe passa em teste de unidade e ainda assim pode estar sendo
// anulada por outra regra — e neste caso o culpado nem aparecia em
// `getComputedStyle().transform`, porque Tailwind v4 usa a propriedade
// `translate`, que é separada.

import { test, expect, type Page } from "@playwright/test"

async function abrirModalAlto(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarOpen: true,
          contextOpen: true,
          viewMode: "linear",
          settings: { onboarded: true },
        },
        version: 4,
      }),
    )
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 })
  await page.getByText("Agendamentos", { exact: true }).first().click()
  // "Nova automação" é o dialog mais ALTO do app — o que expõe os dois
  // defeitos. Numa lista vazia o gatilho é o link do estado vazio.
  await page.getByRole("button", { name: /comece do zero/i }).first().click()
  await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible()
  await page.waitForTimeout(400) // a animação de entrada termina
}

test("o dialog não é posicionado por translate (era o que borrava o texto)", async ({
  page,
}) => {
  await abrirModalAlto(page)
  const m = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-slot="dialog-content"]',
    ) as HTMLElement
    const s = getComputedStyle(el)
    return { translate: s.translate, transform: s.transform, top: el.getBoundingClientRect().top }
  })
  // Nenhum deslocamento por porcentagem da PRÓPRIA altura: é dele que sai o
  // meio-pixel. `none` nos dois, e a posição final em pixel inteiro.
  expect(m.translate).toBe("none")
  expect(m.transform).toBe("none")
  expect(Number.isInteger(m.top)).toBe(true)
})

test("dialog mais alto que a janela ROLA em vez de ser cortado", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await abrirModalAlto(page)
  const m = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-slot="dialog-content"]',
    ) as HTMLElement
    const viewport = document.querySelector(
      '[data-slot="dialog-viewport"]',
    ) as HTMLElement
    const r = el.getBoundingClientRect()
    return {
      maisAltoQueAJanela: r.height > window.innerHeight,
      cortadoEmCima: r.top < 0,
      viewportRola: viewport.scrollHeight > viewport.clientHeight + 1,
    }
  })
  // O cenário precisa ser o difícil, senão o teste não prova nada.
  expect(m.maisAltoQueAJanela).toBe(true)
  // Topo nunca cortado: era ali que ficava o título e o X de fechar.
  expect(m.cortadoEmCima).toBe(false)
  // E o que passa do fim é ALCANÇÁVEL — a parte que antes não existia.
  expect(m.viewportRola).toBe(true)
})
