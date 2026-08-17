// QUEM PEDIU O ENVIO — e por que isso é um TIPO, e não um comentário.
//
// O INCIDENTE (2026-08-16, `docs/incidentes/2026-08-16-agy-fila-e-exit1.md`)
// ---------------------------------------------------------------------------
// O banner "Liberar e reenviar" (gate de diretório) chamou `handleSend` no meio
// de um turno vivo. O `handleSend` viu `running`, fez o que faz com mensagem de
// gente (ENFILEIROU), e o `finally` do turno drenou a fila: o MESMO prompt
// rodou por inteiro pela segunda vez. Dois turnos reais, 20 chamadas de
// ferramenta cada, ~2,4M de tokens a mais, num repo onde o usuário tinha
// avisado no próprio prompt que havia outro dev mexendo nos arquivos.
//
// O cabeçalho da função que reenviava já dizia "só resolve entre turnos". Era
// aspiração: nada impunha. Este módulo é a imposição.
//
// A REGRA
// -------
// A fila do composer (`conv.queued`, os chips "Na fila · enviam juntas ao
// terminar") é **do humano**. Ela guarda o que ELE digitou enquanto o agente
// trabalhava, e o `×` dela apaga os blobs dos anexos do disco
// (`store/chat.ts`, `removeQueued`). Pôr uma retomada do app lá dentro mente
// duas vezes: não foi ele que pôs, e ele pode cancelar (ou apagar anexo alheio)
// achando que está mexendo em coisa dele.
//
// Então: **retomada de sistema NUNCA entra na fila do humano.** Com turno em
// voo ela é descartada com aviso honesto, porque reenviar é o projeto correto
// (o `--add-dir` é fixo no spawn: só um turno NOVO nasce com a pasta liberada)
// mas só cabe entre turnos.
//
// A fronteira é o compilador: `entraNaFilaDoHumano` é um type predicate, e o
// `enqueue` do store pede um `OrigemHumana`. Uma retomada de sistema não tem
// como fabricar essa prova sem que alguém escreva a mentira à mão, visível em
// review.

import type { Attachment } from "@/lib/attachments"

/** Você: composer, ⌘K, botão de repetir, drenagem da fila que você digitou. */
export type OrigemHumana = { autor: "humano" }

/** Retomadas que o APP dispara sozinho. Cada motivo tem aviso próprio. */
export type MotivoDeSistema = "auto-resume" | "pasta-liberada"

/** O app se retomando. Nunca entra na fila do humano. */
export type OrigemSistema = { autor: "sistema"; motivo: MotivoDeSistema }

export type OrigemDoEnvio = OrigemHumana | OrigemSistema

export const HUMANO: OrigemHumana = { autor: "humano" }

/** Reenvio automático depois de limite de uso / "vou tentar depois". */
export const AUTO_RESUME: OrigemSistema = {
  autor: "sistema",
  motivo: "auto-resume",
}

/** Reenvio depois de liberar a pasta barrada pelo gate de diretório. */
export const PASTA_LIBERADA: OrigemSistema = {
  autor: "sistema",
  motivo: "pasta-liberada",
}

/** A assinatura da fila do composer. Ela é do HUMANO, e o 4º parâmetro é a
 *  prova: `OrigemSistema` não é atribuível a `OrigemHumana`, então uma retomada
 *  do app não compila neste caminho. */
export type Enfileirar = (
  convId: string,
  text: string,
  attachments: Attachment[] | undefined,
  autor: OrigemHumana,
) => void

/** Com turno em voo, ESTE envio pode esperar na fila do composer? Só o humano
 *  pode: é a fila dele. Type predicate de propósito, para o `enqueue` só ser
 *  alcançável dentro do ramo já provado. */
export function entraNaFilaDoHumano(
  origem: OrigemDoEnvio,
): origem is OrigemHumana {
  return origem.autor === "humano"
}

/** Este envio É a retomada automática? (Ela não cancela o próprio agendamento e
 *  nunca planeja primeiro; as outras origens seguem o toggle da conversa.) */
export function ehAutoResume(origem: OrigemDoEnvio): boolean {
  return origem.autor === "sistema" && origem.motivo === "auto-resume"
}

/** O que dizer quando uma retomada de sistema esbarra num turno vivo. Diz o que
 *  ficou de pé (a pasta ESTÁ liberada) e quando vale, sem prometer envio. */
export function avisoDeDescarte(origem: OrigemSistema): string {
  switch (origem.motivo) {
    case "pasta-liberada":
      return "Pasta liberada. Vale a partir do próximo envio."
    case "auto-resume":
      return "Retomada automática dispensada: já tem um turno rodando aqui."
  }
}
