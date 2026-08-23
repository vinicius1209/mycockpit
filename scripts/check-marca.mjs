// GUARDA DE MARCA — o produto se chama Frota (docs/frota-rename-plan.md).
//
// O que ela impede: "MyCockpit" voltar a aparecer numa string que o usuário lê
// ou que vai no prompt de um agente. Sem guarda, o nome antigo reentra sozinho —
// por copiar uma linha vizinha, por um agente que leu o repo inteiro e imitou o
// que viu mais.
//
// O que ela NÃO toca, e é o ponto do plano: o rename NÃO é um replace global. O
// repo tem três categorias e só uma é marca:
//
//   marca         "O MyCockpit preservou..." → vira Frota. É o que esta guarda cobre.
//   interno       comentários, nomes de módulo → limpeza posterior, sem valor de marca.
//   PERSISTÊNCIA  `mycockpit.db`, `.mycockpit/`, `mc.app`, `dev.vinicius.mycockpit`,
//                 `mycockpit.flight-plan`, `mc-work` → NÃO MUDAM. Trocar qualquer
//                 um desses cria um app novo e vazio ao lado do seu, ou desliga
//                 credencial, hook e handoff que já existem em disco.
//
// Por isso a varredura é só de `MyCockpit` (com maiúsculas), e só em STRING —
// os identificadores persistidos são minúsculos, então ficam de fora por
// construção, não por allowlist que alguém precisa lembrar de manter.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const RAIZ = new URL("../app/src", import.meta.url).pathname
const MARCA_VELHA = /MyCockpit/

/** Testes podem citar o nome antigo: eles descrevem comportamento legado, e
 *  vários FIXAM justamente que um identificador não mudou. */
const isTeste = (p) => /\.(test|spec)\.[jt]sx?$/.test(p)

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) yield* arquivos(p)
    else if (/\.[jt]sx?$/.test(p) && !isTeste(p)) yield p
  }
}

/** Linha de comentário puro. Comentário é categoria "interna": citar o nome
 *  antigo ali não engana usuário nenhum, e proibir viraria ruído que ninguém
 *  respeita — guarda que cria exceção demais deixa de ser lida. */
const soComentario = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)

const achados = []
let varridos = 0
for (const f of arquivos(RAIZ)) {
  varridos++
  const linhas = readFileSync(f, "utf8").split("\n")
  linhas.forEach((l, i) => {
    if (!MARCA_VELHA.test(l) || soComentario(l)) return
    achados.push(`${f.replace(RAIZ + "/", "")}:${i + 1}: ${l.trim().slice(0, 100)}`)
  })
}

if (achados.length) {
  console.error(`\nmarca: ${achados.length} ocorrência(s) de "MyCockpit" fora de comentário\n`)
  for (const a of achados) console.error(`- ${a}`)
  console.error(
    `\nO produto se chama Frota. Se isto for MARCA, troque.\n` +
      `Se for PERSISTÊNCIA (banco, .mycockpit/, mc.app, bundle id, formato de\n` +
      `plano de voo), o nome certo é minúsculo e NÃO muda — ver\n` +
      `docs/frota-rename-plan.md.\n`,
  )
  process.exit(1)
}
console.log(`marca ok · ${varridos} arquivos varridos em app/src · produto: Frota`)
