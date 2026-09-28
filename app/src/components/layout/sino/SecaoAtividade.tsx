// A atividade do sino: o que aconteceu enquanto você não olhava, uma linha por
// conversa por dia (ADR-271). Cinza é sucesso (§1); só a falha pinta.

import {
  AlertCircle,
  Check,
  CircleHelp,
  Gauge,
  Info,
  MessageCircleQuestion,
  ShieldQuestion,
  X,
} from "lucide-react"
import { fmtAgo, fmtTime } from "@/lib/format"
import {
  metaDoAvulso,
  rotuloDosPedidos,
  type Avulso,
  type Dia,
  type GrupoDaConversa,
} from "@/lib/sino/agrupar"
import type { Notification } from "@/store/notifications"
import {
  LinhaDoSino,
  PontoNaoVisto,
  RotuloDoSino,
} from "@/components/layout/sino/LinhaDoSino"

const CINZA = "size-3.5 shrink-0 text-muted-foreground"

function IconeDoItem({ kind }: { kind: Notification["kind"] }) {
  if (kind === "run_error") return <AlertCircle className="size-3.5 shrink-0 text-st-error" />
  if (kind === "evento") return <Info className={CINZA} />
  if (kind === "limit") return <Gauge className={CINZA} />
  if (kind === "approval") return <ShieldQuestion className={CINZA} />
  if (kind === "question") return <MessageCircleQuestion className={CINZA} />
  if (kind === "gate") return <CircleHelp className={CINZA} />
  return <Check className={CINZA} />
}

export interface AcoesDaAtividade {
  tituloDe: (convId: string, projectId: string) => string | null
  projetoDe: (projectId: string) => string | null
  abrirGrupo: (g: GrupoDaConversa) => void
  abrirItem: (n: Notification) => void
  tirar: (ids: string[]) => void
}

function Fim({ ts, hoje, naoLidas, now }: { ts: number; hoje: boolean; naoLidas: number; now: number }) {
  return (
    <>
      {hoje ? fmtAgo(now - ts) : fmtTime(ts)}
      {naoLidas > 0 && <PontoNaoVisto />}
    </>
  )
}

function LinhaDoGrupo({ g, hoje, now, a }: { g: GrupoDaConversa; hoje: boolean; now: number; a: AcoesDaAtividade }) {
  const pedidos = rotuloDosPedidos(g.pedidos)
  return (
    <LinhaDoSino
      icone={g.desfecho ? <Check className={CINZA} /> : <MessageCircleQuestion className={CINZA} />}
      titulo={a.tituloDe(g.convId, g.projectId) ?? g.itens[0].title}
      selo={g.turnos > 1 ? `${g.turnos} turnos` : undefined}
      fim={<Fim ts={g.ts} hoje={hoje} naoLidas={g.naoLidas} now={now} />}
      meta={g.desfecho?.subtitle ?? a.projetoDe(g.projectId)}
      corpo={g.desfecho?.body}
      rastro={
        pedidos && (
          <>
            <MessageCircleQuestion className="size-3 shrink-0" />
            {pedidos}
          </>
        )
      }
      lida={g.naoLidas === 0}
      dica="Abrir a conversa"
      onAbrir={() => a.abrirGrupo(g)}
      acoes={[{ icone: X, rotulo: "Tirar do sino", fazer: () => a.tirar(g.itens.map((n) => n.id)) }]}
    />
  )
}

function LinhaAvulsa({ e, hoje, now, a }: { e: Avulso; hoje: boolean; now: number; a: AcoesDaAtividade }) {
  const n = e.item
  return (
    <LinhaDoSino
      icone={<IconeDoItem kind={n.kind} />}
      titulo={n.title}
      fim={<Fim ts={n.ts} hoje={hoje} naoLidas={e.naoLidas} now={now} />}
      meta={metaDoAvulso(n, n.convId ? a.tituloDe(n.convId, n.projectId) : null)}
      corpo={n.body}
      lida={n.read}
      onAbrir={() => a.abrirItem(n)}
      acoes={[{ icone: X, rotulo: "Tirar do sino", fazer: () => a.tirar([n.id]) }]}
    />
  )
}

export function SecaoAtividade({
  dias,
  now,
  vazio,
  acoes,
}: {
  dias: Dia[]
  now: number
  /** O que dizer quando o filtro não deixa nada. */
  vazio: string | null
  acoes: AcoesDaAtividade
}) {
  if (dias.length === 0) {
    return vazio ? (
      <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">{vazio}</div>
    ) : null
  }
  return (
    <>
      {dias.map((dia) => {
        const hoje = dia.rotulo === "Hoje"
        return (
          <section key={dia.chave} aria-label={dia.rotulo}>
            <RotuloDoSino>{dia.rotulo}</RotuloDoSino>
            {dia.entradas.map((e) =>
              e.tipo === "conversa" ? (
                <LinhaDoGrupo key={e.chave} g={e} hoje={hoje} now={now} a={acoes} />
              ) : (
                <LinhaAvulsa key={e.chave} e={e} hoje={hoje} now={now} a={acoes} />
              ),
            )}
          </section>
        )
      })}
    </>
  )
}
