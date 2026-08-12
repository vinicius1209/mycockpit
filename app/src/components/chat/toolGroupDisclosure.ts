// Regra de disclosure dos grupos de atividade (despoluição do fio, direção B
// do mock docs/mocks/fio-despoluicao-b.html): o passado custa UMA linha por
// grupo; só o vivo fica aberto; a falha não se esconde. Puro e testável — o
// componente só fornece os fatos (DOM/scroll) e obedece.
//
// A REGRA EXATA do recolhimento automático (documentada aqui por decisão da
// story, guarda 1):
//
// 1. Grupo que NASCE assentado (histórico, replay, remount da janela) nasce
//    recolhido. Falha assentada nasce ABERTA mostrando só a linha falhada
//    (o stub esconde as concluídas) — falha nunca recolhe quieta.
// 2. Grupo VIVO (turno rodando nele, processo gerenciado ou trabalho diferido)
//    fica aberto, a menos que o usuário o tenha recolhido manualmente.
// 3. Na transição vivo → assentado, recolhe automaticamente SÓ quando não
//    puxa o tapete de ninguém:
//    - nunca se o usuário togglou o grupo manualmente (ele assumiu o
//      disclosure — precedente do manuallyToggled);
//    - nunca se o grupo terminou com falha;
//    - se o leitor está DESANCORADO do fundo com o grupo visível na viewport
//      (ele rolou até ali pra ler), mantém aberto;
//    - caso contrário (grupo fora da viewport, ou leitor seguindo o fundo do
//      fio — o stick-to-bottom preserva a posição de leitura), recolhe.
//    Ao recolher um grupo ACIMA da viewport, o MessageList compensa o
//    scrollTop pela altura perdida no mesmo frame (layout effect): sem isso o
//    conteúdo que o leitor desancorado está lendo abaixo saltaria (WKWebView
//    não tem overflow-anchor e o autoscroll do ChatPanel só cobre quem está
//    no fundo). Limite conhecido: grupo PARCIALMENTE visível no topo conta
//    como "na viewport" e não recolhe — não há salto a compensar nesse caso.

/** O grupo nasce aberto? Vivo abre; falha assentada abre (mostrando só a
 *  culpada); todo o resto do passado nasce recolhido numa linha. */
export function bornOpen(input: { live: boolean; failed: boolean }): boolean {
  return input.live || input.failed
}

/** Decide o recolhimento na transição vivo → assentado. Ver a regra exata no
 *  cabeçalho do arquivo. */
export function shouldAutoCollapseOnSettle(input: {
  /** O usuário já abriu/fechou este grupo por gesto próprio. */
  manuallyToggled: boolean
  /** O grupo terminou com alguma ação falhada. */
  failed: boolean
  /** O cabeçalho do grupo está visível na viewport do fio. */
  groupInViewport: boolean
  /** O leitor está ancorado no fundo do fio (seguindo o stream). */
  followingBottom: boolean
}): boolean {
  if (input.manuallyToggled) return false
  if (input.failed) return false
  if (!input.groupInViewport) return true
  return input.followingBottom
}

/** Rótulo do stub que esconde as concluídas num grupo assentado COM falha
 *  ("as 6 ok não pagam o pato"): visível que existiram, invisível até pedir. */
export function settledOkStubLabel(count: number, open: boolean): string {
  const noun = count === 1 ? "1 concluída" : `${count} concluídas`
  return `${noun} · ${open ? "ocultar" : "mostrar"}`
}
