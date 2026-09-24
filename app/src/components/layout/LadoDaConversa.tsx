// Um arquivo ao lado da conversa (ADR-243, mock aprovado em
// docs/mocks/abas-de-arquivo-persistentes.html): ler um arquivo ENQUANTO se
// conversa sobre ele, sem que alternar abas esconda um dos dois.
//
// Mora no MESMO host da conversa, à direita dela, e o fio nunca desmonta: só
// estreita (docs/abas-no-principal-plan.md). Um lado só. Abaixo de
// `CARTAO_PARA_O_LADO` ele não aparece, e a aba vira aba comum.

import { useRef, useState } from "react"
import { Fronteira } from "@/components/common/Fronteira"
import { FileTab } from "@/components/layout/FileTab"
import { LADO_MAX, LADO_MIN, abasDo, useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useChat } from "@/store/chat"

export function LadoDaConversa() {
  const convId = useChat((s) => s.activeId)
  const aoLado = useAbasDeArquivo((s) => abasDo(s, convId).aoLado)
  const ladoCabe = useAbasDeArquivo((s) => s.ladoCabe)
  const guardada = useAbasDeArquivo((s) => s.larguraDoLado)
  // Durante o arrasto a largura é local: o store persiste em disco a cada
  // mudança, e o ponteiro manda dezenas por segundo. Guarda uma vez, ao soltar.
  const [arrastando, setArrastando] = useState<number | null>(null)
  const alca = useRef<HTMLDivElement | null>(null)
  if (!aoLado || !ladoCabe) return null
  const fracao = arrastando ?? guardada

  const arrastar = (e: React.PointerEvent<HTMLDivElement>) => {
    const caixa = alca.current?.parentElement?.getBoundingClientRect()
    if (!caixa || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    setArrastando(Math.min(LADO_MAX, Math.max(LADO_MIN, (caixa.right - e.clientX) / caixa.width)))
  }
  const soltar = () => {
    if (arrastando !== null) useAbasDeArquivo.getState().setLarguraDoLado(arrastando)
    setArrastando(null)
  }

  return (
    <>
      <div
        ref={alca}
        role="separator"
        aria-orientation="vertical"
        aria-label="Largura do arquivo ao lado"
        title="Arrastar para redimensionar"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={arrastar}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        className="relative w-2 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-sel-hover"
      >
        <span className="absolute inset-y-0 left-1/2 border-l border-border/40" />
      </div>
      <div style={{ width: `${fracao * 100}%` }} className="flex min-h-0 min-w-0 shrink-0 flex-col">
        <Fronteira area="o arquivo ao lado" resetKey={aoLado}>
          <FileTab path={aoLado} aoLado />
        </Fronteira>
      </div>
    </>
  )
}
