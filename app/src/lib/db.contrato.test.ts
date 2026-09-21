import { describe, expect, it } from "vitest"

/** O contrato que faltava em 21/09/2026 (ADR-222).
 *
 *  O nome do arquivo do banco vive em DUAS linguagens: o TS abre a conexão e o
 *  Rust registra as migrações nela. O elo entre os dois era um comentário
 *  ("DEVE bater com add_migrations no lib.rs"), quer dizer, nenhum elo. O
 *  rename trocou o lado Rust e deixou o TS no nome velho, e o resultado não foi
 *  erro: foi o plugin SQL abrindo um banco NOVO e vazio, sem as migrações
 *  (registradas no outro nome), com os 81M de conversas intactos e invisíveis
 *  ao lado. Tela zerada, "Adicionar projeto" falhando, nada no log.
 *
 *  Por isso o nome não é variável de ambiente: ele não varia por ambiente. É
 *  uma constante única que precisa de prova mecânica de que os dois lados leem
 *  a MESMA, que é o que está aqui. */
const TS = import.meta.glob("./db.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>
const RUST = import.meta.glob("../../src-tauri/src/*.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const fonte = (registro: Record<string, string>, sufixo: string): string => {
  const achado = Object.entries(registro).find(([caminho]) =>
    caminho.endsWith(sufixo),
  )
  if (!achado) throw new Error(`fonte não encontrada: ${sufixo}`)
  return achado[1]
}

describe("contrato do nome do banco entre TS e Rust", () => {
  it("a URL que o TS abre é o BANCO que o Rust migra", () => {
    const ts = fonte(TS, "db.ts").match(/const DB_URL = "sqlite:([^"]+)"/)
    const rust = fonte(RUST, "lib.rs").match(/pub const BANCO: &str = "([^"]+)"/)

    expect(ts?.[1], "DB_URL não encontrado em lib/db.ts").toBeTruthy()
    expect(rust?.[1], "BANCO não encontrado em src-tauri/src/lib.rs").toBeTruthy()
    // Divergir aqui não quebra nada: abre um banco vazio e some com o histórico.
    expect(ts?.[1]).toBe(rust?.[1])
  })

  it("nenhum leitor do Rust abre o banco pelo nome legado", () => {
    // Seis leitores ficaram para trás no rename (quit, companion, mcp_control,
    // plugin_mcp, agent, conversation_items): abriam o arquivo do nome antigo
    // no diretório NOVO, que é o banco vazio, não o de verdade. Todo leitor
    // passa por `crate::BANCO`.
    //
    // O nome legado vem de BANCO_LEGADO, não escrito à mão: ele só sobrevive
    // como a constante da migração, em lib.rs, e este teste não é o segundo
    // lugar onde ele mora.
    const lib = fonte(RUST, "lib.rs")
    const legado = lib.match(/pub const BANCO_LEGADO: &str = "([^"]+)"/)?.[1]
    expect(legado, "BANCO_LEGADO não encontrado em lib.rs").toBeTruthy()

    const literal = new RegExp(
      `\\.join\\(\\s*"${legado!.replace(".", "\\.")}"\\s*\\)`,
    )
    const culpados = Object.entries(RUST)
      .filter(([caminho]) => !caminho.endsWith("lib.rs"))
      .filter(([, src]) => literal.test(src))
      .map(([caminho]) => caminho)

    expect(culpados, "abra o banco por crate::BANCO, nunca por literal").toEqual(
      [],
    )
  })
})
