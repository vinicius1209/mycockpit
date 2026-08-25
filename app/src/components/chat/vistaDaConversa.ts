// O que o painel da conversa mostra, decidido fora do JSX.
//
// ── O DEFEITO QUE ISTO CONSERTA (25/08/2026) ────────────────────────────────
// Havia um booleano chamado `missionActive` que NÃO significava "missão ativa":
// ele era `!!byConv[convId]`, ou seja "esta conversa TEM uma missão" — e o
// registro fica em memória depois que a missão termina (o próprio store diz
// isso: "qualquer status: rodando OU timeline visível").
//
// Consequência, relatada pelo usuário com missão concluída na tela: o composer
// aceitava mensagem (o envio olha `status === "running"`, que já era false), a
// mensagem era gravada… e o fio NUNCA voltava a renderizar, porque a condição
// dele era `!missionActive`. Você digitava e nada aparecia.
//
// ── A REGRA ────────────────────────────────────────────────────────────────
// São DUAS perguntas diferentes, e o nome único as colapsava:
//
//   "tem missão nesta conversa?"  → a TIMELINE aparece (registro do episódio)
//   "a missão está RODANDO?"      → ela TOMA a tela (o fio recua)
//
// Missão terminal (done/error/aborted) mantém a timeline como registro E
// devolve o fio, com a conversa continuando abaixo dela.
//
// Não duplica o resumo: no fim normal a missão NÃO grava marco de conclusão no
// fio (o `patchConv({status:"done"})` não chama `recordHistory`), então o
// resumo existe num lugar só, a timeline.

/** O status de uma missão, do ponto de vista de quem desenha a tela. */
export type StatusDaMissao = "running" | "done" | "error" | "aborted"

export interface VistaDaConversa {
  /** A timeline da missão aparece (registro do episódio, terminado ou não). */
  timeline: boolean
  /** O transcript aparece. Recua SÓ enquanto a missão roda. */
  fio: boolean
  /** A barra de presença aparece. Mesma regra do fio. */
  presenca: boolean
  /** O "Boa tarde, …" aparece (conversa nenhuma e missão nenhuma). */
  boasVindas: boolean
}

export function vistaDaConversa(p: {
  temConversa: boolean
  /** null = nenhuma missão nesta conversa. */
  missao: StatusDaMissao | null
}): VistaDaConversa {
  const temMissao = p.missao !== null
  // A ÚNICA condição que faz o fio recuar. `done`, `error` e `aborted` são
  // terminais: a missão virou história, e história não bloqueia conversa.
  const rodando = p.missao === "running"
  return {
    timeline: temMissao,
    fio: p.temConversa && !rodando,
    presenca: p.temConversa && !rodando,
    // Missão sem conversa ainda ocupa a tela: o "Boa tarde" flutuando sobre a
    // timeline foi o defeito que a supressão original veio consertar.
    boasVindas: !p.temConversa && !temMissao,
  }
}
