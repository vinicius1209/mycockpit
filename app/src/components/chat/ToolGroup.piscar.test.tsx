/** @vitest-environment jsdom */
// O grupo de ações não pisca a cada leitura (ADR-290, correção 3). Abrir para
// uma ação de 87ms e recolher em seguida aparecia como duas linhas surgindo e
// sumindo, e a mola do fio subia e descia junto.
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ isTauri: () => true }))

import { ToolGroup } from "@/components/chat/ToolGroup"
import type { ToolItem } from "@/components/chat/messageNodes"

// O começo REAL de um turno do Claude Code (conversation_items, 01/10/2026):
// carimbos e desfechos como vieram; o caminho do projeto saiu do comando.
const PRINT = "/Users/vini/Library/Application Support/dev.vinicius.frota/attachments/58886d7a/"
const REAL: ToolItem[] = [
  { kind: "tool", id: "r1", name: "Read", input: { file_path: `${PRINT}b58d53700809ae27.png` }, ts: 1_790_867_025_228, activityAt: 1_790_867_025_315, result: { ok: true, text: "", lines: 0 } },
  { kind: "tool", id: "r2", name: "Read", input: { file_path: `${PRINT}b0d81d6cd00a84df.png` }, ts: 1_790_867_025_840, activityAt: 1_790_867_025_933, result: { ok: true, text: "", lines: 0 } },
  { kind: "tool", id: "ts", name: "ToolSearch", input: { max_results: 1, query: "select:mcp__frota-work__conversation_title" }, ts: 1_790_867_026_543, activityAt: 1_790_867_026_614, result: { ok: true, text: "", lines: 0 } },
  { kind: "tool", id: "ti", name: "mcp__frota-work__conversation_title", input: { title: "Tooltip de uso preso aberto" }, ts: 1_790_867_028_301, activityAt: 1_790_867_028_381, result: { ok: true, text: "", lines: 1 } },
  { kind: "tool", id: "b1", name: "Bash", input: { command: 'grep -rln "todas as janelas" --include=*.tsx .' }, ts: 1_790_867_029_127, activityAt: 1_790_867_030_967, result: { ok: true, text: "", lines: 1 } },
  { kind: "tool", id: "b2", name: "Bash", input: { command: 'grep -rln "todas as janelas" .' }, ts: 1_790_867_032_572, activityAt: 1_790_867_032_794, result: { ok: true, text: "", lines: 4 } },
] as ToolItem[]

/** As ações como o fio as via no instante `agora`: o que ainda não nasceu
 *  fica de fora, o que nasceu e não terminou roda sem desfecho. */
function noInstante(agora: number): ToolItem[] {
  return REAL.filter((tool) => (tool.ts ?? 0) <= agora).map((tool) =>
    (tool.activityAt ?? 0) <= agora ? tool : { ...tool, result: undefined, activityAt: tool.ts },
  )
}

function grupo(agora: number) {
  return <ToolGroup tools={noInstante(agora)} active agent="claude-code" />
}

function aberto(container: HTMLElement): boolean {
  return container.querySelector("[data-work-root]")?.getAttribute("aria-expanded") === "true"
}

function linhas(container: HTMLElement): number {
  return container.querySelectorAll('[role="tree"] [role="treeitem"]').length
}

/** Leva o relógio até `agora`, deixando correr os timers do caminho. */
function ate(agora: number) {
  act(() => {
    vi.advanceTimersByTime(agora - Date.now())
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(REAL[0].ts!)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ToolGroup · o grupo não pisca a cada ação curta", () => {
  it("a rajada de leituras de ~90ms não abre o grupo em nenhum instante", () => {
    const { container, rerender } = render(grupo(Date.now()))
    const instantes = REAL.slice(0, 4).flatMap((tool) => [tool.ts!, tool.activityAt!])
    for (const agora of instantes) {
      ate(agora)
      rerender(grupo(agora))
      expect(aberto(container), `aberto em +${agora - REAL[0].ts!}ms`).toBe(false)
    }
    // A espera de quem já terminou não sobrevive: ninguém abre depois.
    ate(REAL[3].activityAt! + 5_000)
    expect(aberto(container)).toBe(false)
  })

  it("o grep de 1.840ms abre o grupo quando passa de 1s, e recolhe uma vez ao terminar", () => {
    const grep = REAL[4]
    vi.setSystemTime(grep.ts!)
    const { container, rerender } = render(grupo(grep.ts!))
    ate(grep.ts! + 999)
    rerender(grupo(grep.ts! + 999))
    expect(aberto(container)).toBe(false)

    ate(grep.ts! + 1_000)
    expect(aberto(container)).toBe(true)

    ate(grep.activityAt!)
    rerender(grupo(grep.activityAt!))
    expect(aberto(container)).toBe(false)
  })

  it("remontar com a ação já rodando há mais de 1s nasce aberto, sem esperar de novo", () => {
    const grep = REAL[4]
    vi.setSystemTime(grep.ts! + 1_500)
    const { container } = render(grupo(grep.ts! + 1_500))
    expect(aberto(container)).toBe(true)
  })

  it("aberto pela pessoa, a lista mantém a altura entre uma ação e a próxima", () => {
    const [grep, grep2] = [REAL[4], REAL[5]]
    vi.setSystemTime(grep.ts!)
    const { container, rerender } = render(grupo(grep.ts!))
    fireEvent.click(container.querySelector("[data-work-root]")!)
    expect(aberto(container)).toBe(true)

    // Rodando, entre ações e rodando de novo: histórico + a corrente (ou a
    // última, enquanto a próxima não chega). Antes, o intervalo despejava
    // as cinco concluídas e a lista crescia e encolhia a cada ação.
    const alturas = [grep.ts!, grep.activityAt!, grep2.ts!, grep2.activityAt!].map((agora) => {
      ate(agora)
      rerender(grupo(agora))
      return linhas(container)
    })
    expect(alturas).toEqual([2, 2, 2, 2])
  })
})
