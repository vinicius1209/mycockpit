// A nota endereçada (`@nota/…`) chega ao agente pelos DOIS envios.
//
// Incidente de 14/09/2026: a pessoa mandou só `@nota/aqui-e-uma-conversa-do-
// codex-que-ainda-vai-demor` pelo composer, e o agente recebeu o endereço cru. O
// resolvedor existia, mas só o envio da mesa (`comporCascata`) o chamava. A
// nota abaixo é a real (conteúdo, ids e escopo copiados do localStorage).
import { beforeEach, describe, expect, it } from "vitest"
import type { StickyNote } from "@/components/notes/types"
import { useStickyNotes } from "@/store/stickyNotes"
import { withNotasDoTurno } from "./promptCascade"

const PROJETO = "54c053f3-9117-4522-a151-42015673bbfc"
const NOTA_REAL: StickyNote = {
  id: "4160d4c8-bfa3-4347-83e5-e1f296aee8a9",
  projectId: PROJETO,
  color: "sand",
  targetAgent: "all",
  collapsed: false,
  createdAt: 1789405136069,
  updatedAt: 1789405161179,
  content:
    "aqui é uma conversa do codex, que ainda vai demorar 4 dias para resetar. De onde ele tirou esses dados? conflitou com a sessao da claude?",
  attachments: [
    { path: "attachments/notes/4160d4c8-bfa3-4347-83e5-e1f296aee8a9/0db7fa79806c9a70.png", name: "image.png", kind: "image", mime: "image/png", bytes: 520282 },
    { path: "attachments/notes/4160d4c8-bfa3-4347-83e5-e1f296aee8a9/a21906f81a96b7de.png", name: "image.png", kind: "image", mime: "image/png", bytes: 62648 },
  ],
}
const ENVIADO = "@nota/aqui-e-uma-conversa-do-codex-que-ainda-vai-demor"

const fonte = (glob: Record<string, unknown>): string => Object.values(glob)[0] as string

describe("nota endereçada no envio", () => {
  beforeEach(() => {
    useStickyNotes.setState({ notes: [NOTA_REAL] })
  })

  it("o endereço vira o conteúdo atual da nota, e o endereço fica no texto", () => {
    const { prompt } = withNotasDoTurno("conv-1", PROJETO, [], ENVIADO)
    expect(prompt).toContain("<notas-do-usuario>")
    expect(prompt).toContain("De onde ele tirou esses dados?")
    expect(prompt).toContain("Anexos desta nota (enviados com este turno): image.png, image.png")
    expect(prompt.endsWith(ENVIADO)).toBe(true)
  })

  it("os prints da nota viajam como anexo do run, depois dos anexos do composer", () => {
    const doComposer = { path: "attachments/conv-1/print.png", name: "print.png", kind: "image" as const, mime: "image/png", bytes: 10 }
    const { attachments } = withNotasDoTurno("conv-1", PROJETO, [], ENVIADO, [doComposer])
    expect(attachments.map((a) => a.path)).toEqual([
      doComposer.path,
      ...NOTA_REAL.attachments!.map((a) => a.path),
    ])
  })

  it("reenviar o mesmo pedido não duplica o anexo da nota", () => {
    const primeira = withNotasDoTurno("conv-1", PROJETO, [], ENVIADO)
    const reenvio = withNotasDoTurno("conv-1", PROJETO, [], ENVIADO, primeira.attachments)
    expect(reenvio.attachments).toHaveLength(2)
  })

  it("nota de outro projeto não vaza para este envio, nem o texto nem os anexos", () => {
    const r = withNotasDoTurno("conv-1", "outro-projeto", [], ENVIADO)
    expect(r.prompt).toBe(ENVIADO)
    expect(r.attachments).toEqual([])
  })

  it("o composer usa a mesma porta que a mesa", () => {
    const chatPanel = fonte(
      import.meta.glob("../../components/chat/ChatPanel.tsx", { query: "?raw", import: "default", eager: true }),
    )
    const cascata = fonte(import.meta.glob("./promptCascade.ts", { query: "?raw", import: "default", eager: true }))
    expect(chatPanel).toMatch(/attachments \} = withNotasDoTurno\([^)]*attachments\)/)
    expect(chatPanel).not.toMatch(/\bwithNotes\(/)
    expect(cascata).toMatch(/withNotasDoTurno\(c\.convId/)
    // a mesa entrega os anexos da nota ao run e à bolha do fio
    const mesa = fonte(import.meta.glob("./send.ts", { query: "?raw", import: "default", eager: true }))
    expect(mesa.match(/juntarAnexos\(attachments, preparedPrompt\.anexosDeNota\)/g)).toHaveLength(2)
  })
})
