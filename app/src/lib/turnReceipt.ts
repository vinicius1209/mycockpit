// Recibo de turno (M2, do estudo do Maestri) — o fim de turno diz O QUE fez.
//
// O gap que isto fecha: quando um turno terminava em background, o aviso dizia
// literalmente "turno concluído". O momento de maior atenção do seu dia não
// carregava conteúdo nenhum. O Ombro do Maestri prova que esse instante merece
// texto; a forma deles (janela flutuante) a gente NÃO copia — já são 3 canais
// e nenhum silencioso (ADR-013), um quarto seria ruído. O que faltava era a
// alma: resumo no canal que já existe.
//
// Duas restrições que desenham o módulo inteiro:
//
// 1. **Prazo, não espera.** O resumo vem de uma chamada ao helper. Esperar sem
//    limite fura "nenhum canal silencioso": helper travado = aviso que nunca
//    sai. Então é corrida contra `RECEIPT_DEADLINE_MS`, e o desfecho ruim é a
//    frase de hoje, nunca o silêncio.
// 2. **Só em background.** No primeiro plano você acabou de ver o turno
//    acontecer no fio; resumir seria contar o que você leu. E a chamada custa —
//    limitar ao turno que rodou longe dos seus olhos é onde ela se paga.

import { suggest } from "@/lib/agent"
import { buildContext } from "@/lib/suggestions"
import type { ChatItem } from "@/store/chat"

/** Quanto o aviso espera pelo resumo antes de sair com a frase genérica. */
export const RECEIPT_DEADLINE_MS = 3000

/** Teto do resumo. Corpo de notificação de SO é truncado pelo próprio sistema;
 *  cortar aqui é escolher ONDE corta em vez de deixar o macOS cortar no meio. */
export const RECEIPT_MAX = 150

export const RECEIPT_PROMPT = `Resuma em UMA frase, em pt-BR, O QUE o assistente FEZ neste último turno.

Regras:
- comece por um verbo no passado ("Extraiu…", "Corrigiu…", "Investigou…");
- seja concreto (arquivo, módulo ou número), nunca genérico como "concluiu a tarefa";
- no máximo 20 palavras;
- responda APENAS a frase, sem aspas, sem markdown, sem prefixo.`

/**
 * Limpa a resposta do helper numa frase usável, ou `null`.
 *
 * `null` é um desfecho DE PRIMEIRA CLASSE: quem chama volta pra frase genérica.
 * Melhor não dizer nada do que empurrar "Claro! Aqui está:" pro centro de
 * notificações do usuário.
 */
export function parseReceipt(raw: string): string | null {
  const primeira = (raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!primeira) return null
  const limpo = primeira
    .replace(/^["'`*\s-]+|["'`*\s]+$/g, "") // aspas, bullets e markdown de borda
    .replace(/\s+/g, " ")
    .trim()
  // Curto demais não é resumo, é ruído ("Ok.", "Feito"). O piso é baixo de
  // propósito: barra o lixo sem virar censor de frase legítima e curta.
  if (limpo.length < 12) return null
  return limpo.length > RECEIPT_MAX
    ? `${limpo.slice(0, RECEIPT_MAX - 1).trimEnd()}…`
    : limpo
}

/**
 * O corpo da notificação. Puro — é a frase que o usuário lê, então ela é
 * testável sem chamar helper nenhum.
 *
 * Com recibo, o "turno concluído" SAI: dizer as duas coisas gastaria a linha
 * curta do sistema repetindo o óbvio (se veio recibo, concluiu). Com erro o
 * desfecho fica, porque aí ele é a informação principal — e o recibo, quando
 * existe, explica onde parou.
 */
export function receiptBody(
  title: string,
  errored: boolean,
  receipt: string | null,
): string {
  if (!receipt) return `${title} · ${errored ? "turno falhou" : "turno concluído"}`
  return errored ? `${title} · turno falhou · ${receipt}` : `${title} · ${receipt}`
}

/**
 * A frase do turno onde ela aparece SOZINHA, abaixo do título: a bandeja e o
 * Companion (R1/R2). Uma linha, sem o título embutido — quem chama já o mostrou.
 *
 * Mora coladinha no `receiptBody` de propósito. As duas parecem candidatas a
 * virar uma função só, e NÃO são — a diferença é deliberada e some se as duas
 * ficarem em arquivos distantes:
 *
 * - o `receiptBody` monta a linha ÚNICA e curta do sistema operacional, então
 *   com recibo ele DERRUBA o "turno concluído" (o recibo já prova que concluiu,
 *   e a linha é cara);
 * - aqui a linha é só a frase, e o desfecho é o FALLBACK — quando não houve
 *   recibo, ele é a única coisa que sobrou pra dizer.
 *
 * O que era duplicação de verdade: este par de palavras estava escrito nas duas
 * superfícies separadamente, uma em TSX e outra no HTML servido ao celular.
 */
export function fraseDoTurno(receipt: string | null, ok: boolean): string {
  return receipt ?? (ok ? "turno concluído" : "turno falhou")
}

/**
 * Pede o resumo ao helper, desistindo no prazo.
 *
 * O `race` não CANCELA a chamada perdedora — o custo dela já foi pago quando
 * saiu. O que o prazo protege é o seu aviso, não a sua fatura; quem protege a
 * fatura é o `helperModel: null`, que nem chega aqui.
 */
export async function turnReceipt(p: {
  helperModel: string | null
  cwd: string
  items: readonly ChatItem[]
  deadlineMs?: number
}): Promise<string | null> {
  if (!p.helperModel) return null
  const prompt = `${RECEIPT_PROMPT}\n\nConversa recente:\n${buildContext(p.items as ChatItem[])}`
  const prazo = new Promise<null>((r) =>
    setTimeout(() => r(null), p.deadlineMs ?? RECEIPT_DEADLINE_MS),
  )
  try {
    const raw = await Promise.race([suggest(p.helperModel, p.cwd, prompt), prazo])
    return typeof raw === "string" ? parseReceipt(raw) : null
  } catch {
    return null // helper indisponível: o aviso sai genérico, nunca deixa de sair
  }
}
