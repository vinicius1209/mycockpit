/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom não implementa ResizeObserver, e o cmdk observa a lista para rolar o
// item ativo. Sem isto o painel nem monta.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub)
// scrollIntoView também não existe no jsdom; o cmdk chama ao mover a seleção.
Element.prototype.scrollIntoView = vi.fn()

vi.mock("@/store/app", () => ({
  useApp: (sel: (s: unknown) => unknown) =>
    sel({ limitedAgents: {}, settings: { detected: {} } }),
}))
vi.mock("@/store/usage", () => ({
  useUsage: (sel: (s: unknown) => unknown) => sel({ byAgent: {}, lastSuccessByAgent: {} }),
}))

import { IdentityDoor } from "@/components/chat/ComposerExecutionControls"
import { ComposerShell } from "@/components/chat/ComposerShell"
import { IdentityPicker } from "@/components/chat/IdentityPicker"

afterEach(cleanup)

/** O rodapé real: um editor de texto (o composer) e a porta da identidade ao
 *  lado. É o arranjo em que o bug aparece. */
function Rodape({
  modelLocked = false,
  onModelChange = () => {},
}: {
  modelLocked?: boolean
  onModelChange?: (v: string) => void
}) {
  // O cartão REAL (`ComposerShell` com `focusRing`), com o `onCardClick` que o
  // console usa: clicar no cartão devolve o foco ao editor. A porta da
  // identidade mora DENTRO desse cartão, sem portal, então todo clique no
  // painel borbulha até aqui. Sem este arranjo o teste passava e o app
  // falhava: foi o que aconteceu duas vezes.
  const editor = useRef<HTMLTextAreaElement>(null)
  return (
    <ComposerShell
      focusRing
      // ADIADO, como o `editor.focus()` do Lexical, que só foca depois que o
      // update dele comita. É isso que faz o roubo vencer o `autoFocus`: o
      // painel monta, a busca ganha o cursor, e o foco do editor chega DEPOIS.
      onCardClick={() => setTimeout(() => editor.current?.focus(), 0)}
      input={<textarea ref={editor} aria-label="composer" defaultValue="" />}
      footer={
      <IdentityDoor label="OpenCode" locked={false}>
        <IdentityPicker
          effectiveDest="opencode"
          locked={false}
          onDestChange={() => {}}
          effectiveModel="default"
          modelLocked={modelLocked}
          onModelChange={onModelChange}
          effectiveEffort="padrao"
          effortLocked={false}
          onEffortChange={() => {}}
        />
      </IdentityDoor>
      }
    />
  )
}

describe("digitar com o seletor de modelo aberto", () => {
  it("o texto vai para a BUSCA, não para o composer", async () => {
    const user = userEvent.setup()
    render(<Rodape />)

    const composer = screen.getByLabelText("composer") as HTMLTextAreaElement
    composer.focus()
    expect(document.activeElement).toBe(composer)

    await user.click(screen.getByRole("button", { name: /OpenCode/ }))
    await user.keyboard("sonnet")

    const busca = document.querySelector<HTMLInputElement>('[data-slot="command-input"]')
    expect(busca, "campo de busca não montou").not.toBeNull()
    expect(composer.value, "o texto vazou para o composer").toBe("")
    expect(busca!.value).toBe("sonnet")
  })

  it("clicar no campo de busca e digitar NÃO devolve o cursor ao composer", async () => {
    // O relato literal: "eu clico, abre, mas não consigo digitar; ele pula
    // para o composer". O clique no campo borbulhava até o cartão, e o cartão
    // focava o editor.
    const user = userEvent.setup()
    render(<Rodape />)
    const composer = screen.getByLabelText("composer") as HTMLTextAreaElement
    await user.click(screen.getByRole("button", { name: /OpenCode/ }))
    const busca = document.querySelector<HTMLInputElement>('[data-slot="command-input"]')!
    await user.click(busca)
    await user.keyboard("opus")
    expect(document.activeElement, "o cartão roubou o foco").toBe(busca)
    expect(composer.value, "o texto vazou para o composer").toBe("")
    expect(busca.value).toBe("opus")
  })

  it("clicar no espaço morto do cartão CONTINUA focando o editor", async () => {
    // A correção não pode matar o gesto que o cartão existe para fazer.
    const user = userEvent.setup()
    render(<Rodape />)
    const cartao = document.querySelector<HTMLElement>("[data-composer-card]")!
    await user.click(cartao)
    expect(document.activeElement).toBe(screen.getByLabelText("composer"))
  })

  it("COM O TURNO EM VOO a busca ainda funciona", async () => {
    // `modelLocked` quer dizer "não dá pra TROCAR o modelo agora", e isso é
    // garantido item a item. Desabilitar o campo travava também OLHAR a lista,
    // que nunca foi restrição: era o bug. Pesquisar em voo é legítimo.
    const user = userEvent.setup()
    render(<Rodape modelLocked />)
    const composer = screen.getByLabelText("composer") as HTMLTextAreaElement
    composer.focus()
    await user.click(screen.getByRole("button", { name: /OpenCode/ }))
    await user.keyboard("sonnet")

    const busca = document.querySelector<HTMLInputElement>('[data-slot="command-input"]')
    expect(busca!.disabled, "a busca não pode ser desabilitada em voo").toBe(false)
    expect(composer.value, "o texto vazou para o composer").toBe("")
    expect(busca!.value).toBe("sonnet")
  })

  it("em voo, pesquisar NÃO destrava trocar de modelo", async () => {
    // A trava que importa continua de pé: é isso que separa os dois sentidos.
    const trocou = vi.fn()
    const user = userEvent.setup()
    render(<Rodape modelLocked onModelChange={trocou} />)
    await user.click(screen.getByRole("button", { name: /OpenCode/ }))
    const itens = document.querySelectorAll('[data-slot="command-item"]')
    expect(itens.length, "lista não renderizou").toBeGreaterThan(0)
    expect(itens[0].getAttribute("aria-disabled")).toBe("true")
    await user.click(itens[0] as HTMLElement)
    expect(trocou).not.toHaveBeenCalled()
  })

  it("ao abrir, o cursor está na busca", async () => {
    const user = userEvent.setup()
    render(<Rodape />)
    screen.getByLabelText("composer").focus()
    await user.click(screen.getByRole("button", { name: /OpenCode/ }))
    expect(document.activeElement).toBe(
      document.querySelector('[data-slot="command-input"]'),
    )
  })
})
