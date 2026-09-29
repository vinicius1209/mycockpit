// DOUTRINA DO PROJETO — `.frota/instructions.md`, o arquivo de instrução do
// PRÓPRIO app. Existe porque instrução era a única camada do contexto que não
// era agnóstica: `CLAUDE.md` só o Claude Code lê, `AGENTS.md` só o Codex, o agy
// não lê nenhum dos dois, e o app NUNCA injetou nenhum deles — só os inventaria
// no painel. Resultado real medido neste repo: 0 de 2 arquivos presentes, com
// 4 das 5 entregas feitas pelo codex, que lê exatamente o AGENTS.md ausente.
//
// A doutrina vale nos três porque quem injeta é o app, pelo mesmo cano da
// persona (presets.ts) e das lições (learning.ts): um BLOCO prependido ao
// prompt. Nada de bolha visível no fio.
//
// Isso revisa o ADR-002 ("reexplicar contexto não é a dor — CLAUDE.md/AGENTS.md
// já cobrem"), que era verdade quando o app era só Claude Code (ADR-005).

import { invoke } from "@tauri-apps/api/core"
import { agentDef } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import { linhaDosSegredos, segredosDoProjeto } from "@/lib/segredos"

/** Onde a doutrina mora por padrão (projeto novo ou já migrado). O caminho
 *  REAL de cada projeto vem do Rust em `Doctrine.path`; este é só o fallback
 *  de quem não recebeu um (mock, fora do Tauri). */
export const DOCTRINE_PATH = ".frota/instructions.md"

export interface Doctrine {
  exists: boolean
  content: string
  bytes: number
  /** Caminho relativo de onde foi lida (ou onde seria criada), resolvido pelo
   *  Rust entre a pasta nova e a antiga. Até 23/09/2026 o front ignorava este
   *  campo e mandava ao prompt de TODO turno `.mycockpit/instructions.md`,
   *  um arquivo que não existe em projeto migrado. */
  path?: string
  /** Os NOMES dos segredos do projeto (ADR-288). Fora do `content` de
   *  propósito: o editor da doutrina não os vê nem os grava no arquivo; só o
   *  bloco do prompt os leva, na mesma cadência da doutrina. */
  segredos?: string[]
}

const VAZIA: Doctrine = { exists: false, content: "", bytes: 0 }

/** Lê a doutrina do projeto. Fora do Tauri (ou em falha) devolve "não existe" —
 *  doutrina é contexto opcional, nunca motivo pra travar um envio. */
export async function readDoctrine(projectPath: string): Promise<Doctrine> {
  if (!isTauri()) return VAZIA
  const [doutrina, segredos] = await Promise.all([
    invoke<Doctrine>("read_project_doctrine", { path: projectPath }).catch(() => VAZIA),
    segredosDoProjeto(projectPath).then(
      (lista) => lista.map((s) => s.nome),
      (e: unknown) => {
        console.error("[doutrina] não li os nomes dos segredos", e)
        return [] as string[]
      },
    ),
  ])
  return segredos.length ? { ...doutrina, segredos } : doutrina
}

/** Grava a doutrina. AQUI o erro sobe: salvar é ação explícita do usuário e
 *  falhar em silêncio faria ele achar que escreveu regra que não existe. */
export async function writeDoctrine(
  projectPath: string,
  content: string,
): Promise<void> {
  await invoke("write_project_doctrine", { path: projectPath, content })
}

/** Lê INTEGRALMENTE um arquivo de instrução de CLI (CLAUDE.md/AGENTS.md) pra
 *  semear a 1ª doutrina. Não usa o conteúdo do inventário do painel de
 *  propósito: aquele vem truncado em 8k pra preview, e semear regra cortada
 *  perderia texto em silêncio. Erro sobe — semear é ação explícita. */
export async function readDoctrineSeed(
  projectPath: string,
  name: string,
): Promise<string> {
  return invoke<string>("read_doctrine_seed", { path: projectPath, name })
}

/** Teto do bloco no prompt. Doutrina é contexto de TODO turno inicial — texto
 *  longo demais roubaria janela do trabalho. Acima disso o bloco corta e APONTA
 *  o arquivo: o agent tem acesso ao disco e puxa o resto se precisar. */
export const DOCTRINE_MAX_CHARS = 12000

/** O bloco da doutrina lida do disco, com o caminho REAL dela. É o que os
 *  envios usam; `buildDoctrineBlock` é o núcleo puro. */
export function blocoDaDoutrina(doutrina: Pick<Doctrine, "content" | "path" | "segredos">): string | null {
  const linha = linhaDosSegredos(doutrina.segredos ?? [])
  const conteudo = linha ? [doutrina.content.trim(), linha].filter(Boolean).join("\n\n") : doutrina.content
  return buildDoctrineBlock(conteudo, doutrina.path || DOCTRINE_PATH)
}

/** Monta o bloco de doutrina prependido ao prompt. null = nada a injetar
 *  (arquivo ausente ou em branco) — puro e testável. */
export function buildDoctrineBlock(content: string, fonte: string = DOCTRINE_PATH): string | null {
  const texto = content.trim()
  if (!texto) return null
  const cortou = texto.length > DOCTRINE_MAX_CHARS
  const corpo = cortou ? texto.slice(0, DOCTRINE_MAX_CHARS) : texto
  const lines = [
    `<doutrina fonte="${fonte}">`,
    "Estas são as regras deste projeto, definidas pelo humano no Frota. Valem do primeiro ao último turno e têm precedência sobre hábitos gerais seus.",
    "",
    corpo,
  ]
  if (cortou) {
    lines.push(
      "",
      `[cortado em ${DOCTRINE_MAX_CHARS} caracteres — leia ${fonte} se precisar do texto completo]`,
    )
  }
  lines.push("</doutrina>")
  return lines.join("\n")
}

/** A doutrina entra neste envio (por QUALQUER canal)? Decidido por capability
 *  (H5: nada de `agent === "agy"`):
 *  - `systemChannel` (claude): TODO turno — o canal system re-envia a cada
 *    spawn, fora do corpo do prompt (H1); frescor de graça, zero eco.
 *  - sem `sessionResume` (agy, motor desconhecido): TODO turno — cada turno é
 *    sessão nova e o recap não carrega o prefixo do prompt.
 *  - com resume e sem canal (codex): só no 1º turno — o resume nativo carrega
 *    dali em diante, e repetir a cada turno pagaria a mesma janela várias
 *    vezes. A exceção do `!hasReply` é a mesma da persona: 1º run que morreu
 *    antes de qualquer resposta não pode deixar a doutrina perdida pra sempre.
 *
 *  - `locked` = a conversa já tem itens (mesmo sinal do shouldInjectPersona);
 *  - `hasReply` = já houve resposta de assistant, ou seja o 1º prompt CHEGOU. */
export function shouldInjectDoctrine(
  agent: string,
  locked: boolean,
  hasReply: boolean,
): boolean {
  const def = agentDef(agent)
  if (def?.systemChannel) return true
  if (!def?.sessionResume) return true
  return !locked || !hasReply
}

/** Quando a doutrina chega ao motor, em pt-BR para a aba "O que o agente vê"
 *  (ADR-237). Mesma régua de `shouldInjectDoctrine`, por capability: com canal
 *  de sistema ou sem retomar sessão, todo turno; com sessão retomada, no
 *  primeiro turno, e de novo quando o texto muda. */
export function quandoDaDoutrina(agent: string): string {
  const def = agentDef(agent)
  if (def?.systemChannel || !def?.sessionResume) return "todo turno"
  return "no 1º turno, e de novo se mudar"
}

/** Fingerprint do bloco de doutrina (H4): FNV-1a 32 em hex — barato, estável,
 *  serve só pra comparar "mudou desde a última injeção nesta conversa". */
export function doctrineFingerprint(block: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < block.length; i++) {
    hash ^= block.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** Prefixo do re-envio por FRESCOR (H4): avisa o motor que as regras mudaram
 *  mid-conversa, em vez de fingir que o bloco é novidade. */
export const DOCTRINE_UPDATED_PREFIX = "(doutrina atualizada)"

/** Decisão de doutrina de UM envio, pronta pros dois canais (H1+H4). */
export interface DoctrineDecision {
  /** Bloco pro CORPO do prompt (motor sem canal system). null = nada. */
  body: string | null
  /** Bloco pro canal SYSTEM (re-enviado a cada spawn). null = nada. */
  system: string | null
  /** Fingerprint da doutrina ATUAL, a carimbar no ledger da conversa (sempre
   *  que o arquivo existe — mesmo sem injetar, pro próximo envio detectar
   *  mudança). null = sem doutrina. */
  fingerprint: string | null
}

/** Decide a doutrina deste envio, por capability do motor. PURA (o caller lê o
 *  disco — readDoctrine + buildDoctrineBlock — e passa o bloco):
 *  - canal system → bloco vai em `system`, todo turno (H1);
 *  - sessão FRESCA no meio da conversa (wheel-switch/backend novo) → bloco
 *    SEMPRE entra (mesma régua do revezamento: a sessão nova nunca viu regra
 *    nenhuma), sem prefixo de atualização;
 *  - sem canal → `body` no 1º turno (regra de sempre) E TAMBÉM quando o
 *    fingerprint carimbado nesta conversa diverge do atual (H4) — aí com o
 *    prefixo "(doutrina atualizada)". Ledger ZERADO (restart do app) numa
 *    conversa já rodada conta como divergência: a edição feita com o app
 *    fechado não pode se perder (promessa "nunca perda" do plano); o custo é
 *    UM bloco por conversa pós-restart, já precificado.
 *  Best-effort como sempre: bloco null (sem arquivo/falha) → tudo null. */
export function decideDoctrine(opts: {
  agent: string
  /** buildDoctrineBlock do conteúdo atual do arquivo (null = sem doutrina). */
  block: string | null
  locked: boolean
  hasReply: boolean
  /** Sessão nativa FRESCA no meio da conversa (S3.2 wheel-switch: o backend
   *  trocou e o resume da origem não vale) → a doutrina sempre viaja. */
  freshSession?: boolean
  /** Último fingerprint carimbado nesta conversa (store `injected.doctrine`).
   *  undefined = ledger zerado (restart) — tratado como divergência quando a
   *  conversa já rodou (ver acima). */
  lastFingerprint: string | undefined
}): DoctrineDecision {
  if (!opts.block) return { body: null, system: null, fingerprint: null }
  const fingerprint = doctrineFingerprint(opts.block)
  const def = agentDef(opts.agent)
  if (def?.systemChannel) {
    return { body: null, system: opts.block, fingerprint }
  }
  if (
    opts.freshSession ||
    shouldInjectDoctrine(opts.agent, opts.locked, opts.hasReply)
  ) {
    return { body: opts.block, system: null, fingerprint }
  }
  // Só se chega aqui com locked && hasReply (motor com resume): fingerprint
  // divergente OU desconhecido (restart) → re-injeta com o prefixo honesto.
  if (opts.lastFingerprint !== fingerprint) {
    return {
      body: `${DOCTRINE_UPDATED_PREFIX}\n${opts.block}`,
      system: null,
      fingerprint,
    }
  }
  return { body: null, system: null, fingerprint }
}
