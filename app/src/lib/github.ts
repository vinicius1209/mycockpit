// O que a máquina diz sobre o `gh`, e o que fazer com cada resposta.
//
// O app JÁ usava o `gh` (cards de PR, merge, checks) e já sabia ler todas as
// contas logadas — `run_gh_any_account` tenta cada identidade sem NUNCA trocar
// a conta ativa global do terminal. Nada disso aparecia em tela: o
// diagnóstico existia dentro do Rust e morria lá.
//
// O incidente que isto resolve é conhecido e já custou tempo nesta máquina:
// "repository not found" num repo que EXISTE, porque a conta ativa não o
// enxerga. Com uma conta só, "conectado" basta. Com duas, saber QUAL está
// ativa é a informação inteira — e é exatamente o que um selo "Connected"
// não consegue dizer.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export interface GhAccount {
  user: string
  active: boolean
}

export interface GhStatus {
  installed: boolean
  version: string | null
  accounts: GhAccount[]
}

/** Pessimista de propósito: fora do Tauri (SSR/teste) e em qualquer falha, o
 *  estado é "não instalado" — a tela oferece instalar, que é inofensivo, em vez
 *  de afirmar "conectado" sem ter olhado. */
export const GH_DESCONHECIDO: GhStatus = {
  installed: false,
  version: null,
  accounts: [],
}

export async function lerGhStatus(): Promise<GhStatus> {
  if (!isTauri()) return GH_DESCONHECIDO
  try {
    return await invoke<GhStatus>("gh_status")
  } catch {
    return GH_DESCONHECIDO
  }
}

/** Como INSTALAR o `gh`. Mesma natureza do UPDATE_COMMANDS do detect: receita
 *  de pacote é conhecimento por-provider e mora ao lado de quem o usa. */
export const GH_INSTALL_COMMAND = "brew install gh"
/** Como LOGAR. O app mostra o comando; quem roda é você, num terminal — login
 *  é gesto humano, e o app não tem como (nem deve) conduzir o fluxo OAuth. */
export const GH_LOGIN_COMMAND = "gh auth login"

/** Troca a conta ATIVA do `gh`. Efeito GLOBAL: vale pro terminal também, e a
 *  tela diz isso ao lado do botão. Err com a mensagem do `gh` quando falha —
 *  nunca silêncio, porque o usuário acabou de pedir uma mudança. */
export async function trocarContaGh(user: string): Promise<void> {
  if (!isTauri()) return
  await invoke("gh_switch_account", { user })
}

export type DiagnosticoGh =
  | { estado: "sem-cli"; comando: string }
  | { estado: "sem-conta"; comando: string }
  | { estado: "sem-ativa"; contas: GhAccount[] }
  | { estado: "ok"; contas: GhAccount[]; ativa: GhAccount }

/** Traduz o estado bruto na PERGUNTA que ele responde, com o remédio junto.
 *
 *  Quatro estados, não dois, porque cada um tem um remédio DIFERENTE — e
 *  colapsar "sem CLI" e "sem conta" num único "não conectado" manda o usuário
 *  rodar o comando errado.
 *
 *  `sem-ativa` parece impossível (o `gh` sempre marca uma), e é justamente por
 *  isso que existe: se um dia o formato mudar e o parser deixar de reconhecer
 *  a marcação, o app diz "não sei qual está ativa" em vez de eleger a primeira
 *  e afirmar algo que não leu. Chute silencioso aqui reintroduz o incidente
 *  que a tela existe pra evitar. */
export function diagnosticoDoGh(s: GhStatus): DiagnosticoGh {
  if (!s.installed) return { estado: "sem-cli", comando: GH_INSTALL_COMMAND }
  if (s.accounts.length === 0)
    return { estado: "sem-conta", comando: GH_LOGIN_COMMAND }
  const ativa = s.accounts.find((a) => a.active)
  if (!ativa) return { estado: "sem-ativa", contas: s.accounts }
  return { estado: "ok", contas: s.accounts, ativa }
}

export interface PrStatusInfo {
  number: number
  title: string
  state: "OPEN" | "MERGED" | "CLOSED"
  isDraft: boolean
  url: string
  baseRefName: string
  headRefName: string
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  checksPassing: number
  checksFailing: number
  checksPending: number
}

interface CacheEntry {
  status: PrStatusInfo | null
  carregadoEm: number
}

const prCache = new Map<string, CacheEntry>()
const TTL_MS = 60_000

export function invalidarCacheDePr(cwd?: string, branch?: string) {
  if (!cwd) {
    prCache.clear()
    return
  }
  if (!branch) {
    for (const key of prCache.keys()) {
      if (key.startsWith(`${cwd}:`)) prCache.delete(key)
    }
    return
  }
  prCache.delete(`${cwd}:${branch}`)
}

/** Consulta o PR correspondente à branch no diretório. Fail-open e em cache. */
export async function consultarPrStatus(
  cwd: string,
  branch: string,
  forcar = false,
): Promise<PrStatusInfo | null> {
  if (!isTauri() || !branch || branch === "HEAD") return null
  const chave = `${cwd}:${branch}`
  const cache = prCache.get(chave)
  const agora = Date.now()

  if (!forcar && cache && agora - cache.carregadoEm < TTL_MS) {
    return cache.status
  }

  try {
    const res = await invoke<PrStatusInfo | null>("gh_pr_status", { cwd, branch })
    prCache.set(chave, { status: res, carregadoEm: agora })
    return res
  } catch {
    prCache.set(chave, { status: null, carregadoEm: agora })
    return null
  }
}

