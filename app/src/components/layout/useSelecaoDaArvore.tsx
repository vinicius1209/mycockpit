// A seleção múltipla da árvore (docs/explorador-de-arquivos-prd.md, D4):
// ⌘/Ctrl+clique alterna, Shift+clique pega o intervalo, Esc limpa. Vale para o
// menu e para o arrasto. Mais o rodapé de uma pasta aberta (erro, carregar
// mais, leitura parcial), que saiu do `ProjectFilesPanel` pelo teto de tamanho.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { AlvoDeArquivo } from "@/lib/acoesDeArquivo"

export interface EstadoDaSelecao {
  selecionados: ReadonlySet<string>
  ancora: string | null
}

export const SEM_SELECAO: EstadoDaSelecao = { selecionados: new Set(), ancora: null }

/** O próximo estado depois de um clique. `null` = clique simples: não é gesto
 *  de seleção, a linha abre e a seleção some. Puro. */
export function aposOClique(
  atual: EstadoDaSelecao,
  caminho: string,
  mods: { alternar: boolean; intervalo: boolean },
  ordem: readonly string[],
): EstadoDaSelecao | null {
  if (mods.intervalo) {
    const de = ordem.indexOf(atual.ancora ?? caminho)
    const ate = ordem.indexOf(caminho)
    if (de < 0 || ate < 0) return { selecionados: new Set([caminho]), ancora: caminho }
    const [a, b] = de <= ate ? [de, ate] : [ate, de]
    return { selecionados: new Set(ordem.slice(a, b + 1)), ancora: atual.ancora ?? caminho }
  }
  if (mods.alternar) {
    const proximo = new Set(atual.selecionados)
    if (proximo.has(caminho)) proximo.delete(caminho)
    else proximo.add(caminho)
    return { selecionados: proximo, ancora: caminho }
  }
  return null
}

/** Sobre o que o gesto age: a seleção inteira quando a linha faz parte dela e
 *  ela tem mais de um item; senão, só a linha. Puro. */
export function itensDoGesto(estado: EstadoDaSelecao, caminho: string): string[] {
  return estado.selecionados.has(caminho) && estado.selecionados.size > 1 ? [...estado.selecionados] : [caminho]
}

/** O alvo do catálogo para os itens do gesto. Puro. */
export function alvoDosItens(itens: readonly string[], ehPasta: (rel: string) => boolean): AlvoDeArquivo {
  if (itens.length > 1) return { tipo: "varios", itens: itens.map((rel) => ({ rel, pasta: ehPasta(rel) })) }
  const [rel] = itens
  return ehPasta(rel) ? { tipo: "pasta", rel } : { tipo: "arquivo", rel }
}

/** `contexto` muda com a raiz e a busca: a seleção que sumiu da tela não pode
 *  ir junto num gesto. */
export function useSelecaoDaArvore(ordem: readonly string[], contexto: string) {
  const [estado, setEstado] = useState<EstadoDaSelecao>(SEM_SELECAO)
  useEffect(() => setEstado(SEM_SELECAO), [contexto])
  return {
    selecionados: estado.selecionados,
    /** Trata o clique. `true` quando foi gesto de seleção: a linha não abre. */
    clicar(caminho: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): boolean {
      const proximo = aposOClique(estado, caminho, { alternar: e.metaKey || e.ctrlKey, intervalo: e.shiftKey }, ordem)
      setEstado(proximo ?? SEM_SELECAO)
      return proximo !== null
    },
    itens: (caminho: string) => itensDoGesto(estado, caminho),
    limpar: () => setEstado(SEM_SELECAO),
    vazia: estado.selecionados.size === 0,
  }
}

/** O que aparece embaixo de uma pasta aberta, além dos filhos. */
export function RodapeDaPasta({
  recuo,
  erro,
  temMais,
  parcial,
  aoTentar,
  aoCarregarMais,
}: {
  recuo: number
  erro: string | null
  temMais: boolean
  parcial: boolean
  aoTentar: () => void
  aoCarregarMais: () => void
}) {
  return (
    <>
      {erro !== null && (
        <div className="flex items-center gap-2 py-1 pr-2 text-[11px] text-destructive" style={{ paddingLeft: recuo }}>
          <span className="min-w-0 flex-1 truncate">{erro}</span>
          <Button variant="ghost" size="chip" onClick={aoTentar}>
            Tentar novamente
          </Button>
        </div>
      )}
      {temMais && (
        <Button
          variant="ghost"
          size="compacto"
          className="w-full justify-start text-muted-foreground"
          style={{ paddingLeft: recuo }}
          onClick={aoCarregarMais}
        >
          Carregar mais nesta pasta
        </Button>
      )}
      {parcial && !temMais && (
        <p className="py-1 pr-2 text-[11px] text-muted-foreground" style={{ paddingLeft: recuo }}>
          Leitura parcial nesta pasta
        </p>
      )}
    </>
  )
}
