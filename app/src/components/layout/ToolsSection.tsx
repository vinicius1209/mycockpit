// A seção FERRAMENTAS do sino: saúde das CLIs desta máquina (sem login, rate
// limit, update) e, desde o M3 do model-autonomy-plan, as notícias de MODELO.
//
// Saiu do `InboxBell.tsx` porque aquele arquivo já estava no teto de tamanho e
// esta seção é um assunto fechado: ela tem as próprias fontes (o snapshot da
// detecção, os limites vivos, o ledger de modelos), as próprias dispensas e a
// própria hierarquia. O sino continua dono do BADGE e do "tudo em dia" — por
// isso o hook devolve `blockedTools` e `hasSection` pra ele.
//
// A distinção que separa isto da faixa "precisa de você": lá o app pergunta O
// QUE FAZER (adotar a proposta, escolher o vencedor) e o item some quando VOCÊ
// decide; aqui não há trabalho pra escolher, há uma ferramenta que não está
// pronta (ou um cardápio de modelos que mudou), e o item some quando o ESTADO
// muda. Por isso nada daqui entra na fila de decisões.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Gauge } from "lucide-react"
import {
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ToolHealthRow } from "@/components/layout/ToolHealthRow"
import { agentLabel } from "@/lib/agent"
import {
  listModelProposals,
  listModelRetirements,
  type ModelProposal,
  type ModelRetirement,
} from "@/lib/modelLedger"
import { modelNews } from "@/lib/modelPromotion"
import {
  blockingToolCount,
  modelHealthItems,
  toolHealthItems,
  type ToolAuthItem,
  type ToolModelNewsItem,
  type ToolUpdateItem,
} from "@/lib/toolHealth"
import { useApp } from "@/store/app"

export interface ToolsSectionState {
  authItems: ToolAuthItem[]
  updateItems: ToolUpdateItem[]
  modelItems: ToolModelNewsItem[]
  /** agent → quando o limite volta (texto pronto do store). */
  limited: Record<string, string | null>
  limitedIds: string[]
  /** O que a seção soma no badge do sino (só impedimento). */
  blockedTools: number
  /** Tem alguma coisa pra mostrar? (o "tudo em dia" do sino depende disto) */
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
  // Notícia de modelo: mesma seção, mesma linha, e ZERO no badge (é
  // conveniência, não impedimento — a régua está em `blockingToolCount`).
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

  const limitedIds = Object.keys(limited)
  return {
    authItems: items.filter((i) => i.kind === "auth"),
    updateItems: items.filter((i) => i.kind === "update"),
    modelItems,
    limited,
    limitedIds,
    blockedTools: blockingToolCount(items),
    hasSection:
      items.length > 0 || limitedIds.length > 0 || modelItems.length > 0,
    dismissUpdate,
    dismissModelNews,
    reloadModels,
  }
}

/** A seção desenhada. Ordem = severidade: sem login (bloqueia, conta no badge)
 *  · rate limit (bloqueia, mas volta sozinho, nenhum gesto seu resolve) ·
 *  update (conveniência, cinza) · modelos (o cardápio mudou, a ferramenta está
 *  de pé). Cada linha leva pra Configurações, onde os gestos já existem. */
export function ToolsSection({
  state,
  openSettings,
}: {
  state: ToolsSectionState
  openSettings: (secao: "machine" | "models") => void
}) {
  if (!state.hasSection) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground uppercase">
        Ferramentas
      </DropdownMenuLabel>
      {state.authItems.map((item) => (
        <ToolHealthRow
          key={`${item.agent}:auth`}
          item={item}
          onOpen={() => openSettings("machine")}
        />
      ))}
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
          onOpen={() => openSettings("machine")}
          onDismiss={() => state.dismissUpdate(item)}
        />
      ))}
      {/* Modelos (M3): o que entrou sozinho, o que não passou e por quê, e o
          que o fornecedor anunciou que vai aposentar. Fecha a seção porque é a
          camada mais leve das três (a ferramenta está de pé; mudou o cardápio
          dela). A procedência inteira mora em Configurações ▸ Modelos, que é
          pra onde a linha leva. */}
      {state.modelItems.map((item) => (
        <ToolHealthRow
          key={item.id}
          item={item}
          onOpen={() => openSettings("models")}
          onDismiss={() => state.dismissModelNews(item)}
        />
      ))}
    </>
  )
}
