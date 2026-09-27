// A saída pergunta antes de descartar texto não salvo (ADR-164): quem conta os
// arquivos sujos para o Rust é o snapshot da bandeja.
import { describe, expect, it, vi } from "vitest"

const updateTray = vi.hoisted(() => vi.fn())
vi.mock("@/lib/tray", () => ({ updateTray }))

import { enviarSnapshotDaTray } from "@/lib/traySnapshot"
import { useEdicao } from "@/store/edicao"

describe("arquivos sujos no snapshot da bandeja", () => {
  it("publica quantos arquivos têm alterações não salvas", () => {
    useEdicao.setState({ sujos: {} })
    enviarSnapshotDaTray(0, 0)
    expect(updateTray).toHaveBeenLastCalledWith(expect.objectContaining({ arquivosSujos: 0 }))
    useEdicao.getState().marcarSujo("/p/a.ts", true)
    useEdicao.getState().marcarSujo("/p/b.rs", true)
    enviarSnapshotDaTray(0, 0)
    expect(updateTray).toHaveBeenLastCalledWith(expect.objectContaining({ arquivosSujos: 2 }))
  })
})
