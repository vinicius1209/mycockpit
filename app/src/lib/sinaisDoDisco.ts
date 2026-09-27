// Quando uma pasta pode ter mudado no disco, sem watcher (o Rust evita FSEvents
// de propósito, `bastidores.rs`). Nasceu dentro da aba Alterações
// (`useAlteracoesVivas`) e saiu para cá quando o editor de arquivos passou a
// precisar dos MESMOS sinais (docs/edicao-de-arquivos-spec.md §10.1):
//  - ação que muda arquivo terminando, em qualquer conversa desta pasta (a
//    classificação do fio, `classificarAcao(...).muda`; nenhum nome de motor);
//  - turno começando ou terminando;
//  - a janela voltando ao foco ou à vista;
//  - o próprio app gravando um arquivo (`avisarGravacao`).
// Amortecido: uma rajada vira UM aviso.

import { classificarAcao } from "@/lib/acaoDoFio"
import type { ChatItem } from "@/store/chat"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Espera depois do último sinal antes de reler. */
const AMORTECIMENTO_MS = 700

interface ConversaVista {
  projectId: string
  worktreePath: string | null
  running: boolean
  finalizing: boolean
  items: readonly ChatItem[]
}

function acaoQueMudouArquivo(item: ChatItem): boolean {
  return item.kind === "tool" && !!item.result && classificarAcao(item).muda
}

/** Uma assinatura que só muda quando a pasta `cwd` pode ter mudado: quem está
 *  rodando e quantas ações que mudam arquivo já terminaram, por conversa desta
 *  pasta. Token de streaming não mexe nela. Puro. */
export function assinaturaDasMudancas(
  conversas: Record<string, ConversaVista>,
  cwd: string,
  pastaDoProjeto: (projectId: string) => string | null,
): string {
  const partes: string[] = []
  for (const [id, conversa] of Object.entries(conversas)) {
    const pasta = conversa.worktreePath ?? pastaDoProjeto(conversa.projectId)
    if (pasta !== cwd) continue
    let mudancas = 0
    for (const item of conversa.items) if (acaoQueMudouArquivo(item)) mudancas += 1
    const ativa = conversa.running || conversa.finalizing
    partes.push(`${id}:${ativa ? 1 : 0}:${mudancas}`)
  }
  return partes.sort().join("|")
}

/** UMA assinatura do chat por pasta, por mais que sejam os ouvintes: a
 *  assinatura varre os itens de todas as conversas, e o chat muda a cada token.
 *  A aba Alterações e dois editores abertos não podem virar três varreduras. */
interface Vigia {
  ouvintes: Set<() => void>
  desligar: () => void
}
const vigias = new Map<string, Vigia>()

function vigiar(cwd: string): Vigia {
  const existente = vigias.get(cwd)
  if (existente) return existente
  const ouvintes = new Set<() => void>()
  const pasta = (projectId: string) =>
    useApp.getState().projects.find((p) => p.id === projectId)?.path ?? null
  // A 1ª assinatura (a que classifica as ações de todas as conversas da
  // pasta) sai do caminho da montagem: abrir a aba não espera por ela.
  let anterior: string | null = null
  const inicial = setTimeout(() => {
    anterior ??= assinaturaDasMudancas(useChat.getState().byId, cwd, pasta)
  }, 0)
  const sair = useChat.subscribe((estado) => {
    const agora = assinaturaDasMudancas(estado.byId, cwd, pasta)
    if (anterior === null || agora === anterior) {
      anterior = agora
      return
    }
    anterior = agora
    for (const f of ouvintes) f()
  })
  const vigia: Vigia = {
    ouvintes,
    desligar: () => {
      clearTimeout(inicial)
      sair()
    },
  }
  vigias.set(cwd, vigia)
  return vigia
}

/** O app gravou algo em `cwd`: acorda quem assina essa pasta. */
export function avisarGravacao(cwd: string): void {
  for (const f of vigias.get(cwd)?.ouvintes ?? []) f()
}

/** Chama `aoMudar` (amortecido, cada ouvinte com o seu) quando a pasta `cwd`
 *  pode ter mudado. Devolve o desligar. */
export function assinarMudancasNaPasta(cwd: string, aoMudar: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const agendar = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      aoMudar()
    }, AMORTECIMENTO_MS)
  }
  const vigia = vigiar(cwd)
  vigia.ouvintes.add(agendar)
  const aoVoltar = () => {
    if (document.visibilityState === "visible") agendar()
  }
  window.addEventListener("focus", agendar)
  document.addEventListener("visibilitychange", aoVoltar)
  return () => {
    if (timer) clearTimeout(timer)
    window.removeEventListener("focus", agendar)
    document.removeEventListener("visibilitychange", aoVoltar)
    vigia.ouvintes.delete(agendar)
    if (vigia.ouvintes.size === 0) {
      vigia.desligar()
      vigias.delete(cwd)
    }
  }
}
