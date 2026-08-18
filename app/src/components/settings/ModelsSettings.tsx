// Configurações ▸ Modelos. A pergunta: "quais modelos entram no seletor dos
// agents e quanto custam".
//
// Desde o M3 (docs/model-autonomy-plan.md) esta seção deixou de ser um par
// aprovar/dispensar às cegas e passou a mostrar PROCEDÊNCIA: o que entrou
// sozinho e por quê, o que está esperando e o que falta, o que foi reprovado e
// com que motivo, e o que o fornecedor anunciou que vai aposentar. A ordem é a
// da hierarquia: o que mexe no que você já usa primeiro, novidade por último.
//
// O gesto "Verificar agora" é o mesmo trabalho da agenda diária, sem freio de
// tempo: perguntar a lista viva de cada CLI, testar os candidatos NOVOS e
// conferir o preço. É a única coisa aqui que gasta quota, e o rodapé diz isso.

import { useCallback, useEffect, useState } from "react"
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
import { roundGaps, roundSummary, runModelRound } from "@/lib/modelRound"
import {
  listModelProposals,
  listModelRetirements,
  setModelProposalStatus,
  type ModelProposal,
  type ModelRetirement,
} from "@/lib/modelLedger"
import { useApp } from "@/store/app"
import { Block, BlockTitle, Note, SectionHeader } from "@/components/settings/parts"
import { fmtCheckedAt } from "@/components/settings/format"
import { sectionDef } from "@/components/settings/sections"
import { cn } from "@/lib/utils"

/** "$3 in · $15 out por 1M tokens" (preço do catálogo p/ uma linha). */
function fmtCatalogPrice(m: CatalogModel | undefined): string | null {
  if (!m || (m.input == null && m.output == null)) return null
  const f = (v: number | null) => (v == null ? "?" : `$${v}`)
  return `${f(m.input)} in · ${f(m.output)} out por 1M tokens`
}

function rotulo(agent: string): string {
  return agentDef(agent)?.label ?? agent
}

/** `reason` (modelPromotion.retirementReason) cola nossa frase + o texto CRU
 *  do fornecedor num parágrafo só, sem separador — o pt-BR e o inglês colado
 *  do CLI ficavam indistinguíveis (achado real do usuário, 18/08/2026). O
 *  campo `vendorNote` já guarda o mesmo texto cru, à parte; aqui só tiramos a
 *  duplicata do `reason` pra render em duas linhas com tratamento diferente,
 *  sem mexer na construção da string (que o aviso do sino também usa). */
function splitVendorNote(
  reason: string,
  vendorNote: string | null,
): { text: string; vendor: string | null } {
  const v = vendorNote?.trim()
  if (!v || !reason.includes(v)) return { text: reason, vendor: null }
  const text = reason.replace(v, "").replace(/\s{2,}/g, " ").trim()
  return { text, vendor: v }
}

/** Uma linha do ledger: o modelo, de quem é, e o MOTIVO por extenso. As ações
 *  entram como filhos (cada grupo tem as suas). */
function ModelRow({
  p,
  price,
  pending = false,
  children,
}: {
  p: ModelProposal
  price: string | null
  /** Esta linha pede SUA decisão agora (o grupo "Esperando você") — é a única
   *  cor de atenção da tela (§2: âmbar = precisa de você), então as outras três
   *  histórias (entrou sozinho, foi reprovado, você já aprovou) ficam neutras
   *  de propósito: já têm desfecho, não competem pela mesma tinta. */
  pending?: boolean
  children?: React.ReactNode
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-secondary/20 px-3 py-2",
        pending ? "border-st-warning/30" : "border-border/50",
      )}
    >

      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">
          {p.label}{" "}
          <span className="text-muted-foreground">
            · {rotulo(p.agent)} · {p.value}
          </span>
        </div>
        <div className="text-[12px] leading-snug text-muted-foreground">
          {p.reason || p.description}
          {price ? ` · ${price}` : ""}
        </div>
        {p.evidence && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-faint">
            {p.evidence.split("\n")[0]}
          </div>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </li>
  )
}

export function ModelsSettings() {
  const catalogCount = useApp((s) => s.settings.catalogCount)
  const lastCatalogRefresh = useApp((s) => s.settings.lastCatalogRefresh)
  const lastModelRound = useApp((s) => s.settings.lastModelRound)
  const [rows, setRows] = useState<ModelProposal[]>([])
  const [retirements, setRetirements] = useState<ModelRetirement[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  // Nada de vazio prematuro: "nenhum modelo" só aparece depois da leitura.
  const [loaded, setLoaded] = useState(false)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    const [p, r, c] = await Promise.all([
      listModelProposals(),
      listModelRetirements(),
      getModelsCatalog(),
    ])
    setRows(p)
    setRetirements(r)
    setCatalog(c)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Decisão do gate humano. Gesto que não gravou NÃO some da tela (ADR-017). */
  async function decide(p: ModelProposal, status: "active" | "dismissed") {
    const ok = await setModelProposalStatus(p.id, status)
    if (!ok) {
      toast.error("Não deu pra gravar a decisão. O modelo continua como estava.")
      return
    }
    // O picker é montado do BANCO, sempre: aprovar e tirar passam pelo mesmo
    // recarregamento, então a lista da tela e o seletor não podem discordar.
    await reloadActiveProposals()
    await load()
  }

  /** O gesto: a rodada inteira, sem freio de tempo. Gasta quota (um token por
   *  candidato novo), então o resultado é contado de volta, nunca engolido. */
  async function checkNow() {
    setChecking(true)
    try {
      // O preço é uma das três pernas: catálogo velho reprovaria candidato por
      // desatualização nossa. Rede caída não impede a rodada (o SEED responde).
      if (!(await refreshCatalogIntoSettings()))
        toast.warning(
          "Não deu pra baixar o catálogo agora. O snapshot anterior segue valendo.",
        )
      const report = await runModelRound({ trigger: "gesture" })
      if (!report) {
        toast.error("A rodada não rodou (o app precisa estar no desktop).")
        return
      }
      toast.success(roundSummary(report))
      for (const gap of roundGaps(report, rotulo)) toast.warning(gap)
    } catch (e) {
      // Gesto espera resultado: falha vira frase, não silêncio.
      toast.error(
        `A rodada de modelos falhou: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      await load()
      setChecking(false)
    }
  }

  const precoDe = (p: ModelProposal) =>
    fmtCatalogPrice(catalogEntryFor(catalog, p.agent, p.value))

  const sozinhos = rows.filter(
    (r) => r.status === "active" && r.decidedBy === "app",
  )
  const aprovados = rows.filter(
    (r) => r.status === "active" && r.decidedBy === "human",
  )
  const pendentes = rows.filter((r) => r.status === "proposed")
  const reprovados = rows.filter((r) => r.status === "rejected")
  const vazio =
    sozinhos.length === 0 &&
    aprovados.length === 0 &&
    pendentes.length === 0 &&
    reprovados.length === 0

  return (
    <div>
      <SectionHeader
        title={sectionDef("models").title}
        description={sectionDef("models").question}
        action={
          <button
            onClick={() => void checkNow()}
            disabled={checking}
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className={cn("size-3.5", checking && "animate-spin")} />
            {checking ? "Verificando..." : "Verificar agora"}
          </button>
        }
      />

      {retirements.length > 0 && (
        <Block>
          <BlockTitle hint="O fornecedor anunciou o fim destes modelos. Eles continuam funcionando e ninguém os tira do seu seletor; a troca é sua.">
            Aposentadoria anunciada
          </BlockTitle>
          <ul className="flex flex-col gap-1.5">
            {retirements.map((r) => {
              const { text, vendor } = splitVendorNote(r.reason, r.vendorNote)
              return (
                <li
                  key={`${r.agent}:${r.value}`}
                  className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                >
                  <div className="text-[13px] text-foreground">
                    {r.value}{" "}
                    <span className="text-muted-foreground">
                      · {rotulo(r.agent)} · sucessor {r.successor}
                    </span>
                  </div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
                    {text}
                  </div>
                  {vendor && (
                    <div className="mt-1 rounded border border-border/40 bg-background/40 px-2 py-1 font-mono text-[11px] leading-snug text-faint">
                      {vendor}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Block>
      )}

      <Block>
        <BlockTitle hint="De onde cada modelo do seletor veio, o que ainda espera você e o que não passou. Nada some daqui sem motivo escrito.">
          Modelos novos
        </BlockTitle>
        {!loaded ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Conferindo o que já foi decidido...
          </div>
        ) : vazio ? (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-[12px] text-muted-foreground">
            Nenhum modelo novo por aqui. Última verificação{" "}
            {fmtCheckedAt(lastModelRound)}.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sozinhos.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  Entraram sozinhos
                </div>
                <ul className="flex flex-col gap-1.5">
                  {sozinhos.map((p) => (
                    <ModelRow key={p.id} p={p} price={precoDe(p)}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void decide(p, "dismissed")}
                      >
                        Tirar do seletor
                      </Button>
                    </ModelRow>
                  ))}
                </ul>
              </div>
            )}

            {pendentes.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-st-warning">
                  Esperando você
                </div>
                <ul className="flex flex-col gap-1.5">
                  {pendentes.map((p) => (
                    <ModelRow key={p.id} p={p} price={precoDe(p)} pending>
                      <Button
                        size="sm"
                        className="bg-brass text-background hover:bg-brass hover:opacity-90"
                        onClick={() => void decide(p, "active")}
                      >
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void decide(p, "dismissed")}
                      >
                        Dispensar
                      </Button>
                    </ModelRow>
                  ))}
                </ul>
              </div>
            )}

            {reprovados.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  Não entraram
                </div>
                <ul className="flex flex-col gap-1.5">
                  {reprovados.map((p) => (
                    <ModelRow key={p.id} p={p} price={precoDe(p)}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void decide(p, "dismissed")}
                      >
                        Dispensar
                      </Button>
                    </ModelRow>
                  ))}
                </ul>
              </div>
            )}

            {aprovados.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  Você aprovou
                </div>
                <ul className="flex flex-col gap-1.5">
                  {aprovados.map((p) => (
                    <ModelRow key={p.id} p={p} price={precoDe(p)}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void decide(p, "dismissed")}
                      >
                        Tirar do seletor
                      </Button>
                    </ModelRow>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <Note>
          Verificar agora pergunta a lista viva de cada CLI, testa até 3
          candidatos NOVOS por motor (um token cada, centavos) e confere o
          preço. Quem passa nos três entra sozinho como OPÇÃO do seletor. O seu
          modelo padrão nunca muda sozinho, e tirar do seletor é um clique.
          Sem gesto, a mesma rodada acontece no máximo 1×/dia.
        </Note>
      </Block>

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
          nunca com um número inventado, e é por isso que ele não entra sozinho
          no seletor.
        </Note>
      </Block>
    </div>
  )
}
