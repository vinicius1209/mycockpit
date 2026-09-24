// O DESPACHO, no composer montado.
//
// O gate é puro e tem teste próprio (`composerSend.test.ts`); o que se prova
// aqui é que o composer OBEDECE a ele — que o botão primário acende e apaga
// pelo mesmo critério, que o Parar toma o lugar do Enviar com turno em voo, e
// que o composer DIZ o que Enter e Tab farão durante o turno.
import { beforeEach, describe, expect, it } from "vitest"
import {
  CONV,
  chat,
  composerDrafts,
  conversa,
  desabilitado,
  fila,
  montar,
  resetarBancada,
} from "./CommandConsole.harness"

beforeEach(resetarBancada)

function rascunho(text: string) {
  composerDrafts.byConv = { [CONV]: { text, attachments: [] } }
}

describe("o botão primário acende só quando há o que enviar", () => {
  it("composer vazio: Enviar desabilitado", () => {
    return montar().then((html) =>
      expect(desabilitado(html, "Enviar")).toBe(true),
    )
  })

  it("com rascunho, Enviar acende", async () => {
    rascunho("roda os testes")
    expect(desabilitado(await montar(), "Enviar")).toBe(false)
  })

  it("anexo persistido reaparece no composer da conversa", async () => {
    composerDrafts.byConv = {
      [CONV]: {
        text: "",
        attachments: [
          {
            path: `attachments/${CONV}/print.png`,
            name: "print-pendente.png",
            kind: "image",
            mime: "image/png",
            bytes: 42,
          },
        ],
      },
    }
    const html = await montar()
    expect(html).toContain("print-pendente.png")
    expect(desabilitado(html, "Enviar")).toBe(false)
  })

  it("rascunho só de espaços não acende (o trim é o mesmo do envio)", async () => {
    rascunho("   \n  ")
    expect(desabilitado(await montar(), "Enviar")).toBe(true)
  })

  it("composer desabilitado pelo dono: nem com rascunho", async () => {
    rascunho("roda os testes")
    expect(desabilitado(await montar({ disabled: true }), "Enviar")).toBe(true)
  })

  it("missão em andamento trava o envio manual", async () => {
    rascunho("roda os testes")
    const html = await montar({ missionRunning: true })
    expect(desabilitado(html, "Enviar")).toBe(true)
    expect(html).toContain(
      "Missão em andamento; pare a missão para enviar manualmente…",
    )
  })
})

describe("com turno em voo há correção imediata, fila e PARAR", () => {
  it("running: some o Enviar, entram corrigir, enfileirar e Parar", async () => {
    rascunho("roda os testes")
    const html = await montar({ running: true })
    expect(desabilitado(html, "Enviar")).toBeNull()
    expect(desabilitado(html, "Interromper e enviar")).toBe(false)
    expect(desabilitado(html, "Enfileirar")).toBe(false)
    expect(desabilitado(html, "Parar")).toBe(false)
  })

  it("o composer avisa que Enter corrige e Tab enfileira", async () => {
    expect(await montar({ running: true })).toContain(
      "Enter corrige agora · Tab envia no próximo turno…",
    )
  })

  it("durante finalizing só aceita fila e não oferece outro Parar", async () => {
    rascunho("roda os testes")
    const html = await montar({ finalizing: true })
    expect(await montar({ finalizing: true })).toContain(
      "Turno terminando · Tab envia assim que fechar…",
    )
    expect(desabilitado(html, "Enfileirar")).toBe(false)
    expect(desabilitado(html, "Interromper e enviar")).toBeNull()
    expect(desabilitado(html, "Parar")).toBeNull()
  })
})

describe("a fila é visível, com o que foi digitado e o que foi anexado", () => {
  it("as mensagens na fila aparecem acima do campo, na ordem digitada", async () => {
    chat.byId = {
      [CONV]: conversa({
        running: true,
        queued: [fila("primeiro isso"), fila("depois aquilo")],
      }),
    }
    const html = await montar({ running: true })
    // ADR-240: a frase diz que elas vão juntas, num envio só
    expect(html).toContain("Vão juntas, num envio só, quando este turno terminar")
    expect(html.indexOf("primeiro isso")).toBeLessThan(
      html.indexOf("depois aquilo"),
    )
  })

  it("o anexo enfileirado aparece JUNTO da mensagem dele", async () => {
    // Anexo que some do chip é anexo que o usuário acha que foi — e a régua
    // antiga deixava o anexo pra trás no envio com turno em voo.
    chat.byId = {
      [CONV]: conversa({
        running: true,
        queued: [
          fila("compara com o print", [
            {
              path: "attachments/6f1c8b90/8f3a2c1d0e.png",
              name: "Captura de Tela 2026-08-15 as 18.42.07.png",
              mime: "image/png",
              kind: "image",
              // `bytes`, não `size`: o vitest não checa tipo e passava; o
              // `bun run build` reprovou. Fixture que o app não consegue
              // produzir não prova caminho nenhum.
              bytes: 184_233,
            },
          ]),
        ],
      }),
    }
    const html = await montar({ running: true })
    expect(html).toContain("compara com o print")
    expect(html).toContain("Captura de Tela 2026-08-15 as 18.42.07.png")
  })

  it("sem fila, a faixa não ocupa espaço nenhum", async () => {
    expect(await montar()).not.toContain("na fila")
  })

  // ADR-240: o envio forçado subiu para o cabeçalho, uma vez só (ele sempre
  // mandou a fila inteira); edição e remoção seguem em cada item.
  it("a fila oferece envio forçado, e cada item edição e remoção", async () => {
    chat.byId = {
      [CONV]: conversa({
        running: true,
        queued: [fila("instrução pendente")],
      }),
    }
    const html = await montar({ running: true })
    expect(html).toContain("Interromper e enviar")
    expect(html).toContain("Editar mensagem")
    expect(html).toContain("Remover da fila")
  })

  it("fila sem turno não promete uma conclusão futura e pode ser enviada", async () => {
    chat.byId = {
      [CONV]: conversa({ queued: [fila("instrução que ficou pendente")] }),
    }
    const html = await montar()
    expect(html).toContain("Pronta para enviar")
    expect(desabilitado(html, "Enviar a fila")).toBe(false)
    expect(html).not.toContain("ao terminar")
  })

  it("durante finalizing informa a espera e não oferece ação sem efeito", async () => {
    chat.byId = {
      [CONV]: conversa({
        finalizing: true,
        queued: [fila("instrução pendente")],
      }),
    }
    const html = await montar({ finalizing: true })
    expect(html).toContain("Aguardando o fechamento do turno")
    expect(desabilitado(html, "Enviar a fila")).toBeNull()
  })
})

describe("com texto digitado durante o turno, o composer oferece fila e correção", () => {
  it("mostra os dois gestos ao lado do botão Parar", async () => {
    rascunho("mensagem digitada em voo")
    const html = await montar({ running: true })
    expect(html).toContain("Enfileirar")
    expect(html).toContain("Interromper e enviar")
    expect(desabilitado(html, "Parar")).toBe(false)
  })
})

describe("o placeholder conta o estado certo", () => {
  it("em repouso, convida a pedir algo", async () => {
    expect(await montar()).toContain("Peça algo ao seu time de agents…")
  })

  it("missão ganha de turno em voo, e o gate concorda com o que está escrito", async () => {
    // As duas coisas podem valer ao mesmo tempo (missão lançada pelo Launchpad
    // com um turno linear já em voo). O placeholder sempre disse "pare a missão";
    // o Enter é que empilhava assim mesmo. Aqui os dois falam a mesma língua.
    rascunho("roda os testes")
    const html = await montar({ running: true, missionRunning: true })
    expect(html).toContain("Missão em andamento")
    expect(html).not.toContain("Tab envia no próximo turno…")
    expect(desabilitado(html, "Enviar")).toBeNull() // com turno em voo, é Parar
  })
})

describe("sem conversa ativa o composer não some, mas não despacha", () => {
  it("o Enviar continua apagado mesmo com rascunho de outra conversa", async () => {
    chat.activeId = null
    rascunho("roda os testes")
    expect(desabilitado(await montar(), "Enviar")).toBe(true)
  })
})

// O menu do chevron (Enviar / Disputa / Missão) é `DropdownMenuContent` do
// Radix: FECHADO ele não vai pra marcação, então qualquer asserção sobre o que
// há dentro dele passaria vazia aqui — teste que não pode falhar. O conteúdo do
// menu e o gesto de abrir são de e2e.
