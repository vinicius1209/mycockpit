// As ações de git da aba Alterações que falam com o remoto ou mexem em branch,
// stash e histórico (docs/explorador-de-arquivos-prd.md, Parte B). O Rust mora
// em `git_sync.rs`; aqui ficam os invokes e as regras puras que a tela usa.

import { invoke } from "@tauri-apps/api/core"
import { idadeCurta } from "@/lib/processos"

export type TipoDeErroDeGit =
  | "acesso"
  | "recusado"
  | "divergiu"
  | "conflito"
  | "alteracoes-locais"
  | "sem-rede"
  | "prazo"
  | "outro"

export interface ErroDeGit {
  tipo: TipoDeErroDeGit
  detalhe: string
  dono: string | null
  contaAtiva: string | null
  contas: string[]
}

export interface OperacaoEmCurso {
  tipo: "rebase" | "merge"
  atual: number | null
  total: number | null
}

export interface EstadoDoRepo {
  ultimaBusca: number | null
  remotoGithub: boolean
  temRemoto: boolean
  operacao: OperacaoEmCurso | null
  conflitos: string[]
  guardadas: number
}

export interface Branch {
  nome: string
  quando: number
  atual: boolean
}

export interface Guardada {
  referencia: string
  mensagem: string
  quando: number
}

export interface CommitDoHistorico {
  hash: string
  curto: string
  mensagem: string
  autor: string
  quando: number
  naoEnviado: boolean
}

const TIPOS = new Set<string>([
  "acesso", "recusado", "divergiu", "conflito", "alteracoes-locais", "sem-rede", "prazo", "outro",
])

/** O que o invoke rejeitou, como `ErroDeGit`. O Rust manda o objeto; qualquer
 *  outra coisa (string, Error) vira "outro" com o texto no detalhe. Puro. */
export function comoErroDeGit(e: unknown): ErroDeGit {
  if (e && typeof e === "object" && "tipo" in e && TIPOS.has(String((e as ErroDeGit).tipo))) {
    const x = e as Partial<ErroDeGit>
    return {
      tipo: x.tipo as TipoDeErroDeGit,
      detalhe: x.detalhe ?? "",
      dono: x.dono ?? null,
      contaAtiva: x.contaAtiva ?? null,
      contas: x.contas ?? [],
    }
  }
  const detalhe = typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
  return { tipo: "outro", detalhe, dono: null, contaAtiva: null, contas: [] }
}

export const estadoDoRepo = (cwd: string) => invoke<EstadoDoRepo>("git_estado_do_repo", { cwd })
export const enviar = (cwd: string, publicar: boolean) => invoke<void>("git_enviar", { cwd, publicar })
export const trazer = (cwd: string, rebase: boolean) => invoke<void>("git_trazer", { cwd, rebase })
export const buscar = (cwd: string) => invoke<void>("git_buscar", { cwd })
export const listarBranches = (cwd: string) => invoke<Branch[]>("git_branches", { cwd })
export const trocarBranch = (cwd: string, branch: string, o: { criar: boolean; guardar: boolean }) =>
  invoke<void>("git_trocar_branch", { cwd, branch, criar: o.criar, guardar: o.guardar })
export const listarGuardadas = (cwd: string) => invoke<Guardada[]>("git_guardadas", { cwd })
export const guardar = (cwd: string, mensagem: string) => invoke<void>("git_guardar", { cwd, mensagem })
export const recuperarGuardada = (cwd: string, referencia: string, apagar: boolean) =>
  invoke<void>("git_recuperar_guardada", { cwd, referencia, apagar })
export const historico = (cwd: string, quantos: number) =>
  invoke<CommitDoHistorico[]>("git_historico", { cwd, quantos })
export const desfazerUltimoCommit = (cwd: string) => invoke<void>("git_desfazer_ultimo_commit", { cwd })
export const continuarOuAbortar = (cwd: string, continuar: boolean) =>
  invoke<void>("git_operacao", { cwd, continuar })

/** O gesto de rede que a faixa pode repetir depois de trocar de conta ou de
 *  trazer com rebase. */
export type GestoDeRede = "enviar" | "publicar" | "trazer" | "trazer-e-enviar" | "buscar"

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`

/** O que o botão de sincronia oferece, pelo estado do branch. `null` quando não
 *  há branch ou remoto: sem para onde enviar, não há botão. Puro. */
export function gestoDoBotao(s: {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  temRemoto: boolean
}): { gesto: GestoDeRede | null; rotulo: string } | null {
  if (!s.branch || !s.temRemoto) return null
  if (!s.upstream) return { gesto: "publicar", rotulo: "Publicar branch" }
  if (s.ahead > 0 && s.behind > 0)
    return { gesto: "trazer-e-enviar", rotulo: `Trazer ${s.behind} e enviar ${s.ahead}` }
  if (s.ahead > 0) return { gesto: "enviar", rotulo: `Enviar ${plural(s.ahead, "commit")}` }
  if (s.behind > 0) return { gesto: "trazer", rotulo: `Trazer ${plural(s.behind, "commit")}` }
  return { gesto: null, rotulo: `Em dia com ${s.upstream}` }
}

/** O mesmo gesto no gerúndio, para o tooltip enquanto roda. Puro. */
export function gestoEmCurso(gesto: GestoDeRede, ahead: number, behind: number): string {
  switch (gesto) {
    case "enviar":
      return `Enviando ${plural(ahead, "commit")}…`
    case "publicar":
      return "Publicando a branch…"
    case "trazer":
      return `Trazendo ${plural(behind, "commit")}…`
    case "trazer-e-enviar":
      return "Trazendo e enviando…"
    case "buscar":
      return "Buscando do remoto…"
  }
}

/** "há 3 h", ou "nunca" sem busca registrada. Puro. */
export function idadeDaBusca(ultimaBusca: number | null, now: number): string {
  if (ultimaBusca === null) return "nunca"
  const s = Math.max(0, Math.floor((now - ultimaBusca) / 1000))
  return s < 60 ? "agora há pouco" : `há ${idadeCurta(s)}`
}

/** "atual", "hoje", "ontem", "3 dias", "2 sem." Puro. */
export function quandoDaBranch(b: Pick<Branch, "quando" | "atual">, now: number): string {
  if (b.atual) return "atual"
  const dias = Math.floor((now - b.quando) / 86_400_000)
  if (dias <= 0) return "hoje"
  if (dias === 1) return "ontem"
  if (dias < 14) return `${dias} dias`
  return `${Math.floor(dias / 7)} sem.`
}

/** A conta que resolve um erro de acesso: o dono do repositório, se ele está
 *  logado no gh e não é o ativo; senão as outras contas logadas. Puro. */
export function contasParaTrocar(e: ErroDeGit): string[] {
  const outras = e.contas.filter((c) => c !== e.contaAtiva)
  if (e.dono && outras.includes(e.dono)) return [e.dono]
  return outras
}

/** O pedido que vai para o composer quando você pede ao agente para resolver
 *  o conflito. Só escreve: quem envia é você. Puro. */
export function pedidoDeConflito(op: OperacaoEmCurso | null, arquivos: readonly string[]): string {
  const onde = op?.tipo === "merge" ? "O merge" : "O rebase"
  const lista = arquivos.map((a) => `- ${a}`).join("\n")
  return `${onde} parou em conflito nestes arquivos:\n${lista}\n\nResolva os conflitos mantendo a intenção dos dois lados, e marque cada arquivo com \`git add\` quando terminar. Não continue nem aborte o ${op?.tipo ?? "rebase"}: essa decisão é minha.`
}
