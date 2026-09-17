// R2 do docs/companion-chat-prd.md: qual endereço vai no QR e o que se diz sobre
// a Tailscale. Nome e estados tirados do Mac real (testdata/tailscale-1.102.4).

import { describe, expect, it } from "vitest"
import { avisoDaTailnet, urlDePareamento, type CompanionInfo, type CompanionTailnet } from "./companionEndereco"

const NOME = "macbook-pro-de-vinicius.taild44f89.ts.net"
const tailnet = (estado: CompanionTailnet["estado"]): CompanionTailnet => ({
  estado,
  nome: estado === "ausente" ? null : NOME,
  url: estado === "pronta" ? `https://${NOME}` : null,
  comando: "tailscale serve --bg 14200",
})
const info = (t?: CompanionTailnet | null): CompanionInfo => ({
  running: true,
  urlLan: "http://192.168.1.7:14200",
  pairingToken: "da80be9c41869ca7cf521d813ccc7686",
  connectedCount: 0,
  tailnet: t,
})

describe("urlDePareamento", () => {
  it("com a Tailscale pronta, o QR leva o endereço seguro", () => {
    expect(urlDePareamento(info(tailnet("pronta")))).toEqual({
      url: `https://${NOME}/#pair=da80be9c41869ca7cf521d813ccc7686`,
      segura: true,
    })
  })

  it("sem serve, sem HTTPS, desligada ou ausente, o QR usa a rede local", () => {
    for (const estado of ["semServe", "semHttps", "desligada", "ausente"] as const) {
      expect(urlDePareamento(info(tailnet(estado)))?.url).toBe("http://192.168.1.7:14200/#pair=da80be9c41869ca7cf521d813ccc7686")
    }
    // build anterior ao R2 não manda `tailnet`
    expect(urlDePareamento(info(undefined))?.segura).toBe(false)
  })

  it("servidor parado ou sem token não gera QR", () => {
    expect(urlDePareamento({ ...info(tailnet("pronta")), running: false })).toBeNull()
    expect(urlDePareamento({ ...info(tailnet("pronta")), pairingToken: null })).toBeNull()
  })
})

describe("avisoDaTailnet", () => {
  it("só oferece comando quando falta o serve", () => {
    expect(avisoDaTailnet(tailnet("semServe"))?.comando).toBe("tailscale serve --bg 14200")
    for (const estado of ["pronta", "semHttps", "desligada", "ausente"] as const) {
      expect(avisoDaTailnet(tailnet(estado))?.comando).toBeNull()
    }
  })

  it("pronta diz o nome e avisa que pareamento da rede local não vale aqui", () => {
    const aviso = avisoDaTailnet(tailnet("pronta"))!.texto
    expect(aviso).toContain(NOME)
    expect(aviso).toContain("parear de novo")
  })

  it("copy sem travessão", () => {
    for (const estado of ["pronta", "semServe", "semHttps", "desligada", "ausente"] as const) {
      expect(avisoDaTailnet(tailnet(estado))!.texto).not.toContain("—")
    }
  })
})
