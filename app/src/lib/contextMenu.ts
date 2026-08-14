// Identidade única do botão direito (ADR-042).
//
// O menu que o WKWebView/WebKitGTK abre sozinho é artefato do MOTOR, não
// feature do produto: ele oferece "Reload" (recarrega o app inteiro),
// "AutoFill", "Search with Google", "Show Writing Tools". Nada disso é do
// Frota. O app suprime o menu do motor em TODO clique direito e responde com o
// menu dele, pela mesma primitiva (`components/ui/context-menu.tsx`).
//
// Este módulo é a REGRA PURA: dado um alvo, quais itens aparecem. Sem DOM,
// sem clipboard, sem Tauri — o host (`components/common/AppContextMenu.tsx`)
// faz a sondagem do DOM e executa. Assim a regra é testável em node.
//
// Guarda inegociável (§7.1 do STYLEGUIDE): item que não FAZ não existe. Cada
// item aqui tem execução real; o que não tem implementação ficou de fora em
// vez de virar item morto.

/** O que estava embaixo do cursor quando o usuário clicou com o direito. */
export type Alvo =
  /** input/textarea/contenteditable: o botão direito ainda tem que servir. */
  | {
      tipo: "editavel"
      /** Campo de senha: nunca oferece copiar/cortar (não vaza segredo). */
      senha: boolean
      /** `readonly`/`disabled`: dá pra tirar texto, não pra pôr. */
      somenteLeitura: boolean
      temSelecao: boolean
      temConteudo: boolean
    }
  /** Mensagem do fio (não editável). */
  | { tipo: "mensagem"; texto: string; selecao: string }
  /** Anexo/evidência com imagem, dentro do fio ou do lightbox. */
  | { tipo: "imagem"; path: string; nome: string }
  /** Texto selecionado em superfície não editável, fora de mensagem. */
  | { tipo: "selecao"; texto: string }

export type ItemId =
  | "cortar"
  | "copiar"
  | "colar"
  | "selecionar-tudo"
  | "copiar-mensagem"
  | "copiar-imagem"
  | "abrir-imagem"
  | "revelar-imagem"

/** Divisor. Nunca sobra nas pontas nem dobra (ver `limpaDivisores`). */
export const DIVISOR = "divisor" as const

export type LinhaMenu = ItemId | typeof DIVISOR

/**
 * O que a máquina REALMENTE consegue fazer agora. Tudo aqui é fato apurado
 * pelo host, não palpite: fora do Tauri não há leitura de área de
 * transferência nem "mostrar na pasta", então o item some (degradação
 * honesta, §5 camada 1) em vez de aparecer e falhar.
 */
export type Recursos = {
  /**
   * Colar. No WKWebView, `navigator.clipboard.readText()` devolve
   * NotAllowedError para conteúdo que a própria página não escreveu, e
   * `execCommand("paste")` devolve false (medido em 14/08/2026). Só existe
   * com o plugin de clipboard do Tauri, que lê o NSPasteboard pelo Rust.
   */
  colar: boolean
  /** "Mostrar na pasta": `revealItemInDir` do plugin opener, só no Tauri. */
  revelar: boolean
}

export const ROTULOS: Record<ItemId, string> = {
  cortar: "Cortar",
  copiar: "Copiar",
  colar: "Colar",
  "selecionar-tudo": "Selecionar tudo",
  "copiar-mensagem": "Copiar mensagem",
  "copiar-imagem": "Copiar imagem",
  "abrir-imagem": "Abrir no app padrão",
  // Neutro de propósito: o produto é Mac E Linux, e "Finder" mentiria no
  // segundo. "Pasta" vale nos dois.
  "revelar-imagem": "Mostrar na pasta",
}

/** Tira divisor das pontas e colapsa divisor repetido. */
function limpaDivisores(linhas: LinhaMenu[]): LinhaMenu[] {
  const saida: LinhaMenu[] = []
  for (const l of linhas) {
    if (l === DIVISOR && (saida.length === 0 || saida[saida.length - 1] === DIVISOR)) {
      continue
    }
    saida.push(l)
  }
  while (saida.length > 0 && saida[saida.length - 1] === DIVISOR) saida.pop()
  return saida
}

/**
 * A regra: alvo → itens. Lista vazia significa "não abre menu nenhum" (menu
 * vazio é pior que menu ausente); o motor continua suprimido de qualquer jeito.
 */
export function itensPara(alvo: Alvo | null, rec: Recursos): LinhaMenu[] {
  if (!alvo) return []

  if (alvo.tipo === "editavel") {
    const podeEscrever = rec.colar && !alvo.somenteLeitura
    // Senha: o único gesto honesto é ENTRAR com texto. Copiar/cortar tirariam
    // o segredo do campo por um menu que o usuário abriu sem querer.
    if (alvo.senha) return podeEscrever ? ["colar"] : []
    return limpaDivisores([
      ...(alvo.temSelecao
        ? alvo.somenteLeitura
          ? (["copiar"] as LinhaMenu[])
          : (["cortar", "copiar"] as LinhaMenu[])
        : []),
      ...(podeEscrever ? (["colar"] as LinhaMenu[]) : []),
      DIVISOR,
      ...(alvo.temConteudo ? (["selecionar-tudo"] as LinhaMenu[]) : []),
    ])
  }

  if (alvo.tipo === "mensagem") {
    return limpaDivisores([
      ...(alvo.selecao ? (["copiar"] as LinhaMenu[]) : []),
      DIVISOR,
      ...(alvo.texto ? (["copiar-mensagem"] as LinhaMenu[]) : []),
    ])
  }

  if (alvo.tipo === "imagem") {
    return limpaDivisores([
      "copiar-imagem",
      DIVISOR,
      "abrir-imagem",
      ...(rec.revelar ? (["revelar-imagem"] as LinhaMenu[]) : []),
    ])
  }

  return alvo.texto ? ["copiar"] : []
}

/**
 * A sondagem do DOM entregue como fato plano, pra decisão de precedência
 * ficar pura (e testada) em vez de escondida em `closest()` encadeado.
 */
export type Sonda = {
  editavel: {
    senha: boolean
    somenteLeitura: boolean
    temSelecao: boolean
    temConteudo: boolean
  } | null
  imagem: { path: string; nome: string } | null
  mensagem: { texto: string } | null
  /** Seleção de texto vigente na janela, já aparada. */
  selecao: string
}

/**
 * Precedência do mais específico pro mais genérico. Imagem antes de mensagem
 * porque o anexo mora DENTRO da mensagem; editável na frente de tudo porque
 * lá o botão direito tem função de sistema a cumprir.
 */
export function alvoDe(s: Sonda): Alvo | null {
  if (s.editavel) return { tipo: "editavel", ...s.editavel }
  if (s.imagem) return { tipo: "imagem", ...s.imagem }
  if (s.mensagem) {
    return { tipo: "mensagem", texto: s.mensagem.texto, selecao: s.selecao }
  }
  if (s.selecao) return { tipo: "selecao", texto: s.selecao }
  return null
}
