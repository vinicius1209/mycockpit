// ADR-246: o agente nomeia a conversa no primeiro turno pela tool
// `conversation_title`. Sem helper configurado, a conversa ficava com a
// primeira frase crua para sempre (24/09/2026: "faça uma revisada nos ultimos
// a…", "https://x.com/wingl…"). A mão da pessoa continua vencendo sempre.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { deriveTitle } from "@/lib/convTitle"
import { useChat, type ChatItem } from "@/store/chat"
import { tituloDoAgente } from "./titulo"

// O pedido REAL que abriu a conversa do print da barra lateral.
const PEDIDO = "https://x.com/winglee/status/2102507043295010908\n\nconsegue acessar esse post, extrair frames do video em boa qualidade?"
const itens = [{ kind: "user", id: "u1", text: PEDIDO, ts: 0 }] as unknown as ChatItem[]

const renomear = vi.fn(async (_id: string, _t: string) => {})

function conversaCom(title: string | null) {
  useChat.setState({
    byId: { c1: { projectId: "p1", items: itens } } as never,
    conversationsByProject: { p1: [{ id: "c1", title }] } as never,
    renameConversation: renomear,
  })
}

const evento = (title: string, convId = "c1") => ({
  kind: "conversation_title" as const,
  data: { runId: "r1", convId, title },
})

beforeEach(() => renomear.mockClear())

describe("título dado pelo agente", () => {
  it("troca a primeira frase crua pelo nome que o agente deu", async () => {
    conversaCom(deriveTitle(itens))
    await tituloDoAgente(evento("Frames do vídeo do winglee"))
    expect(renomear).toHaveBeenCalledWith("c1", "Frames do vídeo do winglee")
  })

  it("limpa com a mesma régua do helper (aspas, ponto final)", async () => {
    conversaCom(deriveTitle(itens))
    await tituloDoAgente(evento('"Frames do vídeo do winglee."'))
    expect(renomear).toHaveBeenCalledWith("c1", "Frames do vídeo do winglee")
  })

  it("nome que a pessoa deu é intocável", async () => {
    conversaCom("Estudo do Zeron")
    await tituloDoAgente(evento("Frames do vídeo do winglee"))
    expect(renomear).not.toHaveBeenCalled()
  })

  it("resposta que não é nome não renomeia", async () => {
    conversaCom(deriveTitle(itens))
    await tituloDoAgente(evento("Ok"))
    await tituloDoAgente(evento("SEM ASSUNTO"))
    expect(renomear).not.toHaveBeenCalled()
  })

  it("outro evento de trabalho, ou conversa que não existe, não mexe em nada", async () => {
    conversaCom(deriveTitle(itens))
    await tituloDoAgente({ kind: "work_update", data: { convId: "c1", title: "Nome" } } as never)
    await tituloDoAgente(evento("Frames do vídeo do winglee", "outra"))
    expect(renomear).not.toHaveBeenCalled()
  })
})
