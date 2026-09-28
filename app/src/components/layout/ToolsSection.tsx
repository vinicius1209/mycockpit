// As FERRAMENTAS no sino: saúde das CLIs desta máquina (sem login, rate limit,
// update) e as notícias de modelo e de modos.
//
// Assunto fechado, com fontes próprias (o snapshot da detecção, os limites
// vivos, o ledger de modelos) e dispensas próprias. "Sem login" sai daqui para
// o Esperando você do sino (`authItems`); o resto vira o rodapé (ADR-271).
//
// A distinção que separa isto da faixa "precisa de você": lá o app pergunta O
// QUE FAZER (adotar a proposta, escolher o vencedor) e o item some quando VOCÊ
// decide; aqui não há trabalho pra escolher, há uma ferramenta que não está
// pronta (ou um cardápio de modelos que mudou), e o item some quando o ESTADO
// muda. Por isso nada daqui entra na fila de decisões.

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Gauge, SlidersHorizontal } from "lucide-react"
import { LinhaDeLista } from "@/components/ui/linha-de-lista"
import { ToolHealthRow } from "@/components/layout/ToolHealthRow"
import { cn } from "@/lib/utils"
import { agentLabel } from "@/lib/agent"
import { secaoDoMotor, type SectionId } from "@/components/settings/sections"
import {
  listModelProposals,
  listModelRetirements,
  type ModelProposal,
  type ModelRetirement,
} from "@/lib/modelLedger"
import { modelNews } from "@/lib/modelPromotion"
import {
  modeDriftItems,
  modelHealthItems,
  toolHealthItems,
  type ToolAuthItem,
  type ToolModeDriftItem,
  type ToolModelNewsItem,
  type ToolUpdateItem,
} from "@/lib/toolHealth"
import {
  MODOS_CURADOS,
  driftDeModos,
  frasesDoDrift,
} from "@/lib/agentModes"
import { useAgentModes } from "@/store/agentModes"
import { useApp } from "@/store/app"

export interface ToolsSectionState {
  authItems: ToolAuthItem[]
  updateItems: ToolUpdateItem[]
  modelItems: ToolModelNewsItem[]
  /** Divergência entre os modos que o motor anuncia e os que o app explica. */
  modeItems: ToolModeDriftItem[]
  /** agent → quando o limite volta (texto pronto do store). */
  limited: Record<string, string | null>
  limitedIds: string[]
  /** O rodapé tem alguma coisa? (o "tudo em dia" do sino depende disto) */
  hasSection: boolean
  dismissUpdate: (item: ToolUpdateItem) => void
  dismissModelNews: (item: ToolModelNewsItem) => void
  /** Relê o ledger de modelos (o sino chama ao ABRIR: uma decisão sua tomada
   *  em Configurações some do aviso na hora, sem esperar a próxima rodada). */
  reloadModels: () => void
}

/** Todo o estado da seção, num lugar só. Nada aqui SONDA nada: lê o snapshot da
 *  detecção (o mesmo que a Frota lê) e o ledger de modelos (o mesmo que
 *  Configurações ▸ Modelos mostra). Abrir o sino nunca fala com CLI. */
export function useToolsSection(): ToolsSectionState {
  const limited = useApp((s) => s.limitedAgents)
  const detected = useApp((s) => s.settings.detected)
  const updateDismissed = useApp((s) => s.settings.updateDismissed)
  const modelNewsDismissed = useApp((s) => s.settings.modelNewsDismissed)
  // A rodada de modelos carimba `lastModelRound` ao terminar: é o sinal de que
  // o ledger mudou, e o único momento em que vale reler o banco.
  const lastModelRound = useApp((s) => s.settings.lastModelRound)
  const setSettings = useApp((s) => s.setSettings)
  const [rows, setRows] = useState<ModelProposal[]>([])
  const [retirements, setRetirements] = useState<ModelRetirement[]>([])

  const reloadModels = useCallback(() => {
    void Promise.all([listModelProposals(), listModelRetirements()]).then(
      ([p, r]) => {
        setRows(p)
        setRetirements(r)
      },
    )
  }, [])
  useEffect(reloadModels, [reloadModels, lastModelRound])

  // Saúde de ferramenta (regras puras em lib/toolHealth): já vem ordenada por
  // impedimento antes de conveniência.
  const items = useMemo(
    () => toolHealthItems(detected, updateDismissed),
    [detected, updateDismissed],
  )
  // Notícia de modelo: mesmo rodapé, mesma linha, e fora do selo (é
  // conveniência, não impedimento; no selo só entra "sem login").
  const modelItems = useMemo(
    () =>
      modelHealthItems(
        modelNews(rows, retirements, Date.now(), modelNewsDismissed),
      ),
    [rows, retirements, modelNewsDismissed],
  )

  /** Dispensa persistida por VERSÃO (§5.4): a próxima versão volta a aparecer. */
  const dismissUpdate = useCallback(
    (item: ToolUpdateItem) => {
      if (!item.latest) return
      setSettings({
        updateDismissed: { ...updateDismissed, [item.agent]: item.latest },
      })
    },
    [setSettings, updateDismissed],
  )

  /** Dispensa persistida por CONTEÚDO: o id do aviso carrega quais modelos ele
   *  anuncia, então dispensar o de hoje não silencia o de amanhã. */
  const dismissModelNews = useCallback(
    (item: ToolModelNewsItem) => {
      setSettings({
        modelNewsDismissed: { ...modelNewsDismissed, [item.id]: Date.now() },
      })
    },
    [setSettings, modelNewsDismissed],
  )

  // Modos: mesma família da notícia de modelo (o cardápio mudou), zero no
  // badge. A sonda tem dono próprio (store/agentModes) e é pedida UMA vez.
  const modosPorAgente = useAgentModes((s) => s.byAgent)
  const ensureModos = useAgentModes((s) => s.ensure)
  useEffect(() => {
    ensureModos(Object.keys(MODOS_CURADOS))
  }, [ensureModos])
  const modeItems = useMemo(
    () =>
      modeDriftItems(
        Object.keys(MODOS_CURADOS).map((agent) => {
          const m = modosPorAgente[agent]
          // `known: false` vira `null`: "não consegui perguntar" não pode virar
          // "sumiram todos os modos" na cara do usuário.
          //
          // A VERSÃO instalada (do mesmo snapshot que a Frota lê) é o que faz
          // uma recusa vencer: modo testado e rejeitado fica calado enquanto o
          // binário for aquele, e volta a perguntar quando ele muda.
          return {
            agent,
            frases: frasesDoDrift(
              agent,
              driftDeModos(
                agent,
                m?.known ? m.ids : null,
                detected[agent]?.version ?? null,
              ),
            ),
          }
        }),
      ),
    [modosPorAgente, detected],
  )

  const limitedIds = Object.keys(limited)
  return {
    authItems: items.filter((i) => i.kind === "auth"),
    updateItems: items.filter((i) => i.kind === "update"),
    modelItems,
    modeItems,
    limited,
    limitedIds,
    hasSection:
      limitedIds.length > 0 ||
      items.some((i) => i.kind === "update") ||
      modelItems.length > 0 ||
      modeItems.length > 0,
    dismissUpdate,
    dismissModelNews,
    reloadModels,
  }
}

/** O rodapé das ferramentas (ADR-271): uma linha que abre a lista. "Sem
 *  login" não mora aqui, porque passa no teste do Esperando você (bloqueia e
 *  some com um gesto seu); o que sobra é o cardápio da ferramenta, que não
 *  segura trabalho nenhum e por isso não disputa o topo com a atividade.
 *  Cada linha leva para Configurações, onde os gestos já existem. */
export function ToolsSection({
  state,
  openSettings,
}: {
  state: ToolsSectionState
  /** A página do motor desde a ADR-268: cada linha abre onde o gesto dela mora. */
  openSettings: (secao: SectionId) => void
}) {
  const [aberto, setAberto] = useState(false)
  const assuntos = [
    ...state.limitedIds.map((id) => `${agentLabel(id)} limitado`),
    ...state.updateItems.map((i) => `Atualização do ${i.label}`),
    ...state.modelItems.map((i) => i.title),
    ...state.modeItems.map((i) => `Modos do ${i.label}`),
  ]
  const quantos = assuntos.length
  if (quantos === 0) return null
  const resumo = [...new Set(assuntos)].join(", ")
  return (
    <div className="mt-1 border-t border-border/40 pt-1">
      <LinhaDeLista
        onClick={() => setAberto(!aberto)}
        aria-expanded={aberto}
        className="flex items-center gap-2 text-[12px] text-muted-foreground"
      >
        <SlidersHorizontal className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {quantos} {quantos === 1 ? "aviso das ferramentas" : "avisos das ferramentas"} · {resumo}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", aberto && "rotate-180")} />
      </LinhaDeLista>
      {aberto && (
        <>
          {state.limitedIds.map((id) => (
            <div
              key={id}
              className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-st-warning/80"
            >
              <Gauge className="size-3.5 shrink-0" />
              <span className="truncate">
                {agentLabel(id)} limitado
                {state.limited[id] ? `, volta ${state.limited[id]}` : ""}
              </span>
            </div>
          ))}
          {state.updateItems.map((item) => (
            <ToolHealthRow
              key={`${item.agent}:update`}
              item={item}
              onOpen={() => openSettings(secaoDoMotor(item.agent))}
              onDismiss={() => state.dismissUpdate(item)}
            />
          ))}
          {/* Modelos: o que entrou sozinho, o que não passou e por quê, e o que
              o fornecedor anunciou que vai aposentar. A procedência inteira
              mora em Configurações ▸ Modelos. */}
          {state.modelItems.map((item) => (
            <ToolHealthRow
              key={item.id}
              item={item}
              onOpen={() => openSettings("models")}
              onDismiss={() => state.dismissModelNews(item)}
            />
          ))}
          {/* Modos: SEM dispensar. Dispensa é pra aviso que você já resolveu;
              este só some quando a curadoria alcança o motor (ou o motor volta
              atrás). */}
          {state.modeItems.map((item) => (
            <ToolHealthRow
              key={item.id}
              item={item}
              onOpen={() => openSettings(secaoDoMotor(item.agent))}
            />
          ))}
        </>
      )}
    </div>
  )
}
