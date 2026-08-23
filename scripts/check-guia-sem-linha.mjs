// O STYLEGUIDE aponta arquivo e SÍMBOLO, nunca `arquivo:linha` (§0).
//
// Por que é guarda e não confiança: a catraca do §10 obriga a DIVIDIR arquivo,
// então número de linha se move toda semana POR DESENHO. A auditoria de
// 23/08/2026 achou 19 referências com linha, duas já podres — uma caía num
// `return out`, outra apontava para 100 linhas DEPOIS do fim do arquivo. As
// demais estavam "dentro do range", o que não prova nada.
//
// Referência que envelhece sozinha é pior que nenhuma: manda o leitor pro lugar
// errado com a autoridade do guia. Nome de símbolo é greppável e sobrevive à
// divisão; por isso a regra é sobre a FORMA da referência, não sobre acertar o
// número.

import { readFileSync } from "node:fs"

const ALVOS = ["docs/STYLEGUIDE.md"]
const REF = /`[A-Za-z][A-Za-z0-9/._-]*\.(?:ts|tsx|rs|mjs):\d+(?:,\d+)*`/g

const achados = []
for (const alvo of ALVOS) {
  const linhas = readFileSync(new URL(`../${alvo}`, import.meta.url), "utf8").split("\n")
  linhas.forEach((l, i) => {
    for (const m of l.matchAll(REF)) achados.push(`${alvo}:${i + 1}: ${m[0]}`)
  })
}

if (achados.length) {
  console.error(`\nguia: ${achados.length} referência(s) com número de linha\n`)
  for (const a of achados) console.error(`- ${a}`)
  console.error(
    "\nAponte arquivo e SÍMBOLO (`store/chat.ts`, `deferredLiveLine`).\n" +
      "Número de linha apodrece sozinho: a catraca do §10 move todos eles a\n" +
      "cada divisão de arquivo, e o leitor cai no lugar errado achando que o\n" +
      "guia o mandou lá.\n",
  )
  process.exit(1)
}
console.log(`guia ok · ${ALVOS.length} documento(s) · nenhuma referência arquivo:linha`)
