// O bloco ```mermaid do fio e das notas (F6, ADR-284): o diagrama, com "Código",
// "Copiar fonte" e "Copiar imagem". Enquanto a lib carrega, ou se o diagrama
// não compila, o código aparece: o render nunca quebra. A fonte que ainda está
// chegando pelo stream espera assentar antes de tentar desenhar.

import { useEffect, useState } from "react"
import { Code, Copy, ImageDown, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyImage, copyText } from "@/lib/clipboard"
import { desenharMermaid, linhaDoErro, resumoDoErro, svgParaPng } from "@/lib/mermaid"
import { cn } from "@/lib/utils"

const ASSENTAR_MS = 300

type Estado =
  | { tipo: "carregando" }
  | { tipo: "pronto"; svg: string }
  | { tipo: "erro"; resumo: string | null; linha: number | null; cru: string }

export function BlocoMermaid({ fonte }: { fonte: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" })
  const [verCodigo, setVerCodigo] = useState(false)

  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => {
      desenharMermaid(fonte).then(
        (svg) => vivo && setEstado({ tipo: "pronto", svg }),
        (e: unknown) => {
          const mensagem = e instanceof Error ? e.message : String(e)
          if (vivo) setEstado({ tipo: "erro", resumo: resumoDoErro(mensagem), linha: linhaDoErro(mensagem), cru: mensagem })
        },
      )
    }, ASSENTAR_MS)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [fonte])

  const pronto = estado.tipo === "pronto"
  const mostrarCodigo = !pronto || verCodigo
  const linhas = fonte.replace(/\n$/, "").split("\n")

  const copiarImagem = async () => {
    if (estado.tipo !== "pronto") return
    try {
      await copyImage(await svgParaPng(estado.svg), "Diagrama copiado como imagem")
    } catch (e) {
      console.error("[mermaid] copiar imagem falhou", e)
      await copyText(fonte, "Não deu para gerar a imagem; copiei a fonte")
    }
  }

  return (
    <div className="mb-2 overflow-hidden rounded-md border bg-background/50" data-mermaid>
      <div className="flex h-8 items-center gap-1 border-b border-border/40 pr-1 pl-3">
        <span className="font-mono text-[11px] text-faint">mermaid</span>
        <span className="flex-1" />
        {pronto && (
          <Button
            type="button"
            size="chip"
            variant="ghost"
            aria-pressed={verCodigo}
            onClick={() => setVerCodigo((v) => !v)}
            className={cn("text-muted-foreground", verCodigo && "bg-sel text-foreground")}
          >
            <Code />
            Código
          </Button>
        )}
        <Button type="button" size="chip" variant="ghost" onClick={() => void copyText(fonte, "Fonte copiada")} className="text-muted-foreground">
          <Copy />
          Copiar fonte
        </Button>
        {pronto && (
          <Button type="button" size="chip" variant="ghost" onClick={() => void copiarImagem()} className="text-muted-foreground">
            <ImageDown />
            Copiar imagem
          </Button>
        )}
      </div>
      {estado.tipo === "erro" && (
        <p className="flex items-start gap-2 px-3 pt-2.5 text-[12px] text-muted-foreground" title={estado.cru}>
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            O diagrama não compilou{estado.linha ? ` na linha ${estado.linha}` : ""}
            {estado.resumo ? `: ${estado.resumo}` : ""}. Mostrando o código.
          </span>
        </p>
      )}
      {mostrarCodigo ? (
        <pre className="overflow-auto p-3 font-mono text-[13px] leading-relaxed">
          {linhas.map((l, i) => (
            <span
              key={i}
              className={cn("block", estado.tipo === "erro" && estado.linha === i + 1 && "-mx-3 bg-secondary px-3")}
            >
              {l || " "}
            </span>
          ))}
        </pre>
      ) : (
        <div
          className="flex justify-center overflow-auto p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          // SVG saído do Mermaid em modo estrito (sanitizado pela própria lib).
          dangerouslySetInnerHTML={{ __html: estado.svg }}
        />
      )}
    </div>
  )
}
