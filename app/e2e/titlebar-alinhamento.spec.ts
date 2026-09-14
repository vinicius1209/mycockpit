import { test, expect, type Page } from "@playwright/test"

// ALINHAMENTO DA BARRA SUPERIOR — o tipo de regra que só existe em LAYOUT: não
// há função pura pra testar, e jsdom não calcula largura nenhuma. Então mede-se
// no browser de verdade, no `dist/` buildado, como o smoke-test de boot.
//
// O que estas medições travam (defeitos achados na inspeção de 14/08/2026):
//  - o centro de comando Painel/Trabalho é centrado no VÃO entre os dois
//    blocos, não na janela. Centrado na janela ele ficava com ar sobrando à
//    esquerda e quase encostado no bloco da direita, que é ~2x mais largo;
//  - a largura do centro de comando é RESERVADA: quem cede sob pressão é o nome do
//    projeto (truncate), nunca a navegação;
//  - nada estoura a janela na largura MÍNIMA do app (940, tauri.conf.json).

/** Larguras cobertas: a mínima da janela, o ponto onde os rótulos longos
 *  entram (lg = 1024) e uma tela larga. */
const LARGURAS = [940, 1024, 1280, 1600]

async function preparar(page: Page) {
  // pula o onboarding: o overlay não muda a barra, mas o app fica mais parecido
  // com o uso real (sidebar e projeto ativo montados).
  await page.addInitScript(() => {
    localStorage.setItem(
      "mc.app",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarOpen: true,
          contextOpen: true,
          viewMode: "painel",
          settings: { onboarded: true },
        },
        version: 4,
      }),
    )
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByRole("button", { name: "Abrir Painel", exact: true }),
  ).toBeVisible({ timeout: 10_000 })
}

/** Mede, no DOM real: os vãos entre o centro de comando e o conteúdo de cada lado, a
 *  largura do centro de comando e o quanto o conteúdo passa da janela. */
async function medir(page: Page) {
  return await page.evaluate(() => {
    const header = document.querySelector("header")!
    const zonas = [...header.children]
    const caixa = (e: Element) => e.getBoundingClientRect()
    const centroDeComando = header.querySelector('[data-testid="centro-de-comando"]')!
    const visiveis = (z: Element) =>
      [...z.children].filter((e) => caixa(e).width > 0)
    const ultimoEsq = visiveis(zonas[0]).at(-1)!
    const primeiroDir = visiveis(zonas[2])[0]!
    const c = caixa(centroDeComando)
    let maisDireita = 0
    for (const el of header.querySelectorAll("*")) {
      const r = caixa(el)
      if (r.width > 0) maisDireita = Math.max(maisDireita, r.right)
    }
    return {
      vaoEsquerda: c.left - caixa(ultimoEsq).right,
      vaoDireita: caixa(primeiroDir).left - c.right,
      larguraCentroDeComando: c.width,
      estouro: maisDireita - window.innerWidth,
    }
  })
}

test("o centro de comando central fica centrado no VÃO entre os dois blocos, em toda largura", async ({
  page,
}) => {
  await preparar(page)
  for (const largura of LARGURAS) {
    await page.setViewportSize({ width: largura, height: 832 })
    await page.waitForTimeout(200)
    const m = await medir(page)
    // Centrado no vão = os dois vãos são iguais (1px de folga pro arredondamento
    // sub-pixel). Centrado na JANELA, que era o defeito, dá vãos diferentes
    // sempre que os blocos têm larguras diferentes — e eles têm.
    expect(
      Math.abs(m.vaoEsquerda - m.vaoDireita),
      `vãos desiguais em ${largura}px: ${m.vaoEsquerda} vs ${m.vaoDireita}`,
    ).toBeLessThanOrEqual(1)
    // Folga mínima reservada dos dois lados (o px-3 da zona do meio): o
    // centro de comando nunca encosta em nada.
    expect(m.vaoEsquerda, `sem folga em ${largura}px`).toBeGreaterThanOrEqual(11)
    expect(m.estouro, `conteúdo estourou a janela em ${largura}px`).toBeLessThanOrEqual(0)
  }
})

test("sob pressão de largura quem cede é o nome do projeto, nunca o centro de comando", async ({
  page,
}) => {
  await preparar(page)

  await page.setViewportSize({ width: 1600, height: 832 })
  await page.waitForTimeout(200)
  const largo = await medir(page)

  // Pior caso real da barra: nome de projeto comprido (o único item elástico da
  // esquerda) na janela MÍNIMA do app. O nome é escrito direto no DOM porque no
  // browser não há Tauri nem banco — o que está sob teste é a REGRA de layout
  // (quem trunca), não de onde veio o texto.
  const temProjeto = await page.evaluate(() => {
    const b = [...document.querySelectorAll("header button")].find((x) =>
      x.getAttribute("aria-label")?.startsWith("Projeto "),
    )
    if (!b) return false
    b.querySelector("[data-project-name]")!.textContent =
      "plataforma-de-checkout-atlas-commerce-v2-migracao-do-gateway-legado"
    return true
  })
  expect(temProjeto, "o boot de teste precisa de projeto ativo").toBe(true)

  await page.setViewportSize({ width: 940, height: 832 })
  await page.waitForTimeout(200)
  const estreito = await medir(page)

  // A navegação mantém a largura inteira…
  expect(estreito.larguraCentroDeComando).toBe(largo.larguraCentroDeComando)
  expect(estreito.estouro).toBeLessThanOrEqual(0)
  // …e é o nome do projeto que trunca.
  const truncado = await page.evaluate(() => {
    const b = [...document.querySelectorAll("header button")].find((x) =>
      x.getAttribute("aria-label")?.startsWith("Projeto "),
    ) as HTMLElement
    const name = b.querySelector("[data-project-name]")!
    return name.scrollWidth > name.clientWidth + 1
  })
  expect(truncado, "o nome do projeto deveria truncar a 940px").toBe(true)
})
