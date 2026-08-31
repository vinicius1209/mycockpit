// A MEMÓRIA de uma conversa, montada por SIGNIFICADO (G1 do
// docs/memoria-de-conversa-plan.md).
//
// # O que este arquivo substitui, e por quê
//
// O `serializeContext` corta por POSIÇÃO: 30% do início + 70% do fim, miolo
// fora. Medido nas conversas reais desta máquina (fase 0 do plano):
//
//   1885 itens · 234k de contexto · em 3k sobram 29,8%
//
// E o número é menos grave que a forma: o que some é o MIOLO, onde moram as
// descobertas e os becos. O início é "o que pedi"; o fim é "onde estamos".
//
// A medida que reescreveu o problema: **90% dos BYTES são itens `tool`**, e os
// `user` — a intenção humana — são ~0%. O orçamento é gasto quase todo em
// telemetria. Em duas das quatro conversas medidas, TODA a intenção humana
// caberia nos 3k de hoje; ela só é espremida por ferramenta.
//
// Então o conserto não é mais orçamento nem melhor compressão: é **gastar por
// significado antes de gastar por posição**.
//
// # A alocação, em ordem de insubstituibilidade
//
//   1. intenção humana      — TODO item `user`. O mais barato e o que ninguém
//                             reconstrói: é o único registro do que se QUIS.
//   2. decisões             — `planGate` com o carimbo. "Eu aprovei isso?" é
//                             pergunta que aparece semanas depois.
//   3. falhas em aberto     — `error`/`limit` e ferramenta que falhou sem
//                             sucesso posterior no mesmo alvo.
//   4. estado atual         — os últimos turnos, verbatim.
//   5. o resto              — ferramenta AGREGADA ("47 leituras em src/"), não
//                             47 linhas.
//
// # A regra que o antigo violava
//
// **Toda projeção declara o que cortou.** O recap de hoje parece completo — tem
// começo, tem fim, e um único `[… N itens omitidos …]` no meio. Truncagem que
// parece íntegra é pior que truncagem óbvia, porque ninguém vai atrás do resto.

import { toolDigest } from "@/lib/fusion"
import { frameHistory } from "@/lib/trust"
import type { ChatItem } from "@/store/chat"

/** Orçamento default. Mesmo número do `RESUME_FALLBACK_BUDGET` de propósito: a
 *  comparação entre os dois algoritmos tem que ser no mesmo espaço. */
export const MEMORIA_BUDGET = 3_000

/** Quantos turnos recentes entram VERBATIM (o "onde estamos"). */
const TURNOS_RECENTES = 6

/** Piso do teto por pedido: abaixo disto a frase não identifica mais nada. */
const PEDIDO_MIN = 60

/** Teto INICIAL de um pedido isolado, quando eles não cabem todos inteiros.
 *
 * Medido: numa conversa com 34 pedidos e 7,6k de texto, manter os INTEIROS
 * mais recentes preservava 5 de 34. Cortando cada um, cabem os 34 — e o começo
 * de um pedido é onde mora a intenção ("quero que você revise o projeto X…");
 * o resto é detalhe, que está no arquivo de memória. Trinta e quatro intenções
 * pela metade reconstroem a conversa; cinco inteiras, não. */
const PEDIDO_MAX = 200

/** O que sobrou de fora, por categoria. Não é telemetria: é a linha que a
 *  projeção imprime pra não se fazer passar por completa. */
export interface Cortes {
  ferramentas: number
  respostas: number
  outros: number
}

export interface Memoria {
  texto: string
  cortes: Cortes
}

const vazio = (s: string | undefined | null) => !s || !s.trim()

/** Uma linha por item, no vocabulário mais curto que ainda identifica. */
function linha(it: ChatItem): string | null {
  switch (it.kind) {
    case "user":
      return vazio(it.text) ? null : `VOCÊ: ${it.text.trim()}`
    case "planGate": {
      const carimbo =
        it.decision === "approved"
          ? "APROVADO"
          : it.decision === "discarded"
            ? "RECUSADO"
            : it.decision === "superseded"
              ? "SUPERADO por um plano posterior"
              : "SEM DECISÃO até aqui"
      return `PLANO (${carimbo}): ${it.text.trim()}`
    }
    case "error":
      return `ERRO: ${it.message.trim()}`
    case "limit":
      return `LIMITE ATINGIDO: ${it.message.trim()}`
    case "text":
      return vazio(it.text) ? null : `AGENTE: ${it.text.trim()}`
    case "tool":
      return `· ${it.name}${it.result && !it.result.ok ? " (FALHOU)" : ""}`
    default:
      return null
  }
}

/**
 * ONDE o trabalho tocou — caminhos e comandos ÚNICOS, do `input` das
 * ferramentas.
 *
 * É o fato de maior sinal por byte que temos, e a primeira versão deste arquivo
 * o perdeu: agregar só o NOME da ferramenta ("Edit ×47") diz que houve edição e
 * esconde ONDE. Um teste do formato antigo pegou a perda — ele exigia
 * `src/App.tsx` no recap, e estava certo.
 *
 * Único de propósito: 47 edições em 3 arquivos são 3 linhas, não 47. E é EXATO,
 * não inferido — vem do argumento que a ferramenta recebeu.
 */
function alvosTocados(items: ChatItem[], max = 20): string | null {
  const vistos = new Set<string>()
  for (const it of items) {
    if (it.kind !== "tool") continue
    const d = toolDigest(it.input)
    if (d) vistos.add(d)
    if (vistos.size >= max) break
  }
  if (vistos.size === 0) return null
  return `ONDE O TRABALHO TOCOU: ${[...vistos].join(", ")}`
}

/**
 * Ferramentas viram CONTAGEM por nome, não lista.
 *
 * 1617 linhas de `· Read` não dizem mais que "Read ×1617" — dizem o mesmo, mil
 * vezes, ocupando o lugar do que só aparece uma vez.
 */
function agregarFerramentas(items: ChatItem[]): string | null {
  const conta = new Map<string, number>()
  for (const it of items) {
    if (it.kind !== "tool") continue
    conta.set(it.name, (conta.get(it.name) ?? 0) + 1)
  }
  if (conta.size === 0) return null
  const partes = [...conta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nome, n]) => (n > 1 ? `${nome} ×${n}` : nome))
  return `Ferramentas usadas: ${partes.join(", ")}`
}

/** Ferramenta que falhou e NÃO teve execução bem-sucedida depois com o mesmo
 *  nome. É a aproximação determinística de "isto ficou quebrado" — sem LLM, sem
 *  adivinhação. Erra pro lado de mostrar demais, que é o lado seguro. */
function falhasEmAberto(items: ChatItem[]): ChatItem[] {
  const okDepois = new Set<string>()
  const abertas: ChatItem[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== "tool") continue
    if (it.result?.ok) okDepois.add(it.name)
    else if (it.result && !it.result.ok && !okDepois.has(it.name)) abertas.push(it)
  }
  return abertas.reverse()
}

/**
 * Monta a memória da conversa dentro do orçamento.
 *
 * O orçamento é gasto na ordem da alocação: se a intenção humana sozinha não
 * couber, ela é truncada pelo FIM (os pedidos recentes mandam) e nada mais
 * entra — porque nada mais vale mais que ela.
 */
export function memoriaDaConversa(
  items: ChatItem[],
  budget = MEMORIA_BUDGET,
): Memoria {
  const cortes: Cortes = { ferramentas: 0, respostas: 0, outros: 0 }
  const secoes: string[] = []
  let usado = 0

  const cabe = (s: string) => usado + s.length + 2 <= budget
  const por = (s: string) => {
    secoes.push(s)
    usado += s.length + 2
  }

  // 1 · INTENÇÃO — entra sempre, e primeiro.
  const pedidos = items.filter((i) => i.kind === "user").map(linha).filter(Boolean)
  if (pedidos.length) {
    const bloco = ["O QUE VOCÊ PEDIU:", ...pedidos].join("\n")
    if (cabe(bloco)) por(bloco)
    else {
      // Não cabe inteira: encurta CADA pedido, e o teto por pedido é ADAPTATIVO
      // — divide o espaço disponível pelo número de pedidos. Descartar pedidos
      // contradiria o princípio deste arquivo ("34 intenções pela metade
      // reconstroem a conversa; 5 inteiras, não"), e a primeira versão fazia
      // exatamente isso quando o teto fixo de 200 não bastava.
      const espaco = Math.floor(budget * 0.6)
      const porPedido = Math.max(
        PEDIDO_MIN,
        Math.min(PEDIDO_MAX, Math.floor(espaco / pedidos.length) - 1),
      )
      const curtos = pedidos.map((p) =>
        p!.length > porPedido ? `${p!.slice(0, porPedido).trimEnd()}…` : p!,
      )
      const bloco2 = ["O QUE VOCÊ PEDIU (cada um encurtado):", ...curtos].join("\n")
      if (cabe(bloco2)) por(bloco2)
      else {
        // Nem no piso cabem: aí sim ficam os mais recentes, e o corte é dito.
        const mantidos: string[] = []
        let n = 0
        for (let i = curtos.length - 1; i >= 0; i--) {
          if (n + curtos[i].length + 1 > espaco) break
          mantidos.unshift(curtos[i])
          n += curtos[i].length + 1
        }
        cortes.outros += curtos.length - mantidos.length
        por(["O QUE VOCÊ PEDIU (os mais recentes, encurtados):", ...mantidos].join("\n"))
      }
    }
  }

  // 2 · DECISÕES
  const decisoes = items.filter((i) => i.kind === "planGate").map(linha).filter(Boolean)
  if (decisoes.length) {
    const bloco = ["DECISÕES:", ...decisoes].join("\n")
    if (cabe(bloco)) por(bloco)
    else cortes.outros += decisoes.length
  }

  // 3 · FALHAS EM ABERTO
  const falhas = [
    ...items.filter((i) => i.kind === "error" || i.kind === "limit"),
    ...falhasEmAberto(items),
  ]
    .map(linha)
    .filter(Boolean)
  if (falhas.length) {
    const bloco = ["FALHAS SEM CONSERTO POSTERIOR:", ...falhas].join("\n")
    if (cabe(bloco)) por(bloco)
    else cortes.outros += falhas.length
  }

  // 4 · ESTADO ATUAL — os últimos turnos COM SIGNIFICADO, verbatim.
  //
  // Pegar os últimos N itens CRUS não serve: numa conversa que termina com 500
  // leituras (o caso real medido), "onde paramos" viraria seis linhas de
  // `· Read`. O que diz onde a conversa parou é o que foi PEDIDO, RESPONDIDO,
  // DECIDIDO ou QUEBROU — ferramenta só entra se não houver mais nada.
  const significativos = items.filter((i) =>
    ["user", "text", "planGate", "error", "limit"].includes(i.kind),
  )
  const cauda = (significativos.length ? significativos : items).slice(
    -TURNOS_RECENTES,
  )
  const recentes = cauda.map(linha).filter(Boolean)
  if (recentes.length) {
    const bloco = ["ONDE A CONVERSA PAROU:", ...recentes].join("\n")
    if (cabe(bloco)) por(bloco)
    else cortes.outros += recentes.length
  }

  // 5 · ONDE tocou — antes da contagem de ferramenta, porque diz mais.
  const alvos = alvosTocados(items)
  if (alvos) {
    if (cabe(alvos)) por(alvos)
    else cortes.outros += 1
  }

  // 6 · O RESTO, agregado.
  const agregado = agregarFerramentas(items)
  if (agregado) {
    if (cabe(agregado)) por(agregado)
    else cortes.ferramentas += items.filter((i) => i.kind === "tool").length
  }

  // O que ficou de fora, por categoria. Contado por TIPO e não por presença
  // literal no texto: a ferramenta agregada aparece como contagem, não como
  // linha, então ela conta como cortada mesmo tendo sido mencionada — é o
  // detalhe dela que não está lá, e é isso que o leitor precisa saber.
  const noFinal = new Set(cauda)
  cortes.ferramentas = items.filter(
    (i) => i.kind === "tool" && !noFinal.has(i),
  ).length
  cortes.respostas = items.filter(
    (i) => i.kind === "text" && !noFinal.has(i),
  ).length

  // O rodapé entra no ORÇAMENTO. Deixá-lo fora estourava o teto (medido: 3111
  // num budget de 3000) — e uma projeção que fura o próprio limite pra dizer
  // que respeita limites é a pior forma de mentir.
  const rodape = declararCortes(cortes)
  if (rodape) {
    if (!cabe(rodape)) {
      // Abre espaço tirando a seção MENOS insubstituível (a última que entrou).
      secoes.pop()
      cortes.outros += 1
    }
    secoes.push(rodape)
  }

  // H3 (prompt-hygiene-plan): isto é conteúdo SERIALIZADO reinjetado em prompt,
  // então sai EMOLDURADO — instrução plantada no histórico fica dentro dos
  // delimitadores, nunca vira pedido solto.
  //
  // Esqueci a moldura na primeira versão, e quem pegou foi o `trust.test.ts` da
  // casa. Vale o registro: a rede existia porque alguém já tinha pensado nisso,
  // e ela mordeu um autor novo do mesmo caminho meses depois. É exatamente o
  // que uma guarda deve fazer.
  //
  // A moldura fica FORA do orçamento, mesma convenção do `serializeContext`: ela
  // é constante e obrigatória, então contá-la faria o teto significar coisas
  // diferentes conforme o tamanho do delimitador.
  return { texto: frameHistory(secoes.join("\n\n")), cortes }
}

/**
 * A linha que impede a projeção de se fazer passar por completa.
 *
 * Ela é o conserto do defeito estrutural do recap antigo: um único
 * `[… N itens omitidos …]` no meio, cercado de texto coerente, lê como
 * "detalhe". Aqui o corte é por CATEGORIA e fica no fim, onde se lê.
 */
export function declararCortes(c: Cortes): string | null {
  const partes: string[] = []
  if (c.ferramentas > 0) partes.push(`${c.ferramentas} execuções de ferramenta`)
  if (c.respostas > 0) partes.push(`${c.respostas} respostas do agente`)
  if (c.outros > 0) partes.push(`${c.outros} outros itens`)
  if (partes.length === 0) return null
  return `NÃO ESTÁ AQUI (${partes.join(", ")}). O histórico completo continua disponível na memória da conversa.`
}
