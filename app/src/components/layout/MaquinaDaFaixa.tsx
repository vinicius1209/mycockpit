// A máquina na faixa de baixo (ADR-262): "mem 10/16 GB · cpu 31%" (o traço de
// CPU fica só no painel: a 28px, com carga baixa, virava "____"), e o painel
// que diz quanto disso é do Frota, com o Parar ao lado de cada turno e o
// Desligar ao lado de cada Chromium. O aviso de memória no fio continua: ele é
// o histórico da conversa; a faixa é o agora da máquina.
//
// Amostra a cada 2 s SÓ com a janela visível; o detalhe (árvore de
// processos, a parte cara) só com o painel aberto.

import { useEffect, useState } from "react"
import { Cpu } from "lucide-react"
import { AgentLogo } from "@/components/common/AgentLogo"
import { GrupoDeProcessos } from "@/components/layout/ArvoreDeProcessos"
import { AcaoDoClique, GatilhoDaFaixa, PainelDaFaixa } from "@/components/layout/statusBarChrome"
import { Button } from "@/components/ui/button"
import { avisar, mensagemDe } from "@/lib/avisos"
import { stopProjectBrowser } from "@/lib/browser"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"
import type { LinhaDaArvore } from "@/lib/arvoreDoTurno"
import { confirm } from "@/lib/confirm"
import { isTauri } from "@/lib/db"
import {
  AMOSTRAS_NO_TRACO,
  fmtGb,
  INTERVALO_DA_AMOSTRA_MS,
  lerAmostra,
  encerrarProcesso,
  lerDetalhe,
  tomDaMaquina,
  turnosNaMaquina,
  type AmostraDoSistema,
  type DetalheDaMaquina,
} from "@/lib/maquina"
import { METER_TEXT } from "@/lib/meter"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Chama `fazer` a cada `ms` enquanto a janela está visível (e uma vez na
 *  volta). Escondida, não gasta nada. */
function useEnquantoVisivel(fazer: () => void, ms: number, ligado = true) {
  useEffect(() => {
    if (!ligado || !isTauri()) return
    let t: ReturnType<typeof setInterval> | null = null
    const ligar = () => {
      if (t || document.hidden) return
      fazer()
      t = setInterval(fazer, ms)
    }
    const desligar = () => {
      if (t) clearInterval(t)
      t = null
    }
    const aoMudar = () => (document.hidden ? desligar() : ligar())
    ligar()
    document.addEventListener("visibilitychange", aoMudar)
    return () => {
      desligar()
      document.removeEventListener("visibilitychange", aoMudar)
    }
  }, [fazer, ms, ligado])
}

function Traco({ pontos, largura, altura }: { pontos: number[]; largura: number; altura: number }) {
  if (pontos.length < 2) return <svg width={largura} height={altura} aria-hidden />
  const d = pontos
    .map((v, i) => `${i ? "L" : "M"}${((i / (pontos.length - 1)) * largura).toFixed(1)},${(altura - 1 - (v / 100) * (altura - 2)).toFixed(1)}`)
    .join(" ")
  return (
    <svg width={largura} height={altura} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25} />
    </svg>
  )
}

export function MaquinaDaFaixa() {
  const [amostra, setAmostra] = useState<AmostraDoSistema | null>(null)
  const [cpu, setCpu] = useState<number[]>([])
  const [aberto, setAberto] = useState(false)
  const [detalhe, setDetalhe] = useState<DetalheDaMaquina | null>(null)
  const liveness = useChat((s) => s.runLivenessByConv)
  const byId = useChat((s) => s.byId)
  const porProjeto = useChat((s) => s.conversationsByProject)
  const projetos = useApp((s) => s.projects)

  const [amostrar] = useState(() => () => {
    void lerAmostra()
      .then((a) => {
        setAmostra(a)
        if (a.cpuPct != null) setCpu((h) => [...h, a.cpuPct!].slice(-AMOSTRAS_NO_TRACO))
      })
      .catch((err) => console.warn("[máquina] amostra falhou:", err))
  })
  const [detalhar] = useState(() => () => {
    void lerDetalhe()
      .then(setDetalhe)
      .catch((err) => console.warn("[máquina] detalhe falhou:", err))
  })
  useEnquantoVisivel(amostrar, INTERVALO_DA_AMOSTRA_MS)
  useEnquantoVisivel(detalhar, 3_000, aberto)

  if (!amostra) return null
  const rodando = new Set(Object.entries(byId).filter(([, c]) => c.running).map(([id]) => id))
  const turnos = turnosNaMaquina(liveness, rodando)
  const tom = tomDaMaquina(amostra, turnos[0]?.mb ?? 0)
  const cpuAgora = cpu.at(-1)
  const media = cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null
  const livre = Math.max(0, amostra.memTotalMb - amostra.memUsadaMb)
  const doFrota = Math.min(detalhe?.frotaMb ?? 0, amostra.memUsadaMb)
  const pct = (mb: number) => `${(mb / Math.max(1, amostra.memTotalMb)) * 100}%`

  const convDoRun = (runId: string) => Object.entries(byId).find(([, c]) => c.runId === runId)?.[0] ?? null

  /** Encerra um processo do turno, com confirmação. O painel fecha antes: dois
   *  painéis disputando o foco não servem a ninguém (`statusBarChrome`). */
  const encerrar = async (runId: string, convId: string | null, l: LinhaDaArvore) => {
    setAberto(false)
    const ok = await confirm({
      title: `Encerrar ${l.nome}?`,
      description:
        "O processo e os filhos dele recebem o pedido para fechar. O turno segue: o agente vê essa ferramenta cair e continua sem ela.",
      confirmLabel: "Encerrar",
      danger: true,
    })
    if (!ok) return
    await encerrarProcesso(runId, l.pids[0]).catch((err) =>
      avisar.erro(`Não consegui encerrar ${l.nome}.`, { origem: { conversa: convId }, detalhe: mensagemDe(err) }),
    )
  }

  const nomeDaConversa = (convId: string) => {
    const pid = byId[convId]?.projectId ?? ""
    const titulo = (porProjeto[pid] ?? []).find((c) => c.id === convId)?.title ?? "Conversa"
    const projeto = projetos.find((p) => p.id === pid)?.name
    return projeto ? `${projeto} · ${titulo}` : titulo
  }

  return (
    <PainelDaFaixa
      open={aberto}
      onOpenChange={setAberto}
      titulo="Máquina"
      icone={<Cpu className="size-3.5" />}
      largura="w-[540px]"
      dica={
        <>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-foreground">Memória</span>
            <span className="font-mono tabular-nums text-foreground">
              {fmtGb(amostra.memUsadaMb)} de {fmtGb(amostra.memTotalMb)} GB
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <span
              className={cn("block h-full rounded-full", tom === "ok" ? "bg-muted-foreground/50" : tom === "warn" ? "bg-st-warning" : "bg-st-error")}
              style={{ width: pct(amostra.memUsadaMb) }}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-border/40 pt-2 text-[12px]">
            <span className="flex-1 text-foreground">CPU</span>
            <span className="text-muted-foreground">
              <Traco pontos={cpu} largura={96} altura={18} />
            </span>
            <span className="w-9 text-right font-mono tabular-nums text-foreground">
              {cpuAgora != null ? `${Math.round(cpuAgora)}%` : "…"}
            </span>
            {media != null && <span className="text-[11px] text-muted-foreground">média {media}%</span>}
          </div>
        </>
      }
      peDaDica={
        <>
          <span>
            {fmtGb(amostra.memTotalMb)} GB · {amostra.nucleos} núcleos
          </span>
          <AcaoDoClique>processos do Frota</AcaoDoClique>
        </>
      }
      nota={`${fmtGb(amostra.memTotalMb)} GB · ${amostra.nucleos} núcleos · amostra a cada 2 s com a janela visível`}
      conteudo={
        <div className="space-y-3">
          <div className="px-1">
            <div className="flex text-[11px] font-medium text-muted-foreground">
              Memória
              <span className="ml-auto font-mono font-normal tabular-nums">
                {fmtGb(amostra.memUsadaMb)} de {fmtGb(amostra.memTotalMb)} GB
              </span>
            </div>
            <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-secondary">
              <span className="h-full bg-foreground/60" style={{ width: pct(doFrota) }} />
              <span className="h-full bg-muted-foreground/30" style={{ width: pct(amostra.memUsadaMb - doFrota) }} />
            </div>
            <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
              <span>
                <i className="mr-1 inline-block size-2 rounded-[2px] bg-foreground/60" />
                Frota {detalhe ? `${fmtGb(doFrota)} GB` : "…"}
              </span>
              <span>
                <i className="mr-1 inline-block size-2 rounded-[2px] bg-muted-foreground/30" />
                resto do sistema {detalhe ? `${fmtGb(amostra.memUsadaMb - doFrota)} GB` : "…"}
              </span>
              <span>livre {fmtGb(livre)} GB</span>
            </div>
          </div>
          <div className="px-1 text-muted-foreground">
            <div className="flex text-[11px] font-medium">
              CPU
              <span className="ml-auto font-mono font-normal tabular-nums">
                {cpuAgora != null ? `${Math.round(cpuAgora)}% agora` : "medindo…"}
                {media != null && ` · média ${media}%`}
              </span>
            </div>
            <Traco pontos={cpu} largura={508} altura={36} />
          </div>
          {detalhe == null ? (
            <div className="px-1 text-[11px] text-muted-foreground">Lendo os processos…</div>
          ) : (
            (detalhe.turnos.length > 0 || detalhe.navegadores.length > 0) && (
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] font-medium text-muted-foreground">Rodando no Frota</div>
                {detalhe.turnos.map((t) => {
                  const convId = convDoRun(t.runId)
                  return (
                    <GrupoDeProcessos
                      key={t.runId}
                      icone={<AgentLogo agent={convId ? (byId[convId]?.agent ?? "") : ""} />}
                      titulo={convId ? nomeDaConversa(convId) : "Turno"}
                      mb={t.mb}
                      processos={t.processos}
                      rotuloDaRaiz="motor"
                      aoEncerrar={(l) => void encerrar(t.runId, convId, l)}
                      acao={
                        convId && (
                          <Button
                            size="chip"
                            variant="outline"
                            onClick={() =>
                              void cancelConversationTurn(convId, "parada").catch((err) =>
                                avisar.erro("Não consegui parar o turno.", { origem: { conversa: convId }, detalhe: mensagemDe(err) }),
                              )
                            }
                          >
                            Parar
                          </Button>
                        )
                      }
                    />
                  )
                })}
                {detalhe.navegadores.map((n) => (
                  <GrupoDeProcessos
                    key={n.projectId}
                    titulo={`Chromium do ${projetos.find((p) => p.id === n.projectId)?.name ?? "projeto"}`}
                    mb={n.mb}
                    processos={n.processos}
                    rotuloDaRaiz="principal"
                    acao={
                      <Button
                        size="chip"
                        variant="outline"
                        onClick={() =>
                          void stopProjectBrowser(n.projectPath)
                            .then(detalhar)
                            .catch((err) =>
                              avisar.erro("Não consegui desligar o navegador.", { origem: { projeto: n.projectId }, detalhe: mensagemDe(err) }),
                            )
                        }
                      >
                        Desligar
                      </Button>
                    }
                  />
                ))}
              </div>
            )
          )}
        </div>
      }
    >
      <GatilhoDaFaixa aria-label="Memória e CPU do computador">
        <span className="text-muted-foreground/70">mem</span>
        <span className={cn("tabular-nums", tom === "ok" ? "text-foreground" : METER_TEXT[tom])}>
          {fmtGb(amostra.memUsadaMb)}/{fmtGb(amostra.memTotalMb)} GB
        </span>
        <span className="text-muted-foreground/70">· cpu</span>
        <span className="w-8 tabular-nums text-foreground">{cpuAgora != null ? `${Math.round(cpuAgora)}%` : "…"}</span>
      </GatilhoDaFaixa>
    </PainelDaFaixa>
  )
}
