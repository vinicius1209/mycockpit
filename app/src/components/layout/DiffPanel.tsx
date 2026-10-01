import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommit,
  Loader2,
  MessageSquare,
  MessageSquareQuote,
  RefreshCw,
} from "lucide-react"
import {
  loadGitDiff,
  type CorteDoDiff,
  type DiffFile,
  type GitDiff,
} from "@/lib/git"
import { composeDiffComments, staleComments } from "@/lib/deliveryDiff"
import { galeriaDoDiff, imagemDoDiffVisivel } from "@/lib/diffImagem"
import { esquecerImagensCitadas } from "@/lib/imagemCitada"
import type { LightboxImage } from "@/store/lightbox"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { DiffLineRow, useDiffComments, type DiffCommentApi } from "./DiffPanel/comments"
import { chaveDosComentarios } from "@/store/comentariosDoDiff"
import { useChat } from "@/store/chat"
import { FilePathLabel, STATUS_META } from "./DiffPanel/parts"
import { detectLanguage } from "@/lib/syntaxHighlight"
import { DiffCommentsFooter } from "./DiffPanel/sendBar"
import { DiffImagem } from "./DiffPanel/imagem"
import {
  detalhesDoCommit,
  loadCommitDiff,
  remoteUrl,
  urlDoCommitNaWeb,
  type DetalhesDoCommit,
} from "@/lib/gitSync"
import { avisar } from "@/lib/avisos"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  if (partes.length === 0 || !partes[0]) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

// O "abrir no editor" vive no cabeçalho e abre o projeto completo com LSP.
/** Painel de alterações: diff da working tree do `cwd` (v1: não-commitado vs HEAD +
 *  arquivos novos) ou de um commit específico. Lista por arquivo, colapsável; expande pros hunks. */
export function DiffPanel({
  cwd,
  focusPath,
  focusSeq,
  soArquivo,
  commitHash,
  onSendToComposer,
}: {
  cwd: string
  /** Mostra só este arquivo, aberto: é a aba das alterações dele (ADR-248). */
  soArquivo?: string
  /** Arquivo que a coluna pediu pra abrir. Chega expandido e com scroll até ele */
  focusPath?: string
  /** Selo do pedido: muda mesmo quando o arquivo é o mesmo. */
  focusSeq?: number
  /** Commit específico a inspecionar. */
  commitHash?: string
  /** Prefill do composer com comentários ou pedido de análise ao agente. */
  onSendToComposer?: (text: string) => void
}) {
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [detalhes, setDetalhes] = useState<DetalhesDoCommit | null>(null)
  const [remoto, setRemoto] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Selo da recarga: a imagem expandida relê o disco quando ele muda.
  const [versao, setVersao] = useState(0)
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(focusPath ? [focusPath] : []),
  )
  const focoRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // Os comentários são da conversa nesta pasta, e sobrevivem a trocar de aba
  // (ADR-251). Mudar de `cwd` é mudar de chave: comentário ancorado no diff de
  // outro repositório não aparece aqui nem vai para o agente.
  const convId = useChat((s) => s.activeId)
  const commentApi = useDiffComments(chaveDosComentarios(convId, cwd))
  const commentCount = Object.keys(commentApi.comments).length

  function reload() {
    setLoading(true)
    if (commitHash) {
      void Promise.all([
        loadCommitDiff(cwd, commitHash),
        detalhesDoCommit(cwd, commitHash).catch(() => null),
        remoteUrl(cwd).catch(() => null),
      ]).then(([d, det, rem]) => {
        esquecerImagensCitadas(cwd)
        setDiff(d)
        setDetalhes(det)
        if (rem) setRemoto(rem)
        setVersao((v) => v + 1)
        setLoading(false)
        if (d && d.files.length > 0) {
          setOpen(new Set(focusPath ? [focusPath] : d.files.map((f) => f.path)))
        }
      })
    } else {
      void loadGitDiff(cwd).then((d) => {
        esquecerImagensCitadas(cwd)
        setDiff(d)
        setDetalhes(null)
        setVersao((v) => v + 1)
        setLoading(false)
      })
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, commitHash])

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

  const todos = diff?.files ?? []
  const files = soArquivo ? todos.filter((f) => f.path === soArquivo) : todos
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)
  // Comentários que perderam a linha (o agente mexeu no arquivo e o reload
  // trouxe outro conteúdo): não somem, vão pra tira de órfãos do rodapé.
  // Contra o diff INTEIRO: na aba de um arquivo, o comentário de outro não é
  // órfão, só não é daqui.
  const stale = staleComments(Object.values(commentApi.comments), todos)
  const galeria = galeriaDoDiff(files, cwd)

  const todosAbertos = files.length > 0 && files.every((f) => open.has(f.path))
  function alternarTodos() {
    if (todosAbertos) {
      setOpen(new Set())
    } else {
      setOpen(new Set(files.map((f) => f.path)))
    }
  }

  // Barra STICKY (branch + stat + refresh): fica no topo enquanto a lista rola.
  // bg sólido (sem backdrop-blur, que custa por-frame e travaria o scroll longo).
  // `bg-card` porque o painel virou CARTÃO (ADR-043, Fase 2): barra sticky tem
  // que ocluir com a cor da própria superfície, senão vira uma faixa de outra
  // cor deslizando por cima do conteúdo. O hairline aqui FICA: ele separa zona
  // de ação de lista de dados, que é a exceção que a regra do §4 preserva.
  const bar = (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-4 py-2 text-[11px]">
      {commitHash ? (
        <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
          <GitCommit className="size-3 shrink-0" />
          <span className="truncate">commit {commitHash.slice(0, 7)}</span>
        </span>
      ) : diff?.branch ? (
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
      {files.length > 1 && (
        <button
          type="button"
          onClick={alternarTodos}
          className={cn(
            controle("chip"),
            "text-muted-foreground hover:text-foreground",
          )}
          title={todosAbertos ? "Recolher todos os arquivos" : "Expandir todos os arquivos"}
        >
          {todosAbertos ? "Recolher todos" : "Expandir todos"}
        </button>
      )}
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
          {detalhes && (
            <CommitHeaderCard
              det={detalhes}
              remoto={remoto}
              onPedirAnalise={() => {
                if (!onSendToComposer) return
                const lista = detalhes.arquivos
                  .map(
                    (a) =>
                      `- ${a.caminho} (${a.status}${a.binario ? ", binário" : `, +${a.additions} −${a.deletions}`})`,
                  )
                  .join("\n")
                const prompt = `Por favor, analise as alterações do commit ${detalhes.curto} ("${detalhes.mensagem}"):\n\nArquivos modificados:\n${lista}\n\nIdentifique possíveis regressões, impactos e pontos de atenção.`
                onSendToComposer(prompt)
              }}
            />
          )}
          {files.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
              {commitHash
                ? "Este commit não possui alterações de arquivo visíveis."
                : soArquivo
                  ? `${soArquivo} não tem alterações agora: foi commitado, revertido ou saiu do disco.`
                  : "Nenhuma alteração não-commitada. Working tree limpa."}
            </div>
          ) : (
            <div className="flex flex-col pb-2">
              {files.map((f) => (
                <FileBlock
                  key={f.path}
                  file={f}
                  cwd={cwd}
                  galeria={galeria}
                  versao={versao}
                  open={f.path === soArquivo || open.has(f.path)}
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
                  onSendToComposer={onSendToComposer}
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
  galeria,
  versao,
  open,
  onToggle,
  commentApi,
  refFoco,
  onSendToComposer,
}: {
  file: DiffFile
  /** Raiz do projeto: o arquivo CORTADO oferece a saída, a imagem lê por ela. */
  cwd: string
  galeria: LightboxImage[]
  versao: number
  open: boolean
  onToggle: () => void
  commentApi: DiffCommentApi
  /** Só o arquivo pedido pela coluna recebe: é a âncora do scroll. */
  refFoco?: React.RefObject<HTMLDivElement | null>
  onSendToComposer?: (text: string) => void
}) {
  const st = STATUS_META[file.status] ?? STATUS_META.modified
  const lang = detectLanguage(file.path)
  return (
    <div ref={refFoco} className="border-b border-border/60">
      <div className="group/file flex w-full items-center gap-2 px-4 py-1.5 transition-colors hover:bg-accent/40">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
        </button>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/file:opacity-100">
          <button
            type="button"
            onClick={() => void copyText(file.path, "Caminho copiado")}
            title="Copiar caminho"
            aria-label="Copiar caminho"
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Copy className="size-3" />
          </button>
          {onSendToComposer && (
            <button
              type="button"
              onClick={() => onSendToComposer(`Sobre o arquivo \`${file.path}\`:\n`)}
              title="Citar arquivo no chat"
              aria-label="Citar arquivo no chat"
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <MessageSquareQuote className="size-3" />
            </button>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
          {file.additions > 0 && (
            <span className="text-st-success">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-st-error">−{file.deletions}</span>
          )}
        </span>
      </div>
      {open &&
        (imagemDoDiffVisivel(file) ? (
          <DiffImagem cwd={cwd} file={file} galeria={galeria} versao={versao} />
        ) : file.binary ? (
          <p className="border-t border-border/60 bg-background/40 px-4 py-2 text-[12px] text-muted-foreground">
            Arquivo binário, sem diff de texto.
          </p>
        ) : file.cortado ? (
          <DiffCortado corte={file.cortado} cwd={cwd} path={file.path} />
        ) : (
          <div
            data-selectable
            className="overflow-x-auto border-t border-border/60 bg-background/40 font-mono text-[12px] leading-[1.55] select-text"
          >
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
                    lang={lang}
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

function CommitHeaderCard({
  det,
  remoto,
  onPedirAnalise,
}: {
  det: DetalhesDoCommit
  remoto: string | null
  onPedirAnalise: () => void
}) {
  const commitUrl = urlDoCommitNaWeb(remoto, det.hash)

  async function copiarSha() {
    await copyText(det.hash)
    avisar.feito("SHA copiado para a área de transferência.")
  }

  async function abrirNoNavegador() {
    if (!commitUrl) return
    await openUrl(commitUrl).catch(() => avisar.erro("Não consegui abrir o link no navegador."))
  }

  return (
    <div className="border-b border-border/40 bg-secondary/20 p-4 text-[12px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-foreground leading-snug">
            {det.mensagem}
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={copiarSha}
              title="Clique para copiar o SHA completo"
              className={cn(
                controle("chip"),
                "font-mono text-[11px] gap-1.5 border border-border/40 bg-card text-foreground hover:bg-accent",
              )}
            >
              <span>{det.curto}</span>
              <Copy className="size-3 text-muted-foreground" />
            </button>
            {commitUrl && (
              <Button
                type="button"
                variant="ghost"
                size="chip"
                onClick={abrirNoNavegador}
                title="Ver commit no GitHub"
              >
                <ExternalLink className="size-3" />
                GitHub
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="chip"
              onClick={onPedirAnalise}
              title="Enviar resumo deste commit para o rascunho da conversa"
            >
              <MessageSquare className="size-3" />
              Analisar com agente
            </Button>
          </div>
        </div>

        {det.corpo && (
          <div className="w-full rounded border border-border/40 bg-card p-3 text-[12px] text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">
            {det.corpo}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-muted-foreground border-t border-border/40 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span className="flex size-4 items-center justify-center rounded-full bg-secondary font-mono text-[11px] font-medium text-muted-foreground">
            {iniciais(det.autor)}
          </span>
          <span className="font-medium text-foreground">{det.autor}</span>
          {det.autorEmail && (
            <span className="opacity-70">&lt;{det.autorEmail}&gt;</span>
          )}
        </div>
        <span>·</span>
        <span>{new Date(det.quando).toLocaleString("pt-BR")}</span>
        {det.pais.length > 0 && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
            Parent: {det.pais.map((p) => p.slice(0, 7)).join(", ")}
          </span>
        )}
      </div>
    </div>
  </div>
)
}
