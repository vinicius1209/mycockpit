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

import type { TabelaCopiavel } from "./tabelaClipboard"

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
  /**
   * Bloco de texto do produto (não editável): mensagem do fio, markdown do
   * agent, detalhe do painel de contexto. O marcador é o `data-selectable`
   * que o app já usa pra liberar seleção — "o usuário pode selecionar" e "o
   * usuário pode copiar" são a mesma pergunta, então não inventamos um
   * segundo marcador pra ela.
   */
  | {
      tipo: "bloco"
      texto: string
      selecao: string
      /** O clique caiu numa tabela do bloco: copiar como tabela (R1 do capricho). */
      tabela?: TabelaCopiavel
      /** A seleção está inteira numa mensagem citável: id do item (R3). */
      citavel?: string
    }
  /**
   * Imagem: anexo, evidência de tool ou o lightbox. `path` só existe onde o
   * app conhece o arquivo de verdade (path relativo contido, resolvido no
   * Rust); num `<img>` solto ele é null e sobra o que dá pra fazer com os
   * pixels que estão na tela.
   */
  | { tipo: "imagem"; path: string | null; nome: string }
  /**
   * Arquivo de código citado em mensagem (chip de código ou link file://).
   * Permite abrir no editor, copiar caminho relativo/completo ou revelar na pasta.
   */
  | {
      tipo: "arquivo"
      rel: string
      abs?: string
      line: number | null
      texto: string
      selecao: string
    }
  /** Texto selecionado em superfície não editável, fora de mensagem. */
  | { tipo: "selecao"; texto: string }

export type ItemId =
  | "cortar"
  | "copiar"
  | "colar"
  | "selecionar-tudo"
  | "copiar-bloco"
  | "citar-trecho"
  | "copiar-tabela-planilha"
  | "copiar-tabela-markdown"
  | "copiar-imagem"
  | "abrir-imagem"
  | "revelar-imagem"
  | "abrir-arquivo"
  | "copiar-caminho-relativo"
  | "copiar-caminho-absoluto"
  | "revelar-arquivo"

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
  // O id fala do ALVO (o bloco), o rótulo fala do resultado pro usuário (o
  // texto). "Copiar mensagem" mentiria no painel de contexto, que usa o mesmo
  // marcador e não tem mensagem nenhuma.
  "copiar-bloco": "Copiar texto",
  "citar-trecho": "Citar trecho",
  "copiar-tabela-planilha": "Copiar tabela para planilha",
  "copiar-tabela-markdown": "Copiar tabela como Markdown",
  "copiar-imagem": "Copiar imagem",
  "abrir-imagem": "Abrir no app padrão",
  // Neutro de propósito: o produto é Mac E Linux, e "Finder" mentiria no
  // segundo. "Pasta" vale nos dois.
  "revelar-imagem": "Mostrar na pasta",
  "abrir-arquivo": "Abrir no editor",
  "copiar-caminho-relativo": "Copiar caminho relativo",
  "copiar-caminho-absoluto": "Copiar caminho completo",
  "revelar-arquivo": "Mostrar na pasta",
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

  if (alvo.tipo === "bloco") {
    return limpaDivisores([
      ...(alvo.selecao ? (["copiar"] as LinhaMenu[]) : []),
      ...(alvo.selecao && alvo.citavel ? (["citar-trecho"] as LinhaMenu[]) : []),
      DIVISOR,
      ...(alvo.texto ? (["copiar-bloco"] as LinhaMenu[]) : []),
      ...(alvo.tabela && alvo.tabela.linhas.length > 0
        ? (["copiar-tabela-planilha", "copiar-tabela-markdown"] as LinhaMenu[])
        : []),
    ])
  }

  if (alvo.tipo === "imagem") {
    // Sem path, o app não conhece o arquivo: abrir/mostrar não teriam o que
    // apontar, e some quem não funciona. Copiar continua, porque os pixels
    // estão na tela.
    return limpaDivisores([
      "copiar-imagem",
      DIVISOR,
      ...(alvo.path ? (["abrir-imagem"] as LinhaMenu[]) : []),
      ...(alvo.path && rec.revelar ? (["revelar-imagem"] as LinhaMenu[]) : []),
    ])
  }

  if (alvo.tipo === "arquivo") {
    const temAbs = Boolean(alvo.abs)
    return limpaDivisores([
      ...(alvo.selecao ? (["copiar"] as LinhaMenu[]) : []),
      DIVISOR,
      "abrir-arquivo",
      "copiar-caminho-relativo",
      ...(temAbs ? (["copiar-caminho-absoluto"] as LinhaMenu[]) : []),
      ...(temAbs && rec.revelar ? (["revelar-arquivo"] as LinhaMenu[]) : []),
      DIVISOR,
      ...(alvo.texto ? (["copiar-bloco"] as LinhaMenu[]) : []),
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
  imagem: { path: string | null; nome: string } | null
  arquivo: {
    rel: string
    abs?: string
    line: number | null
  } | null
  bloco: { texto: string; tabela?: TabelaCopiavel; citavel?: string } | null
  /** Seleção de texto vigente na janela, já aparada. */
  selecao: string
}

/**
 * Precedência do mais específico pro mais genérico. Imagem antes de bloco
 * porque o anexo mora DENTRO da mensagem; editável na frente de tudo porque
 * lá o botão direito tem função de sistema a cumprir.
 */
export function alvoDe(s: Sonda): Alvo | null {
  if (s.editavel) return { tipo: "editavel", ...s.editavel }
  if (s.imagem) return { tipo: "imagem", ...s.imagem }
  if (s.arquivo) {
    return {
      tipo: "arquivo",
      rel: s.arquivo.rel,
      abs: s.arquivo.abs,
      line: s.arquivo.line,
      texto: s.bloco?.texto ?? s.arquivo.rel,
      selecao: s.selecao,
    }
  }
  if (s.bloco) {
    return {
      tipo: "bloco",
      texto: s.bloco.texto,
      selecao: s.selecao,
      ...(s.bloco.tabela ? { tabela: s.bloco.tabela } : {}),
      ...(s.bloco.citavel && s.selecao ? { citavel: s.bloco.citavel } : {}),
    }
  }
  if (s.selecao) return { tipo: "selecao", texto: s.selecao }
  return null
}
