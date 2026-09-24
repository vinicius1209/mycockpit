import { pastasDoTurno as pastasCitadas } from "@/lib/arquivoCitado"
import type { CausaDoCorte } from "@/lib/corte"
import type { DeferredKind } from "@/lib/work"
import { invoke, Channel } from "@tauri-apps/api/core"
import type { Attachment } from "@/lib/attachments"
import { agentDef } from "@/lib/agents"
import { cumulativeUsageAgents } from "@/lib/agentRoster"
import { loadUsageBaseline, saveUsageBaseline } from "@/lib/db"
import { nextBaseline, type CumulativeUsage } from "@/lib/usage"
import { carregarCustoDaSessao, salvarCustoDaSessao } from "@/lib/db/custoDaSessao"
import type {
  EffectiveRunManifest,
  InstructionSourceClaim,
  McpPreflightGate,
  McpRunOverride,
} from "@/lib/tooling"
import { entregarSemTravar, relatoVisivel } from "@/lib/entregaDeEvento"
import { useBastidores } from "@/store/bastidores"

/** Proveniência do custo (espelha CostSource no Rust). */
export type CostSource = "reported" | "estimated" | "unknown"

/** Eventos normalizados emitidos pelo backend (espelha AgentEvent no Rust). */
export type AgentEvent =
  | { type: "run_manifest"; manifest: EffectiveRunManifest }
  | { type: "preflight_blocked"; gate: McpPreflightGate }
  | { type: "started" }
  | {
      type: "run_status"
      main_alive: boolean | null
      descendants: number | null
      rss_mb: number | null
      last_byte_at: number | null
      observed_at: number
    }
  | { type: "startup_failed"; message: string }
  | { type: "session"; session_id: string; model: string | null; tools: number }
  | { type: "text"; text: string }
  | { type: "subagent_text"; parent_tool_id: string; text: string }
  | { type: "text_delta"; text: string }
  | { type: "text_stop" }
  | {
      type: "tool"
      id: string
      name: string
      input: unknown
      parent_tool_id: string | null
    }
  /** `images` = evidência visual do resultado (browser-plan B1): paths
   *  RELATIVOS ao app_data_dir ("evidence/<convId>/…"), gravados pelo backend.
   *  Ausente/vazio = tool sem imagem (comportamento de sempre). */
  | {
      type: "tool_result"
      id: string
      ok: boolean
      text: string
      lines: number
      images?: string[]
    }
  /** Trabalho DIFERIDO do provider (tool Workflow/background task): vive além
   *  do turno que o criou (deferred-work-plan, D1). `tool_use_id` liga ao
   *  tool_use Workflow de origem; `output_file` = resultado em DISCO da
   *  task_notification (a lição do incidente: o relatório existia e ninguém
   *  sabia); `progress` = cru do task_progress (workflow_progress/usage). */
  | {
      type: "deferred_work"
      id: string
      tool_use_id: string | null
      kind: DeferredKind | null
      name: string | null
      status: "running" | "progress" | "completed" | "stopped"
      summary: string | null
      output_file: string | null
      progress: unknown
    }
  /** Saída AO VIVO de uma tool que ainda roda (ADR-200). Não vai para o fio:
   *  `runAgent` desvia para o painel Bastidores. */
  | { type: "tool_output"; id: string; text: string }
  /** Footprint da última chamada. A janela vem do runtime quando ele informa;
   *  null permite fallback de catálogo explicitamente marcado como estimado. */
  | { type: "context_usage"; tokens: number; window_tokens: number | null }
  /** A fonte esperada falhou; limpa snapshot velho em vez de mostrá-lo como atual. */
  | { type: "context_unavailable" }
  | { type: "limit_reached"; message: string; reset_hint: string | null }
  /** Fim de turno com telemetria. Tokens e custo são SEMPRE do TURNO — quando
   *  o motor só sabe reportar o acumulado da thread, o runner já subtraiu o
   *  baseline (ADR-033). `cumulative_usage` é o acumulado cru daquela thread,
   *  só pro app persistir e devolver no próximo run; NUNCA é o número exibido.
   *  Ausente = motor que reporta por turno. */
  | {
      type: "result"
      ok: boolean
      text: string | null
      cost_usd: number | null
      cost_source: CostSource
      input_tokens: number
      output_tokens: number
      cache_read: number
      cache_creation: number
      cumulative_usage?: CumulativeUsage | null
      /** Custo ACUMULADO da sessão como o CLI reportou (ADR-226): só para
       *  guardar como base do próximo turno. O custo do turno é `cost_usd`. */
      reported_cost_total?: number | null
    }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  /** `cause` é carimbada no app pelo gesto (lib/corte.ts); o runner nunca manda. */
  | { type: "cancelled"; cause?: CausaDoCorte }
  | { type: "done"; code: number | null }
  | { type: "unknown"; raw: unknown }

export interface RunAgentOptions {
  planFirst?: boolean
  memoryFallback?: string | null
  systemPrompt?: string | null
  mcpFingerprint?: string | null
  instructionSources?: InstructionSourceClaim[]
  mcpRecoveries?: McpRunOverride[]
}

/** Dispara um agent de código (`agent` = claude-code | codex | opencode) na pasta
 *  `cwd` e streama eventos via Channel. */
export async function runAgent(
  runId: string,
  convId: string,
  agent: string,
  model: string | null,
  effort: string | null,
  prompt: string,
  cwd: string,
  resume: string | null,
  permission: string,
  attachments: Attachment[],
  onEvent: (e: AgentEvent) => void,
  /** "Planejar primeiro" (plan mode por turno): o motor segura os writes. */
  planFirstOrOptions: boolean | RunAgentOptions = false,
  /** Frota resume: memória da conversa que o motor SÓ usa se o resume
   *  nativo falhar (prepende ao prompt no restart e emite `resume://fallback`).
   *  null = comportamento atual (falha do resume vira erro). */
  legacyMemoryFallback: string | null = null,
  /** H1 (prompt-hygiene-plan): conteúdo de SISTEMA por-run (persona+doutrina).
   *  Motor com `systemChannel` recebe no canal nativo (re-enviado a cada
   *  spawn); sem, o Rust dobra no corpo (fail-open). null = nada. */
  legacySystemPrompt: string | null = null,
  /** H2: fingerprint do último plano de MCPs ANUNCIADO nesta conversa (ledger
   *  `injected.mcp` da store, alimentado por `mcp://announced`). O Rust só
   *  re-anuncia mid-conversa quando o plano atual diverge. null = desconhecido
   *  (anuncia — fail-open pra visibilidade). */
  legacyMcpFingerprint: string | null = null,
  /** Skills de plugin realmente expandidas neste prompt. O Rust revalida o
   * fingerprint antes do spawn; esta lista não é aceita como autoridade. */
  legacyInstructionSources: InstructionSourceClaim[] = [],
  /** Decisão efêmera para um gate anterior, revalidada no backend. */
  legacyMcpRecoveries: McpRunOverride[] = [],
): Promise<void> {
  const options: RunAgentOptions =
    typeof planFirstOrOptions === "boolean"
      ? {
          planFirst: planFirstOrOptions,
          memoryFallback: legacyMemoryFallback,
          systemPrompt: legacySystemPrompt,
          mcpFingerprint: legacyMcpFingerprint,
          instructionSources: legacyInstructionSources,
          mcpRecoveries: legacyMcpRecoveries,
        }
      : planFirstOrOptions
  // ADR-033 — usage acumulado por thread: ÚNICO ponto do app em que o baseline
  // entra e o acumulado volta. Todas as superfícies que rodam agent (chat,
  // disputa, missão, agenda) passam por aqui, então nenhuma
  // delas precisa saber que existe motor que reporta acumulado.
  // Quem reporta acumulado sai do registry (capability), nunca de nome de
  // motor; sem resume não há thread anterior, então não há baseline.
  const baseline =
    resume && agentDef(agent)?.cumulativeUsage
      ? await loadUsageBaseline(
          resume,
          convId,
          cumulativeUsageAgents().map((a) => a.id),
        )
      : null
  // ADR-226: o custo que a sessão retomada já reportou, para o runner tirar
  // o custo DESTE turno do acumulado. Motor que não reporta custo não tem o
  // que descontar (capability, nunca nome de motor).
  const costBaseline =
    resume && agentDef(agent)?.reportsCost ? await carregarCustoDaSessao(resume) : null
  // ADR-252: a pasta de cada arquivo solto de fora do projeto vale só neste
  // envio. Sai da moldura do próprio prompt (o acesso é exatamente o que ele
  // manda ler) e só vai para motor que recebe pasta extra (capability).
  const pastasDoTurno = agentDef(agent)?.pastasExtras ? pastasCitadas(prompt, cwd) : []
  // Thread desta execução: o `resume` é a aposta; o `session` confirma (ou
  // desmente, quando o resume falhou e o CLI abriu outra).
  let threadId = resume
  const channel = new Channel<AgentEvent>()
  // Falha ao aplicar um evento não pode congelar o resto do turno, e precisa
  // aparecer no fio, não só no log (ADR-190).
  channel.onmessage = entregarSemTravar((e) => {
    // ADR-200: saída viva tem teto e dono próprio; no fio ela re-renderizaria
    // a conversa a cada linha e incharia o banco.
    if (e.type === "tool_output") {
      useBastidores.getState().anexarSaida(convId, e.id, e.text)
      return
    }
    if (e.type === "session" && e.session_id) threadId = e.session_id
    if (e.type === "result" && e.cumulative_usage && threadId) {
      void saveUsageBaseline(threadId, convId, nextBaseline(e.cumulative_usage))
    }
    if (e.type === "result" && e.reported_cost_total != null && threadId) {
      void salvarCustoDaSessao(threadId, convId, e.reported_cost_total)
    }
    onEvent(e)
  }, relatoVisivel((message) => onEvent({ type: "notice", message })))
  await invoke("run_agent", {
    runId,
    convId,
    agent,
    model,
    effort,
    prompt,
    cwd,
    resume,
    permission,
    attachments,
    planFirst: options.planFirst ?? false,
    memoryFallback: options.memoryFallback ?? null,
    systemPrompt: options.systemPrompt ?? null,
    mcpFingerprint: options.mcpFingerprint ?? null,
    instructionSources: options.instructionSources ?? [],
    mcpRecoveries: options.mcpRecoveries ?? [],
    usageBaseline: baseline,
    costBaseline,
    pastasDoTurno,
    onEvent: channel,
  })
}

/** Cancela um run em andamento (H1). */
export async function cancelAgent(runId: string): Promise<boolean> {
  return invoke<boolean>("cancel_agent", { runId })
}

/** Aprovação/interação pendente movidas p/ lib/interaction.ts (padrão unificado). */

/** Rótulo de exibição de um agent (id → nome). Fonte única: lib/agents. */
export function agentLabel(agent: string): string {
  return agentDef(agent)?.label ?? agent
}

/** Helper one-shot (Sprint 3): roda um modelo barato e retorna o texto puro. */
export async function suggest(
  model: string,
  cwd: string,
  prompt: string,
): Promise<string> {
  return invoke<string>("suggest", { model, cwd, prompt })
}
