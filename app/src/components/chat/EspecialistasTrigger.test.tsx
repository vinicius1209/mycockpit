import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  CARAS_VISIVEIS,
  PortaDosEspecialistas,
  rotuloDosEspecialistas,
} from "./EspecialistasTrigger"
import type { AgentDef } from "@/lib/agentDefs"

function persona(nome: string, category: string): AgentDef {
  return {
    id: `id-${nome}`,
    slug: nome,
    name: nome,
    category,
    avatarStyle: "",
    avatarSeed: "",
  } as AgentDef
}

const TIME = [
  persona("iris", "Design"),
  persona("aline", "Engenharia"),
  persona("marco", "Estratégia"),
  persona("nero", "Ops"),
  persona("testa", "Qualidade"),
  persona("vault", "Segurança"),
]

function render(time: AgentDef[], total = time.length) {
  return renderToStaticMarkup(
    createElement(PortaDosEspecialistas, {
      time: time.slice(0, CARAS_VISIVEIS),
      total,
      onOpen: () => {},
    }),
  )
}

describe("rotuloDosEspecialistas", () => {
  it("diz quantos são, e concorda em número", () => {
    expect(rotuloDosEspecialistas(0)).toBe("Especialistas")
    expect(rotuloDosEspecialistas(1)).toBe("1 especialista")
    expect(rotuloDosEspecialistas(6)).toBe("6 especialistas")
  })
})

describe("PortaDosEspecialistas", () => {
  it("sem persona nenhuma NÃO inventa cara: volta ao glifo neutro", () => {
    const html = render([], 0)
    expect(html).not.toContain("<svg viewBox=\"0 0 40 40\"")
    expect(html).toContain('aria-label="Especialistas"')
  })

  it("mostra as caras do time e o total", () => {
    const html = render(TIME)
    // três caras desenhadas (o rig usa o viewBox 40×40)
    expect(html.match(/viewBox="0 0 40 40"/g)).toHaveLength(CARAS_VISIVEIS)
    expect(html).toContain(">6<")
  })

  it("nunca desenha mais caras que o teto, por mais gente que exista", () => {
    const html = render(TIME, 40)
    expect(html.match(/viewBox="0 0 40 40"/g)).toHaveLength(CARAS_VISIVEIS)
    expect(html).toContain(">40<")
  })

  it("o total conta o escopo inteiro, não só as caras visíveis", () => {
    const html = render(TIME, 12)
    expect(html).toContain('aria-label="12 especialistas"')
  })

  it("a cor da cara é o DOMÍNIO, não a persona: o time é uma família", () => {
    const html = render([persona("x", "Design"), persona("y", "Design")])
    // rosa do domínio Design (lib/avatar.CATEGORY_COLOR), nas duas
    expect(html.match(/#f472b6/g)?.length).toBe(2)
  })

  it("categoria desconhecida cai no brass em vez de sumir com a cara", () => {
    const html = render([persona("z", "Astrologia")])
    expect(html).toContain("#e4a862")
  })

  it("o rótulo acessível acompanha a contagem (é o que o leitor de tela ouve)", () => {
    expect(render([persona("a", "Ops")])).toContain('aria-label="1 especialista"')
  })

  it("no servidor a cara sai ESTÁTICA: sem ponteiro, sem desvio", () => {
    const html = render([persona("a", "Ops")])
    expect(html).toContain("translate(0px, 0px)")
  })
})
