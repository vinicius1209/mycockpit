// A RECEITA ÚNICA DE "DECISÃO PENDENTE" (§2 do STYLEGUIDE, ADR-043).
//
// POR QUE ISTO É CÓDIGO E NÃO UMA CONVENÇÃO
// -----------------------------------------
// Mesmo remédio do `lib/selection.ts` e do `lib/meter.ts`: a régua é UMA e é
// código. Quando a regra mora só no guia, ela se estilhaça em opacidades. O
// levantamento de 15/08/2026 achou QUATRO superfícies de atenção que só
// divergiam no número (`/40 + /10`, `/45 + /[0.07]`, `/30 + /5`, e o
// `border-brass/40 bg-brass/[0.07]` do fluxo de aprovação, que nem âmbar era).
// O valor escolhido, `/40` + `/10`, é o que já tinha mais sítios no app
// (`ComposerBanners` ×2, `CompanionSettings`, `ContextPanel`) — adotar o mais
// comum faz das migrações futuras um no-op.
//
// A REGRA
// -------
// Âmbar (`--st-warning`, alias de `--st-queued`) tem UM dono: **precisa de
// você**. Cartão que segura o trabalho até você decidir usa esta superfície, e
// nenhuma outra tinta. O brass é do GESTO — o botão primário DENTRO do cartão
// segue brass, e é isso que separa "o que está esperando" de "o que você
// clica". Antes do ADR-043 os dois eram a mesma tinta, e o cartão mais
// importante do app (permissão pra executar comando na sua máquina) pedia
// decisão na cor do botão que a resolve.
//
// A TRILHA PRECISA SER CONTÍNUA
// -----------------------------
// O ponto do slot da conversa (`ConversationSlot`, `bg-st-warning`) e os ícones
// do inbox (`InboxBell`, `text-st-warning`) já falavam âmbar para os MESMOS
// pedidos. Quem seguia a trilha chegava num cartão brass: a cor mudava no
// último passo, bem onde se decide.
//
// ONDE **NÃO** SE APLICA
// ----------------------
//  - **Contexto do pedido**, e não o pedido: o paredão de comando, o preview e
//    o integral em dialog são evidência para ler, não a decisão. Ficam neutros
//    (`bg-card`), dentro do cartão.
//  - **Falha consumada**: é vermelho (`st-error`), não âmbar. Âmbar é o que
//    ainda pode ser decidido.
//  - **Aviso que não segura nada** (update disponível, dívida de dias): fica na
//    lista sem tinta. Sinal que acende sempre não é sinal (§2).

/** Cartão/banner que SEGURA o trabalho até você decidir: pedido de permissão,
 *  pergunta do agent, missão interrompida esperando retomar ou descartar.
 *  Aplique junto do raio e do padding da superfície; o botão primário de dentro
 *  continua brass. */
export const PENDING_DECISION = "border-st-warning/40 bg-st-warning/10"
