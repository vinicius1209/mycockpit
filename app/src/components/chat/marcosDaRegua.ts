// Os marcos da régua de turnos (ADR-250, mock `docs/mocks/regua-de-turnos.html`).
//
// A régua nasceu com um traço por GRUPO DE AUTOR (você, agente, sistema). Na
// conversa real que motivou a troca, 13 pedidos viravam 34 traços: todo aviso
// do sistema (memória, compactação, retomada) ganhava traço de turno e partia a
// resposta do agente em duas, e o balão do traço do agente mostrava a PRIMEIRA
// frase dele, que é narração ("Antes de commitar, confiro…"), nunca a resposta.
//
// Agora a unidade é o PEDIDO: do seu item `user` até o próximo. O que o agente,
// o especialista e o sistema fizeram nesse meio pertence ao traço desse pedido.
// Os fatos (resposta, estado, duração, ações) vêm de `historicoDePedidos`, a
// MESMA derivação da aba Conversa: duas superfícies que mostram o pedido não
// podem discordar sobre ele. Aqui só entra o que é da régua: que grupos da
// tela são de qual pedido, os avisos do sistema e o rótulo do corte.
//
// Puro: o componente só mede, observa e pinta.

import type { PedidoDoFio } from "@/lib/conversationMap/historico"
import { rotuloDoCorte } from "@/lib/corte"
import type { ChatItem } from "@/store/chat"
import type { MessageGroup } from "./messageGroups"

export interface MarcoDaRegua {
  /** id do item `user` que abriu o pedido. */
  key: string
  /** DOM do primeiro grupo DESTE pedido na janela: é para onde o clique leva. */
  groupId: string
  /** Keys de todos os grupos que pertencem ao pedido (o marcador ativo). */
  grupos: string[]
  /** Posição do pedido na conversa inteira, a partir de 1. */
  ordem: number
  pedido: PedidoDoFio
  /** Primeira linha de cada aviso do sistema que caiu dentro do pedido. */
  avisos: string[]
  /** Quem cortou e por quê, quando o pedido foi interrompido (ADR-180). */
  corte: string | null
  /** >1 quando o marcador representa uma FAIXA condensada de pedidos. */
  span?: number
  /** Keys dos pedidos engolidos pela faixa (só quando `span` > 1). */
  covers?: string[]
}

function primeiraLinha(texto: string): string | null {
  return texto.split("\n").map((l) => l.trim()).find(Boolean) ?? null
}

/** Os pedidos donos de um grupo, na ordem. Quase sempre um só, mas duas
 *  mensagens suas seguidas (a fila drenando, por exemplo) caem no MESMO grupo
 *  "você" e são dois pedidos. */
function donosDoGrupo(grupo: MessageGroup, dono: Map<string, string>): string[] {
  const donos: string[] = []
  for (const node of grupo.nodes) {
    const ids = "itemIds" in node && node.itemIds ? [node.key, ...node.itemIds] : [node.key]
    const achado = ids.map((id) => dono.get(id)).find(Boolean)
    if (achado && !donos.includes(achado)) donos.push(achado)
  }
  return donos
}

/**
 * Um marco por pedido que tem algo na janela pintada, na ordem do fio.
 * `pedidos` vem de `historicoDePedidos` (do mais novo ao mais velho, como a
 * aba Conversa lê). Grupo sem pedido (o que vem antes do primeiro pedido)
 * entra no marco mais próximo para o "na tela" não sumir, sem virar traço.
 */
export function marcosDaRegua(
  groups: readonly MessageGroup[],
  items: readonly ChatItem[],
  pedidos: readonly PedidoDoFio[],
): MarcoDaRegua[] {
  const dono = new Map<string, string>()
  const avisos = new Map<string, string[]>()
  const cortes = new Map<string, string>()
  let atual: string | null = null
  for (const item of items) {
    // A MESMA fronteira do histórico: fala endereçada a especialista não abre
    // pedido, ela acontece dentro do pedido em curso.
    if (item.kind === "user" && !item.advisorTo) atual = item.id
    if (!atual) continue
    dono.set(item.id, atual)
    if (item.kind === "notice") {
      const linha = primeiraLinha(item.message)
      if (linha) avisos.set(atual, [...(avisos.get(atual) ?? []), linha])
    } else if (item.kind === "cancelled") {
      cortes.set(atual, rotuloDoCorte(item.cause))
    }
  }

  const total = pedidos.length
  const porId = new Map(pedidos.map((p, i) => [p.id, { pedido: p, ordem: total - i }]))
  const marcos: MarcoDaRegua[] = []
  const porPedido = new Map<string, MarcoDaRegua>()
  const semDono: string[] = []
  for (const grupo of groups) {
    const ids = donosDoGrupo(grupo, dono).filter((id) => porId.has(id))
    if (ids.length === 0) {
      const ultimo = marcos.at(-1)
      if (ultimo) ultimo.grupos.push(grupo.key)
      else semDono.push(grupo.key)
      continue
    }
    for (const id of ids) {
      const existente = porPedido.get(id)
      if (existente) {
        if (!existente.grupos.includes(grupo.key)) existente.grupos.push(grupo.key)
        continue
      }
      const marco: MarcoDaRegua = {
        key: id,
        groupId: `msg-group-${grupo.key}`,
        grupos: [...semDono.splice(0), grupo.key],
        ordem: porId.get(id)!.ordem,
        pedido: porId.get(id)!.pedido,
        avisos: avisos.get(id) ?? [],
        corte: cortes.get(id) ?? null,
      }
      marcos.push(marco)
      porPedido.set(id, marco)
    }
  }
  return marcos
}

/** A linha de baixo do marco: a resposta, ou o desfecho quando não houve. */
export function respostaDoMarco(marco: MarcoDaRegua): string {
  const { pedido } = marco
  if (pedido.estado === "interrompido" && marco.corte) return marco.corte
  if (pedido.resposta) return pedido.resposta
  switch (pedido.estado) {
    case "rodando":
      return "trabalhando…"
    case "limite":
      return "parou no limite de uso"
    case "erro":
      return "terminou com erro"
    case "interrompido":
      return "interrompido"
    default:
      return "sem resposta registrada"
  }
}

/** O pedido pede atenção: parou num limite ou terminou em erro. */
export function marcoPedeAtencao(marco: MarcoDaRegua): boolean {
  return marco.pedido.estado === "erro" || marco.pedido.estado === "limite"
}
