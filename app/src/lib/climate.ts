// CLIMA DE RISCO — quando a área de conteúdo ganha sinal AMBIENTE de que o
// próximo turno executa sem pedir.
//
// Por que existe: "Liberado" era só um rótulo âmbar num segmented, e rótulo
// estático vira papel de parede (você para de ver o que está sempre ali, do
// mesmo jeito). Modo em que o agente escreve e executa na sua máquina sem
// perguntar merece um sinal que acompanha a tela inteira, não um selo.
//
// A regra da casa que isto instaura: **modo de RISCO tem sinal ambiente;
// STATUS não.** Status (rodando, concluído, falhou) já tem lugar no fio e na
// linha viva; se cada estado ganhasse moldura, a moldura deixaria de significar
// alguma coisa. A moldura tem um dono só, e o dono é o risco autorizado.
//
// Autolimitado de propósito: só o modo perigoso acende. Não existe "clima de
// Só lê" nem "clima de Pede" — sinal que acende sempre não é sinal.

import type { PermissionMode } from "@/lib/types"

export interface ClimateInput {
  /** Há conversa ativa na tela? Sem conversa, não há próximo turno pra avisar. */
  hasConversation: boolean
  /** Modo EFETIVO da conversa ativa (vem do projeto dela, ver lib/permission). */
  mode: PermissionMode
  /** A conversa ativa tem pedido pendente (permissão ou pergunta) esperando você? */
  awaitingDecision: boolean
}

/**
 * O clima de risco está aceso?
 *
 * Colisão resolvida aqui (as duas coisas são âmbar, e âmbar tem significados
 * diferentes no §2 do STYLEGUIDE):
 *
 * - **âmbar de DECISÃO ganha do clima.** Enquanto um pedido espera resposta, o
 *   clima recolhe: o âmbar da tela precisa ser lido como "responde aqui", e uma
 *   moldura âmbar permanente ao redor de uma pergunta âmbar dilui exatamente o
 *   pixel acionável. O modo continua DITO, sem ambiguidade, na linha de
 *   Execução (o segmented âmbar com o triângulo) — que é a fonte autoritativa;
 *   o clima é lembrete, não é a verdade.
 * - **vermelho de FALHA não apaga o clima.** Falha é conteúdo (mora no fio, com
 *   matiz próprio) e o modo segue perigoso depois dela; apagar a moldura ali
 *   seria mentir sobre o próximo turno. Planos diferentes (moldura × conteúdo),
 *   matizes diferentes, e o orçamento de tinta do §2 continua em 2 cores.
 *
 * Puro: quem desenha não recalcula nada.
 */
export function riskClimateOn(input: ClimateInput): boolean {
  if (!input.hasConversation) return false
  if (input.mode !== "liberado") return false
  if (input.awaitingDecision) return false
  return true
}

/**
 * A moldura do clima, em classe única (exportada pra ser TESTÁVEL).
 *
 * `ring-inset` de 1px, não desloca layout nenhum, não rouba clique
 * (`pointer-events-none`) e não anima — logo `prefers-reduced-motion` não tem o
 * que desligar (§6: pulse é pra vivo, e o modo não é um evento, é uma condição
 * permanente; algo pulsando ali seria ruído infinito).
 *
 * ELA EMOLDURA A JANELA, NÃO O PAINEL (corrigido no build 202). Até o 201 isto
 * morava dentro do <section> do ChatPanel, então a moldura parava onde o painel
 * parava — a sidebar e a faixa de status ficavam de fora e o olho lia "moldura
 * cortada por outra camada" (relato do usuário). Não era camada nenhuma: ela
 * nunca tinha coberto a janela. E a promessa que o próprio app faz, na descrição
 * do modo, é "a tela inteira ganha moldura âmbar" — o alcance agora cumpre a
 * frase.
 *
 * `rounded-[10px]`: a janela do macOS é arredondada (titleBarStyle Overlay, com
 * decoração nativa). Um anel de cantos retos tem os cantos comidos pelo raio do
 * sistema — que era a OUTRA metade do "parece cortado".
 */
export const CLIMATE_FRAME_CLASS =
  "pointer-events-none absolute inset-0 z-[130] rounded-[10px] ring-1 ring-st-warning/30 ring-inset"
