// O app NÃO guarda caminho de config de agent nenhum (ADR-102).
//
// A restrição é do produto: o Frota vai ser instalado em outras máquinas, então
// nada pode ser fixo aqui. Onde cada CLI guarda a config de MCP é conhecimento
// do FORNECEDOR: muda com a versão, muda com o sistema, e já mudou uma vez
// nesta casa (a evidência do agy descrevia a 1.1.13 e a 1.1.21 tinha ganhado
// `agy mcp add`). Um caminho desses no código é uma bomba-relógio silenciosa:
// funciona na máquina de quem escreveu e falha na do usuário, sem erro claro.
//
// A saída desenhada no lugar: para config de USUÁRIO, rodar o comando do
// próprio CLI (`agy mcp add …`) e deixar ELE decidir onde escrever. Para config
// de PROJETO, guardar o NOME do arquivo (`opencode.json`), que é relativo ao
// diretório escolhido e portanto portátil por definição.
//
// Esta guarda existe porque a decisão acima é fácil de furar sem querer: basta
// alguém "só ler rapidinho" o mcp_config.json pra descobrir alguma coisa.
//
// Comentário é permitido de propósito: explicar ONDE o fornecedor guarda é
// documentação legítima (e vários ADRs dependem disso). O que a guarda barra é
// o caminho virar STRING de código, que é quando ele passa a ser executado.

import { readdirSync, readFileSync } from "node:fs"

const RAIZ = new URL("../app/src-tauri/src/", import.meta.url)

// Config de MCP por fornecedor. Nome de arquivo SOZINHO (`opencode.json`) não
// entra: ele é a forma portátil, e é justamente o que o desenho manda usar.
const PROIBIDOS = [
  { padrao: /"[^"]*\.gemini\/config[^"]*"/g, quem: "agy" },
  { padrao: /"[^"]*mcp_config\.json[^"]*"/g, quem: "agy" },
  { padrao: /"[^"]*\.config\/opencode[^"]*"/g, quem: "opencode" },
]

function varrer(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir)
    if (e.isDirectory()) varrer(u, acc)
    else if (e.name.endsWith(".rs")) acc.push(u)
  }
  return acc
}

const arquivos = varrer(RAIZ)
const achados = []
for (const arq of arquivos) {
  const nome = arq.href.slice(RAIZ.href.length)
  const linhas = readFileSync(arq, "utf8").split("\n")
  // Fixture de teste captura saída REAL do CLI, que às vezes cita o caminho.
  // Isso não é o app usando o caminho, é o app provando que leu a saída dele.
  const inicioDosTestes = linhas.findIndex((l) => l.trim() === "#[cfg(test)]")
  const limite = inicioDosTestes === -1 ? linhas.length : inicioDosTestes
  for (let i = 0; i < limite; i++) {
    const l = linhas[i]
    if (l.trimStart().startsWith("//")) continue
    for (const { padrao, quem } of PROIBIDOS) {
      for (const m of l.matchAll(padrao)) {
        achados.push(`${nome}:${i + 1}: ${m[0]}  (config do ${quem})`)
      }
    }
  }
}

if (achados.length) {
  console.error(`\nconfig de agent: ${achados.length} caminho(s) fixo(s) no código\n`)
  for (const a of achados) console.error(`- ${a}`)
  console.error(
    "\nO app não guarda caminho de config de agent. Para config de usuário,\n" +
      "rode o comando do CLI (ver mcp_instalacao.rs); para config de projeto,\n" +
      "guarde o NOME do arquivo, que é relativo ao diretório e portátil.\n",
  )
  process.exit(1)
}

console.log(
  `config de agent ok · ${arquivos.length} arquivos .rs varridos · ` +
    `${PROIBIDOS.length} famílias de caminho barradas`,
)
