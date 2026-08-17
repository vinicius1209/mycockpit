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

describe("bloqueio que o --add-dir NÃO destrava (incidente 2026-08-16)", () => {
  // Payload REAL, do item `#31` da conversa ec1642c1 (lido do banco). É o texto
  // que o `agy` 1.1.13 devolveu ao tentar ler o arquivo de configuração DELE.
  const REGRA_INTERNA =
    "Permission denied for read_file(/Users/viniciusmachado/.gemini/antigravity-cli/settings.json). Matches hardcoded system protection boundary rule."

  it("não oferece liberar quando a regra é do próprio CLI", () => {
    // O ACCESS_RE casa por "permission denied" e o path está fora da raiz: sem
    // esta segunda régua, o banner oferecia "Liberar e reenviar" e o app gastou
    // 5 minutos e ~2,4M de tokens executando uma correção impossível.
    expect(detectBlockedDir(REGRA_INTERNA, "/Users/viniciusmachado/projetos/mycockpit")).toBeNull()
  })

  it("as outras redações da mesma regra também não passam", () => {
    for (const texto of [
      "permission denied: /Users/vini/x/y.json violates system protection rules",
      "cannot access /Users/vini/x/y.json (hard-coded security policy)",
      "not permitted: /Users/vini/x/y.json matches protection boundary",
    ]) {
      expect(detectBlockedDir(texto, ROOT)).toBeNull()
    }
  })

  it("mas o gate de diretório COMUM continua detectado", () => {
    // A régua nova não pode comer o caso que o banner existe para resolver.
    const texto =
      "/Users/vini/projetos/backend/src/app.ts is outside the allowed directories"
    expect(detectBlockedDir(texto, ROOT)).toBe("/Users/vini/projetos/backend/src")
  })
})
