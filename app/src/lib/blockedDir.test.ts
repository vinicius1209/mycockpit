import { describe, expect, it } from "vitest"
import { detectBlockedDir } from "./blockedDir"

const ROOT = "/Users/vini/projetos/workout-jejum"

describe("detectBlockedDir", () => {
  it("pega repo irmão fora da raiz quando há termo de acesso", () => {
    const text =
      "Error: /Users/vini/projetos/workout-backend/src is outside the allowed directories"
    expect(detectBlockedDir(text, ROOT)).toBe("/Users/vini/projetos/workout-backend/src")
  })

  it("sobe pro diretório-pai quando o path é um arquivo", () => {
    const text =
      "cannot access /Users/vini/projetos/backend/routes/v1.ts: not permitted"
    expect(detectBlockedDir(text, ROOT)).toBe("/Users/vini/projetos/backend/routes")
  })

  it("null sem termo de acesso (path fora da raiz mas erro comum)", () => {
    const text = "/Users/vini/projetos/backend/x.ts: syntax error on line 3"
    expect(detectBlockedDir(text, ROOT)).toBeNull()
  })

  it("null quando o path está DENTRO da raiz", () => {
    const text = `permission denied: ${ROOT}/src/secret.ts`
    expect(detectBlockedDir(text, ROOT)).toBeNull()
  })

  it("null quando o path já está liberado", () => {
    const allowed = ["/Users/vini/projetos/backend"]
    const text =
      "not allowed to read /Users/vini/projetos/backend/app.ts outside working dir"
    expect(detectBlockedDir(text, ROOT, allowed)).toBeNull()
  })

  it("ignora paths de sistema", () => {
    const text = "permission denied: /usr/local/bin/thing not permitted"
    expect(detectBlockedDir(text, ROOT)).toBeNull()
  })

  it("null em texto vazio ou sem path", () => {
    expect(detectBlockedDir("", ROOT)).toBeNull()
    expect(detectBlockedDir("permission denied but no path here", ROOT)).toBeNull()
  })
})
