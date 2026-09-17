// Qual texto vai no envio: o override do editor, ou o valor do composer.
//
// ── O DEFEITO (25/08/2026) ─────────────────────────────────────────────────
// Relato: "montei um prompt grande com 5 imagens e não consigo enviar, clico no
// botão e nada acontece". E o detalhe que resolveu: **Enter funcionava**.
//
// O `submit` era assim:
//
//     function submit(overrideText?: string) {
//       const text = (overrideText ?? value).trim()
//
// O Enter chama `submit(textoDoEditor)` — string, tudo certo. Mas o botão é
// `onClick={onSubmit}`, e aí o REACT passa o MouseEvent como 1º argumento. O
// `??` só cai pro fallback em null/undefined, e um evento é truthy: `.trim()`
// num MouseEvent lança TypeError, o handler do React engole, e o clique não faz
// nada. Silenciosamente.
//
// Estava assim desde o ADR-051. Ninguém viu porque Enter é o gesto natural de
// quem digita; o botão só é procurado quando o prompt é grande demais pra
// confiar na tecla.
//
// ── A REGRA ────────────────────────────────────────────────────────────────
// SÓ string vence o valor do composer. Qualquer outra coisa (evento, undefined,
// null, número) cai no `value`. Assim o call site não precisa lembrar de
// escrever `() => submit()` — e um call site novo não consegue reintroduzir o
// defeito.

//
// Citações do rascunho (capricho PRD R4) entram AQUI, na frente do texto, pelo
// formato de `lib/citacao.ts`: é o único ponto por onde passam envio, envio
// forçado e fila. Sem texto escrito, a citação sozinha não vira mensagem.

import { textoComCitacoes, type BlocoDoRascunho } from "@/lib/citacao"
import { textoComColagens, type BlocoColagem } from "@/lib/colagem"

export function textoDoEnvio(
  override: unknown,
  value: string,
  blocos?: readonly BlocoDoRascunho[],
): string {
  const texto = textoComCitacoes((typeof override === "string" ? override : value).trim(), blocos)
  // Colagens grandes (capricho R7) vão no fim, depois do que foi escrito.
  const colagens = (blocos ?? []).filter((b): b is BlocoColagem => b.tipo === "colagem")
  return textoComColagens(texto, colagens)
}
