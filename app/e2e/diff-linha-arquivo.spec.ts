import { test, expect } from "@playwright/test"
import { FILE_LABEL_CLS } from "../src/components/layout/DiffPanel/parts"

// A ESCADA DE ENCOLHIMENTO da linha de arquivo do diff.
//
// Regra que só existe em layout: não há função pura pra testar, e jsdom não
// calcula largura nenhuma. Mede-se no browser, no `dist/` buildado, com o CSS
// compilado de verdade — mesmo método do titlebar-alinhamento.
//
// Este teste existe porque a mesma linha regrediu TRÊS vezes em dois dias, cada
// correção criando o defeito seguinte:
//
//  1. `dir` truncando, `base` com `shrink-0` → nome longo TRANSBORDAVA e
//     pintava por cima do contador de ±linhas (visto na tela com
//     `console-2026-08-06T18-49-27-114Z.log`);
//  2. os dois truncando → nada colidia, mas o NOME era cortado numa coluna
//     estreita, que é o dado que a linha existe pra mostrar;
//  3. esta → o diretório cede tudo primeiro, o nome trunca por último, e o
//     `overflow-hidden` garante que nada pinte por cima do contador.
//
// As classes vêm IMPORTADAS de `parts.tsx`. Reescrevê-las aqui testaria a
// cópia, não o componente — e foi por não ter medida nenhuma que isso regrediu.

const CASOS = [
  { nome: "curto", base: ".gitignore", dir: ".mycockpit/" },
  { nome: "medio", base: "ConversationSlot.tsx", dir: "src/components/layout/" },
  {
    nome: "longo",
    base: "console-2026-08-06T18-49-27-114Z.log",
    dir: ".mycockpit/",
  },
]

/** Larguras reais da coluna: o `minSize` do painel e um pouco acima. */
const LARGURAS = [240, 300, 420]

test("o nome do arquivo NUNCA pinta por cima do contador", async ({ page }) => {
  await page.goto("/")
  const medidas = await page.evaluate(
    ({ cls, casos, larguras }) => {
      const out: {
        caso: string
        largura: number
        colide: boolean
        nomeCortado: boolean
        dirVisivel: boolean
      }[] = []
      const palco = document.createElement("div")
      palco.style.cssText = "position:fixed;top:-9999px;left:0"
      document.body.appendChild(palco)
      for (const largura of larguras) {
        for (const c of casos) {
          palco.innerHTML = `
            <div style="display:flex;align-items:baseline;gap:6px;width:${largura}px">
              <span style="flex:none">A</span>
              <span class="${cls.host}">
                <span class="${cls.base}" data-p="base">${c.base}</span>
                <span class="${cls.dir}" data-p="dir">${c.dir}</span>
              </span>
              <span style="flex:none" data-p="cnt">+124</span>
            </div>`
          const q = (n: string) =>
            palco.querySelector(`[data-p="${n}"]`) as HTMLElement
          const base = q("base"),
            dir = q("dir"),
            cnt = q("cnt")
          out.push({
            caso: c.nome,
            largura,
            colide:
              base.getBoundingClientRect().right >
              cnt.getBoundingClientRect().left + 1,
            nomeCortado: base.scrollWidth > base.clientWidth + 1,
            dirVisivel: Math.round(dir.getBoundingClientRect().width) > 0,
          })
        }
      }
      palco.remove()
      return out
    },
    { cls: FILE_LABEL_CLS, casos: CASOS, larguras: LARGURAS },
  )

  // A invariante dura: em NENHUMA largura, com NENHUM nome, o nome invade o
  // contador. Foi este o defeito que chegou na tela.
  for (const m of medidas) {
    expect(m.colide, `${m.caso} @ ${m.largura}px`).toBe(false)
  }

  // E a ordem de sacrifício: quem cede primeiro é o diretório.
  const largo = medidas.filter((m) => m.largura === 420)
  expect(largo.find((m) => m.caso === "curto")?.nomeCortado).toBe(false)
  expect(largo.find((m) => m.caso === "curto")?.dirVisivel).toBe(true)

  // No pior caso real (nome enorme, coluna mínima) o diretório já sumiu — é o
  // preço certo: sem ele a linha ainda identifica o arquivo; sem o nome, não.
  const apertado = medidas.find(
    (m) => m.caso === "longo" && m.largura === 240,
  )!
  expect(apertado.dirVisivel).toBe(false)
})
