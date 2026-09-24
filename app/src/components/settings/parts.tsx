// Peças compartilhadas das Configurações. Existem para que a hierarquia seja
// a MESMA em toda seção (o "bagunçado" do build 191 era, em parte, cada bloco
// inventando o próprio cabeçalho):
//
//   SectionHeader  — o que esta seção responde (+ 1 ação, no máximo)
//   BlockTitle     — divisão interna da seção (etiqueta de instrumento, 11px)
//   Field          — uma preferência: rótulo/hint à esquerda, controle à direita
//   Note           — prosa de rodapé (o porquê, a periodicidade, o preço)
//
// Elevação: a seção é E0 (plano). Linha de lista é E1 (bg-card/borda hairline)
// e NÃO ganha outro cartão dentro — detalhe interno se separa por hairline.

import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { useChromeSlot } from "@/components/settings/settingsChrome"

/** Cabeçalho da seção. Título, escopo e ação vão para a BARRA fixa do
 *  SettingsDialog (portal, ver settingsChrome.tsx); a descrição fica inline,
 *  como primeira linha do conteúdo, com a mesma margem em toda seção. Fora do
 *  dialog (teste com renderToStaticMarkup, storybook) renderiza tudo inline. */
export function SectionHeader({
  title,
  description,
  action,
  escopo,
}: {
  title: string
  description?: string | null
  /** Uma ação, no máximo. Use `<Button size="compacto" variant="ghost">`. */
  action?: ReactNode
  /** Seletor de escopo (projeto) quando a seção é por-projeto: fica ao lado
   *  do título, na barra, nunca herdado em silêncio. */
  escopo?: ReactNode
}) {
  const slot = useChromeSlot()
  useEffect(() => {
    if (!slot) return
    slot.ocupar(true)
    return () => slot.ocupar(false)
  }, [slot])
  const barra = (
    <>
      <h2 className="shrink-0 text-[14px] font-semibold text-foreground">{title}</h2>
      {escopo}
      <span className="flex-1" />
      {action}
    </>
  )
  const descricao = description ? (
    <p className="mb-3 text-[12px] leading-snug text-muted-foreground">{description}</p>
  ) : null
  if (!slot?.alvo) {
    return (
      <div className="mb-3">
        <div className="flex items-center gap-3">{barra}</div>
        {descricao}
      </div>
    )
  }
  return (
    <>
      {createPortal(barra, slot.alvo)}
      {descricao}
    </>
  )
}

/** Divisão interna da seção. `hint` explica o bloco em uma linha. */
export function BlockTitle({
  children,
  hint,
}: {
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-1.5">
      <h3 className="etiqueta">{children}</h3>
      {hint && (
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

/** Uma preferência: rótulo (+hint) à esquerda, controle à direita. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && (
          <div className="text-[12px] leading-snug text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Prosa de rodapé de um bloco (periodicidade, preço, ressalva). */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
      {children}
    </p>
  )
}

/** Espaçamento entre blocos dentro de uma seção. */
export function Block({ children }: { children: ReactNode }) {
  return <div className="mt-6">{children}</div>
}

export const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"

// ─────────────────────────────────────────────────────────────────────────────
// SUPERFÍCIES (24/08/2026)
//
// As peças acima dão o vocabulário de ESTRUTURA (o que é seção, bloco, campo,
// nota). Faltava o de SUPERFÍCIE — o que é cartão, linha, selo — e sem ele cada
// seção inventou o seu. Medido antes de escrever isto:
//
//   19 strings de "cartão" distintas em components/settings
//   17 strings de selo/rótulo caixa-alta
//   raio em rounded-md, -lg e -xl; borda em border/50, border/60 e border
//
// Uma coisa conceitual, dezenove implementações. Nenhuma delas errada sozinha;
// o problema é que a próxima seção não tem onde se ancorar e inventa a
// vigésima. `ui/badge.tsx` existia e NINGUÉM usava — o default do shadcn vem
// com raio de pílula e a escala de tamanho do Tailwind, e a casa usa raio de
// canto e px declarado (§3).
//
// O tom é PROPRIEDADE, não classe solta: é o que permite a guarda de verde
// contar num lugar só, em vez de uma exceção por arquivo.

/** Tom de estado. `ok` é PROBE REAL (§2: verde é marco raro ou probe), nunca
 *  "ambiente saudável" — para isso o tom certo é `neutro`. */
export type Tom = "neutro" | "ok" | "atencao" | "erro"

const TOM_TEXTO: Record<Tom, string> = {
  neutro: "text-muted-foreground",
  ok: "text-st-success",
  atencao: "text-st-warning",
  erro: "text-st-error",
}

const TOM_SELO: Record<Tom, string> = {
  neutro: "bg-secondary text-muted-foreground",
  ok: "bg-st-success/12 text-st-success",
  atencao: "bg-st-warning/15 text-st-warning",
  erro: "bg-st-error/12 text-st-error",
}

/** Cartão: a superfície E1 das Configurações. Uma borda hairline, um raio, um
 *  fundo — e nada de cartão dentro de cartão (detalhe interno se separa por
 *  hairline, como diz o cabeçalho deste arquivo). */
export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/50 bg-secondary/20",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Cabeçalho do cartão: nome à esquerda, meta em mono, selo à direita.
 *  `acao` é o gesto do cartão inteiro (ex.: "Re-verificar"). */
export function CardHead({
  nome,
  meta,
  selo,
  acao,
}: {
  nome: ReactNode
  meta?: ReactNode
  selo?: ReactNode
  acao?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <span className="text-[13px] font-medium text-foreground">{nome}</span>
      {meta && (
        <span className="truncate font-mono text-[11px] text-muted-foreground/70">
          {meta}
        </span>
      )}
      {(selo || acao) && (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {selo}
          {acao}
        </span>
      )}
    </div>
  )
}

/** Corpo do cartão. Separado do cabeçalho por hairline, nunca por outro cartão. */
export function CardBody({ children }: { children: ReactNode }) {
  return <div className="border-t border-border/50 px-3 py-2.5">{children}</div>
}

/** Selo de estado: UMA palavra, caixa alta, sem borda. O que ele diz é estado,
 *  não nome — por isso mora à direita e nunca dentro do título. */
export function Selo({
  tom = "neutro",
  children,
}: {
  tom?: Tom
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-px text-[11px] font-medium tracking-wide uppercase",
        TOM_SELO[tom],
      )}
    >
      {children}
    </span>
  )
}

/** Linha de lista: glifo, título (+dica), e o que vier à direita.
 *  É a peça do "uma linha por fato" que o resumo derivado precisa. */
export function Row({
  glifo,
  titulo,
  dica,
  direita,
}: {
  glifo?: ReactNode
  titulo: ReactNode
  dica?: ReactNode
  direita?: ReactNode
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
      {glifo && <span className="shrink-0">{glifo}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-foreground">{titulo}</div>
        {dica && (
          <div className="text-[12px] leading-snug text-muted-foreground">
            {dica}
          </div>
        )}
      </div>
      {direita && <div className="flex shrink-0 items-center gap-1.5">{direita}</div>}
    </li>
  )
}

/** Nota de CONSEQUÊNCIA: para quando um gesto tem preço fora do app.
 *  Filete à esquerda, tom âmbar — distinto do `Note`, que é prosa de rodapé.
 *  (Não é "barra de acento": aquela guarda mira filete POSICIONADO e colado em
 *  aresta com fundo tingido; aqui é borda de bloco no fluxo.) */
export function Consequencia({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 border-l-2 border-st-warning/60 pl-2.5 text-[12px] leading-snug text-muted-foreground">
      {children}
    </p>
  )
}

/** Texto no tom de um estado, sem virar selo (para frases inteiras). */
export function TomTexto({ tom, children }: { tom: Tom; children: ReactNode }) {
  return <span className={TOM_TEXTO[tom]}>{children}</span>
}
