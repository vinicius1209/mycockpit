// A RECEITA ÚNICA DE "ESCOLHIDO" (§2 do STYLEGUIDE, ADR-043 Fase 5).
//
// POR QUE ISTO É CÓDIGO E NÃO UMA CONVENÇÃO
// -----------------------------------------
// A Fase 5 fechou dezesseis sítios que diziam "ativo" de três jeitos
// diferentes, e três receitas de chip que só divergiam na opacidade da borda
// (`border-brass/40`, `/50`, `/60`) — divergência que ninguém decidiu e que
// nasce sozinha quando a regra mora só no guia. É o mesmo remédio do
// `lib/meter.ts` ("a régua é UMA e é código"): superfície nova IMPORTA, não
// recalcula.
//
// A REGRA
// -------
// Seleção NÃO É COR. Quem foi escolhido ganha **preenchimento neutro (`--sel`)
// + peso 500 + texto `foreground`** — nenhuma tinta de status, nenhuma barra de
// acento, nenhum sublinhado colorido, nenhum ícone tingido por estar ativo. O
// brass é do GESTO (ação primária, foco, marca); num app cuja doutrina é
// aprovação humana, a tinta de "isto executa sem pedir" não pode ser prima da
// tinta de "esta linha está selecionada".
//
// ONDE **NÃO** SE APLICA (fronteira decidida, não esquecida)
// ---------------------------------------------------------
//  - **Interruptor binário de ajuste** (`Switch`, checkbox nativo com
//    `accent-color`): ligar/desligar UM comportamento não é escolher entre
//    itens, e o preenchimento do trilho É a afordância — neutro ali deixaria
//    ligado e desligado com o mesmo pixel. Segue brass.
//  - **Controle segmentado** (comutador da barra superior, Painel/Trabalho):
//    exceção já fechada no §2, segue em E1 (`bg-card` +
//    `--shadow-sm`). A permissão da linha de Execução SAIU desta lista quando
//    virou lista vertical no painel de colapso: lá ela é `SELECTED_FILL`
//    normal, como qualquer opção de menu — só "Liberado" segue amber pela
//    regra de baixo, risco autorizado, não por ser controle segmentado.
//  - **Risco autorizado** ("Liberado", "Auto" de autonomia): é âmbar, não é
//    seleção — o §2 manda o risco ficar visível, e neutralizar ali seria
//    esconder o que precisa ser visto.

/** Item ESCOLHIDO que ganha preenchimento próprio: chip de filtro, linha de
 *  lista, opção de formulário, aba. Aplique depois das classes-base (o
 *  `twMerge` do `cn` resolve o conflito a favor do que vem por último). */
export const SELECTED_FILL = "border-transparent bg-sel font-medium text-foreground"

/** O par do `SELECTED_FILL`: disponível, ainda não escolhido. Hover é
 *  `--sel-hover` (~metade da opacidade: hover é convite, seleção é fato). */
export const UNSELECTED =
  "border-border text-muted-foreground hover:bg-sel-hover hover:text-foreground"

/** Escolhido que JÁ TEM superfície própria (cartão, nó de canvas): não dá pra
 *  trocar o preenchimento sem apagar a superfície, então quem marca é o aro —
 *  neutro, com o halo em `--sel`. Continua sem tinta. */
export const SELECTED_ON_SURFACE =
  "border-border-strong shadow-[0_0_0_3px_var(--sel)]"
