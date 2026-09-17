// Configurações ▸ Agentes na máquina. A pergunta: "quais CLIs de agent
// existem aqui, em que versão, logadas ou não". SÓ isso — o medidor de janela,
// os hooks de terminal e o curador de modelos saíram daqui (cada um responde
// outra pergunta e ganhou seção própria).
//
// Hierarquia: a lista é ESTADO (probe real, verde só com probe), os botões da
// direita são AÇÃO (atualizar/copiar comando) e o rodapé diz a periodicidade.

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react"
import {
  crossChannelNote,
  detectAgents,
  latestLabel,
  notaDeCopias,
  refreshModelLists,
  toProbeMap,
  updateAvailable,
  UPDATE_COMMANDS,
} from "@/lib/detect"
import {
  hydrateUpdateJobs,
  startUpdate,
  updateButtonState,
  useUpdates,
} from "@/lib/updates"
import { useApp } from "@/store/app"
import { Note, SectionHeader } from "@/components/settings/parts"
import { fmtCheckedAt } from "@/components/settings/format"
import { sectionDef } from "@/components/settings/sections"
import { cn, formatDisplayPath } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** Agents que a seção lista (na ordem), com o rótulo do checklist. */
const AGENT_TOOLS: { id: string; label: string; sub: string }[] = [
  { id: "claude-code", label: "Claude Code", sub: "CLI da Anthropic" },
  { id: "codex", label: "Codex", sub: "CLI da OpenAI" },
  { id: "agy", label: "Antigravity", sub: "CLI do Google" },
  { id: "opencode", label: "OpenCode", sub: "CLI da sst · multi-provedor" },
]

export function MachineAgents() {
  const detected = useApp((s) => s.settings.detected)
  const lastUpdateCheck = useApp((s) => s.settings.lastUpdateCheck)
  const setSettings = useApp((s) => s.setSettings)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // Jobs de update: estado GLOBAL (lib/updates), não do componente — o job é
  // do app e sobrevive ao fechar/reabrir o modal (incidente dos N cliques).
  const updateJobs = useUpdates((s) => s.byAgent)

  useEffect(() => {
    // Re-hidrata os jobs de update ao abrir o painel: job vivo volta a mostrar
    // spinner; desfecho perdido com o modal fechado é anunciado agora.
    void hydrateUpdateJobs()
  }, [])

  async function checkNow() {
    setChecking(true)
    const tools = await detectAgents()
    const now = Date.now()
    if (tools.length > 0)
      setSettings({ detected: toProbeMap(tools, now), lastUpdateCheck: now })
    else setSettings({ lastUpdateCheck: now })
    // Listas vivas de TODO motor que sabe se listar: leitura da máquina, sem
    // quota, todas em paralelo (uma não deve esperar a outra).
    await refreshModelLists()
    setChecking(false)
  }

  function copyCmd(id: string, cmd: string) {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(id)
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
    })
  }

  // "Atualizar": só dispara o JOB (lib/updates → update.rs). Dedupe, toast com
  // id estável, timeout gentil e re-verificação pós-sucesso são do job — nada
  // disso mora no componente, então fechar o modal não perde nada.

  return (
    <div>
      <SectionHeader
        title={sectionDef("machine").title}
        description={sectionDef("machine").question}
        action={
          <Button size="compacto" variant="ghost" onClick={() => void checkNow()} disabled={checking}>
            <RotateCcw className={cn("size-3.5", checking && "animate-spin")} />
            Verificar agora
          </Button>
        }
      />
      <ul className="flex flex-col gap-1.5">
        {AGENT_TOOLS.map((tool) => {
          const probe = detected[tool.id]
          const hasUpdate = probe ? updateAvailable(probe) : false
          const cmd = UPDATE_COMMANDS[tool.id]
          // spinning = o job DESTE agent está vivo; disabled = qualquer job
          // vivo (um update por vez — dois brew brigam pelo lock).
          const { spinning, disabled } = updateButtonState(updateJobs, tool.id)
          // "última" POR CANAL do binário gerenciado, rotulada ("última
          // v2.1.212 (homebrew)"): o teto do npm não vale pra binário do brew.
          const latestText = probe ? latestLabel(probe) : null
          // canal cruzado: outro canal tem versão maior que o teto do canal
          // do binário — informação pra decisão humana, sem botão.
          const channelNote = probe ? crossChannelNote(probe) : null
          // cópias duplicadas no PATH: do probe (persistido), não do job.
          const copias = probe ? notaDeCopias(probe) : null
          return (
            <li
              key={tool.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
            >
              <span className="shrink-0">
                {/* Auth honesta (Sprint 0): CLI deslogada ou com auth incerta
                    nunca ganha o check verde — verde exige probe.auth ok/na. */}
                {!probe || !probe.installed ? (
                  <X className="size-4 text-st-error" />
                ) : hasUpdate ||
                  probe.auth === "missing" ||
                  probe.auth === "unknown" ? (
                  <AlertTriangle className="size-4 text-st-warning" />
                ) : (
                  <Check className="size-4 text-st-success" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                {/* o "update disponível" já é sinalizado pelo ícone âmbar à
                    esquerda + o botão "Atualizar agora" + a "última vX" abaixo,
                    então nada de badge (era ele que estourava a linha). */}
                <div className="truncate text-[13px] text-foreground">
                  {tool.label}{" "}
                  <span className="text-muted-foreground">· {tool.sub}</span>
                </div>
                <div
                  className="truncate text-[12px] text-muted-foreground"
                  title={probe?.detail ?? undefined}
                >
                  {!probe ? (
                    "não verificado ainda"
                  ) : !probe.installed ? (
                    "não instalado"
                  ) : (
                    <>
                      {`instalado v${probe.version ?? "?"}${
                        latestText ? ` · ${latestText}` : ""
                      }`}
                      {probe.auth === "ok" && (
                        <span>
                          {" · logado"}
                          {probe.detail ? ` (${probe.detail})` : ""}
                        </span>
                      )}
                      {probe.auth === "missing" && (
                        <span className="text-st-warning">{" · sem login"}</span>
                      )}
                      {probe.auth === "unknown" && (
                        <span className="text-st-warning">
                          {" · auth desconhecida"}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {/* Canal cruzado na cara: "o canal npm tem v2.1.220; este
                    binário é homebrew (teto v2.1.212)". Sem botão — trocar de
                    canal é gesto do usuário. */}
                {channelNote && (
                  <div
                    className="truncate text-[11px] text-muted-foreground"
                    title={channelNote}
                  >
                    {channelNote}
                  </div>
                )}
                {/* Honestidade sobre instalações duplicadas: o "atualizei e não
                    mudou nada" quase sempre é o app usando uma cópia diferente
                    da que o shell do usuário resolve (brew × nvm).

                    Vem do PROBE, não do job: é fato da máquina, e no job só
                    existia depois de rodar um update e sumia no reinício.
                    O caminho é elidido pela CAUDA (formatDisplayPath) — o
                    truncate do CSS cortava justo o fim, que é a parte que
                    distingue as cópias; a lista inteira fica no title. */}
                {copias && (
                  <div
                    className="truncate text-[11px] text-st-warning"
                    title={copias.todos.join("\n")}
                  >
                    {copias.total} cópias no PATH · o app usa e atualiza{" "}
                    {formatDisplayPath(copias.binPath, 40)}
                  </div>
                )}
              </div>
              {cmd ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* "Atualizar" (dispara o job in-app) quando há update novo,
                      OU spinner enquanto o job dele vive (mesmo depois de
                      fechar e reabrir o modal); o "copiar comando" é
                      ÍCONE-ONLY (tooltip = comando) pra não estourar a
                      largura do painel. */}
                  {(hasUpdate || spinning) && (
                    <button
                      onClick={() => void startUpdate(tool.id)}
                      disabled={disabled}
                      title="Atualiza o CLI aqui (detecta npm/brew/self-update)"
                      className="flex items-center gap-1 rounded bg-brass px-2 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {spinning ? (
                        <>
                          <Loader2 className="size-3 animate-spin" /> atualizando…
                        </>
                      ) : (
                        <>
                          <Download className="size-3" /> Atualizar
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => copyCmd(tool.id, cmd)}
                    title={`Copiar comando de update: ${cmd}`}
                    aria-label="Copiar comando de update"
                    className="grid size-6 shrink-0 place-items-center rounded bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {copied === tool.id ? (
                      <Check className="size-3 text-st-success" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </div>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground/60">
                  —
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <Note>
        Verificação automática 1×/dia ao abrir o app (última:{" "}
        {fmtCheckedAt(lastUpdateCheck)}). Quando sai versão nova você recebe uma
        notificação única por versão.
      </Note>
    </div>
  )
}
