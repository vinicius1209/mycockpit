import { describe, expect, it } from "vitest"
import { blocoDaDoutrina } from "./doctrine"
import { linhaDosSegredos, nomeDeSegredo } from "./segredos"

// Gêmeo do Rust: a tela recusa o mesmo que `segredos::nome_valido`.
const RUST = Object.values(
  import.meta.glob("../../src-tauri/src/segredos.rs", { query: "?raw", import: "default", eager: true }),
)[0] as string

describe("segredos do projeto (ADR-288)", () => {
  it("a regra do nome é a mesma do Rust, com os mesmos reservados", () => {
    const linha = RUST.split("\n").find((l) => l.includes("const RESERVADOS"))!
    const reservadosDoRust = [...linha.matchAll(/"([A-Z]+)"/g)].map((m) => m[1])
    expect(reservadosDoRust.length).toBeGreaterThan(5)
    for (const nome of reservadosDoRust) expect(nomeDeSegredo(nome)).toContain("do sistema")
    expect(nomeDeSegredo("STRIPE_SECRET_KEY")).toBeNull()
    expect(nomeDeSegredo("FROTA_X")).toContain("da Frota")
    expect(nomeDeSegredo("stripe")).toContain("maiúsculas")
  })

  it("a doutrina leva só os nomes, e nunca um valor", () => {
    expect(linhaDosSegredos([])).toBeNull()
    const bloco = blocoDaDoutrina({ content: "Mocks em docs/mocks.", path: ".frota/instructions.md", segredos: ["SUPABASE_URL", "STRIPE_SECRET_KEY"] })!
    expect(bloco).toContain("Mocks em docs/mocks.")
    expect(bloco).toContain("SUPABASE_URL, STRIPE_SECRET_KEY")
    expect(bloco).toContain("nunca imprima")
  })

  it("projeto sem doutrina mas com segredo ainda avisa os nomes", () => {
    const bloco = blocoDaDoutrina({ content: "", path: ".frota/instructions.md", segredos: ["API_TOKEN"] })
    expect(bloco).toContain("API_TOKEN")
    expect(blocoDaDoutrina({ content: "", path: ".frota/instructions.md" })).toBeNull()
  })
})
