// Endereço do Companion em Configurações: o que o servidor informa
// (`companion_status`) e qual URL vai no QR (R2 do docs/companion-chat-prd.md).
// Puro. A Frota só LÊ o estado da Tailscale; o comando que muda a rede da
// pessoa é mostrado para ela rodar.

export type EstadoTailnet = "ausente" | "desligada" | "semHttps" | "semServe" | "pronta"

/** Espelho de `companion_tailnet::Tailnet` no Rust. */
export interface CompanionTailnet {
  estado: EstadoTailnet
  /** Nome da máquina na tailnet, sem ponto final. */
  nome: string | null
  /** `https://<nome>`, só quando `pronta`. */
  url: string | null
  /** O que rodar no Terminal para expor o Companion na tailnet. */
  comando: string
}

/** Info do servidor companion (espelho do CompanionInfo do Rust). */
export interface CompanionInfo {
  running: boolean
  urlLan: string | null
  /** C4 — token de PAREAMENTO do QR (uso único, vida curta; rotaciona
   *  sozinho). A credencial definitiva de cada aparelho nunca sai por aqui. */
  pairingToken: string | null
  /** Nº de dispositivos (sockets WS) conectados agora. */
  connectedCount: number
  /** R2 — estado da Tailscale; ausente em builds anteriores ao R2. */
  tailnet?: CompanionTailnet | null
  /** R5 — nome deste Mac como o celular mostra (cabeçalho e atalho). */
  maquina?: string | null
}

/** A URL do QR: o endereço seguro quando a Tailscale está pronta, senão a LAN.
 *  Só o token de PAREAMENTO viaja nela, nunca a credencial definitiva. */
export function urlDePareamento(info: CompanionInfo | null): { url: string; segura: boolean } | null {
  if (!info?.running || !info.pairingToken) return null
  const base = info.tailnet?.estado === "pronta" && info.tailnet.url ? info.tailnet.url : info.urlLan
  if (!base) return null
  return { url: `${base.replace(/\/+$/, "")}/#pair=${info.pairingToken}`, segura: base.startsWith("https://") }
}

/** O que dizer sobre a Tailscale, e se há comando para a pessoa rodar. */
export function avisoDaTailnet(t: CompanionTailnet | null | undefined): { texto: string; comando: string | null } | null {
  if (!t) return null
  switch (t.estado) {
    case "pronta":
      return {
        texto: `Endereço seguro pela Tailscale (${t.nome}). Funciona dentro e fora de casa. Aparelho pareado pela rede local precisa parear de novo por aqui.`,
        comando: null,
      }
    case "semServe":
      return {
        texto: "A Tailscale está pronta. Para usar o Companion fora de casa, rode no Terminal do Mac:",
        comando: t.comando,
      }
    case "semHttps":
      return {
        texto: "Falta ativar HTTPS no painel da Tailscale (DNS, HTTPS Certificates). Enquanto isso, o QR usa a rede local.",
        comando: null,
      }
    case "desligada":
      return { texto: "A Tailscale está desligada neste Mac. Enquanto isso, o QR usa a rede local.", comando: null }
    case "ausente":
      return {
        texto: "Para usar fora de casa com segurança, instale a Tailscale no Mac e no celular. Sem ela, o Companion funciona só na rede local.",
        comando: null,
      }
  }
}
