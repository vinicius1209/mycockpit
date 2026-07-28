// AppDialog — a parte testável sem DOM: o mapa de larguras. O render (X padrão,
// título/fallback a11y) depende do portal do Radix, que não sobe no ambiente
// node do vitest; fica coberto pelo tsc + vite build + uso real no Especialistas.

import { describe, expect, it } from "vitest"
import { APP_DIALOG_SIZE } from "./app-dialog"

describe("AppDialog · escala de largura", () => {
  it("cada size mapeia pra uma classe sm:max-w única", () => {
    expect(APP_DIALOG_SIZE.sm).toBe("sm:max-w-sm")
    expect(APP_DIALOG_SIZE.md).toBe("sm:max-w-md")
    expect(APP_DIALOG_SIZE.lg).toBe("sm:max-w-lg")
    expect(APP_DIALOG_SIZE.xl).toBe("sm:max-w-[920px]")
  })

  it("usa o prefixo sm: pra vencer o max-w embutido do DialogContent no twMerge", () => {
    // se alguma classe perder o `sm:`, o `sm:max-w-lg` do base não é sobrescrito
    for (const cls of Object.values(APP_DIALOG_SIZE)) {
      expect(cls.startsWith("sm:max-w-")).toBe(true)
    }
  })
})
