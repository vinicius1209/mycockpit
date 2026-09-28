// Os efeitos do catálogo de arquivo (`lib/acoesDeArquivo.ts`). Um lugar só,
// para a árvore, a aba e o chip do fio fazerem a mesma coisa com o mesmo
// gesto. O que é da árvore (buscar na pasta, recolher) chega por callback.

import { invoke } from "@tauri-apps/api/core"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { abrirAoLado, mostrarNaArvore } from "@/components/layout/abasNoPrincipal"
import type { AcaoDeArquivo, AlvoDeArquivo } from "@/lib/acoesDeArquivo"
import { blocosComArquivos, nomeDoCaminho } from "@/lib/arquivoCitado"
import { avisar, mensagemDe } from "@/lib/avisos"
import { copyText } from "@/lib/clipboard"
import { openInEditor, pickEditor } from "@/lib/editors"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { planoDoArrasto } from "@/lib/soltura"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { useEditors } from "@/store/editors"

export interface ContextoDaAcao {
  /** A raiz de onde `rel` parte: a pasta do projeto ou o worktree da conversa. */
  root: string
  aoBuscarNaPasta?: (rel: string) => void
  aoRecolher?: (rel: string) => void
}

const absoluto = (root: string, rel: string) => (rel.startsWith("/") ? rel : `${root.replace(/\/+$/, "")}/${rel}`)

/** Abre no editor externo preferido. O menu pode ser a primeira superfície a
 *  precisar de editor na sessão: sem o `ensure`, a lista viria vazia. */
export async function abrirNoEditor(projectPath: string, rel: string, line: number | null): Promise<void> {
  useEditors.getState().ensure()
  const escolhido = pickEditor(useEditors.getState().detected ?? [], useApp.getState().settings.preferredEditor)
  if (!escolhido) {
    avisar.erro("Nenhum editor de código detectado nesta máquina")
    return
  }
  await openInEditor({ editor: escolhido.id, projectPath, rel, line }).catch((err) =>
    avisar.erro("Não consegui abrir no editor.", { detalhe: mensagemDe(err) }),
  )
}

/** Cita arquivos e pastas no composer da conversa ativa: o mesmo cartão do
 *  arrasto (ADR-252). Pelo menu, a conversa vem à vista com o cursor no
 *  composer; pelo ⌘↵ da árvore (`focar: false`), o foco fica na linha para
 *  citar a próxima, e o cartão no rascunho é o retorno. */
export function citarNoComposer(
  root: string,
  itens: readonly { rel: string; pasta: boolean }[],
  { focar = true }: { focar?: boolean } = {},
): void {
  const convId = useChat.getState().activeId
  if (!convId) {
    avisar.erro("Abra uma conversa para citar aqui.")
    return
  }
  const blocos = itens.flatMap((i) => {
    const plano = planoDoArrasto({ tipo: "arquivo", id: `arquivo:${i.rel}`, caminho: i.rel, pasta: i.pasta }, root)
    return plano.acao === "arquivo" ? [plano.bloco] : []
  })
  const drafts = useComposerDrafts.getState()
  drafts.setBlocos(convId, blocosComArquivos(drafts.byConv[convId]?.blocos ?? [], blocos))
  const conversaAVista = useApp.getState().mainTab.kind === "conversa"
  if (!focar) {
    // Sem a conversa à vista, o cartão não aparece: o aviso é o retorno.
    if (!conversaAVista)
      avisar.feito(itens.length === 1 ? `${nomeDoCaminho(itens[0].rel)} citado no composer` : `${itens.length} itens citados no composer`)
    return
  }
  if (!conversaAVista) useApp.getState().closeMainTab()
  setTimeout(focusConsoleComposer, 120)
}

export async function executarAcaoDeArquivo(
  acao: AcaoDeArquivo,
  alvo: AlvoDeArquivo,
  ctx: ContextoDaAcao,
): Promise<void> {
  const { root } = ctx
  if (alvo.tipo === "varios") {
    if (acao === "citar") citarNoComposer(root, alvo.itens)
    if (acao === "copiar-caminhos")
      await copyText(alvo.itens.map((i) => i.rel).join("\n"), `${alvo.itens.length} caminhos copiados`)
    return
  }
  const { rel } = alvo
  const nome = nomeDoCaminho(rel)
  switch (acao) {
    case "abrir":
      useApp.getState().openFileTab(rel)
      return
    case "abrir-ao-lado":
      abrirAoLado(rel)
      return
    case "abrir-no-editor":
      await abrirNoEditor(root, rel, null)
      return
    case "abrir-no-app":
      await invoke("abrir_no_app_padrao", { root, rel }).catch((err) =>
        avisar.erro(`Não consegui abrir ${nome} no app padrão.`, { detalhe: mensagemDe(err) }),
      )
      return
    case "citar":
      citarNoComposer(root, [{ rel, pasta: alvo.tipo === "pasta" }])
      return
    case "ver-alteracoes":
      useApp.getState().openDiffTab(rel)
      return
    case "copiar-nome":
      await copyText(nome, `Nome de ${nome} copiado`)
      return
    case "copiar-caminho-relativo":
      await copyText(rel, "Caminho relativo copiado")
      return
    case "copiar-caminho-completo":
      await copyText(absoluto(root, rel), `Caminho de ${nome} copiado`)
      return
    case "mostrar-na-arvore":
      mostrarNaArvore(rel)
      return
    case "mostrar-na-pasta":
      await revealItemInDir(absoluto(root, rel)).catch((err) =>
        avisar.erro("Não consegui mostrar na pasta (o arquivo ainda existe?)", { detalhe: mensagemDe(err) }),
      )
      return
    case "buscar-na-pasta":
      ctx.aoBuscarNaPasta?.(rel)
      return
    case "recolher-dentro":
      ctx.aoRecolher?.(rel)
      return
    case "copiar-caminhos":
      return
  }
}
