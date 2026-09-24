// Passo 1 — agentes. Instala uma CAPACIDADE: sem agent padrão escolhido, toda
// conversa nova começa perguntando. A detecção é a mesma do resto do app
// (detect_agents), e a decisão de quem aparece vem do registry + do probe,
// nunca de nome de agent no código.

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Loader2, RotateCcw } from "lucide-react"
import { AGENTS, availability } from "@/lib/agents"
import type { AgentDef } from "@/lib/agents"
import {
  INSTALL_COMMANDS,
  detectAgents,
  toProbeMap,
  type AgentProbe,
} from "@/lib/detect"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import { SELECTED_FILL } from "@/lib/selection"
import { partitionAgents, preselectAgent } from "./flow"

/** Uma linha do probe, em cinza: instalado é o caso comum e caso comum não
 *  ganha tinta (§2). Só o que PEDE algo do usuário (sem login) vira âmbar. */
function probeLine(probe: AgentProbe | undefined): {
  text: string
  warn: boolean
} {
  if (!probe || !probe.installed) return { text: "não encontrada", warn: false }
  const v = probe.version ? `v${probe.version}` : "instalada"
  if (probe.auth === "missing")
    return { text: `${v} · sem login`, warn: true }
  if (probe.auth === "unknown")
    return { text: `${v} · login não confirmado`, warn: false }
  return {
    text: probe.detail ? `${v} · ${probe.detail}` : v,
    warn: false,
  }
}

function AgentRow({
  def,
  probe,
  selected,
  onSelect,
}: {
  def: AgentDef
  probe: AgentProbe | undefined
  selected: boolean
  onSelect: () => void
}) {
  const line = probeLine(probe)
  const install = INSTALL_COMMANDS[def.id]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected ? SELECTED_FILL : "border-border/60 hover:bg-sel-hover",
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          selected ? "border-foreground" : "border-muted-foreground/50",
        )}
      >
        {/* O miolo do radio é o PIP da receita (§2): neutro, nunca tinta. */}
        {selected && <span className="size-2 rounded-full bg-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-foreground">{def.label}</span>
        <span
          className={cn(
            "block truncate text-[11px]",
            line.warn ? "text-st-warning" : "text-muted-foreground",
          )}
        >
          {def.description} · {line.text}
        </span>
      </span>
      {!probe?.installed && install && (
        <code className="shrink-0 rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {install}
        </code>
      )}
    </button>
  )
}

export function AgentStep() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const [detecting, setDetecting] = useState(true)
  const [checked, setChecked] = useState(false)
  // latch de mão única: a gaveta abre sozinha quando a escolha do usuário mora
  // lá dentro, mas nunca se fecha sozinha (brigaria com o clique dele).
  const [showOthers, setShowOthers] = useState(false)
  const autoPicked = useRef(false)

  async function runDetection() {
    setDetecting(true)
    const found = await detectAgents()
    const map = toProbeMap(found, Date.now())
    setSettings({ detected: map })
    setDetecting(false)
    setChecked(true)
    // pré-seleção UMA vez: reexecutar atropelaria a escolha do usuário.
    if (autoPicked.current) return
    autoPicked.current = true
    const { found: visible } = partitionAgents(AGENTS, map)
    const pick = preselectAgent(visible, null)
    if (pick) setSettings({ defaultAgent: pick })
  }

  useEffect(() => {
    void runDetection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detected = settings.detected
  const { found, others } = partitionAgents(AGENTS, detected)
  const nothingFound = checked && found.length === 0
  // sem nenhuma detecção não há "os outros": a lista inteira vira o destaque,
  // com o cabeçalho dizendo a verdade (não são "encontrados").
  const primary = nothingFound ? others : found
  const collapsed = nothingFound ? [] : others
  const selected = settings.defaultAgent

  useEffect(() => {
    if (collapsed.some((d) => d.id === selected)) setShowOthers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, collapsed.length])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold text-foreground">
          Escolha o agent padrão
        </h2>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          É quem abre toda conversa nova. Dá pra trocar por conversa e nas
          Configurações depois.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="etiqueta text-muted-foreground">
          {detecting
            ? "procurando CLIs no seu PATH"
            : nothingFound
              ? "integradas ao app"
              : `encontradas nesta máquina · ${found.length}`}
        </span>
        {!detecting && (
          <button
            type="button"
            onClick={() => void runDetection()}
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            Procurar de novo
          </button>
        )}
      </div>

      {detecting ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-6 text-[12px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Verificando quais CLIs estão instaladas.
        </div>
      ) : (
        <>
          {nothingFound && (
            <p className="text-[12px] leading-snug text-st-warning">
              Nenhuma CLI de agent encontrada no seu PATH. Instale uma e clique
              "Procurar de novo". Você pode seguir sem isso, mas nenhuma
              conversa vai rodar até ter uma.
            </p>
          )}
          <div role="radiogroup" className="flex flex-col gap-1.5">
            {primary.map((def) => (
              <AgentRow
                key={def.id}
                def={def}
                probe={detected[def.id]}
                selected={selected === def.id}
                onSelect={() => setSettings({ defaultAgent: def.id })}
              />
            ))}
          </div>

          {collapsed.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowOthers((v) => !v)}
                aria-expanded={showOthers}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    showOthers && "rotate-180",
                  )}
                />
                {showOthers
                  ? "Esconder as outras"
                  : `Mostrar as outras (${collapsed.length})`}
              </button>
              {showOthers && (
                <div role="radiogroup" className="mt-1.5 flex flex-col gap-1.5">
                  {collapsed.map((def) => (
                    <AgentRow
                      key={def.id}
                      def={def}
                      probe={detected[def.id]}
                      selected={selected === def.id}
                      onSelect={() => setSettings({ defaultAgent: def.id })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Escolha que não está nesta máquina não bloqueia, mas também não
              finge: a linha diz o que falta antes do primeiro run falhar. */}
          {!nothingFound &&
            selected &&
            availability(selected, detected) === "missing" && (
              <p className="text-[12px] leading-snug text-st-warning">
                {AGENTS.find((a) => a.id === selected)?.label ?? selected} não
                está instalado aqui. Escolher agora é válido, mas instale a CLI
                antes de enviar o primeiro turno.
              </p>
            )}
        </>
      )}
    </div>
  )
}
