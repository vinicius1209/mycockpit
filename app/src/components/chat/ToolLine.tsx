// A LINHA de uma ação no fio (saiu do MessageList, que estava no teto da
// catraca de tamanho: dividir, nunca subir). Desde a ADR-241 ela diz VERBO +
// OBJETO: arquivo vira pílula com o ícone do tipo, e a narração do agente vai
// para o hover quando existe objeto melhor que ela.
import { memo, useEffect, useMemo, useState } from "react"
import {
  Bot,
  ChevronRight,
  Copy,
  FilePen,
  FileText,
  Globe,
  ImagePlus,
  MessageSquareQuote,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { avisar } from "@/lib/avisos"
import { StepDot, type StepStatus } from "@/components/chat/statusGlyphs"
import { DeferredOutputFile } from "@/components/chat/DeferredOutputFile"
import { EvidenceThumb, evidenceGallery } from "@/components/chat/MiniaturasDoFio"
import { editHunks, UnifiedDiff } from "@/components/chat/InlineDiff"
import { FraseDaAcao } from "@/components/chat/FraseDaAcao"
import type { ToolItem } from "@/components/chat/messageNodes"
import {
  branchContains,
  hasRunningDescendant,
  NO_NAMED_WORK,
  type ToolTreeNode,
} from "@/components/chat/toolTree"
import { detailBornOpen } from "@/components/chat/toolGroupDisclosure"
import { ToolNodeList } from "@/components/chat/ToolGroup"
import { controle } from "@/components/ui/controle"
import { useNasceuAgora, useTrocou } from "@/lib/nascimento"
import { cn } from "@/lib/utils"
import {
  cleanResultText,
  evidenceMeta,
  META_NAVEGADOR_EXTERNO,
  presentTool,
  resultMeta,
  type ToolKind,
} from "@/lib/toolview"
import { workKey } from "@/lib/toolGroup"
import { useLightbox } from "@/store/lightbox"
import { deferredRetryTitle } from "@/store/chat"

const KIND_ICON: Record<ToolKind, LucideIcon> = {
  bash: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  image: ImagePlus,
  generic: Wrench,
}


/** Tool call como LINHA (círculo de status + ícone + rótulo + meta), colapsável.
 *  A prosa do agent é o conteúdo; a ferramenta é rodapé, não caixa. `active` =
 *  o turno está rodando E este é o passo corrente (sem result ainda). */
export const ToolLine = memo(function ToolLine({
  node,
  activeToolId,
  agent,
  depth = 1,
  deferredPending = false,
  namedWork = NO_NAMED_WORK,
  onStop,
  onRetry,
  atraso,
}: {
  node: ToolTreeNode
  /** Posição na cascata da rajada (ms); só vale para quem nasceu agora. */
  atraso?: number
  activeToolId?: string | null
  agent: string
  depth?: number
  /** Há trabalho em background do provider vivo neste fio (D1.4): o botão de
   *  interromper avisa que ele morre junto com o turno. */
  deferredPending?: boolean
  /** Trabalhos (`workKey`) cujo nome um ancestral visível já mostrou: se ESTA
   *  linha apresenta um deles, ela mostra só o delta (o estado). Falha nunca
   *  dedupa — a linha falhada é a evidência e mantém o nome. */
  namedWork?: ReadonlySet<string>
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
  onApprovePlan?: (id: string) => void
}) {
  const { item, children } = node
  const active =
    branchContains(node, activeToolId) ||
    item.managedProcess?.status === "running" ||
    item.managedProcess?.status === "stopping" ||
    item.deferred?.status === "running"
  const p = presentTool(item.name, item.input)
  const Icon = KIND_ICON[p.kind]
  const i = (item.input ?? {}) as Record<string, unknown>
  const diff = editHunks(item.name, i)
  // Nível 2 do disclosure: primeiro se abre o grupo semântico; só um gesto
  // explícito revela comando/input/output/diff desta ação.
  const [open, setOpen] = useState(active && children.length > 0)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const failed = item.result?.ok === false && !item.result.interrupted
  const status: StepStatus = item.result
    ? item.result.ok
      ? "ok"
      : item.result.interrupted
        ? "stopped"
        : "error"
    : active
      ? "running"
      : "recorded"
  const [nasceu, trocou] = [useNasceuAgora(item.ts), useTrocou(status)]
  const res = resultMeta(item.name, item.result)
  const processStatusLabel = item.managedProcess
    ? item.managedProcess.status === "running"
      ? "em execução"
      : item.managedProcess.status === "stopping"
        ? "parando"
        : item.managedProcess.status === "stopped"
          ? "parou"
          : item.managedProcess.status === "failed"
            ? "falhou"
            : item.managedProcess.status === "orphaned"
              ? "órfão"
              : "encerrado"
    : null
  const processMeta = item.managedProcess
    ? `PID ${item.managedProcess.pid} · ${processStatusLabel}`
    : null
  // Estado do trabalho diferido no PRÓPRIO rótulo da linha (D1.2). Rodando, o
  // nó é MARCO ("iniciado", onde o trabalho nasceu): quem narra o agora é a
  // linha viva do rodapé, e dois painéis vivos competindo foi a confusão dos
  // builds 181/182 (background-status B2.2).
  const deferredMeta = item.deferred
    ? item.deferred.status === "running"
      ? "iniciado"
      : item.deferred.status === "completed"
        ? "concluiu"
        : "interrompido"
    : null
  // Rótulo UMA vez (despoluição, paleta A ①): o nome pertence ao TRABALHO, e
  // quem já mostrou é dono. Se um ancestral visível (cabeçalho do grupo ou uma
  // linha acima) já apresentou ESTA entidade, o nó mostra só o delta dele — o
  // estado (que no diferido já é a meta "iniciado/concluiu/interrompido").
  // Falha não dedupa: a linha falhada é a evidência e mantém o nome.
  const work = workKey(item)
  const echoesOwner =
    work != null && status !== "error" && namedWork.has(work)
  // A posse desce inteira: quem apresentou a entidade (ou herdou a posse dela)
  // repassa aos descendentes, então o mesmo nome não reaparece 2 níveis abaixo.
  const namedForChildren = useMemo(() => {
    if (work == null || namedWork.has(work)) return namedWork
    const next = new Set(namedWork)
    next.add(work)
    return next as ReadonlySet<string>
  }, [namedWork, work])
  const stateWord =
    status === "running"
      ? "em execução"
      : status === "ok"
        ? "concluído"
        : status === "stopped"
          ? "parou"
          : "registrado"
  const label = echoesOwner ? (deferredMeta ?? stateWord) : p.label
  // Com o arquivo na pílula (caminho no hover) e a tool nomeada na frase, a
  // meta não repete nenhum dos dois; o aviso de navegador externo fica.
  const metaPropria =
    p.meta && (p.object?.kind === "file" || p.kind === "generic")
      ? p.meta.startsWith(META_NAVEGADOR_EXTERNO)
        ? META_NAVEGADOR_EXTERNO
        : null
      : p.meta
  const meta = [
    metaPropria,
    processMeta,
    echoesOwner ? null : deferredMeta,
    res,
    evidenceMeta(item.images, item.name),
  ]
    .filter(Boolean)
    .join(" · ")
  // Suprime o boilerplate de sucesso do write/edit ("File created…") — vira ""
  // e o bloco de result nem aparece (o cartão já mostra arquivo + diff).
  const resultText = cleanResultText(item.name, item.result)
  const expandable = Boolean(
    p.detail ||
      diff ||
      resultText ||
      item.agentSummary ||
      item.deferred?.outputFile ||
      children.length,
  )
  // Ação no dono certo (background-status B2.4): no cartão de UM trabalho só
  // cabe ação DAQUELE trabalho. "Interromper turno" mata o turno inteiro, então
  // mora na superfície do turno (o Parar do composer, com a copy do D1.4). No
  // nó de trabalho diferido ele ainda era pior: depois do `result` o runId já é
  // null (chat.ts:1050) e o clique não parava nada — botão de teatro.
  const stopInHeader =
    active &&
    onStop &&
    item.deferred == null &&
    (p.kind === "agent" || item.managedProcess != null)
  const briefingLines = p.detail ? Math.max(1, p.detail.split("\n").length) : 0
  // Régua do briefing aplicada ao bloco de comando/entrada: a caixa irmã já
  // nascia recolhida, dizia o tamanho e tinha teto de altura; esta não tinha
  // nenhuma das três, e um heredoc de 34 linhas empurrava o estado vivo pra
  // fora da viewport. Comando de UMA linha (o caso comum) segue aberto: o
  // recolhimento custaria mais clique do que economiza altura.
  const isCommand = p.kind === "bash"
  const detailTitle = isCommand ? "Comando" : "Entrada"
  const [detailOpen, setDetailOpen] = useState(() => detailBornOpen(briefingLines))

  useEffect(() => {
    if (active && children.length) setOpen(true)
  }, [active, children.length])

  return (
    <div
      className={cn("min-w-0", nasceu && "fio-nasce-desliza")}
      style={nasceu && atraso ? { animationDelay: `${atraso}ms` } : undefined}
    >
      <div className="flex min-w-0 items-center">
        <button
          onClick={() => expandable && setOpen((o) => !o)}
          data-work-node
          data-node-id={item.toolId ?? item.id}
          data-parent-id={item.parentToolId}
          role="treeitem"
          aria-level={depth}
          aria-expanded={expandable ? open : undefined}
          tabIndex={-1}
          className={cn(
            controle("compacto"),
            "group/step flex min-w-0 flex-1 text-left transition-colors",
            expandable && "hover:bg-sel-hover",
            p.emphasis === "warning" && status !== "error" && "text-st-warning",
          )}
        >
        <span
          className="grid size-4 shrink-0 place-items-center"
          title={status === "recorded" ? "sem resultado registrado" : undefined}
        >
          {status === "running" || status === "stopped" ? (
            <StepDot status={status} ancestor={hasRunningDescendant(node, activeToolId)} />
          ) : (
            <Icon
              className={cn(
                "size-3.5",
                trocou && "fio-assenta",
                failed
                  ? "text-st-error"
                  : status === "ok"
                    ? "text-muted-foreground/55"
                    : p.emphasis === "warning"
                      ? "text-st-warning"
                      : "text-muted-foreground/70",
              )}
            />
          )}
        </span>
        <span
          // A narração vai pro hover só quando a linha mostra OUTRA coisa
          // (a pílula, a busca); quando ela já é a frase, repetir é ruído.
          title={
            echoesOwner || (p.object?.kind === "text" && p.object.frase)
              ? undefined
              : (p.narration ?? undefined)
          }
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            // estado no PRÓPRIO rótulo (não só no ponto): concluído assenta,
            // em execução fica pleno → a sequência ganha ritmo de progresso.
            failed
              ? "text-foreground"
              : status === "ok"
                ? "text-foreground/55"
                : status === "running"
                  ? "text-foreground"
                  : p.emphasis === "warning"
                    ? "text-st-warning"
                    : "text-foreground/75",
          )}
        >
          {echoesOwner ? <span className="truncate">{label}</span> : <FraseDaAcao view={p} />}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {diff ? (
            // contagem de diff em SUSSURRO (paleta A: metadado, não semáforo);
            // as cores continuam dentro do diff aberto, onde são evidência.
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
              {diff.added > 0 && `+${diff.added}`}
              {diff.added > 0 && diff.removed > 0 && " "}
              {diff.removed > 0 && `−${diff.removed}`}
            </span>
          ) : (
            meta && (
              <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                {meta}
              </span>
            )
          )}
          {/* Selo do motor saiu do nó (background-status B2.3): ele mora no
              cabeçalho do agente (work-hierarchy) — repetido em cada linha
              virava ruído ao lado do rótulo de transporte. */}
          {expandable && (
            // seta de expandir no FIM (longe do ícone `>_` → sem duplicação).
            <ChevronRight
              className={cn(
                "size-3 text-muted-foreground/45 transition-transform group-hover/step:text-muted-foreground/70",
                open && "rotate-90",
              )}
            />
          )}
        </span>
        </button>
        {stopInHeader && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStop(item)
            }}
            title={
              item.managedProcess
                ? item.managedProcess.status === "stopping"
                  ? "Processo encerrando. Clique para forçar a parada imediata."
                  : "Para este processo e os filhos dele"
                : deferredPending
                  ? "O provider não expõe cancelamento individual deste subagente; interrompe o turno completo e o trabalho em background morre junto"
                  : "O provider não expõe cancelamento individual deste subagente; interrompe o turno completo"
            }
            className={cn(controle("chip"), "mr-1 border border-st-error/30 text-st-error transition-colors hover:bg-st-error/10")}
          >
            <Square className="size-2.5" />
            <span className="hidden lg:inline">
              {item.managedProcess
                ? item.managedProcess.status === "stopping"
                  ? "Forçar parada"
                  : "Parar"
                : "Interromper turno"}
            </span>
          </button>
        )}
      </div>
      {/* Evidência VISUAL do resultado (B1): sempre à mostra (o valor é VER o
          que o agent viu), thumbnail modesto — detalhe é no lightbox. Tool sem
          imagem não rende nada aqui (fail-open). */}
      {item.images && item.images.length > 0 && (
        <div className="mt-1 mb-1 ml-7 flex flex-wrap gap-1.5">
          {item.images.map((path, i) => (
            <EvidenceThumb
              key={path}
              path={path}
              onOpen={() =>
                useLightbox.getState().open(evidenceGallery(item.images!), i)
              }
            />
          ))}
        </div>
      )}
      {open && (
        <div className="fio-ramo">
          {p.kind === "agent" && p.detail && (
            <div className="mt-1 mb-1.5 overflow-hidden rounded-md bg-secondary/20">
              <button
                type="button"
                onClick={() => setBriefingOpen((value) => !value)}
                aria-expanded={briefingOpen}
                className={cn(controle("chip"), "flex w-full gap-2 text-left text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground")}
              >
                <MessageSquareQuote className="size-3.5 shrink-0" />
                <span>Briefing do agente</span>
                <span className="font-mono text-[11px] text-muted-foreground/70">
                  · {briefingLines} linha{briefingLines === 1 ? "" : "s"}
                </span>
                <ChevronRight
                  className={cn(
                    "ml-auto size-3 text-muted-foreground/45 transition-transform",
                    briefingOpen && "rotate-90",
                  )}
                />
              </button>
              {briefingOpen && (
                <div
                  data-selectable
                  className="max-h-52 overflow-y-auto border-t border-border/40 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/70"
                >
                  {p.detail}
                </div>
              )}
            </div>
          )}
          {((p.kind !== "agent" && p.detail) ||
            diff ||
            resultText ||
            item.agentSummary ||
            (item.result && onRetry)) && (
            <div className="mt-1 mb-1.5 overflow-hidden rounded-md bg-secondary/20">
              {p.kind !== "agent" && p.detail && (
                <div>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setDetailOpen((value) => !value)}
                      aria-expanded={detailOpen}
                      // Botão, não título: caixa normal (§3). "COMANDO" em caixa alta
                      // se vestia de rótulo e escondia que abre o comando.
                      className={cn(controle("chip"), "flex min-w-0 flex-1 gap-2 text-left font-medium text-muted-foreground/80 transition-colors hover:text-foreground")}
                    >
                      <span>{detailTitle}</span>
                      <span className="font-mono text-[11px]">
                        · {briefingLines} linha{briefingLines === 1 ? "" : "s"}
                      </span>
                      <ChevronRight
                        className={cn(
                          "ml-auto size-3 shrink-0 text-muted-foreground/45 transition-transform",
                          detailOpen && "rotate-90",
                        )}
                      />
                    </button>
                    {/* Contenção visual nunca vira truncagem de evidência: o
                        texto armazenado não muda e sai INTEIRO daqui, recolhido
                        ou não (cláusula do Codex na auditoria). */}
                    <button
                      type="button"
                      title={isCommand ? "Copia o comando inteiro" : "Copia a entrada inteira"}
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard?.writeText(p.detail!)
                        avisar.feito(isCommand ? "Comando copiado" : "Entrada copiada")
                      }}
                      className="mr-1.5 shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent/40 hover:text-foreground"
                    >
                      <Copy className="size-3" />
                    </button>
                  </div>
                  {detailOpen && (
                    <div
                      data-selectable
                      className="max-h-52 overflow-y-auto px-2 pb-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/70"
                    >
                      {p.detail}
                    </div>
                  )}
                </div>
              )}
              {diff && (
                <div
                  className={cn(
                    p.kind !== "agent" &&
                      p.detail &&
                      "border-t border-border/40",
                  )}
                >
                  <p className="px-2 pt-2 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
                    Alterações
                  </p>
                  {diff.hunks.map((rows, idx) => (
                    <div
                      key={idx}
                      className={cn(idx > 0 && "border-t border-border/40")}
                    >
                      <UnifiedDiff rows={rows} />
                    </div>
                  ))}
                </div>
              )}
              {resultText && (
                <div className="border-t border-border/40 p-2">
                  <p className="mb-1 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
                    {failed ? "Erro" : "Saída"}
                  </p>
                  <div
                    data-selectable
                    className={cn(
                      "font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
                      failed ? "text-st-error" : "text-muted-foreground",
                    )}
                  >
                    {resultText}
                  </div>
                </div>
              )}
              {item.agentSummary && (
                <div className="border-t border-border/40 p-2">
                  <p className="mb-1 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
                    Retorno do agente
                  </p>
                  <div
                    data-selectable
                    className="text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/75"
                  >
                    {item.agentSummary}
                  </div>
                </div>
              )}
              {item.deferred?.outputFile && (
                <DeferredOutputFile
                  outputFile={item.deferred.outputFile}
                  status={item.deferred.status}
                />
              )}
              {/* Retomar ≠ repetir (D1, ADR-182): tool pai com diferido associado
                  não repete p/ não duplicar; só diferido INTERROMPIDO retoma. */}
              {item.result && onRetry && (!item.deferred
                ? !children.some((c) => c.item.deferred != null)
                : item.deferred.status === "interrupted") && (
                <div className="flex items-center justify-end gap-1.5 border-t border-border/40 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRetry(item)
                    }}
                    title={item.deferred ? deferredRetryTitle(item.deferred) : undefined}
                    className={cn(controle("chip"), "border text-muted-foreground hover:bg-accent hover:text-foreground")}
                  >
                    <RotateCcw className="size-3" /> {item.deferred ? "Retomar" : "Repetir etapa"}
                  </button>
                </div>
              )}
            </div>
          )}
          {children.length > 0 && (
            <ToolNodeList
              nodes={children}
              activeToolId={activeToolId}
              agent={agent}
              depth={depth + 1}
              parentId={item.toolId ?? item.id}
              live={active}
              deferredPending={deferredPending}
              namedWork={namedForChildren}
              onStop={onStop}
              onRetry={onRetry}
            />
          )}
        </div>
      )}
    </div>
  )
})
