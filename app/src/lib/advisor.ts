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

import { ESCREVENDO, estadoDaFerramenta, type ParecerAoVivo } from "@/lib/parecerAoVivo"
import { getAgentDef, slugify, type AgentDef } from "@/lib/agentDefs"
import { runAgent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
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

/** Quantos anexos de mensagens ANTERIORES o parecer recebe. Teto porque há
 *  motor que carrega cada imagem direto no contexto (o Codex, por `-i`): a
 *  conversa inteira de prints sairia cara sem ninguém ter pedido. */
export const MAX_ANEXOS_ANTERIORES = 6

export interface AnexosDoParecer {
  doPedido: Attachment[]
  anteriores: Attachment[]
  /** Do pedido, mas o motor do especialista não lê este tipo. Não vão ao run;
   *  o especialista fica sabendo que existem, e a pessoa vê uma linha no fio. */
  naoEntregues?: Attachment[]
}

/** Capacidade de anexo do motor (espelho `caps` de `agentDefinition.ts`). */
export type CapsDeAnexo = { image: boolean; pdf: boolean }

function motorLe(anexo: Pick<Attachment, "kind">, caps: CapsDeAnexo | undefined): boolean {
  if (!caps) return false
  if (anexo.kind === "image") return caps.image
  if (anexo.kind === "pdf") return caps.pdf
  return false
}

/** Separa pelo que o motor do especialista lê: o do pedido que não chega é
 *  dito (a quem pediu e a ele); o anterior que não chega sai calado, porque
 *  ninguém o mandou para este especialista. PURO. */
export function entregaveisAoMotor(anexos: AnexosDoParecer, caps: CapsDeAnexo | undefined): AnexosDoParecer {
  return {
    doPedido: anexos.doPedido.filter((a) => motorLe(a, caps)),
    anteriores: anexos.anteriores.filter((a) => motorLe(a, caps)),
    naoEntregues: anexos.doPedido.filter((a) => !motorLe(a, caps)),
  }
}

/** A linha do fio quando um anexo do pedido não chega ao especialista. Só
 *  existe nesse caso: com tudo entregue, a tela não muda. PURO. */
export function avisoDeAnexoNaoEntregue(
  especialista: string,
  motor: string,
  naoEntregues: readonly Pick<Attachment, "name" | "kind">[],
): string | null {
  if (!naoEntregues.length) return null
  const tipos = [...new Set(naoEntregues.map((a) => (a.kind === "pdf" ? "PDF" : a.kind === "image" ? "imagem" : "esse tipo de arquivo")))]
  const quantos = naoEntregues.length === 1 ? "1 anexo" : `${naoEntregues.length} anexos`
  return `${especialista} não recebeu ${quantos} deste pedido: ${naoEntregues.map((a) => a.name).join(", ")} (o ${motor} não lê ${tipos.join(" nem ")}).`
}

/** O que o parecer recebe de anexo: os do pedido em que foi chamado e os mais
 *  recentes das mensagens anteriores da conversa, sem repetir. Puro. */
export function anexosDoParecer(
  pedido: readonly Attachment[],
  itens: readonly ChatItem[],
): AnexosDoParecer {
  const vistos = new Set<string>()
  const doPedido = pedido.filter((a) => a.path.trim() && !vistos.has(a.path) && vistos.add(a.path))
  const anteriores: Attachment[] = []
  for (let i = itens.length - 1; i >= 0 && anteriores.length < MAX_ANEXOS_ANTERIORES; i--) {
    const item = itens[i]
    if (item.kind !== "user" || !item.attachments?.length) continue
    for (const anexo of [...item.attachments].reverse()) {
      if (anteriores.length >= MAX_ANEXOS_ANTERIORES) break
      if (!anexo.path.trim() || vistos.has(anexo.path)) continue
      vistos.add(anexo.path)
      anteriores.push(anexo)
    }
  }
  return { doPedido, anteriores }
}

/** Nome da bolha e nome do arquivo entregue: o motor recebe o segundo. */
function linhaDoAnexo(anexo: Pick<Attachment, "name" | "path">): string {
  const arquivo = anexo.path.split("/").pop() ?? anexo.path
  return anexo.name && anexo.name !== arquivo ? `- ${anexo.name} (arquivo ${arquivo})` : `- ${arquivo}`
}

/** Monta o prompt do conselheiro: identidade (personalityMd) + política + o
 *  contexto JÁ serializado da conversa (o caller passa serializeContext, não
 *  reimplementamos) + a pergunta. PURO e testável. */
export function buildAdvisorPrompt(opts: {
  def: Pick<AgentDef, "name" | "personalityMd" | "policy" | "rubric">
  /** Contexto da conversa/diff já serializado (lib/fusion.serializeContext). */
  context: string
  question: string
  /** Os anexos que o motor recebe junto (`anexosDoParecer`). Aqui só entram
   *  os NOMES, separados por origem: o arquivo em si o motor recebe pelo
   *  `runAdvisor`. Listar o caminho relativo era o que enganava o agente. */
  anexos?: AnexosDoParecer
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
  const doPedido = opts.anexos?.doPedido ?? []
  const anteriores = opts.anexos?.anteriores ?? []
  const naoEntregues = opts.anexos?.naoEntregues ?? []
  const files = [
    doPedido.length
      ? `\n\nAnexos deste pedido (a Frota entrega os arquivos junto com este pedido; abra os relevantes):\n${doPedido.map(linhaDoAnexo).join("\n")}`
      : "",
    anteriores.length
      ? `\n\nAnexos de mensagens anteriores desta conversa (também entregues, só para leitura; abra se ajudarem):\n${anteriores.map(linhaDoAnexo).join("\n")}`
      : "",
    naoEntregues.length
      ? `\n\nAnexos deste pedido que o seu motor não lê (existem, mas você não os recebeu; não opine como se os tivesse visto):\n${naoEntregues.map(linhaDoAnexo).join("\n")}`
      : "",
  ].join("")
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
  /** Entregues ao motor como num turno normal: o Rust valida (existe, mora sob
   *  a raiz de anexos) e o adapter dá o acesso nativo. Só leitura segue valendo
   *  pelo `fusion-ro`. */
  attachments?: Attachment[]
  /** O parecer AO VIVO (ADR-267): o que ele está fazendo, a partir dos eventos
   *  reais do motor, e o texto que já chegou. */
  aoVivo?: (v: ParecerAoVivo) => void
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
    opts.attachments ?? [],
    (e) => {
      if (e.type === "text_delta") {
        buf += e.text
        sawDelta = true
        opts.aoVivo?.({ estado: ESCREVENDO, texto: buf })
      } else if (e.type === "tool") {
        opts.aoVivo?.({ estado: estadoDaFerramenta(e.name, e.input), texto: buf })
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
    estilo: "mensagem",
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
