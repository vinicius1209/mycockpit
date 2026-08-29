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
import { ChevronRight, RotateCcw } from "lucide-react"
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
import {
  Block,
  BlockTitle,
  Card,
  CardBody,
  CardHead,
  Note,
  SectionHeader,
  Selo,
} from "@/components/settings/parts"
import { fmtCheckedAt } from "@/components/settings/format"
import {
  historicoDeModelos,
  seletorDoAgente,
  totalDeModelos,
} from "@/lib/seletorDeModelos"
import { LEAGUE_DESTINATIONS, agentModels, defaultModelFor } from "@/lib/agents"
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
  const [rows, setRows] = useState<ModelProposal[]>([])
  const [retirements, setRetirements] = useState<ModelRetirement[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  // Nada de vazio prematuro: "nenhum modelo" só aparece depois da leitura.
  // Qual cartão de agent está aberto. Todos fechados por padrão: a pergunta
  // "quantos eu tenho" se responde pelo cabeçalho, sem abrir nada.
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
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

  const pendentes = rows.filter((r) => r.status === "proposed")
  const seletores = LEAGUE_DESTINATIONS.map((d) =>
    seletorDoAgente(
      d.id,
      agentModels(d.id),
      defaultModelFor(d.id),
      retirements,
      rows,
    ),
  )
  const historico = historicoDeModelos(rows, retirements)

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

      {/* 1. O ÚNICO bloco com peso, e ele SOME quando não há nada esperando.
             Bloco que aparece sempre ninguém lê. */}
      {pendentes.length > 0 && (
        <Block>
          <BlockTitle hint="Passaram no teste de 1 token e o preço confere. Entram no seletor só se você quiser.">
            Precisam de você · {pendentes.length}
          </BlockTitle>
          <ul className="flex flex-col gap-1.5">
            {pendentes.map((p) => (
              <ModelRow key={p.id} p={p} price={precoDe(p)} pending>
                <Button
                  size="padrao"
                  className="bg-brass text-background hover:bg-brass hover:opacity-90"
                  onClick={() => void decide(p, "active")}
                >
                  Adicionar
                </Button>
                <Button size="padrao" variant="ghost" onClick={() => void decide(p, "dismissed")}>
                  Não
                </Button>
              </ModelRow>
            ))}
          </ul>
        </Block>
      )}

      {/* 2. A RESPOSTA DA PERGUNTA DO TÍTULO — e ela não existia. A tela
             prometia "quais modelos entram no seletor" e mostrava só eventos.
             Um cartão por agent, fechado: são 27 modelos ao todo (medido), e
             lista chapada viraria rolagem. */}
      <Block>
        <BlockTitle hint="O que aparece no seletor de cada conversa. Tirar vale só pro que entrou por decisão sua.">
          No seu seletor · {totalDeModelos(seletores)}
        </BlockTitle>
        <div className="flex flex-col gap-1.5">
          {seletores.map((s) => (
            <Card key={s.agent}>
              <button
                type="button"
                onClick={() =>
                  setAberto((a) => ({ ...a, [s.agent]: !a[s.agent] }))
                }
                className="w-full text-left transition-colors hover:bg-accent/40"
                aria-expanded={!!aberto[s.agent]}
              >
                <CardHead
                  nome={rotulo(s.agent)}
                  meta={`${s.linhas.length} modelos`}
                  selo={
                    s.aposentando > 0 ? (
                      <Selo tom="atencao">{s.aposentando} aposentando</Selo>
                    ) : undefined
                  }
                  acao={
                    <ChevronRight
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        aberto[s.agent] && "rotate-90",
                      )}
                    />
                  }
                />
              </button>
              {aberto[s.agent] && (
                <CardBody>
                  <ul className="flex flex-col gap-0.5">
                    {s.linhas.map((l) => (
                      <li
                        key={l.value}
                        className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-foreground">
                            {l.value}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {/* A APOSENTADORIA MORA NA LINHA DO MODELO, não num
                                bloco no topo: é aqui que ela muda a decisão. */}
                            {l.aposentando
                              ? l.aposentando.sucessor
                                ? `O fornecedor vai aposentar. Sucessor: ${l.aposentando.sucessor}`
                                : "O fornecedor vai aposentar."
                              : l.description}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {l.padrao && <Selo tom="neutro">padrão</Selo>}
                          {l.aposentando && <Selo tom="atencao">aposentando</Selo>}
                          {l.removivelPor && (
                            <button
                              type="button"
                              onClick={() => void decide(l.removivelPor!, "dismissed")}
                              className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              tirar
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              )}
            </Card>
          ))}
        </div>
      </Block>

      {/* 3. O CHANGELOG sai da frente sem deixar de existir: "nada some daqui
             sem motivo escrito" continua valendo, agora fechado. */}
      {historico.length > 0 && (
        <Block>
          <details>
            <summary className="cursor-pointer text-[12px] text-muted-foreground marker:text-faint">
              Histórico de mudanças · {historico.length}
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {historico.map((e) => (
                <li key={e.chave} className="flex gap-2.5 text-[12px] text-muted-foreground">
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    {fmtCheckedAt(e.quando)}
                  </span>
                  <span className="min-w-0">
                    {rotulo(e.agent)}: {e.texto}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </Block>
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
          nunca com um número inventado, e é por isso que ele não entra sozinho
          no seletor.
        </Note>
      </Block>
    </div>
  )
}
