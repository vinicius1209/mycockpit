// Texto longo não pode empurrar o conteúdo do diálogo para fora do cartão.
//
// Visto em 22/09/2026 no "Adicionar projeto": com um caminho de pasta longo, o
// diálogo ficava com 448px e o formulário (nome, pasta, pré-visualização,
// botões) vazava pela direita. O `DialogContent` é `grid` sem colunas, e a
// coluna implícita cresce até o min-content do filho; texto `truncate` tem
// min-content igual ao texto INTEIRO. O `min-w-0` da linha flex não alcança
// essa conta. A linha de pré-visualização trunca o NOME do mesmo jeito, então
// um nome longo reproduz o defeito fora do Tauri (a pasta só vem do seletor
// nativo).
//
// A prova é geometria medida, como em `dialog-centralizado.spec.ts`.

import { test, expect } from "@playwright/test"

test("nome longo no Adicionar projeto fica dentro do diálogo", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
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
  await page.getByRole("button", { name: "Adicionar projeto" }).first().click()
  const dialogo = page.locator('[data-slot="dialog-content"]')
  await expect(dialogo).toBeVisible()
  await page.waitForTimeout(400) // a animação de entrada termina

  await page
    .locator("#project-name")
    .fill(`Landing Prime ${"com um nome que não acaba mais ".repeat(8)}`)
  await page.waitForTimeout(100)

  const m = await dialogo.evaluate((el) => {
    const caixa = el.getBoundingClientRect()
    const filhos = Array.from(el.querySelectorAll("form *")) as HTMLElement[]
    const alemDaBorda = filhos.filter((f) => f.getBoundingClientRect().right > caixa.right + 0.5)
    return {
      vazaNaLargura: el.scrollWidth - el.clientWidth,
      larguraDoModal: caixa.width,
      larguraDoForm: (el.querySelector("form") as HTMLElement).getBoundingClientRect().width,
      alemDaBorda: alemDaBorda.length,
    }
  })
  // O cenário precisa ser o difícil: o nome sozinho passa da largura do modal.
  expect(m.larguraDoModal).toBeLessThan(500)
  expect(m.vazaNaLargura).toBe(0)
  expect(m.larguraDoForm).toBeLessThanOrEqual(m.larguraDoModal)
  expect(m.alemDaBorda).toBe(0)
})
