// Tail de um arquivo de saída pelo Rust (`bastidor_seguir`, ADR-200). O Rust
// só lê o arquivo; aqui só se acumula com teto e se entrega um `setState` por
// quadro, por mais pedaços que cheguem juntos. A inscrição morre quando a vista
// fecha ou troca de arquivo.

import { useEffect, useState } from "react"
import { Channel, invoke } from "@tauri-apps/api/core"
import { SAIDA_VAZIA, somarLinhas, type SaidaViva } from "@/lib/bastidores"

/** Espelho de `bastidores::PedacoDeSaida`. */
export interface PedacoDeSaida {
  linhas: string[]
  descartouInicio: boolean
  reiniciou: boolean
  fim: string | null
}

export interface EstadoDoArquivo {
  saida: SaidaViva
  /** O acompanhamento acabou (arquivo apagado, indisponível). */
  fim: string | null
  erro: string | null
}

const INICIAL: EstadoDoArquivo = { saida: SAIDA_VAZIA, fim: null, erro: null }

/** Aplica pedaços na ordem em que chegaram. Puro. */
export function aplicarPedacos(estado: EstadoDoArquivo, pedacos: PedacoDeSaida[]): EstadoDoArquivo {
  let { saida, fim } = estado
  for (const p of pedacos) {
    const base = p.reiniciou ? SAIDA_VAZIA : saida
    saida = somarLinhas(base, p.linhas, p.descartouInicio ? 1 : 0)
    if (p.fim) fim = p.fim
  }
  return { ...estado, saida, fim }
}

export function useSaidaDeArquivo(caminho: string | null): EstadoDoArquivo {
  const [estado, setEstado] = useState<EstadoDoArquivo>(INICIAL)
  useEffect(() => {
    setEstado(INICIAL)
    if (!caminho) return
    let ativo = true
    let inscricao: string | null = null
    let lote: PedacoDeSaida[] = []
    let quadro = 0
    const canal = new Channel<PedacoDeSaida>()
    canal.onmessage = (pedaco) => {
      lote.push(pedaco)
      if (quadro) return
      quadro = requestAnimationFrame(() => {
        quadro = 0
        const pedacos = lote
        lote = []
        if (ativo) setEstado((e) => aplicarPedacos(e, pedacos))
      })
    }
    invoke<string>("bastidor_seguir", { caminho, canal })
      .then((id) => {
        if (ativo) inscricao = id
        else void invoke("bastidor_parar", { id })
      })
      .catch((erro: unknown) => {
        if (ativo) {
          setEstado((e) => ({
            ...e,
            erro: typeof erro === "string" ? erro : "não consegui acompanhar a saída",
          }))
        }
      })
    return () => {
      ativo = false
      if (quadro) cancelAnimationFrame(quadro)
      if (inscricao) void invoke("bastidor_parar", { id: inscricao })
    }
  }, [caminho])
  return estado
}
