// Marcar uma região do quadro para o agente (navegador PRD R4, B3). O quadro
// fica CONGELADO enquanto a pessoa arrasta: marcar sobre uma imagem que muda
// embaixo do cursor não diz nada. Esc cancela; soltar com a região desenhada
// manda para `browser_marcar`, que acha os elementos reais e recorta.

import { useEffect, useRef, useState } from "react"
import type { BrowserPreviewFrame } from "@/lib/browser"
import type { RegiaoNoQuadro } from "./capturaDaPagina"

interface Ponto {
  x: number
  y: number
}

/** Retângulo normalizado entre dois pontos (em pixels do quadro). */
export function retanguloEntre(a: Ponto, b: Ponto): { x: number; y: number; largura: number; altura: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    largura: Math.abs(a.x - b.x),
    altura: Math.abs(a.y - b.y),
  }
}

export function MarcacaoNoQuadro({
  quadro,
  enviando,
  onMarcar,
  onCancelar,
}: {
  quadro: BrowserPreviewFrame
  enviando: boolean
  onMarcar: (regiao: RegiaoNoQuadro) => void
  onCancelar: () => void
}) {
  const imagemRef = useRef<HTMLImageElement | null>(null)
  const [inicio, setInicio] = useState<Ponto | null>(null)
  const [fim, setFim] = useState<Ponto | null>(null)

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelar()
    }
    window.addEventListener("keydown", aoTeclar)
    return () => window.removeEventListener("keydown", aoTeclar)
  }, [onCancelar])

  const largura = quadro.width ?? imagemRef.current?.naturalWidth ?? 0
  const altura = quadro.height ?? imagemRef.current?.naturalHeight ?? 0

  const pontoNoQuadro = (clientX: number, clientY: number): Ponto | null => {
    const img = imagemRef.current
    if (!img || !largura || !altura) return null
    const r = img.getBoundingClientRect()
    return {
      x: Math.min(Math.max(((clientX - r.left) / r.width) * largura, 0), largura),
      y: Math.min(Math.max(((clientY - r.top) / r.height) * altura, 0), altura),
    }
  }

  const ret = inicio && fim ? retanguloEntre(inicio, fim) : null

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-[12px] text-muted-foreground">
        {enviando
          ? "Lendo os elementos da região…"
          : "Arraste sobre a área que o agente deve ver · Esc cancela"}
      </p>
      <div
        className="relative max-h-[calc(100%-1.75rem)] max-w-full cursor-crosshair touch-none select-none"
        onPointerDown={(e) => {
          if (enviando || e.button !== 0) return
          const p = pontoNoQuadro(e.clientX, e.clientY)
          if (!p) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setInicio(p)
          setFim(p)
        }}
        onPointerMove={(e) => {
          if (!inicio) return
          const p = pontoNoQuadro(e.clientX, e.clientY)
          if (p) setFim(p)
        }}
        onPointerUp={() => {
          if (!inicio || !fim) return
          const r = retanguloEntre(inicio, fim)
          setInicio(null)
          if (r.largura < 4 || r.altura < 4) {
            setFim(null)
            return
          }
          onMarcar({ ...r, quadroLargura: largura, quadroAltura: altura })
        }}
      >
        <img
          ref={imagemRef}
          src={`data:image/jpeg;base64,${quadro.data}`}
          alt="Quadro congelado para marcar"
          draggable={false}
          className="block max-h-full max-w-full rounded-lg border border-border bg-background object-contain"
        />
        {ret && largura > 0 && altura > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-sm bg-ring/15 ring-2 ring-ring"
            style={{
              left: `${(ret.x / largura) * 100}%`,
              top: `${(ret.y / altura) * 100}%`,
              width: `${(ret.largura / largura) * 100}%`,
              height: `${(ret.altura / altura) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  )
}
