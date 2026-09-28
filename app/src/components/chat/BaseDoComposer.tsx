// A BASE do composer (ADR-247, mock `docs/mocks/base-do-composer.html`).
//
// Plano, fila e exceções do turno eram quatro cartões empilhados acima do
// composer, cada um com borda e estilo próprios, e a pilha comia a tela durante
// o turno inteiro. Agora o que é INFORMAÇÃO do turno vira uma tira de uma linha
// presa ao topo do composer, com uma gaveta que abre por clique, uma por vez. O
// que pede DECISÃO (aprovação, pergunta, aviso que bloqueia o envio) continua
// cartão acima: essa separação é a regra desta superfície.
//
// Da conversa com a pessoa (24/09/2026):
//  - o plano mostra a etapa corrente com "1/8" no fim, como antes; barrinha de
//    etapas não, porque cresce com o plano e disputa espaço com o título;
//  - a fila mostra os ANEXOS com a tira fechada (miniaturas, "+N"): "posso ter
//    enviado anexos… quero ter visibilidade".
//
// Regras do plano que vieram do `LivePlanCard` (tasks.AGENTS.md): só aparece com
// plano corrente sem terminal e turno vivo; o resumo é a etapa em andamento, ou
// "Próxima:" quando o agente ainda não disse qual; com a aba do painel aberta,
// o detalhe é dela e a gaveta não abre.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, Check, Clock, Gauge, ListChecks } from "lucide-react"
import { CometaVivo } from "@/components/ui/cometa-vivo"
import { QueuedChips } from "@/components/chat/FilaDoComposer"
import { guardarDaFila } from "@/components/notes/notaGuardada"
import { agirNaExcecao, ListaDeExcecoes } from "@/components/chat/ExcecoesDoTurno"
import { useCotaNaTira } from "@/components/chat/CotaPertoBanner"
import { MiniaturaDaTira } from "@/components/chat/MiniaturaDeAnexo"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { moverNaFila } from "@/components/chat/filaComposer"
import { agentLabel } from "@/lib/agent"
import { excecoesDoTurno } from "@/lib/excecoesDoTurno"
import { taskPlansOf } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { controle } from "@/components/ui/controle"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"

type Gaveta = "plano" | "fila" | "aviso" | "cota"

/** Episódios de cota já mostrados: a gaveta abre sozinha só na primeira vez. */
const cotasJaAbertas = new Set<string>()

/** O que a tira diz do plano, ou null quando não há plano vivo. Puro. */
export function resumoDoPlano(
  items: ConvState["items"],
  vivo: boolean,
): { texto: string; feitas: number; total: number; andando: boolean; semEtapaCorrente: boolean } | null {
  const plano = taskPlansOf(items).live
  const tasks = plano?.tasks ?? []
  if (!plano || tasks.length === 0 || !vivo) return null
  const atual = tasks.find((t) => t.status === "in_progress")
  const proxima = tasks.find((t) => t.status === "pending")
  return {
    texto: atual ? (atual.active ?? atual.title) : proxima ? `Próxima: ${proxima.title}` : "Plano concluído",
    feitas: tasks.filter((t) => t.status === "completed").length,
    total: tasks.length,
    andando: !!atual,
    semEtapaCorrente: !atual && !!proxima,
  }
}

function Segmento({
  aberto,
  onClick,
  children,
  titulo,
  cresce = false,
  desabilitado = false,
}: {
  aberto: boolean
  onClick: () => void
  children: ReactNode
  titulo?: string
  cresce?: boolean
  desabilitado?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      title={titulo}
      aria-expanded={desabilitado ? undefined : aberto}
      className={cn(
        // Só o título da etapa cede; contador, fila e aviso nunca quebram.
        controle("compacto"),
        "gap-2 rounded-none whitespace-nowrap transition-colors not-first:border-l not-first:border-border/40 disabled:cursor-default",
        cresce ? "min-w-0 flex-1" : "shrink-0",
        aberto ? "bg-sel text-foreground" : "text-muted-foreground hover:text-foreground enabled:hover:bg-sel-hover",
      )}
    >
      {children}
    </button>
  )
}

export function BaseDoComposer({
  conv,
  convId,
  onEdit,
  onForceSend,
}: {
  conv: Pick<ConvState, "items" | "running" | "finalizing" | "runManifest" | "agent" | "queued" | "stagedAgent">
  convId: string | null
  onEdit?: (index: number) => void
  onForceSend?: (index: number) => void
}) {
  // "auto" até o primeiro gesto: com mensagem na fila, a gaveta da FILA nasce
  // aberta. O texto que você escreveu e o que anexou ficam à vista (ADR-240:
  // "anexo algo, esqueço, e não consigo mais ver"); recolher é gesto seu.
  const [gaveta, setGaveta] = useState<Gaveta | null | "auto">("auto")
  const detalheNoPainel = useApp((s) => s.contextOpen && s.contextPanelTab === "conversa")
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path ?? null)
  const vivo = conv.running || conv.finalizing
  const plano = useMemo(() => resumoDoPlano(conv.items, vivo), [conv.items, vivo])
  const fila = conv.queued ?? []
  const excecoes = excecoesDoTurno(conv.runManifest, agentLabel(conv.agent))
  const anexos = fila.flatMap((m) => m.attachments)
  const cota = useCotaNaTira(conv, convId)
  // O aviso de cota é novidade: na primeira vez do episódio, a gaveta dele abre.
  const episodio = cota?.chave ?? null
  useEffect(() => {
    if (!episodio || cotasJaAbertas.has(episodio)) return
    cotasJaAbertas.add(episodio)
    setGaveta("cota")
  }, [episodio])

  if (!plano && fila.length === 0 && excecoes.length === 0 && !cota) return null
  // A gaveta aberta de algo que sumiu (a fila esvaziou, o plano acabou) fecha.
  const pedida = gaveta === "auto" ? (fila.length > 0 ? "fila" : null) : gaveta
  const aberta =
    (pedida === "plano" && plano && !detalheNoPainel) ||
    (pedida === "fila" && fila.length > 0) ||
    (pedida === "aviso" && excecoes.length > 0) ||
    (pedida === "cota" && cota)
      ? pedida
      : null
  const alterna = (g: Gaveta) => setGaveta(aberta === g ? null : g)
  const turnState = conv.running ? "running" : conv.finalizing ? "finalizing" : "idle"

  const imagens = anexos.filter((a) => a.kind === "image").length
  const documentos = anexos.length - imagens
  const resumoDosAnexos = [
    imagens ? `${imagens} ${imagens === 1 ? "imagem" : "imagens"}` : null,
    documentos ? `${documentos} ${documentos === 1 ? "documento" : "documentos"}` : null,
  ]
    .filter(Boolean)
    .join(" e ")

  return (
    <div data-base-do-composer className="mx-2.5 overflow-hidden rounded-t-xl border border-b-0 bg-card/60">
      <div className="flex min-w-0">
        {plano && (
          <Segmento
            cresce
            aberto={aberta === "plano"}
            onClick={() => alterna("plano")}
            desabilitado={detalheNoPainel}
            titulo={detalheNoPainel ? "Etapas abertas no painel Plano" : plano.texto}
          >
            {plano.andando && conv.running ? (
              <span className="grid size-3.5 shrink-0 place-items-center">
                <CometaVivo papel="passo" className="text-muted-foreground" />
              </span>
            ) : plano.feitas === plano.total ? (
              <Check className="size-3.5 shrink-0 text-muted-foreground/60" />
            ) : (
              <ListChecks className="size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <span className="min-w-0 flex-1 truncate text-left text-foreground/85">{plano.texto}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
              {plano.feitas}/{plano.total}
            </span>
          </Segmento>
        )}
        {fila.length > 0 && (
          <Segmento
            aberto={aberta === "fila"}
            onClick={() => alterna("fila")}
            titulo={`${fila.length} ${fila.length === 1 ? "mensagem" : "mensagens"} na fila${resumoDosAnexos ? ` · ${resumoDosAnexos} vão junto` : ""}`}
          >
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-st-queued/15 px-1 text-[11px] font-semibold text-st-queued tabular-nums">
              {fila.length}
            </span>
            na fila
            {anexos.length > 0 && (
              <span className="flex items-center gap-0.5">
                {anexos.slice(0, 3).map((a) => (
                  <MiniaturaDaTira key={a.path} anexo={a} />
                ))}
                {anexos.length > 3 && (
                  <span className="ml-0.5 text-[11px] text-muted-foreground tabular-nums">+{anexos.length - 3}</span>
                )}
              </span>
            )}
          </Segmento>
        )}
        {excecoes.length > 0 && (
          <Segmento aberto={aberta === "aviso"} onClick={() => alterna("aviso")}>
            <AlertTriangle
              className={cn(
                "size-3.5",
                excecoes.some((e) => e.tom === "atencao") ? "text-st-warning" : "text-muted-foreground",
              )}
              aria-hidden
            />
            {excecoes.length} {excecoes.length === 1 ? "aviso" : "avisos"}
          </Segmento>
        )}
        {cota && (
          <Segmento aberto={aberta === "cota"} onClick={() => alterna("cota")} titulo={cota.titulo}>
            {cota.motivo === "ritmo" ? (
              <Clock className="size-3.5 text-st-warning" aria-hidden />
            ) : (
              <Gauge className="size-3.5 text-st-warning" aria-hidden />
            )}
            <span className="tabular-nums">{cota.resumo}</span>
          </Segmento>
        )}
      </div>
      {aberta && (
        <div className="max-h-64 overflow-y-auto border-t border-border/40">
          {aberta === "plano" && plano && (
            <div aria-label="Etapas do plano" className="px-3 py-2">
              {plano.semEtapaCorrente && (
                <p className="mb-1.5 px-1 text-[11px] text-muted-foreground/70">
                  O agente ainda não informou qual etapa está em andamento.
                </p>
              )}
              <TaskChecklist tasks={taskPlansOf(conv.items).live?.tasks ?? []} dense live={vivo} />
            </div>
          )}
          {aberta === "fila" && convId && (
            <QueuedChips
              embutida
              queued={fila}
              onEdit={onEdit}
              onForceSend={onForceSend}
              onRemove={(i) => useChat.getState().removeQueued(convId, i)}
              onMover={(de, para) => moverNaFila(convId, de, para)}
              onGuardar={(i, escopo) => void guardarDaFila(convId, i, escopo)}
              turnState={turnState}
            />
          )}
          {aberta === "cota" && cota?.detalhe}
          {aberta === "aviso" && <ListaDeExcecoes embutida excecoes={excecoes} onAcao={(e) => agirNaExcecao(e, projectPath)} />}
        </div>
      )}
    </div>
  )
}
