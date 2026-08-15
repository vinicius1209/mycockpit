// SLOT DIREITO DA LINHA DE CONVERSA (STYLEGUIDE §6, ADR-043).
//
// A linha tem três zonas com três donos, e esta é a terceira: 36px reservados
// que respondem UMA pergunta ("quando?"), em ordem fechada
// `pede > rodando > falhou > tempo relativo`. A identidade do motor fica na
// marca à esquerda e não recebe mais selo de estado: quem muda sozinho mora
// aqui, quem nunca muda mora lá.
//
// Puro de propósito: a ordem e o rótulo são decisão, e decisão se testa sem
// DOM. O componente só pinta o que estas funções decidem.

/** O que ocupa o slot. Um por vez, sempre nesta precedência. */
export type SlotEstado = "pede" | "rodando" | "falhou" | "quando"

/**
 * A ordem é fechada e não é arbitrária:
 * - **pede** vence tudo porque é o único que PAROU esperando você (é a mesma
 *   regra do ponto na pasta do projeto: um turno que roda sozinho não precisa
 *   de você; um que parou pra perguntar, sim);
 * - **rodando** vem antes de **falhou** porque falha carimbada é do turno
 *   ANTERIOR (o `finishedUnseen` só é limpo quando você abre a conversa), e
 *   uma conversa que já voltou a rodar não pode ficar vestida de vermelho;
 * - **quando** é o repouso, e é o único estado sem tinta.
 */
export function slotEstado({
  pede,
  rodando,
  falhou,
}: {
  pede: boolean
  rodando: boolean
  falhou: boolean
}): SlotEstado {
  if (pede) return "pede"
  if (rodando) return "rodando"
  if (falhou) return "falhou"
  return "quando"
}

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA
const SEMANA = 7 * DIA

/**
 * Tempo relativo com precisão que DEGRADA: `agora · 9m · 1h · 3d`, e data a
 * partir de 7 dias. "34d" seria ruído fingindo precisão; segundos seriam um
 * segundo relógio na tela, e o §6 já deu o agora à linha viva do rodapé.
 *
 * Sem carimbo confiável devolve "" — o slot fica vazio e o layout não desloca
 * (§6, "sem status confiável, não inventa"). Carimbo no futuro (drift de
 * relógio) vira "agora", nunca um negativo.
 */
export function fmtQuando(
  updatedAt: number | null | undefined,
  agora: number,
): string {
  if (updatedAt == null || !Number.isFinite(updatedAt) || updatedAt <= 0) return ""
  const idade = agora - updatedAt
  if (idade < MINUTO) return "agora"
  if (idade < HORA) return `${Math.floor(idade / MINUTO)}m`
  if (idade < DIA) return `${Math.floor(idade / HORA)}h`
  if (idade < SEMANA) return `${Math.floor(idade / DIA)}d`
  const d = new Date(updatedAt)
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
}
