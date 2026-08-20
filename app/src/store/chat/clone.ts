// Duplicar/fork de conversa — extraído de store/chat.ts (arquivo no teto de
// tamanho), mesmo padrão de lib/db/conversations.ts vindo de lib/db.ts: um
// recorte de responsabilidade fechado ("clonar uma conversa gravando no DB e
// promovendo a cópia a ativa"), não um pedaço arbitrário partido só pra caber
// no limite.
//
// `duplicateConversation` (cópia INTEIRA, lida do DB pra garantir o que há de
// mais recente persistido) e `forkConversationAt` (cópia CURADA, só até um
// turno — "quero tentar outro caminho a partir daqui", não "quero outra
// igual"; lê do estado EM MEMÓRIA porque o turno já está renderizado como
// concluído, então já é fonte de verdade, sem esperar o persist throttled)
// compartilham o mesmo núcleo de gravação (`commitClonedConversation`).
//
// Tipos importados de @/store/chat são TYPE-ONLY (apagados na compilação):
// não criam ciclo de import em runtime, mesmo com chat.ts importando as três
// funções deste arquivo de volta.

import { toast } from "sonner"
import type { ChatItem, ChatState } from "@/store/chat"
import { emptyConv, markOrphanedProcesses, projectOfConv, uid } from "@/store/chat"
import {
  loadConversation as dbLoad,
  saveConversation as dbSave,
  setConversationColor as dbSetColor,
  type ConversationMeta,
} from "@/lib/db/conversations"
import { normalizeModelValue } from "@/lib/agents"
import { createWorktree } from "@/lib/git"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/** Marcador de cópia no fim do título, com ou sem número: ` (fork)`,
 *  ` (fork 2)`, ` (cópia)`, ` (cópia 3)`. Global-less (sem /g) de propósito —
 *  quem repete é o laço de `baseTitle`, e regex com /g guarda `lastIndex`
 *  entre chamadas, que é uma classe inteira de bug sutil. */
const MARCADOR = /\s*\((?:fork|cópia)(?:\s+\d+)?\)$/

/** Tira TODOS os marcadores do fim (o laço também limpa título legado que já
 *  acumulou, tipo "Conversa (fork) (fork)"). */
function baseTitle(title: string): string {
  let base = title
  while (MARCADOR.test(base)) base = base.replace(MARCADOR, "")
  return base.trim() || "Conversa"
}

/**
 * Título de uma cópia/fork: base limpa + marcador com o menor número LIVRE
 * entre os irmãos. Sem isso, forkar um fork virava "X (fork) (fork)" e dois
 * forks da mesma origem nasciam com títulos idênticos.
 *
 * Pura de propósito (recebe os irmãos, não lê a store): é a única regra aqui
 * que dá pra testar sem montar estado.
 */
export function cloneTitle(
  srcTitle: string,
  marker: "fork" | "cópia",
  siblings: readonly string[],
): string {
  const base = baseTitle(srcTitle)
  const usados = new Set(siblings)
  for (let n = 1; ; n++) {
    const candidato = n === 1 ? `${base} (${marker})` : `${base} (${marker} ${n})`
    if (!usados.has(candidato)) return candidato
  }
}

/** Núcleo comum: grava uma cópia nova no DB e a torna ativa. Sessão/model/
 *  contextTokens NULL de propósito — a cópia não herda a sessão do CLI da
 *  origem (resume conflitaria). O título já chega pronto (ver `cloneTitle`). */
async function commitClonedConversation(
  set: Set,
  owner: string,
  items: ChatItem[],
  agent: string,
  reqModel: string | null,
  effort: string | null,
  title: string,
  srcColor: string | null,
): Promise<string> {
  const newId = uid()
  await dbSave(newId, owner, title, null, items, [], agent, reqModel, effort, null, null)
  if (srcColor != null) await dbSetColor(newId, srcColor)
  set((s) => {
    const meta: ConversationMeta = {
      id: newId,
      title,
      updatedAt: Date.now(),
      color: srcColor,
      worktreePath: null,
      agent,
    }
    const nextList = [...(s.conversationsByProject[owner] ?? []), meta]
    return {
      activeId: newId,
      projectId: owner,
      conversationsByProject: { ...s.conversationsByProject, [owner]: nextList },
      conversations: owner === s.projectId ? nextList : s.conversations,
      byId: {
        ...s.byId,
        [newId]: { ...emptyConv(owner), items, agent, reqModel, effort, sessionId: null },
      },
    }
  })
  return newId
}

/**
 * Isola o fork num worktree PRÓPRIO — é isto que faz o fork ser paralelo de
 * verdade (modelo do Orca/Paseo), e não duas conversas escrevendo na mesma
 * pasta e se atropelando.
 *
 * O que o worktree É, sem promessa a mais: `git worktree add -b
 * mycockpit/<slug>` a partir do **HEAD** (ver `git.rs:create_worktree_sync`),
 * dentro de `.mycockpit/worktrees/` (que já nasce gitignorado). Ou seja, o
 * fork começa do último commit — mudança NÃO-COMMITADA da origem não vem
 * junto, e o toast diz isso em vez de deixar a pessoa descobrir na marra.
 *
 * FAIL-SOFT por decisão: projeto sem git, sem commit ou com o git recusando
 * não pode desfazer um fork que JÁ existe e já é a conversa ativa. A conversa
 * fica, sem isolamento, e o motivo (que o Rust devolve em português) aparece
 * no toast — dá pra isolar depois pelo menu de contexto da conversa.
 */
async function isolateFork(
  get: Get,
  convId: string,
  projectId: string,
): Promise<void> {
  if (!isTauri()) return // browser/dev: não há git pra consultar
  const projectPath = useApp
    .getState()
    .projects.find((p) => p.id === projectId)?.path
  if (!projectPath) return
  try {
    const info = await createWorktree(projectPath, convId)
    // `setWorktree` (a MESMA ação do "Isolar" do menu de contexto) já grava no
    // banco, na meta da sidebar e no byId — não duplicamos esse caminho aqui.
    get().setWorktree(convId, info.path)
    toast.success(`Fork isolado em ${info.branch}`, {
      description: "Parte do último commit; mudança não-commitada não veio junto.",
    })
  } catch (e) {
    toast("Fork criado, mas sem isolamento.", {
      description:
        typeof e === "string" && e
          ? e
          : "Não deu pra criar o worktree; dá pra isolar depois pelo menu da conversa.",
    })
  }
}

export async function duplicateConversationImpl(
  get: Get,
  set: Set,
  id: string,
): Promise<void> {
  // Duplica no MESMO projeto da conversa-fonte (acha pelo id único), não
  // necessariamente o ativo. A cópia entra no array daquele projeto.
  const before = get()
  const owner = projectOfConv(before.conversationsByProject, id) ?? before.projectId
  if (!owner) return
  const src = before.conversationsByProject[owner]?.find((c) => c.id === id)
  const loaded = await dbLoad(id)
  if (loaded === "corrupt") return // não duplica linha corrompida
  const items = markOrphanedProcesses(loaded?.items ?? get().byId[id]?.items ?? [])
  const agent = loaded?.agent ?? get().byId[id]?.agent ?? "claude-code"
  const rawReqModel = loaded?.reqModel ?? get().byId[id]?.reqModel ?? null
  const reqModel = normalizeModelValue(agent, rawReqModel)
  const effort = loaded?.effort ?? get().byId[id]?.effort ?? null
  // Irmãos lidos DEPOIS do await (a lista pode ter mudado durante o dbLoad).
  const siblings = (get().conversationsByProject[owner] ?? []).flatMap((c) => (c.title ? [c.title] : []))
  await commitClonedConversation(
    set,
    owner,
    items,
    agent,
    reqModel,
    effort,
    cloneTitle(src?.title ?? loaded?.title ?? "Conversa", "cópia", siblings),
    src?.color ?? null,
  )
}

export async function forkConversationAtImpl(
  get: Get,
  set: Set,
  id: string,
  uptoItemId: string,
): Promise<void> {
  const before = get()
  const owner = projectOfConv(before.conversationsByProject, id) ?? before.projectId
  if (!owner) return
  const src = before.conversationsByProject[owner]?.find((c) => c.id === id)
  const conv = before.byId[id]
  if (!conv) return
  const cut = conv.items.findIndex((it) => it.id === uptoItemId)
  if (cut === -1) return // turno não está no fio carregado → não força nada
  const items = markOrphanedProcesses(conv.items.slice(0, cut + 1))
  const reqModel = normalizeModelValue(conv.agent, conv.reqModel)
  const siblings = (before.conversationsByProject[owner] ?? []).flatMap((c) => (c.title ? [c.title] : []))
  const newId = await commitClonedConversation(
    set,
    owner,
    items,
    conv.agent,
    reqModel,
    conv.effort,
    cloneTitle(src?.title ?? "Conversa", "fork", siblings),
    src?.color ?? null,
  )
  // Worktree DEPOIS de commitar a conversa, de propósito: o fork já apareceu e
  // já é a ativa; o isolamento chega em seguida e nunca segura a UI. Diferente
  // do `duplicateConversation`, que é "quero outra igual" e não pede pasta
  // própria — fork é "quero seguir OUTRO caminho a partir daqui", e caminho
  // paralelo sem pasta paralela é dois agentes brigando pelo mesmo arquivo.
  await isolateFork(get, newId, owner)
}
