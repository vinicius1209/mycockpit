// Bastidores (ADR-200): o que roda fora da resposta principal de uma conversa,
// derivado dos itens que o fio JÁ tem. Nada aqui inventa estado: cada item diz
// de onde vem a saída que a vista vai mostrar, e quando não há saída ao vivo
// isso vira texto honesto, não um log vazio "rodando".

import { deferredKind, type DeferredKind } from "@/lib/work"
import type { ChatItem } from "@/store/chat"

/** `tarefa` é o diferido cujo tipo o motor não disse (ou o contrato não
 *  conhece): aparece como trabalho genérico, nunca como um dos outros. */
export type TipoDeBastidor = "terminal" | "subagente" | "workflow" | "tarefa" | "processo"

const TIPO_DO_DIFERIDO: Record<DeferredKind, TipoDeBastidor> = {
  terminal: "terminal",
  subagent: "subagente",
  workflow: "workflow",
  other: "tarefa",
}

const TITULO_SEM_NOME: Record<TipoDeBastidor, string> = {
  terminal: "Terminal em segundo plano",
  subagente: "Subagente",
  workflow: "Workflow",
  tarefa: "Tarefa em segundo plano",
  processo: "Processo",
}
export type EstadoDeBastidor = "vivo" | "concluido" | "interrompido" | "falhou"

export type FonteDaSaida =
  /** Arquivo que o motor escreve ao vivo (shell em segundo plano do Claude). */
  | { tipo: "arquivo"; caminho: string }
  /** Deltas do próprio stream do turno, pelo id da tool que lançou. */
  | { tipo: "stream"; toolId: string }
  /** Saída que o `frota-work` já mantém no item. */
  | { tipo: "processo" }
  /** A saída chega inteira no resultado do item. Nenhuma derivação produz
   *  esta fonte desde 21/09/2026 (comando do turno saiu do índice); a vista
   *  ainda sabe mostrá-la. */
  | { tipo: "resultado" }
  /** Passos do subagente, pelos itens filhos. */
  | { tipo: "passos"; paiId: string }
  /** O motor não entrega saída enquanto roda. */
  | { tipo: "sem-saida" }

export interface Bastidor {
  itemId: string
  tipo: TipoDeBastidor
  titulo: string
  detalhe: string | null
  /** A linha de comando, quando o trabalho é (ou foi lançado por) um comando. */
  comando: string | null
  estado: EstadoDeBastidor
  desde: number
  atualizadoEm: number
  fonte: FonteDaSaida
  tokens: number | null
}

type ToolItem = Extract<ChatItem, { kind: "tool" }>

/** Terminados que ainda aparecem no índice: o suficiente para ler o que acabou
 *  de acabar sem virar um histórico. */
export const TERMINADOS_NO_INDICE = 8

function uma(texto: string | null | undefined, max = 120): string | null {
  const linha = texto?.trim().split("\n")[0]?.trim()
  if (!linha) return null
  return linha.length > max ? `${linha.slice(0, max - 1)}…` : linha
}

/** Resumo curto do alvo de uma tool, para o passo de subagente e o título. */
export function alvoDaTool(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const i = input as Record<string, unknown>
  for (const chave of ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"]) {
    const v = i[chave]
    if (typeof v === "string" && v.trim()) return uma(v)
  }
  return null
}

function estadoDaTool(it: ToolItem): EstadoDeBastidor {
  if (!it.result) return "vivo"
  if (it.result.interrupted) return "interrompido"
  return it.result.ok ? "concluido" : "falhou"
}

function campo(input: unknown, chave: string): string | null {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>)[chave] : null
  return typeof v === "string" && v.trim() ? v : null
}

/** A linha de comando de uma tool de terminal. `Bash` é o nome canônico do
 *  contrato: os adapters normalizam o terminal de cada motor para ele. Barato
 *  de propósito, porque a lista se refaz a cada evento do turno. */
function comandoDa(it: ToolItem | undefined): string | null {
  return it?.name === "Bash" ? campo(it.input, "command") : null
}

/** A lista de uma conversa: vivos primeiro (mais recente no topo), depois os
 *  últimos terminados que têm o que abrir.
 *
 *  Entra SÓ o que sobrevive ao gesto que o lançou, e quem diz isso é o
 *  contrato, igual para todo motor: trabalho diferido (`deferred`, que cada
 *  adapter emite quando o SEU motor devolve a conversa e o trabalho segue) e
 *  processo gerenciado pela Frota (`managedProcess`). Comando comum do turno
 *  não entra, por mais que demore: duração não é segundo plano, e ele já tem
 *  cartão no fio. Até 21/09/2026 entrava todo Bash acima de 3 s ou com saída
 *  ao vivo, e o índice virava a lista de comandos do turno.
 *
 *  Terminado sem saída nenhuma não entra: a vista dele seria vazia, e é assim
 *  que a Frota guardou, até o build #386, cada Bash comum que o Claude abria
 *  como task em primeiro plano. `comStream` = toolIds que já mandaram saída ao
 *  vivo. Puro. */
export function bastidoresDaConversa(
  items: ChatItem[],
  comStream: ReadonlySet<string> = new Set(),
): Bastidor[] {
  const out: Bastidor[] = []
  const porToolId = new Map<string, ToolItem>()
  for (const it of items) {
    if (it.kind === "tool" && it.toolId) porToolId.set(it.toolId, it)
  }
  for (const it of items) {
    if (it.kind !== "tool") continue
    if (it.deferred) {
      const d = it.deferred
      const tipo = TIPO_DO_DIFERIDO[deferredKind(d) ?? "other"]
      out.push({
        itemId: it.id,
        tipo,
        titulo: uma(d.name) ?? TITULO_SEM_NOME[tipo],
        // O motor repete o nome no resumo quando não tem o que dizer.
        detalhe: uma(d.summary) === uma(d.name) ? null : uma(d.summary),
        comando: d.toolUseId ? comandoDa(porToolId.get(d.toolUseId)) : null,
        estado: d.status === "running" ? "vivo" : d.status === "completed" ? "concluido" : "interrompido",
        desde: d.startedAt,
        atualizadoEm: d.updatedAt,
        fonte: tipo === "subagente" && d.toolUseId
          ? { tipo: "passos", paiId: d.toolUseId }
          : d.outputFile
            ? { tipo: "arquivo", caminho: d.outputFile }
            : d.toolUseId && comStream.has(d.toolUseId)
              ? { tipo: "stream", toolId: d.toolUseId }
              : { tipo: "sem-saida" },
        tokens: d.tokens,
      })
      continue
    }
    if (it.managedProcess) {
      const p = it.managedProcess
      out.push({
        itemId: it.id,
        tipo: "processo",
        titulo: uma(p.label) ?? uma(p.command) ?? TITULO_SEM_NOME.processo,
        detalhe: null,
        comando: p.command || null,
        estado:
          p.status === "running" || p.status === "stopping"
            ? "vivo"
            : p.status === "exited"
              ? "concluido"
              : p.status === "stopped"
                ? "interrompido"
                : "falhou",
        desde: p.startedAt,
        atualizadoEm: p.updatedAt,
        fonte: { tipo: "processo" },
        tokens: null,
      })
    }
  }
  const vivos = out.filter((b) => b.estado === "vivo").sort((a, b) => b.desde - a.desde)
  const terminados = out
    .filter((b) => b.estado !== "vivo" && b.fonte.tipo !== "sem-saida")
    .sort((a, b) => b.atualizadoEm - a.atualizadoEm)
    .slice(0, TERMINADOS_NO_INDICE)
  return [...vivos, ...terminados]
}

export interface PassoDeSubagente {
  id: string
  nome: string
  alvo: string | null
  estado: EstadoDeBastidor
}

/** Os passos de um subagente: as tools cujo pai é o lançador. Puro. */
export function passosDoSubagente(items: ChatItem[], paiId: string): PassoDeSubagente[] {
  const out: PassoDeSubagente[] = []
  for (const it of items) {
    if (it.kind !== "tool" || it.parentToolId !== paiId || it.deferred) continue
    out.push({ id: it.id, nome: it.name, alvo: alvoDaTool(it.input), estado: estadoDaTool(it) })
  }
  return out
}

// --------------------------------------------------------------- saída viva ---

/** Linhas guardadas por vista. Acima disso, as mais antigas saem e a vista diz
 *  quantas. É o teto que mantém o DOM leve sem lib de virtualização. */
export const LINHAS_MAX = 2000
const LINHA_MAX = 4000

export interface SaidaViva {
  linhas: string[]
  /** Linhas antigas que saíram pelo teto (ou que o motor não entregou). */
  descartadas: number
  /** Pedaço sem `\n` esperando o resto. */
  resto: string
}

export const SAIDA_VAZIA: SaidaViva = { linhas: [], descartadas: 0, resto: "" }

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** A linha como o terminal mostraria: sem ANSI e, com `\r`, só o último
 *  trecho. Com `cor`, as sequências de cor (SGR) ficam para o render
 *  (ADR-283). Espelho de `bastidores::limpar_linha` no Rust. Puro. */
export function limparLinha(bruta: string, { cor = false }: { cor?: boolean } = {}): string {
  const semCr = bruta.endsWith("\r") ? bruta.slice(0, -1) : bruta
  const visivel = semCr.slice(semCr.lastIndexOf("\r") + 1)
  const limpa = visivel
    .replace(ANSI, (seq) => (cor && /^\u001b\[[0-9;]*m$/.test(seq) ? seq : ""))
    // eslint-disable-next-line no-control-regex
    .replace(cor ? /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]|\u001b(?!\[[0-9;]*m)/g : /[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  return limpa.length > LINHA_MAX ? `${limpa.slice(0, LINHA_MAX)}…` : limpa
}

/** Soma linhas já prontas respeitando o teto. Puro. */
export function somarLinhas(atual: SaidaViva, novas: string[], descartadasAntes = 0): SaidaViva {
  if (!novas.length && !descartadasAntes) return atual
  const linhas = atual.linhas.concat(novas)
  const excesso = Math.max(0, linhas.length - LINHAS_MAX)
  return {
    linhas: excesso ? linhas.slice(excesso) : linhas,
    descartadas: atual.descartadas + excesso + descartadasAntes,
    resto: atual.resto,
  }
}

/** Soma texto cru (deltas de stream, que partem linha no meio). Puro. */
export function somarTexto(atual: SaidaViva, texto: string): SaidaViva {
  const partes = (atual.resto + texto).split("\n")
  const resto = partes.pop() ?? ""
  const somado = somarLinhas(atual, partes.map((p) => limparLinha(p, { cor: true })))
  return { ...somado, resto }
}
