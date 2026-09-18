// O NOME que a conversa ganha quando o primeiro turno termina.
//
// Aqui só mora o que é puro: o recorte que vai pro modelo, o prompt e a
// limpeza da resposta. O quando (fim do primeiro turno), o se (título ainda não
// apropriado por ninguém) e o efeito (renomear) moram em `store/chat/titulo.ts`.
//
// Duas escolhas que valem explicação:
//
// 1. **O recorte NÃO é o `buildContext` das sugestões.** Aquele leva as últimas
//    6 mensagens, que é o certo para "o que fazer agora" e o errado para "como
//    isso se chama": o que nomeia uma conversa é o PEDIDO que a abriu. Então o
//    recorte daqui é ancorado no primeiro texto do usuário, com a última
//    resposta do assistente só como desempate (o pedido "arruma isso" sozinho
//    não nomeia nada).
// 2. **`null` é desfecho de primeira classe**, como no recibo de turno: quem
//    chama volta pro `deriveTitle`, que é o texto que a PESSOA escreveu. Um
//    nome ruim é pior que um nome cru, então na dúvida o parser recusa.

import type { ChatItem } from "@/store/chat"

/** Teto do nome, igual ao do `deriveTitle`: é a régua da sidebar. */
export const TITULO_MAX = 44

/** Prazo curto de propósito: ninguém está esperando por isso, e o turno já
 *  acabou. Estourou, a conversa fica com o nome cru e a vida segue. */
export const TITULO_DEADLINE_MS = 4000

const PEDIDO_CAP = 600
const RESPOSTA_CAP = 600

/** A resposta do modelo quando a conversa ainda não tem assunto. Não é enfeite:
 *  sem ela, "oi" devolvia "Qual é o assunto do trabalho" — o modelo respondia a
 *  pergunta em vez de nomear, e a conversa ganhava uma PERGUNTA como nome
 *  (saída real do haiku em 18/09/2026, fixture em `tituloDaConversa.test.ts`). */
export const SEM_ASSUNTO = "SEM ASSUNTO"

export const TITULO_PROMPT = `Dê um NOME curto para esta conversa de trabalho, em pt-BR.

Regras:
- nomeie o ASSUNTO, não a ação nem o desfecho ("Timer do watchdog", nunca "Corrigi o timer" ou "Conversa sobre bug");
- de 3 a 6 palavras, no máximo ${TITULO_MAX} caracteres;
- sem aspas, sem markdown, sem ponto final, sem travessão;
- não comece com "Conversa sobre", "Discussão de" nem "Ajuda com";
- o assunto pode vir da RESPOSTA quando o pedido é vago ("arruma isso" + resposta sobre o parse do custo = "Parse do custo do turno");
- responda ${SEM_ASSUNTO} apenas se a conversa for SÓ saudação ou teste, sem nenhum trabalho técnico citado em lugar nenhum;
- responda APENAS o nome, nada além dele.`

/** O recorte que nomeia: o pedido que abriu a conversa, mais a última resposta
 *  do assistente como contexto. */
export function contextoDoTitulo(items: readonly ChatItem[]): string {
  const pedido = items.find((it) => it.kind === "user")
  const texto = (pedido && "text" in pedido ? pedido.text : "") ?? ""
  const respostas = items.filter((it) => it.kind === "text")
  const ultima = respostas[respostas.length - 1]
  const resposta = (ultima && "text" in ultima ? ultima.text : "") ?? ""
  const linhas = [`Pedido: ${texto.slice(0, PEDIDO_CAP)}`]
  if (resposta) linhas.push(`Resposta: ${resposta.slice(0, RESPOSTA_CAP)}`)
  return linhas.join("\n")
}

/**
 * Limpa a resposta do helper num nome usável, ou `null`.
 *
 * O travessão não é só estilo: o guia proíbe em copy, e o nome da conversa vira
 * título de notificação e de schedule. Quando ele aparece, o formato é sempre
 * "Assunto — detalhe", então o corte fica com o assunto.
 */
export function parseTitulo(raw: string): string | null {
  const primeira = (raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!primeira) return null
  let limpo = primeira
    .replace(/^["'`*#\s-]+|["'`*\s]+$/g, "") // aspas, bullets e markdown de borda
    .replace(/\s+/g, " ")
    .trim()
  // "Assunto — detalhe" vira "Assunto". Antes do corte de ponto final, senão
  // um detalhe terminando em "." deixaria o ponto no meio do caminho.
  const travessao = limpo.search(/[—–]/)
  if (travessao >= 0) limpo = limpo.slice(0, travessao).trim()
  limpo = limpo.replace(/[.,;:]+$/, "").trim()
  // A sentinela chega com a caixa e a pontuação que o modelo quiser: o haiku
  // devolveu "SEM ASSUNTO" numa rodada e "Sem assunto." na outra (as duas
  // reais). Compara depois da limpeza, sem acento e sem caixa.
  if (
    limpo
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toUpperCase() === SEM_ASSUNTO
  ) {
    return null
  }
  // Preâmbulo conversacional ("Claro! Aqui está:") sempre termina em dois
  // pontos, e o corte acima o deixaria terminando em "Aqui está". O sinal é a
  // linha ORIGINAL, não a limpa.
  if (/:$/.test(primeira.trim())) return null
  // Curto demais não é nome, é ruído ("Ok", "Bug"). O piso é baixo: barra o
  // lixo sem virar censor de nome legítimo e curto.
  if (limpo.length < 5) return null
  return limpo.length > TITULO_MAX ? `${limpo.slice(0, TITULO_MAX)}…` : limpo
}
