import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import fioReal from "@/test/fio-real.json"
import { vozDoNo, vozesDoTurno, vozesPlanas, vozesPorTurno } from "./vozDoTurno"

const items = fioReal as unknown as ChatItem[]

const texto = (id: string, text: string, fase?: "narracao" | "resposta"): ChatItem =>
  ({ kind: "text", id, text, ...(fase ? { fase } : {}) }) as ChatItem
const tool = (id: string): ChatItem => ({ kind: "tool", id, name: "Bash", input: {}, result: { ok: true, text: "", lines: 0 } }) as ChatItem

describe("a voz de cada fala do turno", () => {
  it("no fio real do Claude, a resposta é a última fala depois da última ação", () => {
    const porTurno = vozesPorTurno(items, 0)
    // Turno real que terminou com "Tudo pronto. Segue o relatório completo da revisão."
    const turno = porTurno.get("00bbe1e0-f38a-4cbf-a15e-87538db313d1")!
    expect(turno.get("1354542d-5330-4c1d-90f6-38ba941c117a")).toBe("resposta")
    const vozes = [...turno.values()]
    expect(vozes.filter((v) => v === "resposta")).toHaveLength(1)
    expect(vozes.filter((v) => v === "narracao")).toHaveLength(4)
  })

  it("quando o motor diz a fase, ela manda", () => {
    const m = vozesDoTurno([
      texto("c1", "Vou gerar um ícone plano simples e salvar a imagem no workspace para você.", "narracao"),
      tool("t1"),
      texto("f1", "Não consegui gerar a imagem porque a ferramenta de geração não está disponível nesta sessão.", "resposta"),
    ])
    expect([...m]).toEqual([["c1", "narracao"], ["f1", "resposta"]])
  })

  it("turno que termina numa ação, sem fala depois, não tem resposta e nada baixa o tom", () => {
    expect(vozesDoTurno([texto("a", "vou rodar"), tool("t1")]).size).toBe(0)
  })

  it("turno com fases mas sem resposta anunciada não baixa o tom de nada", () => {
    expect(vozesDoTurno([texto("a", "narrando", "narracao"), tool("t")]).size).toBe(0)
  })

  it("turno que falhou não ganha resposta", () => {
    const m = vozesPorTurno(
      [{ kind: "user", id: "u", text: "x" } as ChatItem, texto("a", "fala"), { kind: "result", id: "r", ok: false } as ChatItem],
      0,
    )
    expect(m.get("r")?.size).toBe(0)
  })

  it("turno ainda rodando não tem voz nenhuma", () => {
    const m = vozesPorTurno([{ kind: "user", id: "u", text: "x" } as ChatItem, texto("a", "fala"), tool("t")], 0)
    expect(vozesPlanas(m).size).toBe(0)
  })

  it("o nó que costura narração e resposta é resposta, e ação não tem voz", () => {
    const vozes = new Map([["n1", "narracao" as const], ["r1", "resposta" as const]])
    expect(vozDoNo(["n1", "t1", "r1"], vozes)).toBe("resposta")
    expect(vozDoNo(["n1", "t1"], vozes)).toBe("narracao")
    expect(vozDoNo(["t1"], vozes)).toBeNull()
  })

  it("turno fechado reaproveita o mapa anterior", () => {
    const base = [{ kind: "user", id: "u", text: "x" } as ChatItem, texto("a", "fala"), { kind: "result", id: "r", ok: true } as ChatItem]
    const antes = vozesPorTurno(base, 0)
    const depois = vozesPorTurno([...base, texto("b", "nova")], 0, antes)
    expect(depois.get("r")).toBe(antes.get("r"))
  })
})
