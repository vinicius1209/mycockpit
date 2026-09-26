// Qual Frota está aberto (ADR-264): o canal e o número do build na faixa
// ("teste #442"), a dica com versão, commit, quando foi feito e de onde roda,
// e o clique que copia a versão para colar num relato. Antes era "local ·
// v0.1.0-t442", sem dizer mais nada.

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { AcaoDoClique, DicaDaFaixa, GatilhoDaFaixa } from "@/components/layout/statusBarChrome"
import { copyText } from "@/lib/clipboard"
import { isTauri } from "@/lib/db"
import { fmtAgo } from "@/lib/format"
import { statusBuildItem } from "@/lib/statusBar"
import { cn } from "@/lib/utils"
import { quandoFoiFeito, versaoParaRelato, type InfoDoBuild } from "@/lib/version"

/** O ponto do canal: só aparece fora do oficial, para o build de teste ou de
 *  dev não passar por oficial numa olhada. */
const PONTO: Record<InfoDoBuild["canal"], string | null> = {
  oficial: null,
  teste: "bg-brass",
  dev: "bg-muted-foreground/60",
  local: "bg-muted-foreground/60",
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="flex-1 text-muted-foreground">{rotulo}</span>
      {children}
    </div>
  )
}

export function VersaoDaFaixa() {
  const [version, setVersion] = useState<string | null>(null)
  const [info, setInfo] = useState<InfoDoBuild | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    getVersion()
      .then(setVersion)
      .catch((err) => console.warn("[versão] sem a versão do app:", err))
    invoke<InfoDoBuild>("build_info")
      .then(setInfo)
      .catch((err) => console.warn("[versão] sem as informações do build:", err))
  }, [])

  const item = statusBuildItem(version, info)
  const ponto = info ? PONTO[info.canal] : null
  const feito = quandoFoiFeito(info?.feitoEm ?? null, Date.now())
  const ha = info?.feitoEm ? fmtAgo(Date.now() - new Date(info.feitoEm).getTime()) : null

  return (
    <DicaDaFaixa
      align="end"
      conteudo={
        <>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              Frota {info?.numero != null ? `#${info.numero}` : (version ?? "")}
            </span>
            <span
              className={cn(
                "ml-auto rounded px-1.5 text-[11px]",
                info?.canal === "teste" ? "bg-brass-soft text-brass" : "bg-secondary text-muted-foreground",
              )}
            >
              {info?.canal ?? "local"}
            </span>
          </div>
          <Linha rotulo="Versão">
            <span className="font-mono tabular-nums text-foreground">{version ?? "sem versão carimbada"}</span>
          </Linha>
          {info?.commit && (
            <Linha rotulo="Commit">
              <span className="font-mono text-foreground">{info.commit}</span>
              {info.mudancasLocais && (
                <span className="rounded bg-secondary px-1.5 text-[11px] text-muted-foreground">com mudanças locais</span>
              )}
            </Linha>
          )}
          {feito && (
            <Linha rotulo="Feito">
              <span className="font-mono tabular-nums text-foreground">{feito}</span>
              {ha && <span className="text-[11px] text-muted-foreground">{ha}</span>}
            </Linha>
          )}
          {info?.pasta && (
            <Linha rotulo="Rodando de">
              <span className="max-w-44 truncate font-mono text-foreground" title={info.pasta}>
                {info.pasta}
              </span>
            </Linha>
          )}
        </>
      }
      pe={<AcaoDoClique>copiar para um relato</AcaoDoClique>}
    >
      <GatilhoDaFaixa
        aria-label={item.title}
        onClick={() => void copyText(versaoParaRelato(version, info), "Versão copiada para o relato.")}
      >
        {ponto && <span aria-hidden className={cn("size-1.5 rounded-full", ponto)} />}
        <span>{item.text}</span>
      </GatilhoDaFaixa>
    </DicaDaFaixa>
  )
}
