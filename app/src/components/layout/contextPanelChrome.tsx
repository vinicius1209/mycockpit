// A GRAMÁTICA VISUAL do painel direito, num arquivo só: seção, aba e badge de
// estágio. Saiu do `ContextPanel.tsx` porque ele estava no teto da catraca do
// §10 e a regra é dividir, nunca subir o teto — e porque as três peças mudam
// juntas: são a receita de "seção" e de "ativo" do painel (ADR-043, Fase 2).
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Seção do painel. Separação por PROXIMIDADE ASSIMÉTRICA (§4): 24px acima do
 *  título, 8px abaixo (razão 3:1) — é isso que gruda o título no conteúdo dele
 *  e o descola do anterior. Zero `<Separator />`: eram 7 hairlines que
 *  ignoravam o `px-5` das seções e corriam de parede a parede enquanto o
 *  conteúdo respirava 20px. */
export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="px-5 pt-6 pb-0 first:pt-1">
      <div className="mb-2">
        <span className="label-mono">{title}</span>
      </div>
      {children}
    </section>
  )
}

/** Estágio do manifest SDD (discovery→…→done). */
export function StageBadge({ stage }: { stage: string }) {
  const done = stage === "done"
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        // "done" fica na tela pra sempre: é ambiente, logo cinza (§2).
        done ? "bg-muted text-muted-foreground" : "bg-brass/15 text-brass",
      )}
    >
      {stage}
    </span>
  )
}

/** Aba do painel (Contexto | Alterações | Plano). Ativa = a MESMA receita das
 *  linhas da árvore (§2, ADR-043): preenchimento neutro `--sel` + peso, sem
 *  tinta. Saiu o sublinhado brass, que era a terceira linguagem de "ativo" do
 *  app, e o contador saiu do brass junto (número é metadado, não gesto).
 *  Sem pip: o pip é o marcador do GUTTER de lista/árvore, e uma tira
 *  horizontal de abas não tem gutter. */
export function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  children: ReactNode
  /** Contador opcional (ex.: nº de arquivos alterados). 0 = sem badge. */
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium tracking-[0.08em] uppercase transition-colors",
        active
          ? "bg-sel text-foreground"
          : "text-muted-foreground/50 hover:bg-sel-hover hover:text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "font-mono font-semibold tabular-nums",
            active ? "text-muted-foreground" : "text-faint",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
