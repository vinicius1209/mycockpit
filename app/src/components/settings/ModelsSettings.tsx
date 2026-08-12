// Configurações ▸ Modelos. A pergunta: "quais modelos entram no seletor dos
// agents e quanto custam". Morava dentro de "CLIs instaladas", onde o assunto
// era outro (binário na máquina × catálogo de modelos).
//
// Duas coisas, nessa ordem: a DECISÃO pendente (propostas do curador, gate
// humano) e o ESTADO do catálogo de preços que alimenta o custo.

import { useEffect, useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { agentDef } from "@/lib/agents"
import {
  getModelsCatalog,
  refreshCatalogIntoSettings,
  type CatalogModel,
} from "@/lib/catalog"
import { catalogEntryFor, reloadActiveProposals } from "@/lib/modelCurator"
import {
  listModelProposals,
  setModelProposalStatus,
  type ModelProposal,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { Block, BlockTitle, Note, SectionHeader } from "@/components/settings/parts"
import { fmtCheckedAt } from "@/components/settings/format"
import { sectionDef } from "@/components/settings/sections"
import { cn } from "@/lib/utils"

/** "$3 in · $15 out por 1M tokens" (preço do catálogo p/ uma proposta). */
function fmtCatalogPrice(m: CatalogModel | undefined): string | null {
  if (!m || (m.input == null && m.output == null)) return null
  const f = (v: number | null) => (v == null ? "?" : `$${v}`)
  return `${f(m.input)} in · ${f(m.output)} out por 1M tokens`
}

export function ModelsSettings() {
  const catalogCount = useApp((s) => s.settings.catalogCount)
  const lastCatalogRefresh = useApp((s) => s.settings.lastCatalogRefresh)
  // Gate humano do curador: propostas pendentes + catálogo (pro preço).
  const [proposals, setProposals] = useState<ModelProposal[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  // Nada de vazio prematuro: "nenhuma proposta" só aparece depois da leitura.
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listModelProposals("proposed"), getModelsCatalog()]).then(
      ([p, c]) => {
        if (cancelled) return
        setProposals(p)
        setCatalog(c)
        setLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function decideProposal(
    p: ModelProposal,
    status: "active" | "dismissed",
  ) {
    await setModelProposalStatus(p.id, status)
    // aprovado → recarrega o cache que o agentModels() mescla no picker.
    if (status === "active") await reloadActiveProposals()
    setProposals((prev) => prev.filter((x) => x.id !== p.id))
  }

  async function refreshCatalog() {
    setRefreshing(true)
    // gesto humano espera resultado: rede caída não vira silêncio (ADR-017).
    const ok = await refreshCatalogIntoSettings()
    if (!ok) toast.error("Não deu pra baixar o catálogo agora. O snapshot anterior segue valendo.")
    setCatalog(await getModelsCatalog())
    setRefreshing(false)
  }

  return (
    <div>
      <SectionHeader
        title={sectionDef("models").title}
        description={sectionDef("models").question}
        action={
          <button
            onClick={() => void refreshCatalog()}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
            Atualizar catálogo
          </button>
        }
      />

      <BlockTitle hint="Modelos novos que o curador achou no catálogo. Aprovar adiciona ao seletor do agent; nada entra sem a sua revisão.">
        Propostas do curador
      </BlockTitle>
      {!loaded ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Conferindo as propostas...
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-[12px] text-muted-foreground">
          Nenhuma proposta esperando você.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {proposals.map((p) => {
            const price = fmtCatalogPrice(
              catalogEntryFor(catalog, p.agent, p.value),
            )
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground">
                    {p.label}{" "}
                    <span className="text-muted-foreground">
                      · {agentDef(p.agent)?.label ?? p.agent}
                    </span>
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {p.description}
                    {price ? ` · ${price}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void decideProposal(p, "active")}
                >
                  Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void decideProposal(p, "dismissed")}
                >
                  Dispensar
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <Block>
        <BlockTitle hint="A tabela de preços que o app usa pra estimar o custo de cada turno.">
          Catálogo de preços
        </BlockTitle>
        <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
          <div className="text-[13px] text-foreground">
            models.dev · {catalogCount}{" "}
            {catalogCount === 1 ? "modelo" : "modelos"}
          </div>
          <div className="text-[12px] text-muted-foreground">
            atualizado {fmtCheckedAt(lastCatalogRefresh)} · o app baixa de novo
            1×/dia, ao abrir
          </div>
        </div>
        <Note>
          Sem catálogo o app cai numa tabela embutida (conferida em jul/2026).
          Modelo que não está em nenhuma das duas fica sem estimativa de custo,
          nunca com um número inventado.
        </Note>
      </Block>
    </div>
  )
}
