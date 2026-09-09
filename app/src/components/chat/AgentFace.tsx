// <AgentFace> — a persona VIVA: a mesma cara do `<AgentAvatar>`, mas desenhada
// por nós, então o olho pode se mover.
//
// Identidade não se decide aqui. `avatarFor` continua sendo a fonte única do
// "como a persona aparece" (seed + cor da categoria); este componente consome o
// MESMO spec e só troca o renderizador. Ver `lib/avatarRig.ts` pro porquê de
// existir um segundo (resumo: o DiceBear é pôster, e pôster não olha).
//
// O olhar segue o §6 do STYLEGUIDE inteiro: ele responde ao PONTEIRO (é gesto,
// não animação ambiente), morre junto com a presença do cursor, e
// `prefers-reduced-motion` degrada pra cara ESTÁTICA e visível, nunca pra
// ausência de cara. O rastreador é único e de módulo (`lib/olhar.ts`).

import { useMemo, useRef, useSyncExternalStore } from "react"
import { avatarFor, categoryColor } from "@/lib/avatar"
import {
  caminhoDaBoca,
  olharPara,
  planoDaCara,
  OLHAR_NEUTRO,
  type DesvioDoOlhar,
} from "@/lib/avatarRig"
import { olharAgora, subscribeOlhar } from "@/lib/olhar"
import { cn } from "@/lib/utils"
import type { AgentDef } from "@/lib/agentDefs"

interface Props {
  /** A persona. Mesmo shape do `<AgentAvatar>`, de propósito: os dois
   *  renderizadores consomem o mesmo spec. */
  def?: Pick<AgentDef, "category" | "avatarStyle" | "avatarSeed" | "slug" | "name">
  /** Overrides diretos (preview ao vivo, que ainda não tem `def`). */
  seed?: string
  category?: string
  /** Lado em px. Abaixo de ~26px a pupila não lê e quem carrega o efeito é a
   *  inclinação da cabeça — medido no mock. */
  size?: number
  /** Segue o ponteiro. `false` (o default) = cara estática, custo zero: sem
   *  assinatura do rastreador, sem medição de geometria. */
  olhar?: boolean
  rounded?: boolean
  className?: string
}

/** Snapshot do servidor (SSR/`renderToStaticMarkup`): sem ponteiro, sempre. */
function semPonteiro() {
  return null
}

export function AgentFace({
  def,
  seed,
  category,
  size = 24,
  olhar = false,
  rounded = false,
  className,
}: Props) {
  const base = def ? avatarFor(def) : undefined
  const sd = seed ?? base?.seed ?? "x"
  const cor =
    category !== undefined
      ? categoryColor(category)
      : base?.backgroundColor ?? categoryColor()
  const plano = useMemo(() => planoDaCara(sd), [sd])

  const svgRef = useRef<SVGSVGElement | null>(null)
  // Cara estática não paga nada: sem assinatura do rastreador, sem medição de
  // geometria. Quem olha assina; quem a MÁQUINA não deixa olhar (movimento
  // reduzido, tela de toque) recebe `null` do próprio rastreador, que é quem
  // decide isso — ver `lib/olhar.ts`.
  const ponteiro = useSyncExternalStore(
    olhar ? subscribeOlhar : subscribeInerte,
    olhar ? olharAgora : semPonteiro,
    semPonteiro,
  )

  // Geometria medida no MOMENTO do quadro, e só quando há ponteiro. O
  // rastreador já coalesce por `requestAnimationFrame`, então isto roda no
  // máximo uma vez por quadro por cara — e nenhuma vez com o cursor parado.
  let desvio: DesvioDoOlhar = OLHAR_NEUTRO
  if (ponteiro && svgRef.current) {
    const r = svgRef.current.getBoundingClientRect()
    desvio = olharPara(
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      ponteiro,
    )
  }

  const olhos = [-1, 1].map((lado) => ({
    lado,
    cx: 20 + lado * plano.afastamentoDoOlho,
  }))

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="presentation"
      aria-hidden
      className={cn("shrink-0", className)}
      style={{
        width: size,
        height: size,
        background: cor,
        // 28% do lado: o mesmo arredondamento que o `radius: 20` do DiceBear
        // produz, pra cara viva e cara pôster não parecerem dois sistemas.
        borderRadius: rounded ? "9999px" : Math.round(size * 0.28),
      }}
    >
      {/* A cabeça inteira inclina; a pupila anda dentro do soquete. Dois graus
          de liberdade porque em tamanho pequeno só o primeiro se enxerga, e em
          tamanho grande só o segundo convence. */}
      <g
        style={{
          transform: `translate(${desvio.cabeca.x}px, ${desvio.cabeca.y}px)`,
          transition: "transform var(--dur) cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {olhos.map(({ lado, cx }) => (
          <ellipse
            key={`s${lado}`}
            cx={cx}
            cy={17}
            rx={4.2}
            ry={plano.alturaDoOlho}
            fill="rgba(255,255,255,.92)"
          />
        ))}
        {olhos.map(({ lado, cx }) => (
          <circle
            key={`p${lado}`}
            cx={cx}
            cy={17}
            r={2.3}
            fill="rgba(20,22,25,.82)"
            style={{
              transform: `translate(${desvio.pupila.x}px, ${desvio.pupila.y}px)`,
              transition: "transform var(--dur-fast) linear",
            }}
          />
        ))}
        <path
          d={caminhoDaBoca(plano.boca)}
          stroke="rgba(255,255,255,.92)"
          strokeWidth={2.4}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  )
}

/** Assinatura no-op pra cara estática: o `useSyncExternalStore` exige uma
 *  função estável, e trocar de `subscribe` entre renders remontaria a
 *  assinatura. Devolver sempre a mesma referência mantém o hook quieto. */
function subscribeInerte(): () => void {
  return () => {}
}
