import type { Attachment } from "@/lib/attachments"
import type { ChatItem } from "@/store/chat"

/** O que dá para AFIRMAR sobre um anexo depois que o turno rodou.
 *
 *  - `inlinado`  — foi embutido na requisição pelo próprio CLI; chegou por
 *                  construção, não há o que verificar (Codex: `-i` vira
 *                  `input_image` base64).
 *  - `aberto`    — o agent chamou a ferramenta de leitura NESTE arquivo (rastro
 *                  no fio). É o único "sim" com prova.
 *  - `nao-aberto`— o turno terminou e não há rastro. O modelo respondeu SEM
 *                  olhar o anexo.
 *  - `pendente`  — o turno ainda roda; cedo demais para dizer.
 *  - `sem-rastro`— o CLI não reporta ferramentas (agy é texto puro), então a
 *                  ausência de rastro NÃO prova nada. Honestidade obrigatória:
 *                  não dá para distinguir "não abriu" de "abriu e não contou".
 */
export type AttachmentRead =
  | "inlinado"
  | "aberto"
  | "nao-aberto"
  | "pendente"
  | "sem-rastro"

/** Agents cujo transporte INLINA o anexo (chega garantido, sem ferramenta). */
const INLINA = new Set(["codex"])

/** Agents que NÃO emitem eventos de ferramenta — o fio não registra a leitura.
 *  O `agy -p` devolve só texto (AgyAdapter::on_stdout_line só emite TextDelta),
 *  então nunca haverá um item `tool` para provar que ele abriu. */
const SEM_TELEMETRIA = new Set(["agy"])

/** Ferramentas de LEITURA de arquivo, por agent. O Claude usa `Read`. */
const TOOLS_DE_LEITURA = new Set(["read", "view_file", "view", "readfile"])

/** O anexo `att` foi lido no turno que começa em `fromIndex` (o índice do item
 *  do usuário que o enviou)? Varre até o próximo item do usuário — o turno
 *  seguinte não conta como prova deste.
 *
 *  Casar por PATH, não por nome: dois anexos podem ter o mesmo nome de exibição
 *  em conversas diferentes, e o path é único (hash do conteúdo). O `endsWith`
 *  cobre o caso de o agent citar caminho relativo à pasta liberada. */
export function attachmentRead(
  items: ChatItem[],
  fromIndex: number,
  att: Attachment,
  agent: string,
  running: boolean,
): AttachmentRead {
  if (INLINA.has(agent)) return "inlinado"
  if (SEM_TELEMETRIA.has(agent)) return "sem-rastro"

  for (let i = fromIndex + 1; i < items.length; i++) {
    const it = items[i]
    if (it.kind === "user") break // começou outro turno: o rastro tem que ser deste
    if (it.kind !== "tool") continue
    if (!TOOLS_DE_LEITURA.has(it.name.toLowerCase())) continue
    if (mencionaPath(it.input, att.path)) return "aberto"
  }
  // ainda rodando: pode abrir daqui a pouco. Só depois do fim é "não abriu".
  return running ? "pendente" : "nao-aberto"
}

/** O input da tool cita este path? Procura em qualquer campo string do objeto
 *  (o nome do parâmetro varia por agent: file_path, path, AbsolutePath…). */
function mencionaPath(input: unknown, path: string): boolean {
  if (typeof input === "string") {
    return input === path || input.endsWith(path) || path.endsWith(input)
  }
  if (!input || typeof input !== "object") return false
  for (const v of Object.values(input as Record<string, unknown>)) {
    if (mencionaPath(v, path)) return true
  }
  return false
}

/** Selo de leitura por PATH de anexo, do jeito que o `MessageItem` consome. */
export type ReadLabels = Record<string, { text: string; warn: boolean } | null>

function sameLabels(a: ReadLabels, b: ReadLabels): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    const x = a[k]
    const y = b[k]
    if (x === y) continue
    if (!x || !y) return false
    if (x.text !== y.text || x.warn !== y.warn) return false
  }
  return true
}

/** Selos de leitura AGRUPADOS POR ITEM, reaproveitando a identidade do frame
 *  anterior quando os rótulos daquele item não mudaram.
 *
 *  Por que existe: o `MessageItem` é `memo`, e recebia o mapa GLOBAL de selos —
 *  um objeto novo a cada token do streaming. `memo` compara raso, então TODA
 *  mensagem do fio re-renderizava a cada delta, exatamente o oposto do que o
 *  comentário dele prometia. Entregando um objeto POR ITEM, e mantendo a
 *  referência quando o conteúdo é o mesmo, a prop só muda quando o selo daquele
 *  item muda de verdade.
 *
 *  Semântica preservada: os selos continuam resolvidos num mapa por PATH (o
 *  último item com aquele path vence, como sempre foi) e só depois fatiados por
 *  item — nenhuma mensagem passa a mostrar rótulo diferente do de hoje. */
export function attachmentReadsByItem(
  items: ChatItem[],
  agent: string,
  running: boolean,
  prev?: Map<string, ReadLabels>,
): Map<string, ReadLabels> {
  const byPath: ReadLabels = {}
  items.forEach((it, i) => {
    if (it.kind !== "user" || !it.attachments?.length) return
    for (const a of it.attachments) {
      byPath[a.path] = attachmentReadLabel(
        attachmentRead(items, i, a, agent, running),
      )
    }
  })
  const out = new Map<string, ReadLabels>()
  for (const it of items) {
    if (it.kind !== "user" || !it.attachments?.length) continue
    const fresh: ReadLabels = {}
    for (const a of it.attachments) fresh[a.path] = byPath[a.path]
    const old = prev?.get(it.id)
    out.set(it.id, old && sameLabels(old, fresh) ? old : fresh)
  }
  return out
}

/** Rótulo curto + se merece destaque de alerta. null = nada a dizer na UI
 *  (inlinado e sem-rastro não viram selo: um é garantido, o outro é ignorância
 *  nossa e anunciá-la como aviso seria alarme falso). */
export function attachmentReadLabel(
  state: AttachmentRead,
): { text: string; warn: boolean } | null {
  switch (state) {
    case "aberto":
      return { text: "lido", warn: false }
    case "nao-aberto":
      return { text: "não foi aberto", warn: true }
    default:
      return null
  }
}
