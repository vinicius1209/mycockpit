// Testes do selo "lido / não foi aberto" no anexo.
//
// O problema que isto resolve: no Claude e no agy o anexo é um PONTEIRO — o
// caminho vai no prompt e o modelo DECIDE abrir. Se ele responder sem abrir, a
// resposta sai igualmente confiante e você não tem como saber. O dado da prova
// já existia no fio (a chamada da ferramenta de leitura); faltava mostrar.
//
// A regra mais importante aqui é a que se RECUSA a afirmar: o `agy -p` devolve
// texto puro e não emite evento de ferramenta, então ausência de rastro não é
// prova de nada. Inventar um "não foi aberto" ali seria mentir com confiança.

import { describe, expect, it } from "vitest"
import type { Attachment } from "@/lib/attachments"
import type { ChatItem } from "@/store/chat"
import { attachmentRead, attachmentReadLabel } from "./attachmentRead"

const PATH = "/Users/v/Library/Application Support/dev.vinicius.mycockpit/attachments/c1/abc.png"
const att: Attachment = {
  path: PATH,
  name: "shot.png",
  kind: "image",
  mime: "image/png",
  bytes: 100,
}

function user(text: string, atts?: Attachment[]): ChatItem {
  return { kind: "user", id: `u-${text}`, text, attachments: atts } as ChatItem
}
function tool(name: string, input: unknown): ChatItem {
  return { kind: "tool", id: `t-${name}-${Math.random()}`, name, input } as ChatItem
}
function texto(t: string): ChatItem {
  return { kind: "text", id: `x-${t}`, text: t } as ChatItem
}

describe("attachmentRead — Claude (ponteiro, com telemetria de tool)", () => {
  it("Read no path do anexo ⇒ aberto (é o único sim com prova)", () => {
    const items = [
      user("o que você vê?", [att]),
      tool("Read", { file_path: PATH }),
      texto("vejo um ícone"),
    ]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("aberto")
  })

  it("turno terminou sem Read ⇒ não-aberto (o modelo respondeu sem olhar)", () => {
    const items = [user("o que você vê?", [att]), texto("acho que é um gráfico")]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("nao-aberto")
  })

  it("turno AINDA rodando sem Read ⇒ pendente, não acusa cedo demais", () => {
    const items = [user("o que você vê?", [att])]
    expect(attachmentRead(items, 0, att, "claude-code", true)).toBe("pendente")
  })

  it("Read em OUTRO arquivo não conta como prova", () => {
    const items = [
      user("o que você vê?", [att]),
      tool("Read", { file_path: "/outro/lugar/README.md" }),
      texto("li o readme"),
    ]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("nao-aberto")
  })

  it("o rastro tem que ser DESTE turno: Read depois do próximo user não vale", () => {
    // senão um Read do turno seguinte "provaria" retroativamente o anterior.
    const items = [
      user("o que você vê?", [att]),
      texto("não sei"),
      user("abre lá então"),
      tool("Read", { file_path: PATH }),
    ]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("nao-aberto")
  })

  it("aceita caminho relativo citado pelo agent (--add-dir libera a pasta)", () => {
    const items = [
      user("o que você vê?", [att]),
      tool("Read", { file_path: "attachments/c1/abc.png" }),
    ]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("aberto")
  })

  it("acha o path em qualquer campo do input (o nome do parâmetro varia)", () => {
    const items = [user("?", [att]), tool("view_file", { AbsolutePath: PATH })]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("aberto")
  })

  it("tool que NÃO é de leitura não conta (Bash citando o path não prova visão)", () => {
    const items = [
      user("?", [att]),
      tool("Bash", { command: `ls -la '${PATH}'` }),
      texto("existe"),
    ]
    expect(attachmentRead(items, 0, att, "claude-code", false)).toBe("nao-aberto")
  })
})

describe("attachmentRead — transporte que INLINA", () => {
  it("codex: chega por construção (-i vira input_image base64) ⇒ inlinado", () => {
    const items = [user("?", [att]), texto("vejo um ícone")]
    expect(attachmentRead(items, 0, att, "codex", false)).toBe("inlinado")
  })
})

describe("attachmentRead — agent SEM telemetria de ferramenta", () => {
  it("agy: sempre sem-rastro, mesmo sem nenhum tool no fio", () => {
    // o `agy -p` devolve texto puro (só TextDelta), então a ausência de rastro
    // NÃO distingue "não abriu" de "abriu e não contou". Não afirmamos.
    const items = [user("?", [att]), texto("vejo um ícone dourado")]
    expect(attachmentRead(items, 0, att, "agy", false)).toBe("sem-rastro")
  })

  it("agy: nem com turno rodando vira pendente (não há o que esperar)", () => {
    expect(attachmentRead([user("?", [att])], 0, att, "agy", true)).toBe("sem-rastro")
  })
})

describe("attachmentReadLabel — só fala quando tem o que dizer", () => {
  it("aberto vira selo discreto; não-aberto vira alerta", () => {
    expect(attachmentReadLabel("aberto")).toEqual({ text: "lido", warn: false })
    expect(attachmentReadLabel("nao-aberto")).toEqual({
      text: "não foi aberto",
      warn: true,
    })
  })

  it("inlinado, pendente e sem-rastro NÃO viram selo", () => {
    // inlinado é garantido (nada a avisar) e sem-rastro é ignorância nossa —
    // transformar isso em aviso seria alarme falso todo turno do agy.
    expect(attachmentReadLabel("inlinado")).toBeNull()
    expect(attachmentReadLabel("pendente")).toBeNull()
    expect(attachmentReadLabel("sem-rastro")).toBeNull()
  })
})
