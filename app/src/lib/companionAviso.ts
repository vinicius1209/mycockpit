// QUANDO O CELULAR É AVISADO COM A TELA FECHADA (Companion PRD A6).
//
// O transporte é do Rust (`companion_push.rs`, cifrado ponta a ponta). A
// decisão é daqui, porque quem conhece a frota é o app. Três regras, e todas
// nasceram de como um aviso vira incômodo:
//
// 1. Só o que PEDE VOCÊ. Turno que terminou bem não acorda ninguém.
// 2. **Um aviso por episódio.** O mesmo pedido de aprovação não avisa de novo a
//    cada respiro do snapshot (mesma lei do watchdog).
// 3. Só quando **nenhuma** página do Companion está conectada. Com a página
//    aberta o aviso já existe lá (vibra e pisca o título): empurrar também
//    seria avisar em dobro.
//
// Limite conhecido: a contagem de conexões é do SERVIDOR, não por aparelho.
// Com dois celulares e um deles com a página aberta, o outro não recebe push
// nessa rodada. Preferi isso a duplicar aviso enquanto não existe presença por
// aparelho.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { companionStatus } from "@/lib/companion"
import type { CompanionAttention, CompanionSnapshot } from "@/lib/companionTypes"

export interface AvisoDeCelular {
  titulo: string
  corpo: string
  /** Rota do Companion, relativa à raiz. */
  url: string
  /** Avisos com a mesma tag se substituem no aparelho. */
  tag: string
}

/** O que cada tipo de pedido diz em UMA linha. */
function frase(item: CompanionAttention): string {
  const onde = item.projectName ? ` · ${item.projectName}` : ""
  switch (item.kind) {
    case "approval":
      return `Aprovação pendente${onde}`
    case "question":
      return `Pergunta do agente${onde}`
    case "gate":
      return `Respostas pendentes${onde}`
    default:
      return `Turno parado${onde}`
  }
}

/** A tela que o toque abre. Sem conversa resolvida, abre o início: melhor a
 *  lista honesta do que uma rota inventada que não existe. */
export function rotaDoEpisodio(item: CompanionAttention): string {
  if (!item.convId || !item.projectId || !item.agent) return "/"
  return `/#/chat/${item.projectId}/${item.agent}/${item.convId}`
}

/** Episódios que ainda não foram avisados, na ordem em que chegaram. */
export function episodiosNovos(
  attention: readonly CompanionAttention[],
  jaAvisados: ReadonlySet<string>,
): CompanionAttention[] {
  return attention.filter((a) => a.id && !jaAvisados.has(a.id))
}

/** O aviso a mandar. Vários episódios novos de uma vez viram UM aviso com a
 *  contagem: o celular não é lugar de enxurrada. */
export function avisoDoTurno(
  novos: readonly CompanionAttention[],
  maquina: string | null,
): AvisoDeCelular | null {
  if (novos.length === 0) return null
  const titulo = maquina?.trim() ? `Frota · ${maquina.trim()}` : "Frota"
  if (novos.length === 1) {
    const item = novos[0]
    return { titulo, corpo: frase(item), url: rotaDoEpisodio(item), tag: `atencao:${item.id}` }
  }
  return {
    titulo,
    corpo: `${novos.length} coisas pedem você`,
    url: "/",
    tag: "atencao:varias",
  }
}

/** Os ids que seguem valendo depois desta rodada: o que ainda está pedindo
 *  você. Episódio resolvido SAI, então se ele voltar mais tarde avisa de novo
 *  (é outro episódio, não repetição do mesmo). */
export function avisadosDepois(
  attention: readonly CompanionAttention[],
  jaAvisados: ReadonlySet<string>,
): Set<string> {
  const vivos = new Set(attention.map((a) => a.id))
  const proximos = new Set<string>()
  for (const id of jaAvisados) if (vivos.has(id)) proximos.add(id)
  for (const id of vivos) proximos.add(id)
  return proximos
}

/** A decisão inteira, sem efeito: o que mandar (ou nada) e o que lembrar. */
export function decidirAviso(
  snapshot: Pick<CompanionSnapshot, "attention">,
  contexto: { jaAvisados: ReadonlySet<string>; conectados: number; maquina: string | null },
): { aviso: AvisoDeCelular | null; avisados: Set<string> } {
  const attention = snapshot.attention ?? []
  const avisados = avisadosDepois(attention, contexto.jaAvisados)
  // Página aberta em algum lugar: ela já avisa. Mesmo assim os episódios ficam
  // marcados, senão fechar a página faria chover aviso do que você já viu.
  if (contexto.conectados > 0) return { aviso: null, avisados }
  return {
    aviso: avisoDoTurno(episodiosNovos(attention, contexto.jaAvisados), contexto.maquina),
    avisados,
  }
}


// ---------------- o efeito ----------------

let avisados: ReadonlySet<string> = new Set()

/** Zera a memória dos episódios avisados (parada do Companion, teste). */
export function esquecerAvisos(): void {
  avisados = new Set()
}

/** Decide e manda. Best-effort de ponta a ponta: sem Tauri, sem servidor ou
 *  sem aparelho inscrito, não acontece nada e ninguém quebra por isso. O que
 *  NÃO é silencioso é falha de entrega: o Rust registra no log com o motivo. */
export async function avisarNoCelular(
  snapshot: Pick<CompanionSnapshot, "attention">,
): Promise<void> {
  if (!isTauri()) return
  const status = await companionStatus()
  // Servidor parado: ninguém para avisar, e nem marcamos episódio (quando ele
  // voltar, o que estiver pedindo você ainda é novidade para o celular).
  if (!status?.running) return
  const { aviso, avisados: proximos } = decidirAviso(snapshot, {
    jaAvisados: avisados,
    conectados: status.connectedCount ?? 0,
    maquina: status.maquina ?? null,
  })
  avisados = proximos
  if (!aviso) return
  try {
    await invoke("companion_push_avisar", { aviso })
  } catch (e) {
    console.warn("[companion] aviso com a tela fechada não saiu:", e)
  }
}
