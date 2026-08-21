// Setup global da suíte: drena o trabalho de fundo antes de apagar a luz.
//
// Sem isto, uma promessa disparada com `void` dentro de um teste sobrevive ao
// próprio teste e acorda depois do teardown do vitest — que foi exatamente o
// `EnvironmentTeardownError` intermitente do CI. Sintoma cruel: passa 3019/3019
// no Mac (grafo de módulos quente, a promessa ganha a corrida) e falha no
// runner de vez em quando, o que convida a culpar "a máquina lenta" em vez do
// código. Aqui a corrida deixa de existir: o teste só acaba quando o fundo
// acabou.
//
// Custo: nenhum para quem não agenda fundo (o Set está vazio, sai na hora).

import { afterEach } from "vitest"
import { aguardeFundo } from "@/lib/deFundo"

afterEach(async () => {
  await aguardeFundo()
})
