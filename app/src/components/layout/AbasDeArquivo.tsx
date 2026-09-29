// As abas de arquivo na tira do painel principal (ADR-243, mock aprovado em
// docs/mocks/abas-de-arquivo-persistentes.html).
//
// Ficam abertas até a pessoa fechar, uma por arquivo, depois da Conversa e de
// um filete. O ícone é o mesmo da árvore (ADR-241). A aba do arquivo que está
// ao lado da conversa leva o ícone de "lado" em vez do de tipo.

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Columns2, FileDiff, GitCommit, PanelRightClose, RotateCcw, X } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileIcon } from "@/components/ui/file-icon"
import { indiceDeSoltura } from "@/components/chat/FilaDoComposer"
import {
  abrirAoLado,
  fecharArquivos,
  fecharOLado,
  mostrar,
  reabrirUltima,
} from "@/components/layout/abasNoPrincipal"
import { rotuloDoAtalho } from "@/components/layout/atalhosDasAbas"
import { aDireitaDe, lerChave, outrasAlemDe, rotulosDasAbas } from "@/lib/abasDeArquivo"
import { currentPlatform } from "@/lib/commandMenu"
import { cn } from "@/lib/utils"
import { abasDo, chaveDoSumido, useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useEdicao } from "@/store/edicao"
import { caminhoDaAba } from "@/lib/edicao/buffers"
import { useRaizEfetiva } from "@/components/layout/raizEfetiva"
import { LinhasDoMenuDeArquivo } from "@/components/layout/MenuDeArquivo"
import { useAlteradosNoGit } from "@/components/layout/useAlteradosNoGit"
import { executarAcaoDeArquivo } from "@/components/common/executarAcaoDeArquivo"
import { itensDoArquivo, type AlvoDeArquivo } from "@/lib/acoesDeArquivo"
import { isTauri } from "@/lib/db"

const ATALHO = "ml-auto pl-4 font-mono text-[11px] text-muted-foreground/60"

function useAbasDaConversa() {
  const convId = useChat((s) => s.activeId)
  const abas = useAbasDeArquivo((s) => abasDo(s, convId))
  return { convId, abas }
}

export function AbasDeArquivo({ vista }: { vista: string | null }) {
  const { convId, abas } = useAbasDaConversa()
  const sumidos = useAbasDeArquivo((s) => s.sumidos)
  const ladoCabe = useAbasDeArquivo((s) => s.ladoCabe)
  const temFechada = useAbasDeArquivo((s) => (convId ? (s.fechadas[convId]?.length ?? 0) > 0 : false))
  const conversaAVista = useApp((s) => s.mainTab.kind === "conversa")
  const [arrasto, setArrasto] = useState<{ de: number; para: number; x0: number; ativo: boolean } | null>(null)
  const refs = useRef<(HTMLElement | null)[]>([])
  const acabouDeArrastar = useRef(false)
  const plataforma = currentPlatform()
  // O ponto de "não salvo": o buffer é por arquivo, e a aba chega nele pela raiz.
  const sujos = useEdicao((s) => s.sujos)
  const raiz = useRaizEfetiva()
  const alterados = useAlteradosNoGit(raiz)

  // A aba à vista entra na área visível da tira. À mão, e não com
  // `scrollIntoView`, que rolaria também os ancestrais (ADR-122).
  useEffect(() => {
    const i = vista ? abas.abertas.indexOf(vista) : -1
    const el = refs.current[i]
    const lista = el?.parentElement
    if (!el || !lista) return
    if (el.offsetLeft < lista.scrollLeft) lista.scrollLeft = el.offsetLeft - 8
    else if (el.offsetLeft + el.offsetWidth > lista.scrollLeft + lista.clientWidth)
      lista.scrollLeft = el.offsetLeft + el.offsetWidth - lista.clientWidth + 8
  }, [vista, abas.abertas])

  if (!convId || abas.abertas.length === 0) return null
  const rotulos = rotulosDasAbas(abas.abertas)

  const soltar = () => {
    if (arrasto?.ativo) {
      acabouDeArrastar.current = true
      if (arrasto.de !== arrasto.para) useAbasDeArquivo.getState().mover(convId, arrasto.de, arrasto.para)
    }
    setArrasto(null)
  }

  return (
    <>
      <span aria-hidden className="mx-1 h-4 shrink-0 border-l border-border/40" />
      {abas.abertas.map((chave, i) => {
        // A aba é um arquivo aberto para ler, as ALTERAÇÕES de um arquivo, ou
        // um commit do histórico.
        const info = lerChave(chave)
        const diff = info.tipo === "diff"
        const commit = info.tipo === "commit"
        const caminho = info.tipo === "commit" ? info.caminho ?? "" : info.caminho
        const rotulo = rotulos.get(chave) ?? { nome: caminho || "commit", pasta: null }
        const aoLado = ladoCabe && abas.aoLado === chave
        const ativa = vista === chave
        const sumiu = Boolean(sumidos[chaveDoSumido(convId, chave)])
        const suja = !diff && !commit && raiz !== null && Boolean(sujos[caminhoDaAba(raiz, chave) ?? ""])
        const alvo = arrasto?.ativo && arrasto.para === i && arrasto.de !== i
        const doMenu: AlvoDeArquivo = { tipo: "arquivo", rel: caminho, fora: caminho.startsWith("/") }
        return (
          <ContextMenu key={chave}>
            <ContextMenuTrigger asChild>
              <div
                ref={(el) => {
                  refs.current[i] = el
                }}
                className={cn(
                  "group/aba flex h-[26px] shrink-0 items-center rounded-md transition-colors",
                  ativa
                    ? "bg-sel"
                    : aoLado && conversaAVista
                      ? "bg-st-running/10"
                      : "hover:bg-sel-hover",
                  arrasto?.ativo && arrasto.de === i && "opacity-50",
                  alvo && "bg-sel-hover",
                )}
              >
                <button
                  role="tab"
                  aria-selected={ativa}
                  title={
                    commit
                      ? info.caminho
                        ? `Alterações em ${info.caminho} no commit ${info.commitHash}`
                        : `Commit ${info.commitHash}`
                      : diff
                        ? `Alterações em ${caminho}`
                        : aoLado
                          ? `${caminho} (ao lado da conversa)`
                          : caminho
                  }
                  onClick={() => {
                    if (acabouDeArrastar.current) {
                      acabouDeArrastar.current = false
                      return
                    }
                    mostrar(chave)
                  }}
                  // Clique do meio fecha, como nas IDEs e nos navegadores.
                  onAuxClick={(e) => {
                    if (e.button === 1) fecharArquivos([chave])
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || abas.abertas.length < 2) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setArrasto({ de: i, para: i, x0: e.clientX, ativo: false })
                  }}
                  onPointerMove={(e) => {
                    if (!arrasto) return
                    if (!arrasto.ativo && Math.abs(e.clientX - arrasto.x0) < 5) return
                    const meios = refs.current.slice(0, abas.abertas.length).map((el) => {
                      const r = el?.getBoundingClientRect()
                      return r ? r.left + r.width / 2 : 0
                    })
                    const para = Math.min(indiceDeSoltura(e.clientX, meios), abas.abertas.length - 1)
                    if (!arrasto.ativo || para !== arrasto.para) setArrasto({ ...arrasto, ativo: true, para })
                  }}
                  onPointerUp={soltar}
                  onPointerCancel={() => setArrasto(null)}
                  className={cn(
                    "flex h-full items-center gap-1.5 rounded-md pr-1 pl-2 text-[11px] font-medium transition-colors",
                    ativa || (aoLado && conversaAVista)
                      ? "text-foreground"
                      : "text-muted-foreground/50 group-hover/aba:text-muted-foreground",
                  )}
                >
                  {aoLado ? (
                    <Columns2 className="size-3.5 shrink-0 text-st-running" />
                  ) : commit ? (
                    <GitCommit className={cn("size-3.5 shrink-0", !ativa && "opacity-70 group-hover/aba:opacity-100")} />
                  ) : diff ? (
                    <FileDiff className={cn("size-3.5 shrink-0", !ativa && "opacity-70 group-hover/aba:opacity-100")} />
                  ) : (
                    <FileIcon path={caminho} size={14} className={cn(!ativa && "opacity-70 group-hover/aba:opacity-100")} />
                  )}
                  <span className={cn("max-w-[180px] truncate", sumiu && "text-muted-foreground/60 line-through")}>
                    {rotulo.nome}
                    {rotulo.pasta && <span className="font-normal text-muted-foreground/60"> · {rotulo.pasta}</span>}
                  </span>
                </button>
                <button
                  onClick={() => fecharArquivos([chave])}
                  title={suja ? `Fechar ${rotulo.nome} (alterações não salvas)` : `Fechar ${rotulo.nome}`}
                  aria-label={suja ? `Fechar ${rotulo.nome} (alterações não salvas)` : `Fechar ${rotulo.nome}`}
                  className={cn(
                    "mr-1 rounded p-0.5 transition-colors hover:!text-foreground focus-visible:text-muted-foreground/60",
                    ativa || suja ? "text-muted-foreground/60" : "text-transparent group-hover/aba:text-muted-foreground/60",
                  )}
                >
                  {suja ? (
                    <>
                      {/* A mesma caixa do X (o nome não anda). O ponto tem 7px,
                          e não 6, por ajuste ÓPTICO: pesa o mesmo que o X ao lado.
                          No hover o X volta, e fechar segue a um clique. */}
                      <span aria-hidden className="grid size-3 place-items-center group-hover/aba:hidden">
                        <span className="size-[7px] rounded-full bg-foreground/80" />
                      </span>
                      <X className="hidden size-3 group-hover/aba:block" />
                    </>
                  ) : (
                    <X className="size-3" />
                  )}
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()} className="w-64">
              {diff || commit ? null : aoLado ? (
                <ContextMenuItem onSelect={fecharOLado}>
                  <PanelRightClose /> Tirar do lado da conversa
                </ContextMenuItem>
              ) : (
                <ContextMenuItem
                  disabled={!ladoCabe}
                  title={ladoCabe ? undefined : "O cartão está estreito demais para dois"}
                  onSelect={() => abrirAoLado(chave)}
                >
                  <Columns2 /> Abrir ao lado da conversa
                </ContextMenuItem>
              )}
              {!diff && !commit && <ContextMenuSeparator />}
              {/* O resto vem do catálogo de arquivo, o mesmo da árvore e do fio. */}
              {!commit && (
                <LinhasDoMenuDeArquivo
                  linhas={itensDoArquivo(
                    doMenu,
                    { noApp: isTauri(), conversa: true, ladoCabe, alterado: !diff && alterados.has(caminho), expandida: false },
                    "aba",
                  )}
                  alvo={doMenu}
                  aoEscolher={(acao) => setTimeout(() => void executarAcaoDeArquivo(acao, doMenu, { root: raiz ?? "" }), 0)}
                  Item={ContextMenuItem}
                  Separador={ContextMenuSeparator}
                />
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => fecharArquivos([chave])}>
                Fechar
                {ativa && <span className={ATALHO}>{rotuloDoAtalho("fechar", plataforma)}</span>}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={abas.abertas.length < 2}
                onSelect={() => fecharArquivos(outrasAlemDe(abas.abertas, chave))}
              >
                Fechar as outras
              </ContextMenuItem>
              <ContextMenuItem
                disabled={i === abas.abertas.length - 1}
                onSelect={() => fecharArquivos(aDireitaDe(abas.abertas, chave))}
              >
                Fechar as da direita
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => fecharArquivos(abas.abertas)}>Fechar todas</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={!temFechada} onSelect={reabrirUltima}>
                <RotateCcw /> Reabrir a última fechada
                <span className={ATALHO}>{rotuloDoAtalho("reabrir", plataforma)}</span>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </>
  )
}

/** "5 ⌄": todas as abas abertas, quando a tira não mostra todas. */
export function TodasAsAbas({ vista }: { vista: string | null }) {
  const { convId, abas } = useAbasDaConversa()
  const plataforma = currentPlatform()
  if (!convId || abas.abertas.length === 0) return null
  const rotulos = rotulosDasAbas(abas.abertas)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Todas as abas abertas"
          aria-label={`Todas as abas abertas (${abas.abertas.length})`}
          className="flex h-[26px] shrink-0 items-center gap-0.5 rounded-md px-1.5 font-mono text-[11px] text-muted-foreground/70 tabular-nums outline-none transition-colors hover:bg-sel-hover hover:text-foreground data-[state=open]:bg-sel data-[state=open]:text-foreground"
        >
          {abas.abertas.length}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Abertas nesta conversa
        </DropdownMenuLabel>
        {abas.abertas.map((chave, i) => {
          const info = lerChave(chave)
          const commit = info.tipo === "commit"
          const diff = info.tipo === "diff"
          const caminho = info.tipo === "commit" ? info.caminho ?? "" : info.caminho
          const rotulo = rotulos.get(chave) ?? { nome: caminho || "commit", pasta: null }
          return (
            <DropdownMenuItem
              key={chave}
              onSelect={() => mostrar(chave)}
              className={cn("text-[12px]", vista === chave && "bg-sel")}
              title={
                commit
                  ? info.caminho
                    ? `Alterações em ${info.caminho} no commit ${info.commitHash}`
                    : `Commit ${info.commitHash}`
                  : diff
                    ? `Alterações em ${caminho}`
                    : caminho
              }
            >
              {commit ? <GitCommit /> : diff ? <FileDiff /> : <FileIcon path={caminho} size={14} />}
              <span className="min-w-0 truncate">
                {rotulo.nome}
                {rotulo.pasta && <span className="text-muted-foreground/60"> · {rotulo.pasta}</span>}
              </span>
              {i < 8 && (
                <DropdownMenuShortcut className="pl-3 font-mono text-[11px] tracking-normal">
                  {rotuloDoAtalho(i + 2, plataforma)}
                </DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator className="bg-border/40" />
        <DropdownMenuItem onSelect={() => fecharArquivos(abas.abertas)} className="text-[12px]">
          Fechar todas
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
