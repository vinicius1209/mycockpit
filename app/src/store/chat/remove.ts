// Apagar uma conversa — e tudo que morre junto com ela.
//
// Extraído de store/chat.ts (no teto do ratchet), no mesmo padrão de
// store/chat/clone.ts: um recorte fechado, não um pedaço partido pra caber. O
// recorte tem nome próprio porque a lista do que morre junto já é longa e só
// cresce: missão, disputa, persist pendente, aviso de drift, linha do banco,
// card ligado, blobs de anexo — e agora o worktree.
//
// A regra que rege a lista inteira: nada pode continuar VIVO e INVISÍVEL
// depois que a conversa some. Missão órfã seguiria rodando fora da sidebar;
// anexo órfão seguiria no disco; worktree órfão segue ocupando pasta e branch.
// São o mesmo defeito com roupas diferentes.
//
// Tipos importados de @/store/chat são TYPE-ONLY (apagados na compilação):
// não criam ciclo de import em runtime.

import { toast } from "sonner"
import { deFundo } from "@/lib/deFundo"
import type { ChatState } from "@/store/chat"
import { projectOfConv } from "@/store/chat"
import { wipeAttachments } from "@/lib/attachments"
import { deleteConversation as dbDelete } from "@/lib/db/conversations"
import { clearPresetDriftWarning } from "@/lib/presets"
import { removeWorktree, worktreeRemovalNote } from "@/lib/git"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"
import { useWorktrees } from "@/store/worktrees"
import { useStickyNotes } from "@/store/stickyNotes"
import { useComposerDrafts } from "@/store/composerDrafts"
import { useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useComentariosDoDiff } from "@/store/comentariosDoDiff"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/**
 * Devolve o worktree da conversa ao repositório: tira a pasta e, se ela não
 * levou trabalho junto, o branch também.
 *
 * Por que isto existe: enquanto isolar era um gesto deliberado no menu, o lixo
 * era raro e consciente. Desde que o FORK passou a isolar sozinho
 * (store/chat/clone.ts), toda tentativa descartada deixava
 * `.frota/worktrees/<slug>` e um branch `mycockpit/<slug>` para trás — e o
 * branch sobrevivia até à remoção manual da pasta. Criar automático obriga a
 * recolher automático.
 *
 * FALA SÓ QUANDO SOBRA. O caminho feliz é silencioso (você mandou apagar, e
 * apagou); quando algo fica no repositório, aí sim precisa ser dito, senão
 * volta a ser exatamente o lixo invisível que motivou este código.
 */
async function dropWorktree(before: ChatState, id: string): Promise<void> {
  if (!isTauri()) return // browser/dev: não há git pra consultar
  const owner = projectOfConv(before.conversationsByProject, id)
  if (!owner) return
  const wt = before.conversationsByProject[owner]?.find((c) => c.id === id)
    ?.worktreePath
  if (!wt) return
  const projectPath = useApp.getState().projects.find((p) => p.id === owner)?.path
  if (!projectPath) return
  // Releitura DEPOIS da tentativa, dê no que der: se recolheu, o número na
  // faixa desce; se o git segurou, é justamente aí que a linha precisa aparecer
  // lá, porque o toast some e a sobra não.
  const releitura = () =>
    void useWorktrees.getState().refresh(owner, projectPath)
  try {
    const r = await removeWorktree(projectPath, wt)
    // Branch apagado é o desfecho ESPERADO e já anunciado no diálogo de
    // confirmação — repetir aqui só faz barulho. Branch que ficou, não: é
    // estado novo no repositório que ninguém pediu.
    if (r.branch && !r.branchRemoved) {
      toast("Worktree removido, branch preservado.", {
        description: worktreeRemovalNote(r) ?? undefined,
      })
    }
  } catch (e) {
    // O git recusa sem --force quando há mudança não-commitada. Não é falha
    // nossa e não vira erro vermelho: é trabalho preservado — mas o usuário
    // acabou de apagar a conversa e precisa saber que a pasta ficou, senão
    // nunca mais volta lá.
    toast("A conversa foi apagada, mas o worktree ficou.", {
      description:
        typeof e === "string" && e
          ? `${e} (a pasta segue em ${wt}).`
          : `Há mudança não-commitada em ${wt}; o git preservou o trabalho.`,
    })
  } finally {
    releitura()
  }
}

/**
 * Hard-delete de uma conversa (a confirmação é da UI; aqui já é decisão tomada).
 *
 * `cancelPersist` chega por parâmetro porque é closure do criador da store
 * (fecha sobre o mapa de timers) — não dá pra importar, e recriá-la aqui seria
 * um segundo mapa de timers, que é o oposto de cancelar o persist certo.
 */
export async function removeConversationImpl(
  get: Get,
  set: Set,
  id: string,
  cancelPersist: (convId: string) => void,
): Promise<void> {
  // Missão/disputa da conversa morrem JUNTO: sem a conversa elas seguiriam
  // rodando invisíveis (fora da sidebar e do snapshot da tray, que subcontaria
  // `running` e deixaria o "Sair" matar o trabalho sem confirmação). Import
  // dinâmico: mission/fusion importam o módulo da store.
  try {
    const [{ useMission }, { useFusion }] = await Promise.all([
      import("@/store/mission"),
      import("@/store/fusion"),
    ])
    useMission.getState().abort(id)
    useFusion.getState().abort(id) // no-op fora de running/judging
    useFusion.getState().discard(id) // limpa board + pending do DB
  } catch {
    // best-effort: a deleção da conversa segue mesmo assim
  }
  // Mira a conversa pelo id ÚNICO → deleta só a linha certa no DB e some do
  // array do projeto DONO dela (mesmo que seja um projeto NÃO-ativo). O
  // projeto ativo e as outras conversas ficam intactos.
  // Cancela o persist throttled pendente ANTES do DELETE: um snapshot atrasado
  // re-inseriria a linha deletada (UPSERT) = conversa-zumbi.
  cancelPersist(id)
  // follow-up S3: o episódio de aviso de drift morre com a conversa (a entrada
  // no Map de módulo não fica órfã).
  clearPresetDriftWarning(id)
  const before = get()
  // ANTES do set: depois dele a conversa some do estado e com ela o
  // `worktreePath` — não haveria mais como saber qual pasta recolher.
  void dropWorktree(before, id)
  await dbDelete(id)
  // E1 (S1.2): o dbDelete devolveu o card ligado pro backlog no banco
  // (conversation_id = NULL) — re-hidrata o store do board pra UI refletir.
  void deFundo(
    import("@/store/cards")
      .then((m) => m.useCards.getState().load())
      .catch(() => {}),
  )
  void wipeAttachments(id) // apaga os blobs da conversa (privacidade imediata)
  // Notas presas a esta conversa: sem isto elas ficam com um `convId` que não
  // casa com nada — invisíveis em qualquer escopo e impossíveis de apagar pela
  // UI, ocupando o localStorage pra sempre. É a regra do topo deste arquivo
  // aplicada a mais um dono: nada continua vivo e INVISÍVEL depois que a
  // conversa some.
  useStickyNotes.getState().clearConversationNotes(id)
  useComposerDrafts.getState().forget(id)
  // As abas da conversa (arquivos, lado, Navegador) e a revisão solta no diff
  // (ADR-251): no disco e na memória, sem dono, pra sempre.
  useAbasDeArquivo.getState().esquecer(id)
  useComentariosDoDiff.getState().esquecerConversa(id)
  const wasActive = before.activeId === id
  // projeto DONO da conversa removida (pode não ser o ativo)
  const owner = projectOfConv(before.conversationsByProject, id) ?? before.projectId
  set((s) => {
    const rest = { ...s.byId }
    delete rest[id]
    const conversationsByProject = { ...s.conversationsByProject }
    if (owner && conversationsByProject[owner]) {
      conversationsByProject[owner] = conversationsByProject[owner].filter(
        (c) => c.id !== id,
      )
    }
    // Só recria o espelho se o DONO for o projeto ATIVO; owner ≠ ativo mantém a
    // REFERÊNCIA (um filter no-op criaria ref nova à toa e re-renderizaria
    // leitores do projeto ativo sem mudança real).
    const mirror =
      owner != null && owner === s.projectId
        ? (conversationsByProject[owner] ??
          s.conversations.filter((c) => c.id !== id))
        : s.conversations
    return { byId: rest, conversationsByProject, conversations: mirror }
  })
  // Se a removida não era a ATIVA (ex.: excluiu de um projeto não-ativo), nada
  // mais a fazer — o painel ativo segue como estava.
  if (!wasActive) return
  const remaining = get().conversations
  if (remaining.length > 0) {
    await get().switchConversation(remaining[0].id)
  } else if (owner) {
    await get().newConversation(owner)
  } else {
    set(() => ({ activeId: null }))
  }
}
