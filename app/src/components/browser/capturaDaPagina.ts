// "Anexar à conversa" e "Copiar imagem" do navegador do projeto (navegador PRD
// R3). A captura é do Rust (`browser_capture.rs`, PNG na resolução real); aqui
// só se decide para onde ela vai: o rascunho da conversa ativa ou o clipboard.

import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { agentDef } from "@/lib/agents"
import { MAX_ATTACH_COUNT, type Attachment } from "@/lib/attachments"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

export interface PaginaAnexada {
  attachment: Attachment
  url: string
  title: string
}

/** Anexos do rascunho com a captura: mesmo arquivo (dedup por hash no Rust)
 *  não entra duas vezes; acima do teto, a captura fica de fora. */
export function anexosComCaptura(
  atuais: Attachment[],
  captura: Attachment,
): { anexos: Attachment[]; coube: boolean } {
  if (atuais.some((a) => a.path === captura.path)) return { anexos: atuais, coube: true }
  if (atuais.length >= MAX_ATTACH_COUNT) return { anexos: atuais, coube: false }
  return { anexos: [...atuais, captura], coube: true }
}

/** A linha que acompanha a imagem no rascunho: de onde ela veio. */
export function linhaDaPagina(pagina: Pick<PaginaAnexada, "title" | "url">): string {
  const titulo = pagina.title.trim()
  return titulo ? `Página "${titulo}" (${pagina.url}):` : `Página ${pagina.url}:`
}

export async function anexarPaginaAoRascunho(projectPath: string, targetId: string): Promise<void> {
  const convId = useChat.getState().activeId
  if (!convId) {
    toast.error("Abra uma conversa para anexar a página.")
    return
  }
  try {
    const pagina = await invoke<PaginaAnexada>("browser_capture_attach", {
      projectPath,
      targetId,
      convId,
    })
    const drafts = useComposerDrafts.getState()
    const { anexos, coube } = anexosComCaptura(
      drafts.byConv[convId]?.attachments ?? [],
      pagina.attachment,
    )
    if (!coube) {
      toast.error(`O rascunho já tem ${MAX_ATTACH_COUNT} anexos. Remova um para anexar a página.`)
      return
    }
    drafts.setAttachments(convId, anexos)
    drafts.appendText(convId, linhaDaPagina(pagina))
    toast.success("Página anexada ao rascunho da conversa.")
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

export async function copiarImagemDaPagina(projectPath: string, targetId: string): Promise<void> {
  try {
    await invoke("browser_capture_copy", { projectPath, targetId })
    toast.success("Imagem da página copiada.")
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

export interface RegiaoNoQuadro {
  x: number
  y: number
  largura: number
  altura: number
  quadroLargura: number
  quadroAltura: number
}

export interface Marcacao extends PaginaAnexada {
  descricao: string
  elementos: { papel: string; nome: string; seletor: string; tag: string }[]
}

/** Para onde vai a marcação (B3): a descrição sempre; a imagem só se o motor da
 *  conversa lê imagem (capability, nunca nome) e se cabe no teto de anexos. */
export function destinoDaMarcacao(
  aceitaImagem: boolean,
  atuais: Attachment[],
  imagem: Attachment,
): { anexos: Attachment[]; aviso: string | null } {
  if (!aceitaImagem) {
    return { anexos: atuais, aviso: "Este motor não lê imagem: vai só a descrição da região." }
  }
  const { anexos, coube } = anexosComCaptura(atuais, imagem)
  return { anexos, aviso: coube ? null : `O rascunho já tem ${MAX_ATTACH_COUNT} anexos: vai só a descrição.` }
}

export async function marcarRegiaoNoRascunho(
  projectPath: string,
  targetId: string,
  regiao: RegiaoNoQuadro,
): Promise<boolean> {
  const chat = useChat.getState()
  const convId = chat.activeId
  if (!convId) {
    toast.error("Abra uma conversa para enviar a marcação.")
    return false
  }
  try {
    const marcacao = await invoke<Marcacao>("browser_marcar", { projectPath, targetId, convId, regiao })
    const drafts = useComposerDrafts.getState()
    const agent = chat.byId[convId]?.stagedAgent ?? chat.byId[convId]?.agent ?? ""
    const { anexos, aviso } = destinoDaMarcacao(
      agentDef(agent)?.caps.image ?? false,
      drafts.byConv[convId]?.attachments ?? [],
      marcacao.attachment,
    )
    drafts.setAttachments(convId, anexos)
    drafts.appendText(convId, marcacao.descricao)
    if (aviso) toast(aviso)
    else toast.success("Marcação no rascunho da conversa.")
    return true
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
    return false
  }
}
