// Os alertas do GitHub (`> [!NOTE]`…) e a tarefa feita no Markdown do fio.
// O alerta é neutro de propósito: o aviso que o agente escreve não é decisão
// pendente nem falha, então não leva âmbar nem vermelho (STYLEGUIDE §2). O
// tipo se lê pelo ícone e pelo rótulo.

import type { ComponentPropsWithoutRef, ReactNode } from "react"
import type { Blockquote, ListItem, Nodes, Root } from "mdast"
import {
  Check,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type TipoDeAlerta = "note" | "tip" | "important" | "warning" | "caution"

const ALERTAS: Record<TipoDeAlerta, { rotulo: string; icone: LucideIcon }> = {
  note: { rotulo: "Nota", icone: Info },
  tip: { rotulo: "Dica", icone: Lightbulb },
  important: { rotulo: "Importante", icone: MessageSquareWarning },
  warning: { rotulo: "Atenção", icone: TriangleAlert },
  caution: { rotulo: "Cuidado", icone: OctagonAlert },
}

// O GitHub pede o marcador sozinho na linha; o texto na mesma linha também
// vale, porque é assim que o agente escreve metade das vezes.
const MARCADOR = /^\[!(note|tip|important|warning|caution)\](?:[ \t]*\n|[ \t]+|$)/i

function marcarAlerta(bq: Blockquote) {
  const par = bq.children[0]
  if (par?.type !== "paragraph") return
  const texto = par.children[0]
  if (texto?.type !== "text") return
  const m = MARCADOR.exec(texto.value)
  if (!m) return
  texto.value = texto.value.slice(m[0].length)
  if (!texto.value) par.children.shift()
  if (par.children.length === 0) bq.children.shift()
  bq.data = { ...bq.data, hProperties: { ...bq.data?.hProperties, dataAlerta: m[1].toLowerCase() } }
}

function marcarFeita(li: ListItem) {
  if (li.checked !== true) return
  li.data = { ...li.data, hProperties: { ...li.data?.hProperties, dataFeita: "" } }
}

/** Plugin remark: marca a citação que abre com `[!TIPO]` (tirando o
 *  marcador) e o item de tarefa feito, para o render achar pelo atributo. */
export function remarkAlertas() {
  return (arvore: Root) => {
    const andar = (no: Nodes) => {
      if (no.type === "blockquote") marcarAlerta(no)
      else if (no.type === "listItem") marcarFeita(no)
      if ("children" in no) for (const filho of no.children) andar(filho)
    }
    andar(arvore)
  }
}

export function ehTipoDeAlerta(v: unknown): v is TipoDeAlerta {
  return typeof v === "string" && v in ALERTAS
}

export function Alerta({ tipo, children }: { tipo: TipoDeAlerta; children?: ReactNode }) {
  const { rotulo, icone: Icone } = ALERTAS[tipo]
  return (
    <div role="note" className="mb-2 rounded-lg border bg-secondary/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <Icone aria-hidden className="size-3.5 shrink-0" />
        {rotulo}
      </div>
      <div className="[&>*:last-child]:mb-0">{children}</div>
    </div>
  )
}

/** Item de lista; o de tarefa feita sai riscado e esmaecido. */
export function ItemDeLista({
  children,
  className,
  "data-feita": feita,
  node: _node,
}: ComponentPropsWithoutRef<"li"> & { "data-feita"?: string; node?: unknown }) {
  return (
    <li
      className={cn(
        className === "task-list-item" && "list-none",
        feita != null && "text-muted-foreground line-through decoration-faint",
      )}
    >
      {children}
    </li>
  )
}

/** A caixinha da tarefa, no lugar do checkbox nativo (que vem desabilitado e
 *  com a cara do sistema). */
export function CaixaDeTarefa({ checked }: { checked?: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? "feita" : "a fazer"}
      // Óptico: -2px põe a caixa no meio da altura-x da primeira linha.
      className={cn(
        "mr-2 inline-grid size-3.5 place-items-center rounded-[3px] align-[-2px]",
        checked ? "bg-muted-foreground text-background" : "border",
      )}
    >
      {checked && <Check aria-hidden className="size-2.5" strokeWidth={3} />}
    </span>
  )
}
