// A LINHA do sino: ícone, título e o fim (hora, ponto de não visto) em cima;
// meta, recibo e rastro embaixo, alinhados pelo texto do título.
//
// O corpo é a `LinhaDeLista` (um botão, que é o que a linha faz: abre). As
// ações do hover são irmãs dela, não filhas, porque botão dentro de botão não
// existe; elas ocupam o lugar do fim, que some enquanto elas aparecem.

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { controle } from "@/components/ui/controle"
import { LinhaDeLista } from "@/components/ui/linha-de-lista"
import { cn } from "@/lib/utils"

export interface AcaoDaLinha {
  icone: LucideIcon
  rotulo: string
  fazer: () => void
}

/** Recuo das linhas de baixo: ícone de 14px + gap de 8px. */
const RECUO = "pl-[22px]"

export function LinhaDoSino({
  icone,
  titulo,
  selo,
  fim,
  meta,
  corpo,
  rastro,
  dica,
  lida = false,
  acoes,
  onAbrir,
}: {
  icone: ReactNode
  titulo: string
  /** Contagem ao lado do título ("6 turnos"). */
  selo?: string
  fim?: ReactNode
  meta?: string | null
  /** O que aconteceu, em frase (o recibo do turno). */
  corpo?: string | null
  /** O que ficou pelo caminho, em cinza. */
  rastro?: ReactNode
  dica?: string
  lida?: boolean
  acoes?: AcaoDaLinha[]
  onAbrir: () => void
}) {
  const temAcoes = !!acoes?.length
  return (
    <div className="group/linha relative">
      <LinhaDeLista onClick={onAbrir} title={dica} className="flex flex-col gap-0.5 py-2">
        <span className="flex w-full items-center gap-2 text-[13px]">
          {icone}
          <span className={cn("min-w-0 truncate", lida ? "text-muted-foreground" : "text-foreground")}>
            {titulo}
          </span>
          {selo && (
            <span className="shrink-0 rounded-full bg-sel px-1.5 text-[11px] text-muted-foreground tabular-nums">
              {selo}
            </span>
          )}
          <span className="flex-1" />
          {fim && (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums",
                temAcoes && "group-focus-within/linha:invisible group-hover/linha:invisible",
              )}
            >
              {fim}
            </span>
          )}
        </span>
        {meta && <span className={cn("w-full truncate text-[11px] text-muted-foreground", RECUO)}>{meta}</span>}
        {corpo && <span className={cn("line-clamp-2 w-full text-[11px] text-foreground/75", RECUO)}>{corpo}</span>}
        {rastro && (
          <span className={cn("flex w-full items-center gap-1.5 text-[11px] text-muted-foreground", RECUO)}>
            {rastro}
          </span>
        )}
      </LinhaDeLista>
      {temAcoes && (
        <span className="absolute top-1.5 right-1.5 hidden items-center group-focus-within/linha:flex group-hover/linha:flex">
          {acoes!.map(({ icone: Icone, rotulo, fazer }) => (
            <button
              key={rotulo}
              type="button"
              onClick={fazer}
              title={rotulo}
              aria-label={rotulo}
              className={cn(
                controle("chip", { quadrado: true }),
                "text-muted-foreground transition-colors hover:bg-sel hover:text-foreground",
              )}
            >
              <Icone className="size-3" />
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

/** O ponto de não visto: tinta de texto, não de gesto. */
export function PontoNaoVisto() {
  return <span aria-label="não visto" className="size-1.5 shrink-0 rounded-full bg-foreground" />
}

/** Título de seção do sino. */
export function RotuloDoSino({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-[11px] tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  )
}
