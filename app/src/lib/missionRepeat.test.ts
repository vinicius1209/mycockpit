// R11 — o furo que a recomendação do mock deixou em aberto: um agent falante
// andando em círculo NUNCA fica calado, então o limiar de silêncio não o pega.
// Os dois fatores juntos, nunca um só, e "não sei olhar o worktree" nunca vira
// "o worktree não mudou".

import { describe, expect, it } from "vitest"
import { REPEAT_MIN, repeatCandidate, repeatWarning } from "./missionRepeat"
import type { ChatItem } from "@/store/chat"

const T0 = 1_700_000_000_000

function cmd(
  command: string,
  ts: number,
  ok: boolean | null = false,
): ChatItem {
  return {
    kind: "tool",
    id: `${command}-${ts}`,
    name: "Bash",
    input: { command },
    ts,
    activityAt: ts + 60_000,
    ...(ok == null ? {} : { result: { ok, text: "", lines: 0 } }),
  } as ChatItem
}

function leitura(ts: number): ChatItem {
  return {
    kind: "tool",
    id: `read-${ts}`,
    name: "Read",
    input: { file_path: "/p/x.ts" },
    ts,
    result: { ok: true, text: "", lines: 1 },
  } as ChatItem
}

const quatro = [
  cmd("bun run test src/billing", T0),
  cmd("bun run test src/billing", T0 + 80_000),
  cmd("bun run test src/billing", T0 + 160_000),
  cmd("bun run test src/billing", T0 + 240_000),
]

describe("primeiro fator · o mesmo comando, seguidas", () => {
  it("quatro iguais no fim viram candidato", () => {
    const c = repeatCandidate(quatro)
    expect(c).toMatchObject({ command: "bun run test src/billing", count: 4 })
    expect(c?.firstAt).toBe(T0)
  })

  it("três não bastam (o limiar é 4, e é uma constante nomeada)", () => {
    expect(REPEAT_MIN).toBe(4)
    expect(repeatCandidate(quatro.slice(1))).toBeNull()
  })

  it("SEGUIDAS é literal: uma leitura no meio quebra a sequência", () => {
    const c = repeatCandidate([
      quatro[0],
      quatro[1],
      leitura(T0 + 120_000),
      quatro[2],
      quatro[3],
    ])
    // sobram 2 seguidas no fim — quem roda o teste depois de cada edição está
    // andando, não batendo a cabeça.
    expect(c).toBeNull()
  })

  it("comandos diferentes não contam como repetição", () => {
    const c = repeatCandidate([
      cmd("bun run test a", T0),
      cmd("bun run test b", T0 + 1000),
      cmd("bun run test c", T0 + 2000),
      cmd("bun run test d", T0 + 3000),
    ])
    expect(c).toBeNull()
  })

  it("ação que não é comando não entra na conta", () => {
    expect(
      repeatCandidate([leitura(1), leitura(2), leitura(3), leitura(4)]),
    ).toBeNull()
  })
})

describe("segundo fator · o worktree parado (e a ignorância que não vira fato)", () => {
  const c = repeatCandidate(quatro)

  it("com o worktree parado desde a primeira, o aviso aparece", () => {
    const w = repeatWarning(c, T0 - 30_000, T0 + 360_000)
    expect(w?.headline).toBe("o mesmo comando, 4 vezes")
    expect(w?.observed).toContain("4 vezes nos últimos 6 min")
    expect(w?.observed).toContain("nenhum arquivo mudou no worktree")
    expect(w?.command).toBe("bun run test src/billing")
  })

  it("escreveu DEPOIS da primeira ⇒ está andando, e não há aviso", () => {
    expect(repeatWarning(c, T0 + 100_000, T0 + 360_000)).toBeNull()
  })

  it("sem leitura do worktree NÃO há aviso: um fator só é alarme falso", () => {
    // é o caso "fora de repo / git ausente / leitura falhou". O comando Rust
    // devolve string vazia e o chamador passa null.
    expect(repeatWarning(c, null, T0 + 360_000)).toBeNull()
  })

  it("sem candidato não há aviso, por mais parado que o worktree esteja", () => {
    expect(repeatWarning(null, T0 - 999_999, T0)).toBeNull()
  })

  it("o texto relata o observado, nunca o diagnóstico", () => {
    const w = repeatWarning(c, T0 - 1000, T0 + 360_000)
    const tudo = `${w?.headline} ${w?.observed}`.toLowerCase()
    expect(tudo).not.toContain("travou")
    expect(tudo).not.toContain("travad")
    expect(tudo).not.toContain("loop")
  })
})
