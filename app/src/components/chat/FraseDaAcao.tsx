// VERBO + OBJETO de uma ação no fio (ADR-241). O olho acha o verbo em cinza e
// o objeto em primeiro plano: arquivo vira pílula com o ícone do tipo, comando
// vira mono, narração do agente vira a frase inteira. É só apresentação:
// quem decide o que é verbo e objeto é o `presentTool`.

import { FileIcon } from "@/components/ui/file-icon"
import type { ToolView } from "@/lib/toolview"

/** O arquivo como OBJETO inline, não controle: 20px, abaixo do degrau `chip`
 *  do §13 de propósito, para caber no trilho de 28px da linha sem empurrar o
 *  texto. Só o nome aparece; o caminho inteiro fica no hover. */
export function PilulaDeArquivo({ path, range }: { path: string; range?: string | null }) {
  const nome = path.split("/").filter(Boolean).pop() ?? path
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        title={path}
        className="inline-flex h-5 min-w-0 items-center gap-1 rounded-md bg-sel pr-1.5 pl-0.5 text-foreground/85"
      >
        {/* O poço segura a artwork colorida sobre qualquer fundo. */}
        <span className="grid size-4 shrink-0 place-items-center rounded-sm bg-background/70">
          <FileIcon path={path} size={12} />
        </span>
        <span className="truncate">{nome}</span>
      </span>
      {range && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
          {range}
        </span>
      )}
    </span>
  )
}

export function FraseDaAcao({ view }: { view: ToolView }) {
  const o = view.object
  if (!o) return <span className="truncate">{view.label}</span>
  const mais = o.mais ? (
    <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">+{o.mais}</span>
  ) : null
  if (o.kind === "text" && o.frase)
    return (
      <>
        <span className="truncate">{o.text}</span>
        {mais}
      </>
    )
  return (
    <>
      <span className="shrink-0 text-muted-foreground">{view.verb}</span>
      {o.kind === "file" ? (
        <PilulaDeArquivo path={o.path} range={o.range} />
      ) : o.kind === "command" ? (
        <span className="truncate font-mono text-[11px]">{o.text}</span>
      ) : (
        <span className="truncate">{o.text}</span>
      )}
      {mais}
    </>
  )
}
