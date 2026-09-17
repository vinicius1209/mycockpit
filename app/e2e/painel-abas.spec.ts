import { test, expect, type Page } from "@playwright/test"

// AS ABAS DO PAINEL DIREITO — mesma classe de regra do `titlebar-alinhamento`:
// só existe em LAYOUT, não há função pura pra testar e jsdom não calcula
// largura nenhuma. Mede-se no browser de verdade, no `dist/` buildado.
//
// O defeito que motivou (build 206): com o painel na largura padrão, a terceira
// aba aparecia como "PL". As abas usavam caixa-alta + tracking, o MESMO
// tratamento dos títulos de seção deste painel — e caixa-alta com tracking
// custa ~18% de largura. Medido: a tira com caixa-alta pede 353,6px; sem, 298,9.
//
// O que estas medições travam:
//  - nenhuma aba é cortada em NENHUMA largura do painel (ele é redimensionável,
//    `minSize` 240px a `maxSize` 42% — AppShell.tsx);
//  - quando os quatro rótulos cabem, eles APARECEM (degradar por decreto era a
//    saída recusada: ícone-só sempre vira enigmas a decorar);
//  - no painel mínimo a tira degrada pra ícone, e o CONTADOR continua visível
//    nos dois modos (é o único dado da tira que muda sozinho).

const ABAS = ["Arquivos", "Conversa", "Alterações", "Bastidores", "Contexto"] as const

async function preparar(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarOpen: true,
          contextOpen: true,
          // `linear` é a única superfície onde o painel direito monta
          // (AppShell.tsx: `contextOpen && viewMode === "linear"`).
          viewMode: "linear",
          settings: { onboarded: true },
        },
        version: 4,
      }),
    )
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(
    page.getByRole("button", { name: "Contexto", exact: true }),
  ).toBeVisible({ timeout: 10_000 })
}

/** Mede, no DOM real: a largura do painel, a da tira de abas, e o quanto cada
 *  aba passa da borda direita do painel (>0 = cortada). */
async function medir(page: Page) {
  return await page.evaluate((abas) => {
    const botoes = abas.map(
      (nome) =>
        [...document.querySelectorAll("aside button")].find(
          (b) => b.getAttribute("aria-label") === nome,
        ) as HTMLElement,
    )
    const header = botoes[0].closest("header") as HTMLElement
    const painel = header.parentElement as HTMLElement
    const caixaPainel = painel.getBoundingClientRect()
    return {
      larguraPainel: +caixaPainel.width.toFixed(1),
      // Estouro da tira: o header tem `overflow` do aside (hidden) por cima —
      // scrollWidth denuncia o conteúdo que não coube.
      estouroTira: header.scrollWidth - header.clientWidth,
      abas: botoes.map((b) => ({
        nome: b.getAttribute("aria-label"),
        // Corte: o quanto a aba passa da borda direita do PAINEL.
        corte: +(b.getBoundingClientRect().right - caixaPainel.right).toFixed(1),
        // Rótulo visível = o <span> do texto está renderizado (a degradação por
        // largura é `display:none` via container query, então width = 0).
        rotuloVisivel: [...b.querySelectorAll("span")].some(
          (s) => s.textContent === b.getAttribute("aria-label") &&
            s.getBoundingClientRect().width > 0,
        ),
        // Rótulo que aparece pela metade ("Alteraç…") passava pelo teste de
        // corte e pelo de visibilidade. Medido com a quinta aba (ADR-200).
        rotuloTruncado: [...b.querySelectorAll("span")].some(
          (s) => s.textContent === b.getAttribute("aria-label") &&
            s.getBoundingClientRect().width > 0 &&
            s.scrollWidth > s.clientWidth,
        ),
      })),
    }
  }, ABAS as unknown as string[])
}

/** Injeta um contador de 3 dígitos na aba "Alterações" — o PIOR CASO real da
 *  tira (um refactor grande passa de 100 arquivos alterados). O contador só
 *  renderiza com `changedCount > 0`, e no browser não há git nem Tauri; o que
 *  está sob teste é a REGRA de layout, não de onde veio o número. */
async function comContadorLargo(page: Page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("aside button")].find(
      (x) => x.getAttribute("aria-label") === "Alterações",
    ) as HTMLElement
    const badge = document.createElement("span")
    badge.className = "font-mono font-semibold tabular-nums"
    badge.dataset.contador = "1"
    badge.textContent = "999"
    b.appendChild(badge)
  })
}

test("nenhuma aba é cortada, em nenhuma largura do painel", async ({ page }) => {
  await preparar(page)
  await comContadorLargo(page)

  // Janela mínima do app (940, tauri.conf.json) → painel no `minSize` de 240px;
  // e janelas largas, onde o painel abre na proporção padrão de 30%.
  for (const largura of [940, 1280, 1600, 1760, 1920, 2200]) {
    await page.setViewportSize({ width: largura, height: 832 })
    await page.waitForTimeout(200)
    const m = await medir(page)
    expect(
      m.estouroTira,
      `a tira de abas estourou o painel (${m.larguraPainel}px) na janela de ${largura}px`,
    ).toBeLessThanOrEqual(0)
    for (const aba of m.abas) {
      expect(
        aba.rotuloTruncado,
        `rótulo de "${aba.nome}" truncado (painel ${m.larguraPainel}px, janela ${largura}px)`,
      ).toBe(false)
      expect(
        aba.corte,
        `aba "${aba.nome}" cortada em ${aba.corte}px (painel ${m.larguraPainel}px, janela ${largura}px)`,
      ).toBeLessThanOrEqual(0)
    }
  }
})

test("rótulo quando cabe, ícone quando não cabe — e o contador fica nos dois", async ({
  page,
}) => {
  await preparar(page)
  await comContadorLargo(page)

  // Com a tira >= 492px (medido para CINCO rótulos inteiros com o pior
  // contador, ADR-200; eram 400px com quatro), os nomes cabem e precisam
  // aparecer. A janela de 2200px abre o painel acima disso na proporção padrão.
  // Em larguras menores a tira degrada para ícone, sem corte e sem truncar.
  await page.setViewportSize({ width: 2200, height: 832 })
  await page.waitForTimeout(200)
  const padrao = await medir(page)
  for (const aba of padrao.abas) {
    expect(
      aba.rotuloVisivel,
      `rótulo de "${aba.nome}" sumiu na largura padrão (painel ${padrao.larguraPainel}px)`,
    ).toBe(true)
  }

  // Painel arrastado até o mínimo: aí sim degrada pra ícone, por LARGURA.
  await page.setViewportSize({ width: 940, height: 832 })
  await page.waitForTimeout(200)
  const minimo = await medir(page)
  expect(
    minimo.larguraPainel,
    "o painel deveria estar no minSize (240px) na janela mínima",
  ).toBeLessThan(260)
  for (const aba of minimo.abas) {
    expect(
      aba.rotuloVisivel,
      `rótulo de "${aba.nome}" continuou visível no painel mínimo (${minimo.larguraPainel}px)`,
    ).toBe(false)
  }

  // O contador sobrevive à degradação: ele é o único dado da tira que muda
  // sozinho, e some junto com o rótulo seria perder a informação, não escondê-la.
  const contadorVisivel = await page.evaluate(
    () =>
      (
        document.querySelector("[data-contador]") as HTMLElement
      ).getBoundingClientRect().width > 0,
  )
  expect(contadorVisivel, "o contador sumiu no painel mínimo").toBe(true)
})
