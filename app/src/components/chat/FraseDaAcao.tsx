// VERBO + OBJETO de uma ação no fio (ADR-241). O olho acha o verbo em cinza e
// o objeto em primeiro plano: arquivo vira pílula com o ícone do tipo, comando
// vira mono, narração do agente vira a frase inteira. É só apresentação:
// quem decide o que é verbo e objeto é o `presentTool`.

import type { MouseEvent } from "react"
import { abrirMencaoDeArquivo, raizDaConversa } from "@/components/common/abrirMencaoDeArquivo"
import { FileIcon } from "@/components/ui/file-icon"
import { parseFileTarget, type FileTarget } from "@/lib/fileLink"
import type { ToolView } from "@/lib/toolview"
import { cn } from "@/lib/utils"
import { useActiveProject } from "@/store/app"

/** O arquivo que a pílula abre, ou `null` quando não é alvo nosso (fora do
 *  projeto e fora das raízes autorizadas). A raiz é a da CONVERSA: com
 *  worktree, o caminho absoluto do motor mora sob ela, não sob o projeto. A
 *  primeira linha da faixa vai junto para o menu de contexto. Puro. */
export function alvoDaPilula(path: string, raiz: string | null, range?: string | null): FileTarget | null {
  if (!raiz) return null
  const alvo = parseFileTarget(path, raiz)
  if (!alvo) return null
  const linha = range ? parseInt(range, 10) : NaN
  return Number.isFinite(linha) && linha > 0 && !alvo.line ? { ...alvo, line: linha } : alvo
}

/** O arquivo como OBJETO inline: 20px, abaixo do degrau `chip` do §13 de
 *  propósito, para caber no trilho de 28px da linha sem empurrar o texto. Só o
 *  nome aparece; o caminho inteiro fica no hover.
 *
 *  Clicar a pílula ABRE O ARQUIVO (pelo mesmo caminho da menção no texto,
 *  `abrirMencaoDeArquivo`), não a ação: expandir segue no resto da linha. A
 *  pílula mora dentro do botão da linha, então o clique para ali
 *  (`stopPropagation`) e ela é `span`, não `button`, para não aninhar botão. */
export function PilulaDeArquivo({
  path,
  range,
  alvo,
  raiz,
}: {
  path: string
  range?: string | null
  alvo?: FileTarget | null
  raiz?: string | null
}) {
  const nome = path.split("/").filter(Boolean).pop() ?? path
  const abrir = alvo
    ? (e: MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        void abrirMencaoDeArquivo(alvo, raiz, { x: r.left, y: r.bottom + 4 })
      }
    : undefined
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        title={path}
        role={abrir ? "link" : undefined}
        aria-label={abrir ? `Abrir ${nome}` : undefined}
        onClick={abrir}
        data-ctx-arquivo={alvo?.rel}
        data-ctx-arquivo-abs={alvo?.abs}
        data-ctx-arquivo-linha={alvo?.line ?? undefined}
        className={cn(
          "inline-flex h-5 min-w-0 items-center gap-1 rounded-md bg-sel pr-1.5 pl-0.5 text-foreground/85",
          abrir && "cursor-pointer transition-colors hover:bg-foreground/10 hover:text-foreground hover:[&>.nome]:underline",
        )}
      >
        {/* O poço segura a artwork colorida sobre qualquer fundo. */}
        <span className="grid size-4 shrink-0 place-items-center rounded-sm bg-background/70">
          <FileIcon path={path} size={12} />
        </span>
        <span className="nome truncate underline-offset-2">{nome}</span>
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
  const projeto = useActiveProject()
  const o = view.object
  const raiz = o?.kind === "file" && projeto?.path ? raizDaConversa(projeto.path) : null
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
        <PilulaDeArquivo path={o.path} range={o.range} raiz={raiz} alvo={alvoDaPilula(o.path, raiz, o.range)} />
      ) : o.kind === "command" ? (
        <span className="truncate font-mono text-[11px]">{o.text}</span>
      ) : (
        <span className="truncate">{o.text}</span>
      )}
      {mais}
    </>
  )
}
