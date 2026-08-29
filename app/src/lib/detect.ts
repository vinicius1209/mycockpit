import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { setDynamicModels } from "@/lib/agents"
import {
  agyModelOptions,
  openCodeModelOptions,
  fetchModelList,
  toListFailure,
  type ModelListFailure,
} from "@/lib/modelList"

/** Espelha DetectedTool do Rust (detect.rs). auth: "ok"=logado · "missing"=
 *  instalado+deslogado · "unknown"=instalado+auth indeterminada · "na"=n/a.
 *  latest é POR CANAL do binário gerenciado (incidente do sucesso falso: a
 *  "última" vinha do npm, o binário era do brew com teto menor — botão
 *  "Atualizar" eterno). altLatest/altChannel = a última do OUTRO canal, só
 *  informação (trocar de canal é gesto do usuário). */
export interface DetectedTool {
  id: string // "claude-code" | "codex" | "agy" | "git" | "swiftc"
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  /** Última versão oficial DO CANAL do binário (null = indisponível/offline). */
  latest: string | null
  /** Canal da fonte do latest ("npm" | "homebrew"). */
  latestChannel: string | null
  altLatest: string | null
  altChannel: string | null
  /** Path real da cópia que vence no PATH (a que o app roda E atualiza). */
  binPath: string | null
  /** Demais cópias no PATH. Vazio = instalação única. */
  otherPaths: string[]
}

/** Snapshot leve por ferramenta, persistido em GlobalSettings.detected. */
export interface AgentProbe {
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  /** Última versão oficial DO CANAL do binário no momento da checagem. */
  latest: string | null
  latestChannel?: string | null
  altLatest?: string | null
  altChannel?: string | null
  /** Opcionais porque snapshot GRAVADO ANTES desta versão não os tem — probe
   *  antigo não vira "instalação única" falsa, vira "não sei" (sem frase). */
  binPath?: string | null
  otherPaths?: string[]
  checkedAt: number
}

/** Comando de update por agent (fallback pra "copiar e rodar à mão" quando o
 *  "Atualizar agora" não consegue). null = sem canal conhecido. */
export const UPDATE_COMMANDS: Record<string, string | null> = {
  "claude-code": "npm i -g @anthropic-ai/claude-code",
  codex: "brew upgrade codex",
  agy: null,
  // OpenCode se atualiza sozinho (`opencode upgrade`), mas o brew é o canal
  // desta máquina e é ele que o `command -v` resolve.
  opencode: "brew upgrade opencode",
}

/** Como INSTALAR cada CLI, pra quem ainda não tem nenhuma (passo 1 do
 *  onboarding). Mesma natureza do UPDATE_COMMANDS acima: conhecimento de
 *  pacote é por-provider e mora neste módulo, nunca em código genérico.
 *  Ausente do mapa = sem receita conhecida (a UI diz isso em vez de chutar). */
export const INSTALL_COMMANDS: Record<string, string> = {
  "claude-code": "npm i -g @anthropic-ai/claude-code",
  codex: "brew install codex",
  agy: "https://antigravity.google/cli",
  // `sst/tap/opencode` estava aqui e NÃO EXISTE ("No available formula or cask
  // with the name"). A receita vinha do repositório do fornecedor, não de um
  // `brew info` — e receita que ninguém rodou é chute com cara de fato. O
  // opencode está no homebrew/core, então o nome simples resolve.
  opencode: "brew install opencode",
}

/** Comandos por agent×CANAL — espelho do plano por canal do update.rs (o
 *  módulo por-provider legítimo): a notificação de update sugere o comando do
 *  canal DETECTADO do binário, não o npm estático (incidente do "npm i" pra
 *  binário do brew). Conhecimento de pacote é por-provider, mora aqui. */
const CHANNEL_COMMANDS: Record<string, Record<string, string>> = {
  "claude-code": {
    npm: "npm i -g @anthropic-ai/claude-code@latest",
    // o cask chama-se `claude-code`, NÃO `claude` (ver update.rs).
    homebrew: "brew upgrade claude-code",
  },
  codex: {
    npm: "npm i -g @openai/codex@latest",
    homebrew: "brew upgrade codex",
  },
}

/** Comando de update do CANAL detectado (G3.2). null = agent sem comando
 *  conhecido OU canal desconhecido — o caller usa copy neutra ("use o painel
 *  CLIs instaladas") em vez de sugerir o comando errado. Puro, testável. */
export function commandForChannel(
  agent: string,
  channel: string | null | undefined,
): string | null {
  if (!channel) return null
  return CHANNEL_COMMANDS[agent]?.[channel] ?? null
}

// O "Atualizar" virou JOB em background: ver @/lib/updates (store + toasts com
// id estável) e update.rs (registry com dedupe). O UpdateOutcome request-
// response morreu junto com o incidente dos N `brew upgrade` concorrentes.

/** Extrai os segmentos numéricos de uma versão ("v2.1.209 (x)" → [2,1,209]).
 *  null = string sem versão comparável. */
function versionSegments(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  const m = raw.match(/\d+(?:\.\d+)*/)
  if (!m) return null
  return m[0].split(".").map(Number)
}

/** true quando a versão `latest` é MAIOR que a instalada, comparando segmento a
 *  segmento (segmento ausente = 0). Strings não-comparáveis (null, sem dígitos)
 *  → false: nunca acusa update sem certeza. */
export function updateAvailable(p: {
  version: string | null
  latest: string | null
}): boolean {
  const cur = versionSegments(p.version)
  const latest = versionSegments(p.latest)
  if (!cur || !latest) return false
  const len = Math.max(cur.length, latest.length)
  for (let i = 0; i < len; i++) {
    const a = cur[i] ?? 0
    const b = latest[i] ?? 0
    if (b > a) return true
    if (b < a) return false
  }
  return false
}

/** Rótulo "última vX (canal)" da linha do painel. null = sem latest conhecida.
 *  O canal aparece pra versão fazer sentido: "última v2.1.212 (homebrew)" ao
 *  lado de um npm v2.1.220 no aviso de canal cruzado não é contradição. */
export function latestLabel(p: {
  latest: string | null
  latestChannel?: string | null
}): string | null {
  if (!p.latest) return null
  return `última v${p.latest}${p.latestChannel ? ` (${p.latestChannel})` : ""}`
}

/** Linha informativa de canal CRUZADO: o outro canal tem versão MAIOR que o
 *  teto do canal do binário. Só informação pra decisão humana — trocar de
 *  canal é gesto do usuário, nunca botão. null = nada a dizer. */
export function crossChannelNote(p: {
  latest: string | null
  latestChannel?: string | null
  altLatest?: string | null
  altChannel?: string | null
}): string | null {
  if (!p.latest || !p.latestChannel || !p.altLatest || !p.altChannel) return null
  if (!updateAvailable({ version: p.latest, latest: p.altLatest })) return null
  return `o canal ${p.altChannel} tem v${p.altLatest}; este binário é ${p.latestChannel} (teto v${p.latest})`
}

/** Aviso de cópias duplicadas no PATH, a partir do PROBE (fato da máquina,
 *  persistido) e não do job de update (memória, morre no reinício).
 *
 *  A frase responde a pergunta de quem lê ("qual delas roda?"), não a do app
 *  ("qual eu gerencio"): `binPath` sai do mesmo `command -v` que o spawn usa,
 *  então a que o app atualiza é literalmente a que executa. Dizer "gerencia"
 *  deixava o leitor concluir sozinho, e a conclusão errada é justamente a que
 *  o aviso existe pra evitar.
 *
 *  null quando não há o que avisar: instalação única, probe velho (campos
 *  ausentes) ou path não resolvido. Aviso que aparece sempre não é lido. */
export function notaDeCopias(p: {
  binPath?: string | null
  otherPaths?: string[]
}): { total: number; binPath: string; todos: string[] } | null {
  const outros = p.otherPaths ?? []
  if (!p.binPath || outros.length === 0) return null
  return {
    total: outros.length + 1,
    binPath: p.binPath,
    todos: [p.binPath, ...outros],
  }
}

/** O que a máquina diz sobre um agent, para quem precisa DECIDIR com isso.
 *
 *  "desconhecido" é um estado de primeira classe, e é o que impede o pior
 *  defeito possível aqui: numa instalação nova (ou logo depois de limpar o
 *  storage) o mapa `detected` vem VAZIO, e tratar vazio como "ausente"
 *  desabilitaria os três agents de uma vez — o app afirmando que nada está
 *  instalado justamente quando ainda não olhou. Ausência de prova não é prova
 *  de ausência: só o probe que EXISTE e diz `installed: false` vira "ausente".
 */
export type EstadoNaMaquina = "instalado" | "ausente" | "desconhecido"

export function estadoNaMaquina(
  id: string,
  detected: Record<string, AgentProbe>,
): EstadoNaMaquina {
  const probe = detected[id]
  if (!probe) return "desconhecido"
  return probe.installed ? "instalado" : "ausente"
}

/** Roda a detecção (comando Rust em paralelo). Fora do Tauri devolve []. */
export async function detectAgents(): Promise<DetectedTool[]> {
  if (!isTauri()) return []
  try {
    return await invoke<DetectedTool[]>("detect_agents")
  } catch {
    return []
  }
}

/** Converte a lista detectada num mapa de snapshots (p/ persistir/consumir). */
export function toProbeMap(
  tools: DetectedTool[],
  now: number,
): Record<string, AgentProbe> {
  const out: Record<string, AgentProbe> = {}
  for (const t of tools) {
    out[t.id] = {
      installed: t.installed,
      version: t.version,
      auth: t.auth,
      detail: t.detail,
      latest: t.latest ?? null,
      latestChannel: t.latestChannel ?? null,
      altLatest: t.altLatest ?? null,
      altChannel: t.altChannel ?? null,
      binPath: t.binPath ?? null,
      otherPaths: t.otherPaths ?? [],
      checkedAt: now,
    }
  }
  return out
}

/** Busca os modelos reais do agy e alimenta o cache dinâmico consultado por
 *  agentModels("agy"). Falha → não mexe (o estático continua valendo).
 *
 *  Usa a MESMA sonda do resto do app (`fetchModelList`, dialeto confinado em
 *  model_list.rs). Havia aqui um segundo caminho (`list_agy_models`) com parse
 *  próprio, que devolvia a LINHA INTEIRA do TSV como slug: o seletor passou a
 *  guardar `"gemini-3.7-flash-high\tGemini 3.7 Flash (High)"` e todo envio
 *  morria em "model … is not recognized". Duas leituras da mesma pergunta, e a
 *  que ninguém olhava apodreceu — por isso agora há uma só.
 *
 *  Devolve a falha em vez de engoli-la (ADR-017): quem chama decide se mostra.
 *  `null` = deu certo (ou não há Tauri, onde não há o que perguntar). */
export async function refreshAgyModels(): Promise<ModelListFailure | null> {
  if (!isTauri()) return null
  try {
    const listing = await fetchModelList("agy")
    if (listing.models.length > 0)
      setDynamicModels("agy", agyModelOptions(listing.models))
    return null
  } catch (e) {
    const falha = toListFailure(e)
    console.warn(`agy models: lista viva indisponível (${falha.kind}) — ${falha.message}`)
    return falha
  }
}

/** O mesmo para o OpenCode. Vale MAIS aqui que no agy: a lista dele depende de
 *  QUAIS credenciais existem (`opencode providers list`), e isso muda sem o app
 *  saber — conectar o OpenRouter faz modelos aparecerem sem tocar em código.
 *  Lista vazia NÃO apaga a curada: sem provedor conectado o `opencode models`
 *  devolve pouco ou nada, e zerar o seletor seria pior que a lista de casa. */
export async function refreshOpenCodeModels(): Promise<ModelListFailure | null> {
  if (!isTauri()) return null
  try {
    const listing = await fetchModelList("opencode")
    if (listing.models.length > 0)
      setDynamicModels("opencode", openCodeModelOptions(listing.models))
    return null
  } catch (e) {
    const falha = toListFailure(e)
    console.warn(`opencode models: lista viva indisponível (${falha.kind}) — ${falha.message}`)
    return falha
  }
}

/**
 * O aviso de "este motor não está nesta máquina", pronto pra UI.
 *
 * Existe porque o app JÁ sabia as duas metades e não juntava: a detecção roda
 * no boot e vive em `settings.detected`, e `INSTALL_COMMANDS` guarda a receita
 * de cada CLI. Sem o elo, você escolhia o motor, escrevia o prompt inteiro,
 * mandava, e só então o Rust respondia "não consegui executar o agent X. Ele
 * está instalado e no PATH?". A resposta era honesta e chegava tarde.
 *
 * Duas honestidades ficam nas regras, não na copy:
 *
 *  1. **Só "ausente" avisa.** `desconhecido` (probe que não rodou, boot antes
 *     da detecção terminar, fora do Tauri) devolve `null`. É o §5 camada 3:
 *     aviso que depende de probe só aparece depois que a leitura terminou,
 *     senão a UI pisca e mente.
 *  2. **Sem receita, sem chute.** Motor fora do `INSTALL_COMMANDS` devolve
 *     `comando: null`, e a UI diz que não conhece a receita em vez de inventar
 *     uma (foi assim que `sst/tap/opencode`, uma fórmula que não existe, viveu
 *     no código).
 */
export interface AvisoDeMotorAusente {
  /** Comando de shell ou URL de instalação. `null` = sem receita conhecida. */
  comando: string | null
  /** A receita é um endereço pra abrir, não um comando pra colar. */
  ehLink: boolean
}

export function avisoDeMotorAusente(
  id: string,
  detected: Record<string, AgentProbe>,
): AvisoDeMotorAusente | null {
  if (estadoNaMaquina(id, detected) !== "ausente") return null
  const comando = INSTALL_COMMANDS[id] ?? null
  return { comando, ehLink: comando != null && /^https?:\/\//.test(comando) }
}
