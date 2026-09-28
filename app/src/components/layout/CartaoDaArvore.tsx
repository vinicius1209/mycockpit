// O cartão de hover da árvore de arquivos (docs/explorador-de-arquivos-prd.md,
// D2 e D2b), no lugar do `title` nativo. UM cartão para a árvore inteira,
// reposicionado na linha sob o mouse; nada por linha. Nada é lido antes de ele
// abrir (~500 ms), e o que foi lido fica em cache por caminho: passar rápido
// por vinte linhas não dispara leitura nenhuma.

import { useEffect, useRef, useState } from "react"
import { Link2 } from "lucide-react"
import { AgentLogo, agentLogoLabel } from "@/components/common/AgentLogo"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { controle } from "@/components/ui/controle"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/db"
import {
  haQuanto,
  lerDetalheDoCaminho,
  lerQuemAlterou,
  metaDoArquivo,
  quemAlterou,
  type CandidatoDeAlteracao,
  type DetalheDoCaminho,
} from "@/lib/detalheDoCaminho"
import { projectFilePreviewKind, urlDoArquivo } from "@/lib/projectFilePreview"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

const ATRASO_PARA_ABRIR = 500
/** Com o cartão aberto, trocar de linha espera menos: o gesto já foi feito. */
const ATRASO_PARA_TROCAR = 200
const ATRASO_PARA_FECHAR = 120

export interface LinhaSobOMouse {
  rel: string
  pasta: boolean
  ignorado: boolean
  aberto: boolean
  /** Itens da pasta, quando ela já foi carregada. */
  itens: number | null
}

interface Lido {
  detalhe: DetalheDoCaminho | null
  candidatos: CandidatoDeAlteracao[]
}

const cache = new Map<string, Lido>()

export function useCartaoDaArvore(root: string) {
  const [alvo, setAlvo] = useState<{ linha: LinhaSobOMouse; ret: DOMRect } | null>(null)
  const [aberto, setAberto] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const limpar = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => limpar, [])

  const fechar = () => {
    limpar()
    setAberto(false)
  }

  return {
    pairar(linha: LinhaSobOMouse, el: HTMLElement) {
      limpar()
      timer.current = setTimeout(
        () => {
          setAlvo({ linha, ret: el.getBoundingClientRect() })
          setAberto(true)
        },
        aberto ? ATRASO_PARA_TROCAR : ATRASO_PARA_ABRIR,
      )
    },
    sair() {
      limpar()
      timer.current = setTimeout(() => setAberto(false), ATRASO_PARA_FECHAR)
    },
    fechar,
    cartao: alvo && (
      <HoverCard open={aberto} onOpenChange={(v) => !v && fechar()}>
        <HoverCardTrigger asChild>
          {/* Âncora, não alvo: o cartão sai da linha, e a linha segue dona do mouse. */}
          <span
            aria-hidden
            className="pointer-events-none fixed block"
            style={{ left: alvo.ret.left, top: alvo.ret.top, width: alvo.ret.width, height: alvo.ret.height }}
          />
        </HoverCardTrigger>
        <HoverCardContent
          side="left"
          align="start"
          className="w-[300px] p-0"
          onPointerEnter={limpar}
          onPointerLeave={() => {
            limpar()
            timer.current = setTimeout(() => setAberto(false), ATRASO_PARA_FECHAR)
          }}
        >
          {aberto && <ConteudoDoCartao root={root} linha={alvo.linha} />}
        </HoverCardContent>
      </HoverCard>
    ),
  }
}

function ConteudoDoCartao({ root, linha }: { root: string; linha: LinhaSobOMouse }) {
  const chave = `${root}\0${linha.rel}`
  const [lido, setLido] = useState<Lido | null>(() => cache.get(chave) ?? null)
  const [dimensoes, setDimensoes] = useState<string | null>(null)
  const projeto = useApp((s) => s.activeProjectId)
  const conversaAtiva = useChat((s) => s.activeId)

  useEffect(() => {
    if (!isTauri()) return
    let vivo = true
    setLido(cache.get(chave) ?? null)
    void Promise.all([
      lerDetalheDoCaminho(root, linha.rel).catch(() => null),
      linha.pasta || !projeto ? Promise.resolve([]) : lerQuemAlterou(projeto, linha.rel).catch(() => []),
    ]).then(([detalhe, candidatos]) => {
      const novo = { detalhe, candidatos }
      cache.set(chave, novo)
      if (vivo) setLido(novo)
    })
    return () => {
      vivo = false
    }
  }, [chave, root, linha.rel, linha.pasta, projeto])

  const now = Date.now()
  const d = lido?.detalhe ?? null
  const imagem = !linha.pasta && ["image", "svg"].includes(projectFilePreviewKind(linha.rel))
  const quem = lido
    ? quemAlterou(lido.candidatos, { root, rel: linha.rel, conversaAtiva, alteradoEm: d?.alteradoEm ?? null })
    : null

  return (
    <div className="text-[12px] leading-relaxed text-muted-foreground">
      {imagem && (
        <div className="grid h-28 place-items-center overflow-hidden rounded-t-xl border-b border-border/40 bg-secondary/40">
          <img
            src={urlDoArquivo(root, linha.rel)}
            alt=""
            className="max-h-full max-w-full object-contain"
            onLoad={(e) => setDimensoes(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
          />
        </div>
      )}
      <div className="px-3 pt-2.5 pb-2.5">
        <p className="font-mono text-[11px] break-all text-foreground/90">
          {linha.rel}
          {linha.pasta ? "/" : ""}
        </p>
        <p className="mt-0.5">
          {linha.pasta
            ? linha.itens !== null
              ? `${linha.itens} ${linha.itens === 1 ? "item" : "itens"}`
              : "Pasta"
            : d
              ? metaDoArquivo(d, linha.rel, now, dimensoes)
              : "Lendo…"}
        </p>
        {(linha.ignorado || linha.aberto || d?.link) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2">
            {linha.aberto && <span>aberto numa aba</span>}
            {linha.ignorado && <span>ignorado pelo git</span>}
            {d?.link && (
              <span className="flex min-w-0 items-center gap-1">
                <Link2 className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono text-[11px]">{d.link}</span>
              </span>
            )}
          </p>
        )}
      </div>
      {quem && (quem.fora !== null || quem.linhas.length > 0) && (
        <div className="border-t border-border/40 px-3 pt-2 pb-2.5">
          <p className="mb-1 text-[11px] text-muted-foreground/70">Quem alterou</p>
          <ul className="flex flex-col gap-0.5">
            {quem.fora !== null && (
              <li className="flex h-7 items-center gap-2">
                <span className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-foreground/80">fora de uma conversa</span>
                <span className="shrink-0 text-[11px]">{haQuanto(quem.fora, now)}</span>
              </li>
            )}
            {quem.linhas.map((l) => (
              <li key={l.conversaId}>
                <button
                  type="button"
                  disabled={l.nesta}
                  onClick={() => {
                    useApp.getState().closeMainTab()
                    void useChat.getState().switchConversation(l.conversaId)
                  }}
                  className={cn(controle("compacto"), "w-full justify-start gap-2 px-0 text-left enabled:hover:text-foreground disabled:cursor-default")}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center">
                    <AgentLogo agent={l.motor} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-foreground/80">{agentLogoLabel(l.motor)}</span>
                    {" · "}
                    {l.nesta ? "nesta conversa" : (l.titulo ?? "outra conversa")}
                  </span>
                  <span className="shrink-0 text-[11px]">{haQuanto(l.quando, now)}</span>
                </button>
              </li>
            ))}
          </ul>
          {quem.mais > 0 && (
            <p className="mt-1 text-[11px]">
              e mais {quem.mais} {quem.mais === 1 ? "conversa" : "conversas"}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const LEGENDA = { M: "modificado", A: "novo", U: "não rastreado", D: "apagado" } as const

/** O sinal à direita da linha (D3): a letra de git em cinza, no lugar do ponto
 *  de "aberto numa aba" quando os dois coexistem; na pasta, um ponto se algum
 *  filho mudou. Sem cor: verde e vermelho são do diff. */
export function SinalDaLinha({
  letra,
  aberto,
  selecionada,
  pastaMudada,
}: {
  letra: keyof typeof LEGENDA | undefined
  aberto: boolean
  selecionada: boolean
  pastaMudada: boolean
}) {
  if (letra)
    return (
      <span aria-label={LEGENDA[letra]} className="w-3 shrink-0 text-center font-mono text-[11px] text-muted-foreground/70">
        {letra}
      </span>
    )
  if (aberto || pastaMudada)
    return (
      <span
        aria-label={aberto ? "Aberto numa aba" : "Algo mudou aqui dentro"}
        className={
          aberto
            ? `size-1.5 shrink-0 rounded-full ${selecionada ? "bg-foreground" : "bg-muted-foreground/70"}`
            : "size-1 shrink-0 rounded-full bg-muted-foreground/50"
        }
      />
    )
  return null
}
