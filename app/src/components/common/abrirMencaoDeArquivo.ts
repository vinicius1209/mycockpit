// O clique numa menção de arquivo no fio (link ou `código inline`).
//
// Abre DENTRO do Frota, pela mesma aba do explorador de arquivos (ADR-157): o
// palco lê, "Abrir no editor" fica como ação secundária do visualizador. Antes o
// fio mandava direto para o editor externo, e o explorador abria no palco: dois
// idiomas para o mesmo gesto. Markdown externo autorizado (fora do projeto)
// segue no visualizador de Markdown; imagem externa autorizada (a captura que o
// agente salvou no brain dele) abre na mesma aba, pelo caminho absoluto.
//
// Nome solto (`dialog-centralizado.spec.ts`) é procurado em vez de ser tratado
// como arquivo da raiz: primeiro nos arquivos que a conversa tocou, depois no
// índice do projeto. Mais de um candidato não vira chute: a pessoa lê quais são.

import { toast } from "sonner"
import { caminhosComONome, isImagePath, type FileTarget } from "@/lib/fileLink"
import { arquivosTocados } from "@/lib/mentionRank"
import { searchProjectFileIndex } from "@/lib/projectFilesService"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMarkdownViewer } from "@/store/markdownViewer"

const MAX_CANDIDATOS_NO_AVISO = 3

function raizDaConversa(projectPath: string): string {
  const chat = useChat.getState()
  const lista = chat.conversationsByProject[chat.projectId ?? ""] ?? chat.conversations
  return lista.find((c) => c.id === chat.activeId)?.worktreePath ?? projectPath
}

export async function abrirMencaoDeArquivo(
  target: FileTarget,
  projectPath: string | null | undefined,
): Promise<void> {
  const raizDoProjeto = projectPath?.replace(/\/+$/, "") ?? ""
  const externo = target.abs && (!raizDoProjeto || !target.abs.startsWith(`${raizDoProjeto}/`))
  if (externo && isImagePath(target.abs)) {
    useApp.getState().openFileTab(target.abs!)
    return
  }
  if (externo) {
    useMarkdownViewer.getState().openViewer(target.abs!, target.rel, projectPath)
    return
  }
  if (!raizDoProjeto) {
    toast.error("Abra um projeto para ver arquivos citados na conversa.")
    return
  }
  const abrir = (rel: string) => useApp.getState().openFileTab(rel)
  if (target.rel.includes("/")) {
    abrir(target.rel)
    return
  }

  const raiz = raizDaConversa(raizDoProjeto)
  const conversa = useChat.getState()
  const itens = conversa.activeId ? (conversa.byId[conversa.activeId]?.items ?? []) : []
  const tocados = caminhosComONome(target.rel, arquivosTocados(itens, raiz))
  if (tocados.length === 1) {
    abrir(tocados[0])
    return
  }

  let candidatos: string[]
  try {
    const busca = await searchProjectFileIndex({ root: raiz, query: target.rel, limit: 50 })
    candidatos = caminhosComONome(
      target.rel,
      busca.page.entries.filter((e) => e.kind === "file").map((e) => e.relPath),
    )
  } catch (erro) {
    console.error("[fio] busca do arquivo citado falhou", erro)
    toast.error(`Não consegui procurar ${target.rel} no projeto`)
    return
  }
  if (candidatos.length === 1) {
    abrir(candidatos[0])
    return
  }
  if (candidatos.length === 0) {
    toast.error(`Não achei ${target.rel} no projeto`)
    return
  }
  const lista = candidatos.slice(0, MAX_CANDIDATOS_NO_AVISO).join(", ")
  const resto = candidatos.length > MAX_CANDIDATOS_NO_AVISO ? ` e mais ${candidatos.length - MAX_CANDIDATOS_NO_AVISO}` : ""
  toast(`${candidatos.length} arquivos se chamam ${target.rel}: ${lista}${resto}. Abra pelo explorador.`)
}
