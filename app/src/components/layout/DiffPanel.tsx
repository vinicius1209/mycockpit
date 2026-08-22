import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronRight, GitBranch, Loader2, RefreshCw } from "lucide-react"
import {
  loadGitDiff,
  type CorteDoDiff,
  type DiffFile,
  type GitDiff,
} from "@/lib/git"
import { composeDiffComments, staleComments } from "@/lib/deliveryDiff"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { cn } from "@/lib/utils"
import { DiffLineRow, useDiffComments, type DiffCommentApi } from "./DiffPanel/comments"
import { FilePathLabel, STATUS_META } from "./DiffPanel/parts"
import { DiffCommentsFooter } from "./DiffPanel/sendBar"

// (M1) O "abrir no editor" vive no CABEÇALHO, um por painel, e abre o PROJETO.
// Nasceu como ícone por linha de arquivo, revertido em 20/08/2026: o hover
// pipocando em cada linha poluía a lista, e abrir o arquivo solto entregava uma
// janela órfã sem árvore nem language server. Quem quer ver a mudança usa o
// diff; quem vai ao editor quer o projeto aberto.
/** Painel de alterações: diff da working tree do `cwd` (v1: não-commitado vs HEAD +
 *  arquivos novos). Lista por arquivo, colapsável; expande pros hunks.
 *  `delivery` (P3 — Entrega→diff): o painel abriu pelo clique numa entrega —
 *  ganha o header de correção no topo (Pedir correção / Fechar). */
export function DiffPanel({
  cwd,
  focusPath,
  focusSeq,
  onSendToComposer,
}: {
  cwd: string
  /** Arquivo que a coluna pediu pra abrir. Chega expandido e com scroll até ele
   *  — sem isso, clicar num arquivo lá e cair no topo de uma lista de 11
   *   deixaria o clique sem resposta. */
  focusPath?: string
  /** Selo do pedido: muda mesmo quando o arquivo é o mesmo, pra o segundo
   *  clique na coluna rolar de novo em vez de virar no-op. */
  focusSeq?: number
  /** Prefill do composer com os comentários soltos no diff (gate humano — não
   *  envia sozinho, só propõe o texto composto). */
  onSendToComposer?: (text: string) => void
}) {
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(focusPath ? [focusPath] : []),
  )
  const focoRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const commentApi = useDiffComments()
  const commentCount = Object.keys(commentApi.comments).length

  function reload() {
    setLoading(true)
    void loadGitDiff(cwd).then((d) => {
      setDiff(d)
      setLoading(false)
    })
  }
  useEffect(() => {
    reload()
    // Trocar de `cwd` (outra conversa/worktree) INVALIDA os comentários: eles
    // são ancorados por caminho+linha do diff ANTERIOR, e mandar pro agente
    // "arquivo.ts:42" de OUTRO repositório é pior que perder o rascunho.
    commentApi.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // Pedido novo de foco (outro arquivo, com a aba já aberta): expande e rola.
  //
  // Move o `scrollTop` do NOSSO container, e não `scrollIntoView`. Não é
  // preciosismo: `scrollIntoView` rola todos os ancestrais roláveis, e
  // `overflow: hidden` (que o `body` e o cartão usam) NÃO impede scroll
  // programático — só esconde a barra. No build #241 isso empurrou a janela
  // inteira pra fora da vista, sem barra nenhuma pra trazer de volta. Mexendo
  // só no container, o estrago não tem como subir.
  useEffect(() => {
    if (!focusPath) return
    setOpen((s) => (s.has(focusPath) ? s : new Set(s).add(focusPath)))
    const cont = scrollerRef.current
    const alvo = focoRef.current
    if (!cont || !alvo) return
    cont.scrollTop += alvo.getBoundingClientRect().top - cont.getBoundingClientRect().top
  }, [focusPath, focusSeq, diff])

  const files = diff?.files ?? []
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)
  // Comentários que perderam a linha (o agente mexeu no arquivo e o reload
  // trouxe outro conteúdo): não somem, vão pra tira de órfãos do rodapé.
  const stale = staleComments(Object.values(commentApi.comments), files)

  // Barra STICKY (branch + stat + refresh): fica no topo enquanto a lista rola.
  // bg sólido (sem backdrop-blur, que custa por-frame e travaria o scroll longo).
  // `bg-card` porque o painel virou CARTÃO (ADR-043, Fase 2): barra sticky tem
  // que ocluir com a cor da própria superfície, senão vira uma faixa de outra
  // cor deslizando por cima do conteúdo. O hairline aqui FICA: ele separa zona
  // de ação de lista de dados, que é a exceção que a regra do §4 preserva.
  const bar = (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-4 py-2 text-[11px]">
      {diff?.branch ? (
        <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{diff.branch}</span>
        </span>
      ) : (
        <span className="text-muted-foreground/60">Alterações</span>
      )}
      <span className="ml-auto flex items-center gap-2 font-mono tabular-nums">
        {totalAdd > 0 && <span className="text-st-success">+{totalAdd}</span>}
        {totalDel > 0 && <span className="text-st-error">−{totalDel}</span>}
      </span>
      {/* Um por painel, ao lado do refresh: os dois são ação sobre o CONJUNTO,
          não sobre uma linha. `rel` vazio = a raiz — abre o projeto. */}
      <OpenInEditor projectPath={cwd} rel="" alvo="o projeto" />
      <button
        onClick={reload}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Atualizar diff"
        title="Atualizar"
      >
        <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading && !diff ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : !diff?.isRepo ? (
        <Empty>Este projeto não é um repositório git.</Empty>
      ) : (
        <>
          {/* scroll NATIVO (mais leve que o Radix ScrollArea com muitos itens). */}
          <div
            ref={scrollerRef}
            // Quando chega ao fim, a roda morre AQUI. Sem `overscroll-contain`,
            // o WKWebView entregou o restante do gesto ao grupo ancestral e
            // deslocou centro + contexto juntos (builds #242 e #243).
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
          {bar}
          {files.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
              Nenhuma alteração não-commitada. Working tree limpa.
            </div>
          ) : (
            <div className="flex flex-col pb-2">
              {files.map((f) => (
                <FileBlock
                  key={f.path}
                  file={f}
                  cwd={cwd}
                  open={open.has(f.path)}
                  onToggle={() =>
                    setOpen((s) => {
                      const n = new Set(s)
                      if (n.has(f.path)) n.delete(f.path)
                      else n.add(f.path)
                      return n
                    })
                  }
                  commentApi={commentApi}
                  refFoco={f.path === focusPath ? focoRef : undefined}
                />
              ))}
            </div>
          )}
          </div>
          <DiffCommentsFooter
            total={commentCount}
            stale={stale}
            onRemove={commentApi.remove}
            onDiscard={commentApi.clear}
            onSend={() => {
              const todos = Object.values(commentApi.comments)
              const staleIds = new Set(stale.map((c) => c.id))
              onSendToComposer?.(composeDiffComments(todos, staleIds))
              commentApi.clear()
            }}
          />
        </>
      )}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * O arquivo que o teto cortou (F1.4).
 *
 * Regra que desenha o componente: diff cortado tem que DIZER que foi cortado,
 * com o tamanho real e uma saída. Esconder mudança grande é o pior desfecho
 * possível num painel cuja função é mostrar o que mudou — pior que travar,
 * porque travar pelo menos é visível.
 *
 * Não oferece comentário, e diz por quê: comentário ancora em
 * `path@side:linha`, e sem linha renderizada não há onde ancorar. Deixar o
 * gesto disponível pra falhar calado seria fail-open.
 */
function DiffCortado({
  corte,
  cwd,
  path,
}: {
  corte: CorteDoDiff
  cwd: string
  path: string
}) {
  const mb = corte.chars / 1e6
  const porque =
    corte.motivo === "linhas"
      ? `${corte.linhas.toLocaleString("pt-BR")} linhas`
      : `linhas muito longas (${mb.toFixed(1)} MB em ${corte.linhas.toLocaleString("pt-BR")} linhas)`
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 bg-background/40 px-4 py-3">
      <p className="text-[12px] text-muted-foreground">
        Diff grande demais para desenhar aqui: {porque}. O painel travaria por
        segundos, então ele não foi renderizado. A mudança está lá, inteira.
      </p>
      <div className="flex items-center gap-3">
        <OpenInEditor projectPath={cwd} rel={path} alvo="o arquivo" />
        <span className="text-[11px] text-muted-foreground/60">
          Sem comentário neste arquivo: não há linha desenhada para ancorar.
        </span>
      </div>
    </div>
  )
}

function FileBlock({
  file,
  cwd,
  open,
  onToggle,
  commentApi,
  refFoco,
}: {
  file: DiffFile
  /** Raiz do projeto — só o arquivo CORTADO usa, pra oferecer a saída. */
  cwd: string
  open: boolean
  onToggle: () => void
  commentApi: DiffCommentApi
  /** Só o arquivo pedido pela coluna recebe: é a âncora do scroll. */
  refFoco?: React.RefObject<HTMLDivElement | null>
}) {
  const st = STATUS_META[file.status] ?? STATUS_META.modified
  return (
    <div ref={refFoco} className="border-b border-border/60">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          className={cn("shrink-0 font-mono text-[11px] font-bold", st.cls)}
          title={st.title}
        >
          {st.label}
        </span>
        <FilePathLabel path={file.path} />
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
          {file.additions > 0 && (
            <span className="text-st-success">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-st-error">−{file.deletions}</span>
          )}
        </span>
      </button>
      {open &&
        (file.binary ? (
          <p className="border-t border-border/60 bg-background/40 px-4 py-2 text-[12px] text-muted-foreground">
            Arquivo binário, sem diff de texto.
          </p>
        ) : file.cortado ? (
          <DiffCortado corte={file.cortado} cwd={cwd} path={file.path} />
        ) : (
          <div className="overflow-x-auto border-t border-border/60 bg-background/40 font-mono text-[12px] leading-[1.55]">
            {file.hunks.map((h, hi) => (
              <div key={hi}>
                <div className="bg-brass/[0.06] px-2 py-0.5 text-[11px] whitespace-pre text-muted-foreground/70">
                  {h.header}
                </div>
                {h.lines.map((ln, li) => (
                  <DiffLineRow
                    key={li}
                    ln={ln}
                    path={file.path}
                    api={commentApi}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
