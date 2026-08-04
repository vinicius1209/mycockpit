// Testes da doutrina do projeto (.mycockpit/instructions.md) — o núcleo puro:
// o bloco injetado no prompt e a decisão de QUANDO injetar.

import { describe, expect, it, vi } from "vitest"
import {
  buildDoctrineBlock,
  decideDoctrine,
  DOCTRINE_MAX_CHARS,
  DOCTRINE_PATH,
  DOCTRINE_UPDATED_PREFIX,
  doctrineFingerprint,
  readDoctrine,
  shouldInjectDoctrine,
} from "./doctrine"

vi.mock("@/lib/db", () => ({ isTauri: () => false }))

describe("buildDoctrineBlock", () => {
  it("envolve o texto num bloco que aponta a fonte", () => {
    const b = buildDoctrineBlock("- Testes em pt-BR.")!
    expect(b.startsWith(`<doutrina fonte="${DOCTRINE_PATH}">`)).toBe(true)
    expect(b.endsWith("</doutrina>")).toBe(true)
    expect(b).toContain("- Testes em pt-BR.")
  })

  it("doutrina vazia ou só espaço NÃO gera bloco", () => {
    // sem isto, um arquivo criado e deixado em branco custaria tokens em todo
    // 1º turno pra dizer nada.
    expect(buildDoctrineBlock("")).toBeNull()
    expect(buildDoctrineBlock("   \n\t\n ")).toBeNull()
  })

  it("texto gigante é cortado E aponta o arquivo (o agent puxa o resto)", () => {
    const gigante = "x".repeat(DOCTRINE_MAX_CHARS + 500)
    const b = buildDoctrineBlock(gigante)!
    expect(b).toContain("[cortado em")
    expect(b).toContain(DOCTRINE_PATH)
    // o corpo cabe no teto (o bloco tem cabeçalho/rodapé além do corpo).
    expect(b.split("\n").find((l) => l.startsWith("xxx"))!.length).toBe(
      DOCTRINE_MAX_CHARS,
    )
  })

  it("texto dentro do teto não ganha aviso de corte", () => {
    expect(buildDoctrineBlock("regra curta")!).not.toContain("[cortado em")
  })
})

describe("shouldInjectDoctrine (decisão por capability, H1/H5)", () => {
  it("conversa nova: injeta", () => {
    expect(shouldInjectDoctrine("claude-code", false, false)).toBe(true)
    expect(shouldInjectDoctrine("codex", false, false)).toBe(true)
  })

  it("claude (canal system): TODO turno — o canal re-envia a cada spawn (H1)", () => {
    expect(shouldInjectDoctrine("claude-code", true, true)).toBe(true)
  })

  it("codex em andamento com resposta: NÃO repete no corpo (o resume carrega)", () => {
    expect(shouldInjectDoctrine("codex", true, true)).toBe(false)
  })

  it("1º run morreu antes de responder: re-injeta", () => {
    // mesma exceção da persona: binário ausente derruba o 1º run e a doutrina
    // não pode ficar presa atrás do lock pra sempre.
    expect(shouldInjectDoctrine("codex", true, false)).toBe(true)
  })

  it("agy recebe em TODO turno (não tem resume; o recap não carrega o prefixo)", () => {
    expect(shouldInjectDoctrine("agy", true, true)).toBe(true)
    expect(shouldInjectDoctrine("agy", false, false)).toBe(true)
  })

  it("motor desconhecido: todo turno (fail-open da doutrina, sem prometer resume)", () => {
    expect(shouldInjectDoctrine("motor-novo", true, true)).toBe(true)
  })
})

describe("decideDoctrine (canal + frescor, H1/H4)", () => {
  const block = buildDoctrineBlock("- Testes em pt-BR.")!

  it("claude: bloco vai pro canal SYSTEM em todo turno, corpo limpo", () => {
    const d = decideDoctrine({
      agent: "claude-code",
      block,
      locked: true,
      hasReply: true,
      lastFingerprint: undefined,
    })
    expect(d.body).toBeNull()
    expect(d.system).toBe(block)
    expect(d.fingerprint).toBe(doctrineFingerprint(block))
  })

  it("codex 1º turno: bloco no corpo + fingerprint pra carimbar", () => {
    const d = decideDoctrine({
      agent: "codex",
      block,
      locked: false,
      hasReply: false,
      lastFingerprint: undefined,
    })
    expect(d.body).toBe(block)
    expect(d.system).toBeNull()
    expect(d.fingerprint).toBe(doctrineFingerprint(block))
  })

  it("H4: fingerprint carimbado IGUAL ao atual → não re-injeta (só re-carimba)", () => {
    const d = decideDoctrine({
      agent: "codex",
      block,
      locked: true,
      hasReply: true,
      lastFingerprint: doctrineFingerprint(block),
    })
    expect(d.body).toBeNull()
    expect(d.system).toBeNull()
    // fingerprint segue voltando: o ledger fica em dia mesmo sem injeção
    expect(d.fingerprint).toBe(doctrineFingerprint(block))
  })

  it("H4: o ARQUIVO mudou desde a última injeção → re-injeta com o prefixo honesto", () => {
    const antigo = doctrineFingerprint(buildDoctrineBlock("- Regra antiga.")!)
    const d = decideDoctrine({
      agent: "codex",
      block,
      locked: true,
      hasReply: true,
      lastFingerprint: antigo,
    })
    expect(d.body).toBe(`${DOCTRINE_UPDATED_PREFIX}\n${block}`)
    expect(d.fingerprint).toBe(doctrineFingerprint(block))
  })

  it("H4: ledger zerado (restart) numa conversa já rodada RE-INJETA com o prefixo (edição com o app fechado não se perde)", () => {
    // O cenário exato do review gate: usuário edita .mycockpit/instructions.md
    // com o app FECHADO; reabre; o ledger efêmero voltou vazio. Sem isto, o
    // envio carimbava o fingerprint atual SEM injetar e a edição nunca chegava
    // ao motor (contradizia a promessa "nunca perda" do plano). O custo é UM
    // bloco por conversa pós-restart, já precificado.
    const d = decideDoctrine({
      agent: "codex",
      block,
      locked: true,
      hasReply: true,
      lastFingerprint: undefined,
    })
    expect(d.body).toBe(`${DOCTRINE_UPDATED_PREFIX}\n${block}`)
    expect(d.fingerprint).toBe(doctrineFingerprint(block))
  })

  it("wheel-switch (sessão fresca no meio da conversa): a doutrina SEMPRE entra, sem prefixo", () => {
    // Mesma régua do revezamento: a sessão nova do backend trocado nunca viu
    // regra nenhuma — mesmo com fingerprint carimbado igual ao atual.
    const d = decideDoctrine({
      agent: "codex",
      block,
      locked: true,
      hasReply: true,
      freshSession: true,
      lastFingerprint: doctrineFingerprint(block),
    })
    expect(d.body).toBe(block)
    expect(d.system).toBeNull()
    expect(d.fingerprint).toBe(doctrineFingerprint(block))
  })

  it("sem doutrina: tudo null em qualquer motor", () => {
    for (const agent of ["claude-code", "codex", "agy"]) {
      const d = decideDoctrine({
        agent,
        block: null,
        locked: false,
        hasReply: false,
        lastFingerprint: "qualquer",
      })
      expect(d).toEqual({ body: null, system: null, fingerprint: null })
    }
  })

  it("fingerprint muda quando o texto muda (e só então)", () => {
    const a = doctrineFingerprint("regra A")
    expect(doctrineFingerprint("regra A")).toBe(a)
    expect(doctrineFingerprint("regra B")).not.toBe(a)
  })
})

describe("readDoctrine fora do Tauri", () => {
  it("degrada pra 'não existe' em vez de lançar", async () => {
    // doutrina é contexto opcional: nenhuma falha aqui pode travar um envio.
    await expect(readDoctrine("/qualquer")).resolves.toEqual({
      exists: false,
      content: "",
      bytes: 0,
    })
  })
})
