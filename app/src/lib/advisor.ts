// CONSELHEIRO INLINE (Especialistas E1) — uma persona de `.frota/agents` é
// chamada NO MEIO da conversa (`@aline revisa isso`), lê o contexto/diff ATUAL e
// devolve um PARECER inline, marcado como dela. É o oposto de
// `resolveFirstTurnPersona` (lib/presets), que injeta a persona no turno-1 como
// o EXECUTOR: aqui ela não vira o executor, só opina lateralmente.
//
// Garantias (DoD do plano):
//  - read-only: dispara pelo runAgent no modo "leitura" que já existe (bloqueia
//    Bash/Edit/Write no spawn). NÃO inventa trava nova. O conselheiro não toca
//    no working tree.
//  - agnóstico: a persona vem do arquivo (getAgentDef); o backend só move.
//  - fail-closed: persona não resolve → o caller distingue "não existe" de "não
//    consegui ler" (getAgentDef lança de propósito nesse caso).
//  - auditoria: o item de parecer carimba persona id + version + digest (reusa o
//    presetDigest já computado no AgentDef) — serve pro drift, igual à conversa.

import { getAgentDef, slugify, type AgentDef } from "@/lib/agentDefs"
import { runAgent } from "@/lib/agent"
import { isTauri } from "@/lib/db"
import type { ChatItem } from "@/store/chat"

/** Modo de permissão do conselheiro: "fusion-ro" — o read-only ESTRITO que já
 *  existe (o mesmo dos candidatos do Fusion). Bloqueia escrita (Bash/Edit/Write)
 *  E desliga TODO o MCP no spawn (--strict-mcp-config {}), então o parecer não
 *  tem NENHUM efeito externo: sem `@aline registra no Notion` disparando uma tool
 *  sem supervisão, e sem `ask_user` pendurando o run num convId sintético sem
 *  dono. NÃO é trava nova; é o modo mais estrito que a casa já oferece. */
export const ADVISOR_PERMISSION = "fusion-ro"

/** O item de parecer no fio (subconjunto do ChatItem). */
export type AdviceItem = Extract<ChatItem, { kind: "advice" }>

/** Uma menção de conselheiro detectada no envio: a persona resolvida + a
 *  pergunta (o resto do texto, sem o `@token`). */
export interface AdvisorMention {
  def: AgentDef
  question: string
}

/** Detecta TODAS as consultas de conselheiro em `text`, na ordem em que
 *  aparecem. Um `@token` casa uma persona por slug OU pelo nome slugificado;
 *  `@` que não resolve (arquivo, texto) não vira consulta, então uma mensagem
 *  sem persona conhecida devolve lista vazia e segue para o executor. PURO.
 *
 *  **Cada conselheiro recebe o trecho endereçado a ele**, e não a mensagem
 *  inteira. O corte é o óbvio na leitura: a fatia de um `@persona` vai até o
 *  próximo `@persona`, e a primeira fatia começa no início do texto (quem
 *  escreve "olha isso @Aline por favor" está falando com a Aline desde o
 *  "olha"). Menção sem texto próprio ("@aline @bob revisa isso") herda a
 *  pergunta da próxima que tiver texto: as duas foram chamadas para a mesma
 *  coisa.
 *
 *  Antes daqui só o PRIMEIRO `@persona` virava consulta, e os outros nomes eram
 *  apagados da pergunta: chamar dois especialistas entregava um só, e o
 *  primeiro ainda recebia a pergunta do segundo colada na dele (relato de
 *  21/09/2026, com print). Silêncio era o pior desfecho possível. */
export function detectAdvisorMentions(
  text: string,
  agents: AgentDef[],
): AdvisorMention[] {
  if (agents.length === 0) return []
  const known = (token: string): AgentDef | null => {
    const slug = slugify(token)
    return agents.find((a) => a.slug === slug || slugify(a.name) === slug) ?? null
  }
  // Onde cada persona foi chamada, na ordem do texto.
  const chamadas: { def: AgentDef; inicio: number; fim: number }[] = []
  const re = /(?:^|\s)@(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const def = known(m[1])
    if (!def) continue
    const inicio = m.index + m[0].length - m[1].length - 1 // posição do "@"
    chamadas.push({ def, inicio, fim: m.index + m[0].length })
  }
  if (chamadas.length === 0) return []
  // A fatia de cada uma: da chamada até a próxima (a primeira pega o começo).
  const limpar = (pedaco: string) =>
    pedaco
      .replace(/(^|\s)@(\S+)/g, (todo, antes: string, token: string) =>
        known(token) ? antes : todo,
      )
      .replace(/\s+/g, " ")
      .trim()
  const fatias = chamadas.map((c, i) => {
    const de = i === 0 ? 0 : c.inicio
    const ate = i + 1 < chamadas.length ? chamadas[i + 1].inicio : text.length
    return limpar(text.slice(de, ate))
  })
  // Menção sem texto próprio herda da próxima que tem; se nenhuma tem, todas
  // ficam com o texto inteiro sem os `@persona` (é tudo o que foi dito).
  const inteiro = limpar(text)
  return chamadas.map((c, i) => {
    let question = fatias[i]
    for (let j = i + 1; !question && j < fatias.length; j++) question = fatias[j]
    return { def: c.def, question: question || inteiro }
  })
}

export type AdvisorResolution =
  | { status: "ok"; def: AgentDef }
  /** a persona sumiu do disco entre a detecção e a invocação. */
  | { status: "missing" }
  /** o disco falhou ao ler a persona (arquivo intacto, leitura quebrada). */
  | { status: "unreadable" }

/** Re-resolve a persona pelo id ANTES de invocar (autoritativo, fail-closed):
 *  getAgentDef LANÇA no erro de disco de propósito, então distinguimos "não
 *  existe mais" (null) de "não consegui ler" (throw), como o plano exige. */
export async function resolveAdvisor(
  projectPath: string | null,
  id: string,
): Promise<AdvisorResolution> {
  try {
    const def = await getAgentDef(projectPath, id)
    return def ? { status: "ok", def } : { status: "missing" }
  } catch {
    return { status: "unreadable" }
  }
}

/** Monta o prompt do conselheiro: identidade (personalityMd) + política + o
 *  contexto JÁ serializado da conversa (o caller passa serializeContext, não
 *  reimplementamos) + a pergunta. PURO e testável. */
export function buildAdvisorPrompt(opts: {
  def: Pick<AgentDef, "name" | "personalityMd" | "policy" | "rubric">
  /** Contexto da conversa/diff já serializado (lib/fusion.serializeContext). */
  context: string
  question: string
  /** Caminhos anexados ao envio. Só os CAMINHOS: o conselheiro roda no cwd do
   *  projeto e lê por conta própria (fusion-ro permite leitura), então listar
   *  basta. Vinham sendo descartados em silêncio — o fio mostrava o clipe e o
   *  parecer opinava sem nunca ter visto o arquivo. */
  attachments?: string[]
}): string {
  const { def, context, question } = opts
  const lines = [
    `<conselheiro name="${def.name}">`,
    `Você é "${def.name}", chamada nesta conversa como CONSELHEIRA (parecer só leitura). Não assuma o volante nem edite nada; leia o contexto atual e a pergunta e dê um parecer objetivo e acionável, do seu ponto de vista. Aja conforme a personalidade abaixo.`,
    "",
    def.personalityMd.trim(),
  ]
  if (def.policy?.trim()) {
    lines.push("", `Política de atuação: ${def.policy.trim()}`)
  }
  // A rubrica É a persona: o conselheiro precisa VER a própria rubrica e avaliar
  // o contexto contra cada item. Só entra quando não-vazia — é o MESMO campo que
  // muda o presetDigest, então o aviso de drift fica honesto (mudou o hash ⇔
  // mudou o que o modelo recebe).
  if (def.rubric.length > 0) {
    lines.push(
      "",
      "Sua rubrica, avalie o contexto atual contra CADA item e diga onde ele passa ou falha:",
      ...def.rubric.map((r) => `- ${r}`),
    )
  }
  lines.push("</conselheiro>")
  const q = question.trim() || "Dê seu parecer sobre o estado atual da conversa."
  const attached = (opts.attachments ?? []).filter((p) => p.trim())
  const files = attached.length
    ? `\n\nArquivos anexados a este pedido (leia se forem relevantes):\n${attached
        .map((p) => `- ${p}`)
        .join("\n")}`
    : ""
  return `${lines.join("\n")}\n\n${context}\n\n---\n\nPergunta para o parecer:\n${q}${files}`
}

export interface RunAdvisorResult {
  ok: boolean
  text: string
  error: string | null
}

/** Dispara o conselheiro pelo runAgent no modo LEITURA (read-only). Sessão
 *  fresca (sem resume) num convId SINTÉTICO — a sessão nativa do fio do executor
 *  fica intocada. Acumula o texto do parecer dos eventos e devolve. NÃO passa
 *  pelo reducer do chat (não é um turno de executor). */
export async function runAdvisor(opts: {
  def: Pick<AgentDef, "backend" | "model" | "effort">
  prompt: string
  cwd: string
}): Promise<RunAdvisorResult> {
  if (!isTauri()) {
    return { ok: false, text: "", error: "indisponível fora do app" }
  }
  const runId = crypto.randomUUID()
  let buf = ""
  let sawDelta = false
  let resultText = ""
  let ok = false
  let error: string | null = null
  await runAgent(
    runId,
    // convId sintético: isola do fio (nenhum resume/sessão do executor tocado).
    `advisor-${runId}`,
    opts.def.backend,
    opts.def.model,
    opts.def.effort,
    opts.prompt,
    opts.cwd,
    null, // sem resume: consulta é sessão fresca
    ADVISOR_PERMISSION,
    [],
    (e) => {
      if (e.type === "text_delta") {
        buf += e.text
        sawDelta = true
      } else if (e.type === "text") {
        // dedup: se veio por deltas, o bloco completo é o mesmo texto (mesma
        // régua do reducer do chat).
        if (!sawDelta) buf += e.text
      } else if (e.type === "result") {
        ok = e.ok
        resultText = e.text ?? ""
      } else if (e.type === "error") {
        error = e.message
      } else if (e.type === "preflight_blocked") {
        const source = e.gate.issues[0]?.sourceLabel ?? "Uma capacidade exigida"
        error = `${source} está indisponível; o parecer não foi iniciado.`
      }
    },
  )
  const text = buf.trim() || resultText.trim()
  return { ok: ok || text.length > 0, text, error }
}

/** Monta o item de PARECER pro fio, carimbado com persona id + version + digest
 *  (auditoria/drift — reusa o digest já computado no AgentDef). PURO. */
export function buildAdviceItem(
  def: Pick<AgentDef, "id" | "name" | "version" | "digest">,
  question: string,
  text: string,
  /** Instante de nascimento do parecer (epoch ms). Injetável nos testes. */
  now: number = Date.now(),
): AdviceItem {
  return {
    kind: "advice",
    id: crypto.randomUUID(),
    personaId: def.id,
    personaName: def.name,
    personaVersion: def.version,
    digest: def.digest,
    question,
    text,
    ts: now,
  }
}

/** "Trazer pro Executor": bloco que injeta o texto do parecer como CONTEXTO no
 *  próximo turno do executor (mesmo cano do personaHandoffBlock — bloco no
 *  prompt, não bolha visível). PURO. */
export function buildAdviceHandoffBlock(
  item: Pick<AdviceItem, "personaName" | "text">,
): string {
  return [
    `<parecer de="${item.personaName}">`,
    `Parecer de ${item.personaName} (conselheiro, só leitura) trazido para você considerar neste turno:`,
    "",
    item.text.trim(),
    "</parecer>",
  ].join("\n")
}
