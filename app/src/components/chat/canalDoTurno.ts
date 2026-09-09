// POR QUAL CANAL A INSTRUÇÃO VIAJA NESTE TURNO.
//
// Extraído do `ChatPanel.despacharEnvio` quando a catraca de tamanho disparou (a
// regra da casa é DIVIDIR, nunca subir o teto). O recorte responde a uma
// pergunta só: dado o motor deste turno, a persona e a doutrina vão pelo canal
// SYSTEM do CLI ou embutidas no corpo do prompt?
//
// AGNÓSTICO POR CONSTRUÇÃO (H1 do prompt-hygiene-plan). A decisão sai da
// capability `systemChannel` do registry, nunca de nome de motor:
//
//  • motor COM canal system → persona e doutrina são re-enviadas a cada spawn,
//    fora do corpo. Frescor de graça e zero inchaço de histórico;
//  • motor SEM canal → os mesmos blocos entram no corpo, na cascata (quem você
//    é → as regras deste projeto → o que já aprendemos → o pedido).
//
// A doutrina do projeto (`.mycockpit/instructions.md`) é injetada pelo APP, o
// que é justamente o que a faz valer igual nos três motores. Best-effort: sem
// arquivo, ou com falha de disco, o turno segue sem o bloco.

import { agentDef as engineDef } from "@/lib/agents"
import { buildDoctrineBlock, decideDoctrine, readDoctrine } from "@/lib/doctrine"
import { personaHandoffBlock } from "@/lib/presets"

export interface AlvoDoCanal {
  /** Motor EFETIVO deste turno (preset/revezamento já resolvidos). */
  agent: string
  projectPath: string
  /** Conversa já travada no motor/modelo do 1º run. */
  locked: boolean
  /** O 1º prompt já CHEGOU no CLI (existe resposta de assistant). */
  hasReply: boolean
  /** Revezamento trocou o backend → sessão fresca, doutrina sempre viaja. */
  wheelSwitch: boolean
  /** Última doutrina anunciada NESTA conversa (ledger da store). */
  lastFingerprint: string | undefined
  presetId: string | null
  presetDigest: string | null
  /** Persona resolvida do 1º turno/reinjeção, quando há. */
  personaBlock: string | null
}

export interface CanalDoTurno {
  /** Conteúdo do canal SYSTEM, ou `null` quando não há canal ou não há o quê. */
  systemPrompt: string | null
  /** Doutrina que entra no CORPO. `null` quando foi pelo canal, ou não se aplica. */
  doctrineBlock: string | null
  /** Carimbo do que foi injetado, pro ledger da conversa. */
  doctrineFingerprint: string | null
  /** A persona que SOBRA pro corpo: `null` quando ela foi pelo canal system.
   *  Devolvida em vez de mutada porque quem chama precisa saber se ainda tem
   *  bloco pra prepender (o gate G2 depende disso). */
  personaBlock: string | null
}

export async function resolverCanalDoTurno(
  alvo: AlvoDoCanal,
): Promise<CanalDoTurno> {
  const sysChannel = engineDef(alvo.agent)?.systemChannel ?? false
  const doctrine = decideDoctrine({
    agent: alvo.agent,
    block: buildDoctrineBlock((await readDoctrine(alvo.projectPath)).content),
    locked: alvo.locked,
    hasReply: alvo.hasReply,
    freshSession: alvo.wheelSwitch,
    lastFingerprint: alvo.lastFingerprint,
  })

  let personaBlock = alvo.personaBlock
  // Persona pro canal system: a resolvida do 1º turno/reinjeção quando há; nos
  // turnos seguintes de conversa carimbada, re-deriva do preset (best-effort —
  // o aviso de drift do S3.4 continua cobrindo divergência).
  let systemPersona: string | null = null
  if (sysChannel) {
    if (personaBlock) {
      systemPersona = personaBlock
      personaBlock = null
    } else if (alvo.locked && alvo.presetId && alvo.presetDigest) {
      systemPersona = await personaHandoffBlock(
        alvo.presetId,
        alvo.presetDigest,
        alvo.projectPath,
      )
    }
  }

  return {
    // identidade primeiro, depois as regras: mesma ordem da cascata do corpo.
    systemPrompt:
      [systemPersona, doctrine.system].filter(Boolean).join("\n\n") || null,
    doctrineBlock: doctrine.body,
    doctrineFingerprint: doctrine.fingerprint,
    personaBlock,
  }
}
