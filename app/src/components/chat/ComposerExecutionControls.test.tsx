// PermissionSelect e PlanFirstToggle: repouso e marcação, por SSR
// (`renderToStaticMarkup`, sem jsdom — o padrão do repo). O gesto de abrir o
// dropdown e clicar num item precisa de DOM de verdade e mora em e2e
// (`e2e/composer.spec.ts`).
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PermissionSelect, PlanFirstToggle } from "./ComposerExecutionControls"
import type { PermissionMode } from "@/lib/types"

function renderPermission(over: Partial<React.ComponentProps<typeof PermissionSelect>> = {}) {
  return renderToStaticMarkup(
    <PermissionSelect value="padrao" onValueChange={() => {}} {...over} />,
  )
}

describe("PermissionSelect — o gatilho mostra o modo, e só Liberado acende âmbar", () => {
  it.each<[PermissionMode, string]>([
    ["leitura", "Só lê"],
    ["padrao", "Pede"],
    ["liberado", "Liberado"],
  ])("modo %s mostra o rótulo canônico %s", (mode, rotulo) => {
    expect(renderPermission({ value: mode })).toContain(rotulo)
  })

  it("Liberado acende âmbar no gatilho", () => {
    expect(renderPermission({ value: "liberado" })).toContain("bg-st-warning/15")
  })

  it("Pede e Só lê NÃO acendem âmbar (sinal que acende sempre não é sinal)", () => {
    expect(renderPermission({ value: "padrao" })).not.toContain("bg-st-warning/15")
    expect(renderPermission({ value: "leitura" })).not.toContain("bg-st-warning/15")
  })

  it("disabled quando não há projeto pra gravar a escolha", () => {
    expect(renderPermission({ disabled: true })).toContain("disabled")
  })

  // O `DropdownMenuContent` é portal + `data-state="closed"` em repouso — a
  // lista de modos com as descrições só existe no DOM depois do clique que
  // abre o menu. Isso é gesto, não repouso: mora em `e2e/composer.spec.ts`
  // ("consegue selecionar e trocar a permissão do projeto").
})

describe("PlanFirstToggle — rótulo visível de propósito", () => {
  it("mostra o texto 'Planejar' sempre (não é ícone-só com tooltip)", () => {
    // Furo §7.1 do plano do colapso: frequência de uso desconhecida — esconder
    // atrás de hover reduziria a descoberta de um controle sem dado nenhum.
    const html = renderToStaticMarkup(
      <PlanFirstToggle active={false} onToggle={() => {}} />,
    )
    expect(html).toContain("Planejar")
    expect(html).toContain('aria-pressed="false"')
  })

  it("ligado, acende brass (interruptor de ajuste — a exceção do lib/selection.ts)", () => {
    const html = renderToStaticMarkup(
      <PlanFirstToggle active={true} onToggle={() => {}} />,
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain("bg-brass/10")
    expect(html).toContain("text-brass")
  })
})
