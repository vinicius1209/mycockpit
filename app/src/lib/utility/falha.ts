// O motivo de uma falha da inferência utilitária, em pt-BR, para quem clicou.
//
// O gateway lança `Error(código)` (`deadline_exceeded`, `auth_required`…), e a
// tela mostrava "Falha ao sugerir a mensagem" para qualquer um deles, porque só
// sabia ler erro em string. Com o helper estourando o prazo em todas as
// chamadas (15/09/2026), a pessoa não tinha como saber que era tempo.

const MOTIVOS: Record<string, string> = {
  deadline_exceeded: "O modelo auxiliar não respondeu a tempo.",
  timed_out: "O modelo auxiliar não respondeu a tempo.",
  auth_required: "O modelo auxiliar precisa de login no Claude Code.",
  rate_limited: "O modelo auxiliar atingiu o limite de uso. Tente de novo mais tarde.",
  spawn_failed: "Não consegui iniciar o modelo auxiliar. O Claude Code está instalado?",
  process_failed: "O modelo auxiliar encerrou com erro. O detalhe ficou no log do app.",
  input_too_large: "As alterações são grandes demais para o modelo auxiliar.",
  invalid_response: "O modelo auxiliar devolveu uma resposta vazia ou inválida.",
  framework_unavailable: "O modelo auxiliar não está disponível agora.",
  cancelled: "A sugestão foi cancelada.",
}

/** Frase para o toast. Código desconhecido ou erro sem código cai no `padrao`. */
export function mensagemDaFalhaUtilitaria(erro: unknown, padrao: string): string {
  if (typeof erro === "string" && erro.trim()) return MOTIVOS[erro] ?? erro
  if (erro instanceof Error) return MOTIVOS[erro.message] ?? padrao
  return padrao
}
