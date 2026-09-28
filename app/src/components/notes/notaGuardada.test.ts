// Guardar para depois: o rascunho e o item da fila viram nota, e a nota volta
// ao composer. O `invoke` responde como `copiar_anexo` (anexo_entre_donos.rs);
// o texto e os anexos são os do print de 27/09.
import { beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
vi.mock("@/lib/focusComposer", () => ({ focusConsoleComposer: vi.fn() }))

import { avisar } from "@/lib/avisos"
import type { Attachment } from "@/lib/attachments"
import {
  guardarDaFila,
  guardarRascunho,
  levarAoComposer,
  rotuloDoEscopo,
  tituloDoGuardado,
} from "@/components/notes/notaGuardada"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { hasComposerDraft, useComposerDrafts } from "@/store/composerDrafts"
import { useStickyNotes } from "@/store/stickyNotes"

const CONV = "0f3c2a5e-8d1b-4c6f-9a7e-2b4d6f8a0c1e"
const PROJ = "p-frota"
const TEXTO = "tentei ler o arquivo “agent.rs” que mostra aqui na sua conversa durante o seu trabalho, e veja o erro que houve"
const ANEXOS: Attachment[] = [
  { path: `attachments/${CONV}/4df9cc61137de769.png`, name: "image.png", kind: "image", mime: "image/png", bytes: 581018 },
  { path: `attachments/${CONV}/9a1be0c2d3f4a5b6.png`, name: "image.png", kind: "image", mime: "image/png", bytes: 308429 },
]

/** O `copiar_anexo` do Rust: devolve o anexo no dono de destino. */
function copiaQueFunciona() {
  invoke.mockImplementation(async (cmd: string, args: { path: string; nome: string; para: { tipo: string; id: string } }) => {
    if (cmd === "wipe_note_attachments") return undefined
    if (cmd !== "copiar_anexo") throw new Error(`comando inesperado ${cmd}`)
    const arquivo = args.path.split("/").pop()
    const pasta = args.para.tipo === "nota" ? `attachments/notes/${args.para.id}` : `attachments/${args.para.id}`
    return { ...ANEXOS[0], path: `${pasta}/${arquivo}`, name: args.nome }
  })
}

function rascunho(texto = TEXTO, anexos = ANEXOS) {
  useComposerDrafts.setState({ byConv: { [CONV]: { text: texto, attachments: anexos, mentionValues: [] } } })
}

beforeEach(() => {
  invoke.mockReset()
  vi.mocked(avisar.feito).mockClear()
  vi.mocked(avisar.erro).mockClear()
  useStickyNotes.setState({ notes: [], dockOpen: false })
  useComposerDrafts.setState({ byConv: {} })
  useApp.setState({ projects: [{ id: PROJ, name: "frota", path: "/Users/viniciusmachado/projetos/frota" }] as never })
  useChat.setState({ byId: { [CONV]: { projectId: PROJ, queued: [] } } as never })
})

describe("guardar o rascunho", () => {
  it("vira nota da conversa com o texto e os anexos, e o composer fica livre", async () => {
    copiaQueFunciona()
    rascunho()
    expect(await guardarRascunho(CONV, "conversa")).toBe(true)
    const [nota] = useStickyNotes.getState().notes
    expect(nota).toMatchObject({ content: TEXTO, convId: CONV, projectId: PROJ, origem: "composer" })
    expect(nota.attachments?.map((a) => a.path)).toEqual([
      `attachments/notes/${nota.id}/4df9cc61137de769.png`,
      `attachments/notes/${nota.id}/9a1be0c2d3f4a5b6.png`,
    ])
    expect(hasComposerDraft(useComposerDrafts.getState().byConv[CONV])).toBe(false)
    // guardar não abre a gaveta: o contador de notas é o retorno
    expect(useStickyNotes.getState().dockOpen).toBe(false)
    expect(avisar.feito).toHaveBeenCalledWith("Guardado nas notas desta conversa.", expect.anything())
  })

  it("nota do projeto não fica presa à conversa, e o toast diz qual projeto", async () => {
    copiaQueFunciona()
    rascunho(TEXTO, [])
    await guardarRascunho(CONV, "projeto")
    const [nota] = useStickyNotes.getState().notes
    expect(nota.convId).toBeUndefined()
    expect(nota.projectId).toBe(PROJ)
    expect(avisar.feito).toHaveBeenCalledWith("Guardado nas notas do projeto frota.", expect.anything())
  })

  it("Desfazer devolve o rascunho inteiro e apaga a nota", async () => {
    copiaQueFunciona()
    rascunho()
    await guardarRascunho(CONV, "conversa")
    const { acao } = vi.mocked(avisar.feito).mock.calls[0][1] as { acao: { fazer: () => void } }
    acao.fazer()
    expect(useStickyNotes.getState().notes).toEqual([])
    expect(useComposerDrafts.getState().byConv[CONV]).toMatchObject({ text: TEXTO, attachments: ANEXOS })
  })

  it("se um anexo não copia, a nota não nasce e o rascunho fica intacto", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "copiar_anexo") throw new Error("caminho de anexo inválido")
      return undefined
    })
    rascunho()
    expect(await guardarRascunho(CONV, "conversa")).toBe(false)
    expect(useStickyNotes.getState().notes).toEqual([])
    expect(useComposerDrafts.getState().byConv[CONV]).toMatchObject({ text: TEXTO, attachments: ANEXOS })
    expect(avisar.erro).toHaveBeenCalledWith("Não consegui guardar a nota.", { detalhe: "caminho de anexo inválido" })
    expect(invoke).toHaveBeenCalledWith("wipe_note_attachments", expect.anything())
  })

  it("o texto recém-serializado do editor vence o da store, e rascunho vazio não guarda", async () => {
    copiaQueFunciona()
    rascunho("tentei ler", [])
    await guardarRascunho(CONV, "conversa", TEXTO)
    expect(useStickyNotes.getState().notes[0].content).toBe(TEXTO)
    rascunho("   ", [])
    expect(await guardarRascunho(CONV, "conversa")).toBe(false)
  })

  it("só anexo também vira nota, com título derivado", async () => {
    copiaQueFunciona()
    rascunho("", ANEXOS)
    await guardarRascunho(CONV, "conversa")
    expect(useStickyNotes.getState().notes[0].content).toBe("2 imagens")
  })
})

describe("guardar da fila", () => {
  it("tira o item, guarda, e Desfazer o devolve à mesma posição", async () => {
    copiaQueFunciona()
    const fila = [
      { text: "roda os testes do editor depois do seu turno", attachments: [] },
      { text: TEXTO, attachments: ANEXOS },
      { text: "e aproveita para ver o aviso de saída no Linux", attachments: [] },
    ]
    useChat.setState({ byId: { [CONV]: { projectId: PROJ, queued: fila } } as never })
    expect(await guardarDaFila(CONV, 1, "conversa")).toBe(true)
    expect(useChat.getState().byId[CONV].queued?.map((q) => q.text)).toEqual([fila[0].text, fila[2].text])
    expect(useStickyNotes.getState().notes[0]).toMatchObject({ content: TEXTO, origem: "fila" })
    const { acao } = vi.mocked(avisar.feito).mock.calls[0][1] as { acao: { fazer: () => void } }
    acao.fazer()
    expect(useChat.getState().byId[CONV].queued?.map((q) => q.text)).toEqual(fila.map((f) => f.text))
    expect(useStickyNotes.getState().notes).toEqual([])
  })
})

describe("levar ao composer", () => {
  it("devolve texto e anexos como fala sua, acrescenta ao que houver e mantém a nota", async () => {
    copiaQueFunciona()
    rascunho()
    await guardarRascunho(CONV, "conversa")
    rascunho("olha isso também", [])
    const nota = useStickyNotes.getState().notes[0]
    expect(await levarAoComposer(nota, CONV)).toBe(true)
    const r = useComposerDrafts.getState().byConv[CONV]
    expect(r.text).toBe(`olha isso também\n\n${TEXTO}`)
    expect(r.attachments.map((a) => a.path)).toEqual([
      `attachments/${CONV}/4df9cc61137de769.png`,
      `attachments/${CONV}/9a1be0c2d3f4a5b6.png`,
    ])
    expect(useStickyNotes.getState().notes).toHaveLength(1)
  })

  it("nota só de anexos não põe o título derivado no composer", async () => {
    copiaQueFunciona()
    rascunho("", ANEXOS)
    await guardarRascunho(CONV, "conversa")
    await levarAoComposer(useStickyNotes.getState().notes[0], CONV)
    expect(useComposerDrafts.getState().byConv[CONV].text).toBe("")
    expect(useComposerDrafts.getState().byConv[CONV].attachments).toHaveLength(2)
  })
})

describe("peças puras", () => {
  it("título do que só tem anexo", () => {
    expect(tituloDoGuardado("  ", [ANEXOS[0]])).toBe("image.png")
    expect(tituloDoGuardado("", ANEXOS)).toBe("2 imagens")
    expect(tituloDoGuardado("", [ANEXOS[0], { ...ANEXOS[0], kind: "pdf", name: "relatorio.pdf" }])).toBe("2 anexos")
    expect(tituloDoGuardado(" oi ", ANEXOS)).toBe("oi")
  })

  it("rótulo do escopo", () => {
    expect(rotuloDoEscopo("conversa", "frota")).toBe("desta conversa")
    expect(rotuloDoEscopo("projeto", "frota")).toBe("do projeto frota")
    expect(rotuloDoEscopo("projeto", null)).toBe("do projeto")
  })
})
