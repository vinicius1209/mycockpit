// O Histórico, recolhido no fim da aba Alterações: os últimos commits da branch
// com os ainda não enviados marcados, busca local, acordeão inline com arquivos
// modificados e navegação para o diff (docs/historico-git-detalhes-prd.md). Só
// lê quando abre, e relê quando a branch muda de posição.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Search,
  Undo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { avisar } from "@/lib/avisos"
import { copyText } from "@/lib/clipboard"
import { confirm } from "@/lib/confirm"
import {
  comoErroDeGit,
  desfazerUltimoCommit,
  detalhesDoCommit,
  historico,
  quandoDaBranch,
  remoteUrl,
  urlDoCommitNaWeb,
  type CommitDoHistorico,
  type DetalhesDoCommit,
} from "@/lib/gitSync"
import { avisarGravacao } from "@/lib/sinaisDoDisco"
import { openUrl } from "@tauri-apps/plugin-opener"
import { GitSection } from "./GitSection"
import { STATUS_META } from "./parts"
import { controle } from "@/components/ui/controle"
import { cn } from "@/lib/utils"

const PASSO = 20

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  if (partes.length === 0 || !partes[0]) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

export function HistoricoGit({
  cwd,
  versao,
  activeCommitHash,
  onSelectCommit,
}: {
  cwd: string
  versao: string
  activeCommitHash?: string
  onSelectCommit?: (hash: string, caminho?: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [quantos, setQuantos] = useState(PASSO)
  const [commits, setCommits] = useState<CommitDoHistorico[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState("")
  const [expandido, setExpandido] = useState<string | null>(null)
  const [detalhesMap, setDetalhesMap] = useState<Record<string, DetalhesDoCommit>>({})
  const [carregandoDetalhes, setCarregandoDetalhes] = useState<string | null>(null)
  const [remoto, setRemoto] = useState<string | null>(null)
  const epoca = useRef(0)

  useEffect(() => {
    if (!aberto) return
    const minha = ++epoca.current
    void remoteUrl(cwd).then(setRemoto).catch(() => setRemoto(null))
    historico(cwd, quantos)
      .then((c) => {
        if (epoca.current !== minha) return
        setCommits(c)
        setErro(null)
      })
      .catch((e) => {
        if (epoca.current === minha) setErro(comoErroDeGit(e).detalhe)
      })
  }, [aberto, cwd, quantos, versao])

  async function desfazer(c: CommitDoHistorico) {
    const ok = await confirm({
      title: "Desfazer o último commit?",
      description: `"${c.mensagem}" deixa de ser commit, e as alterações dele voltam para a área de trabalho, preparadas.`,
      confirmLabel: "Desfazer commit",
    })
    if (!ok) return
    try {
      await desfazerUltimoCommit(cwd)
      avisar.feito(`Commit ${c.curto} desfeito`)
      avisarGravacao(cwd)
    } catch (e) {
      avisar.erro("Não consegui desfazer o commit.", { detalhe: comoErroDeGit(e).detalhe })
    }
  }

  async function toggleExpandir(hash: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (expandido === hash) {
      setExpandido(null)
      return
    }
    setExpandido(hash)
    if (!detalhesMap[hash]) {
      setCarregandoDetalhes(hash)
      try {
        const det = await detalhesDoCommit(cwd, hash)
        setDetalhesMap((prev) => ({ ...prev, [hash]: det }))
      } catch (e) {
        avisar.erro("Não consegui ler os detalhes do commit.", { detalhe: comoErroDeGit(e).detalhe })
      } finally {
        setCarregandoDetalhes(null)
      }
    }
  }

  const now = Date.now()
  const ultimo = commits?.[0]

  const filtrados = useMemo(() => {
    if (!commits) return null
    const q = busca.trim().toLowerCase()
    if (!q) return commits
    return commits.filter(
      (c) =>
        c.mensagem.toLowerCase().includes(q) ||
        c.autor.toLowerCase().includes(q) ||
        c.curto.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q),
    )
  }, [commits, busca])

  return (
    <GitSection title="Histórico" isOpen={aberto} onToggle={() => setAberto((a) => !a)}>
      {erro ? (
        <p className="px-3 py-1.5 text-[12px] text-muted-foreground">{erro}</p>
      ) : commits === null ? (
        <p className="px-3 py-1.5 text-[12px] text-muted-foreground">Lendo…</p>
      ) : commits.length === 0 ? (
        <p className="px-3 py-1.5 text-[12px] text-muted-foreground">Nenhum commit ainda.</p>
      ) : (
        <>
          {commits.length > 3 && (
            <div className="px-3 pt-1 pb-1.5">
              <div className="flex h-[26px] items-center gap-1.5 rounded-md border border-border/40 bg-secondary/50 px-2 text-[11px] text-muted-foreground focus-within:border-border focus-within:bg-background">
                <Search className="size-3 shrink-0 opacity-60" />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar por mensagem, autor ou hash…"
                  className="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none text-[11px]"
                />
                {busca && (
                  <button
                    type="button"
                    onClick={() => setBusca("")}
                    className="rounded p-0.5 hover:text-foreground"
                    aria-label="Limpar filtro"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {filtrados && filtrados.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">
              Nenhum commit encontrado para "{busca}".
            </p>
          ) : (
            <ul>
              {filtrados?.map((c) => {
                const ativo = activeCommitHash === c.hash
                const isExpandido = expandido === c.hash
                return (
                  <li key={c.hash} className="flex flex-col border-b border-border/40 last:border-b-0">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectCommit?.(c.hash)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onSelectCommit?.(c.hash)
                        }
                      }}
                      title={`${c.mensagem}\n${c.autor} · ${new Date(c.quando).toLocaleString("pt-BR")}`}
                      className={cn(
                        controle("compacto"),
                        "group w-full justify-start gap-1.5 px-3 cursor-pointer select-none text-left",
                        ativo ? "bg-sel font-medium" : "hover:bg-sel-hover",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => void toggleExpandir(c.hash, e)}
                        className={cn(
                          controle("chip", { quadrado: true }),
                          "text-muted-foreground hover:text-foreground shrink-0",
                        )}
                        aria-label={isExpandido ? "Recolher detalhes do commit" : "Expandir detalhes do commit"}
                        aria-expanded={isExpandido}
                      >
                        {isExpandido ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                      </button>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.curto}</span>
                      <span
                        className="shrink-0 flex size-4 items-center justify-center rounded-full bg-secondary font-mono text-[11px] text-muted-foreground"
                        title={c.autor}
                      >
                        {iniciais(c.autor)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground/90">{c.mensagem}</span>
                      {c.naoEnviado ? (
                        <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[11px] text-foreground/80">
                          não enviado
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {quandoDaBranch({ quando: c.quando, atual: false }, now)}
                        </span>
                      )}
                    </div>

                    {isExpandido && (
                      <div className="flex flex-col gap-2 bg-secondary/30 px-3 py-2 pl-8 text-[11px] border-t border-border/40">
                        {carregandoDetalhes === c.hash && !detalhesMap[c.hash] ? (
                          <p className="text-muted-foreground">Lendo detalhes…</p>
                        ) : detalhesMap[c.hash] ? (
                          <DetalhesDoCommitInline
                            det={detalhesMap[c.hash]}
                            remoto={remoto}
                            onAbrirDiff={() => onSelectCommit?.(c.hash)}
                            onAbrirArquivo={(p) => onSelectCommit?.(c.hash, p)}
                          />
                        ) : null}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex items-center gap-1.5 px-3 pt-1">
            {ultimo?.naoEnviado && commits.length > 1 && (
              <Button type="button" variant="ghost" size="chip" onClick={() => void desfazer(ultimo)}>
                <Undo2 />
                Desfazer último commit
              </Button>
            )}
            {commits.length >= quantos && quantos < 200 && (
              <Button
                type="button"
                variant="ghost"
                size="chip"
                className="ml-auto text-muted-foreground"
                onClick={() => setQuantos((q) => q + PASSO)}
              >
                Ver mais
              </Button>
            )}
          </div>
        </>
      )}
    </GitSection>
  )
}

function DetalhesDoCommitInline({
  det,
  remoto,
  onAbrirDiff,
  onAbrirArquivo,
}: {
  det: DetalhesDoCommit
  remoto: string | null
  onAbrirDiff: () => void
  onAbrirArquivo: (caminho: string) => void
}) {
  const commitUrl = urlDoCommitNaWeb(remoto, det.hash)

  async function copiarSha(e: React.MouseEvent) {
    e.stopPropagation()
    await copyText(det.hash)
    avisar.feito("SHA copiado para a área de transferência.")
  }

  async function abrirNoNavegador(e: React.MouseEvent) {
    e.stopPropagation()
    if (!commitUrl) return
    await openUrl(commitUrl).catch(() => avisar.erro("Não consegui abrir o link no navegador."))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>{det.autor}</span>
        {det.autorEmail && <span className="opacity-70">&lt;{det.autorEmail}&gt;</span>}
        <span>·</span>
        <span>{new Date(det.quando).toLocaleString("pt-BR")}</span>
      </div>

      {det.corpo && (
        <div className="rounded border border-border/40 bg-card p-2 text-foreground/90 whitespace-pre-wrap leading-relaxed text-[11px]">
          {det.corpo}
        </div>
      )}

      <div className="flex items-center justify-between text-muted-foreground font-medium pt-1">
        <span>
          {det.arquivos.length} {det.arquivos.length === 1 ? "arquivo alterado" : "arquivos alterados"}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          <span>+{det.totalAdditions}</span>{" "}
          <span>−{det.totalDeletions}</span>
        </span>
      </div>

      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {det.arquivos.map((arq) => {
          const meta = STATUS_META[arq.status] ?? STATUS_META.modified
          return (
            <div
              key={arq.caminho}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onAbrirArquivo(arq.caminho)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  onAbrirArquivo(arq.caminho)
                }
              }}
              className={cn(
                controle("chip"),
                "group/arq w-full justify-start gap-1.5 px-1.5 cursor-pointer hover:bg-accent/40",
              )}
            >
              <span className={cn("w-3 font-mono font-semibold text-[11px]", meta.cls)}>
                {meta.label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80 group-hover/arq:text-foreground">
                {arq.caminho}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {arq.binario ? (
                  <span>bin</span>
                ) : (
                  <>
                    {arq.additions > 0 && <span>+{arq.additions} </span>}
                    {arq.deletions > 0 && <span>−{arq.deletions}</span>}
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
        <Button type="button" size="chip" variant="outline" onClick={onAbrirDiff}>
          Abrir diff na aba
        </Button>
        <Button type="button" size="chip" variant="ghost" onClick={copiarSha} title="Copiar SHA completo">
          <Copy className="size-3" />
          SHA
        </Button>
        {commitUrl && (
          <Button
            type="button"
            size="chip"
            variant="ghost"
            onClick={abrirNoNavegador}
            title="Ver commit no GitHub"
          >
            <ExternalLink className="size-3" />
            GitHub
          </Button>
        )}
      </div>
    </div>
  )
}
