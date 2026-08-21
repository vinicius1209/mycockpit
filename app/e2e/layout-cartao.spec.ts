// Nada dentro do cartão do centro pode torná-lo ROLÁVEL.
//
// O build #241 quebrou assim: um dos hosts de superfície saiu sem `flex-col`,
// o filho que se declara `flex-1` deixou de ser item de flex e cresceu até a
// altura do conteúdo (um diff de 1.400 linhas). O cartão escondeu o vazamento
// — `overflow: hidden` esconde a BARRA, não impede o scroll —, mas cartão e
// painel ficaram com `scrollHeight > clientHeight`, e um `scrollIntoView`
// empurrou a janela inteira pra fora da vista.
//
// Aqui a prova é medida no navegador de verdade, em ESTILO COMPUTADO: string
// de classe passa em teste de unidade e ainda assim pode estar sendo anulada
// por outra regra. O que este arquivo NÃO alcança é a superfície do diff, que
// exige Tauri (o `git_diff` é comando nativo) — para essa parte a rede é o
// teste de unidade da constante + a rodagem manual.

import { test, expect } from "@playwright/test"

test("o cartão do centro não rola, e seus hosts são caixas de flex", async ({
  page,
}) => {
  await page.goto("/")
  const cartao = page.getByTestId("cartao-centro")
  await expect(cartao).toBeVisible()

  const m = await page.evaluate(() => {
    const card = document.querySelector(
      '[data-testid="cartao-centro"]',
    ) as HTMLElement
    // Hosts = filhos diretos que disputam o vão (a tira de abas é shrink-0).
    // Só os VISÍVEIS: superfície escondida é `display: none` e não vaza nada —
    // ela mantém o `flex-grow: 1` no estilo e entraria no filtro à toa.
    const hosts = Array.from(card.children).filter((el) => {
      const s = getComputedStyle(el as HTMLElement)
      return s.flexGrow === "1" && s.display !== "none"
    }) as HTMLElement[]
    return {
      qtdHosts: hosts.length,
      hosts: hosts.map((h) => {
        const s = getComputedStyle(h)
        return { display: s.display, direction: s.flexDirection, minH: s.minHeight }
      }),
      // A folga de 1px absorve arredondamento de subpixel do layout.
      cartaoRola: card.scrollHeight > card.clientHeight + 1,
      janelaRola:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight + 1,
    }
  })

  expect(m.qtdHosts).toBeGreaterThan(0)
  for (const h of m.hosts) {
    expect(h.display).toBe("flex")
    expect(h.direction).toBe("column")
    // Sem `min-height: 0` o item de flex não encolhe abaixo do conteúdo, e o
    // vazamento acontece do mesmo jeito por outro caminho.
    expect(h.minH).toBe("0px")
  }
  expect(m.cartaoRola).toBe(false)
  expect(m.janelaRola).toBe(false)

  // A CADEIA acima do cartão precisa CORTAR, não esconder: `hidden` continua
  // sendo scroll container e aceita `scrollTop` por script — foi assim que um
  // `scrollIntoView` dentro do diff levou centro e contexto embora. `clip` não
  // tem scrollTop pra empurrar. Parar num nível só devolve o defeito um degrau
  // acima, então o teste anda até a raiz do shell.
  const cadeia = await page.evaluate(() => {
    const card = document.querySelector(
      '[data-testid="cartao-centro"]',
    ) as HTMLElement
    const out: { nome: string; overflow: string }[] = []
    let el: HTMLElement | null = card
    while (el && !el.classList.contains("grain")) {
      out.push({
        nome: `${el.tagName}${el.id ? "#" + el.id : ""}`,
        overflow: getComputedStyle(el).overflowY,
      })
      el = el.parentElement
    }
    if (el) out.push({ nome: ".grain", overflow: getComputedStyle(el).overflowY })
    return out
  })
  for (const no of cadeia) {
    expect(
      ["clip", "visible", "auto"].includes(no.overflow),
      `${no.nome} está "${no.overflow}": moldura do shell não pode ser "hidden"`,
    ).toBe(true)
  }
  expect(cadeia.some((n) => n.nome === ".grain" && n.overflow === "clip")).toBe(true)
})

test("o grupo que contém centro + contexto não aceita scroll nem sem barra", async ({
  page,
}) => {
  await page.goto("/")
  const m = await page.evaluate(() => {
    const innerGroup = document.querySelector(
      '#main [data-slot="resizable-panel-group"]',
    ) as HTMLElement
    // Força overflow sem depender do invoke nativo `git_diff`. É a condição
    // estrutural da captura do #242: qualquer descendente alto basta para que
    // `overflow:hidden` vire um scroll container sem barra.
    const overflowProbe = document.createElement("div")
    overflowProbe.style.cssText =
      "flex:none;align-self:flex-start;width:1px;height:50000px;"
    innerGroup.appendChild(overflowProbe)
    innerGroup.scrollTop = 10_000
    return {
      clientHeight: innerGroup.clientHeight,
      scrollHeight: innerGroup.scrollHeight,
      scrollTop: innerGroup.scrollTop,
      overflowY: getComputedStyle(innerGroup).overflowY,
    }
  })

  expect(m.scrollHeight).toBeGreaterThan(m.clientHeight)
  expect(m.overflowY).toBe("clip")
  expect(m.scrollTop).toBe(0)
})

test("o painel principal inteiro é uma fronteira não rolável", async ({
  page,
}) => {
  await page.goto("/")
  const m = await page.evaluate(() => {
    const main = document.querySelector("#main") as HTMLElement
    const wrapper = main.firstElementChild as HTMLElement
    return {
      main: getComputedStyle(main).overflowY,
      wrapper: getComputedStyle(wrapper).overflowY,
    }
  })

  expect(m.main).toBe("clip")
  expect(m.wrapper).toBe("clip")
})
