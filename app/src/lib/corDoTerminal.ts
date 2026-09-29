// A cor que a ferramenta emitiu, nos Bastidores (ADR-283). Só o SGR básico
// (negrito, esmaecido e as 8 cores, normais e claras) vira token `terminal-*`;
// fundo, 256 cores fora das 16 primeiras e truecolor caem no neutro. Cor é
// estado real: o ✓ verde do teste e o erro vermelho do Vite chegam como são.

export interface TrechoComCor {
  texto: string
  /** Classes do trecho; vazio é o texto padrão da saída. */
  classe: string
}

type Cor = "erro" | "sucesso" | "aviso" | "info" | "fraco" | null

interface Estilo {
  cor: Cor
  negrito: boolean
  esmaecido: boolean
}

const SGR = /\u001b\[([0-9;]*)m/g
const SGR_INTEIRO = /\u001b\[[0-9;]*m/g

const CLASSE_DA_COR: Record<Exclude<Cor, null>, string> = {
  erro: "text-terminal-error",
  sucesso: "text-terminal-success",
  aviso: "text-terminal-warning",
  info: "text-terminal-info",
  fraco: "text-terminal-dim",
}

/** A cor de uma das 16 cores de base (0–7 normais, 8–15 claras). */
function corDaBase(n: number): Cor {
  switch (n % 8) {
    case 0:
      return "fraco"
    case 1:
      return "erro"
    case 2:
      return "sucesso"
    case 3:
      return "aviso"
    case 4:
    case 5:
    case 6:
      return "info"
    default:
      return null
  }
}

function aplicar(estilo: Estilo, parametros: string): Estilo {
  const codigos = parametros === "" ? [0] : parametros.split(";").map((p) => Number(p || 0))
  let e = { ...estilo }
  for (let i = 0; i < codigos.length; i++) {
    const c = codigos[i]
    if (c === 0) e = { cor: null, negrito: false, esmaecido: false }
    else if (c === 1) e.negrito = true
    else if (c === 2) e.esmaecido = true
    else if (c === 22) e = { ...e, negrito: false, esmaecido: false }
    else if (c === 39) e.cor = null
    else if (c >= 30 && c <= 37) e.cor = corDaBase(c - 30)
    else if (c >= 90 && c <= 97) e.cor = c === 90 ? "fraco" : corDaBase(c - 90)
    else if (c === 38 || c === 48) {
      // 38;5;n e 38;2;r;g;b: consome os parâmetros para não lê-los como código.
      const modo = codigos[i + 1]
      if (modo === 5) {
        const n = codigos[i + 2]
        if (c === 38) e.cor = n != null && n < 16 ? (n === 8 ? "fraco" : corDaBase(n)) : null
        i += 2
      } else if (modo === 2) {
        if (c === 38) e.cor = null
        i += 4
      }
    }
  }
  return e
}

function classeDo(e: Estilo): string {
  const partes: string[] = []
  if (e.cor) partes.push(CLASSE_DA_COR[e.cor])
  else if (e.esmaecido) partes.push(CLASSE_DA_COR.fraco)
  if (e.cor && e.esmaecido) partes.push("opacity-70")
  if (e.negrito) partes.push("font-semibold")
  return partes.join(" ")
}

/** A saída em trechos com a classe de cada um. O estado de cor atravessa as
 *  linhas, como num terminal. Sequência cortada no meio some. Puro. */
export function trechosComCor(texto: string): TrechoComCor[] {
  if (!texto.includes("\u001b")) return texto ? [{ texto, classe: "" }] : []
  const out: TrechoComCor[] = []
  let estilo: Estilo = { cor: null, negrito: false, esmaecido: false }
  let desde = 0
  const empurrar = (pedaco: string) => {
    const limpo = pedaco.replace(/\u001b[^m]*$/, "").replace(/\u001b/g, "")
    if (!limpo) return
    const classe = classeDo(estilo)
    const ultimo = out[out.length - 1]
    if (ultimo && ultimo.classe === classe) ultimo.texto += limpo
    else out.push({ texto: limpo, classe })
  }
  for (const m of texto.matchAll(SGR)) {
    empurrar(texto.slice(desde, m.index))
    estilo = aplicar(estilo, m[1])
    desde = m.index + m[0].length
  }
  empurrar(texto.slice(desde))
  return out
}

/** O texto sem as sequências de cor, para copiar e medir. Puro. */
export function semCor(texto: string): string {
  return texto.replace(SGR_INTEIRO, "")
}
