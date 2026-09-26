// "Anexar à conversa" e "Copiar imagem" do navegador do projeto (navegador PRD
// R3). A captura é do Rust (`browser_capture.rs`, PNG na resolução real); aqui
// só se decide para onde ela vai: o rascunho da conversa ativa ou o clipboard.

import { invoke } from "@tauri-apps/api/core"
import { avisar, mensagemDe } from "@/lib/avisos"
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
    avisar.erro("Abra uma conversa para anexar a página.")
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
      avisar.erro(`O rascunho já tem ${MAX_ATTACH_COUNT} anexos. Remova um para anexar a página.`)
      return
    }
    drafts.setAttachments(convId, anexos)
    drafts.appendText(convId, linhaDaPagina(pagina))
    avisar.feito("Página anexada ao rascunho da conversa.")
  } catch (cause) {
    avisar.erro("Não consegui anexar a página.", { detalhe: mensagemDe(cause) })
  }
}

export async function copiarImagemDaPagina(projectPath: string, targetId: string): Promise<void> {
  try {
    await invoke("browser_capture_copy", { projectPath, targetId })
    avisar.feito("Imagem da página copiada.")
  } catch (cause) {
    avisar.erro("Não consegui copiar a imagem da página.", { detalhe: mensagemDe(cause) })
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
  regiao: { x: number; y: number; largura: number; altura: number }
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
    avisar.erro("Abra uma conversa para enviar a marcação.")
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
    // A descrição é material do pedido, não texto que a pessoa escreveu: vira
    // pílula no rascunho, como a citação e a colagem (relato de 17/09/2026).
    drafts.addMarcacao(convId, {
      tipo: "marcacao",
      id: crypto.randomUUID(),
      pagina: marcacao.title,
      url: marcacao.url,
      largura: marcacao.regiao.largura,
      altura: marcacao.regiao.altura,
      descricao: marcacao.descricao,
    })
    if (aviso) avisar.nota(aviso)
    else avisar.feito("Marcação no rascunho da conversa.")
    return true
  } catch (cause) {
    avisar.erro("Não consegui marcar a região.", { detalhe: mensagemDe(cause) })
    return false
  }
}
