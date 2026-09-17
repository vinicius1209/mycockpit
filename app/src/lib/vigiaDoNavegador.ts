// Vigia do navegador do projeto (navegador PRD R6, B6).
//
// Dois episódios, um aviso cada:
//  • QUEDA: o processo do navegador terminou sem ninguém ter pedido. O
//    `ProcessRegistry` já emite `process_exited`, então o vigia reage ao evento
//    em vez de sondar num relógio; parada pedida chega como `stopped` e não avisa.
//  • SOBRA: no boot, Chromium de perfil da Frota sem sessão viva (o app caiu com
//    ele aberto). Ele segura o perfil e o próximo "Ligar" falharia sem explicar.
//    A Frota só oferece encerrar; quem decide é a pessoa.

import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { startProjectBrowser } from "@/lib/browser"
import { isTauri } from "@/lib/db"
import { listenWorkEvents, type ManagedProcess } from "@/lib/work"
import { useApp } from "@/store/app"

const PREFIXO_DO_NAVEGADOR = "browser-"

/** O processo que saiu era o navegador de um projeto e caiu sozinho? */
export function quedaDoNavegador(
  processo: Pick<ManagedProcess, "runId" | "status" | "exitCode">,
): { projectId: string; exitCode: number | null } | null {
  if (!processo.runId.startsWith(PREFIXO_DO_NAVEGADOR)) return null
  if (processo.status !== "exited" && processo.status !== "failed") return null
  return { projectId: processo.runId.slice(PREFIXO_DO_NAVEGADOR.length), exitCode: processo.exitCode }
}

export interface NavegadorOrfao {
  pid: number
  projectId: string
}

/** A frase do aviso de sobra, com os nomes dos projetos quando se sabe. */
export function avisoDeOrfaos(orfaos: readonly NavegadorOrfao[], nomeDe: (id: string) => string | null): string {
  const nomes = [...new Set(orfaos.map((o) => nomeDe(o.projectId)).filter((n): n is string => !!n))]
  const de = nomes.length ? ` (${nomes.join(", ")})` : ""
  return orfaos.length === 1
    ? `Um navegador de projeto${de} ficou aberto de uma sessão anterior e segura o perfil.`
    : `${orfaos.length} navegadores de projeto${de} ficaram abertos de uma sessão anterior e seguram os perfis.`
}

/** Um aviso por processo que caiu. */
const avisados = new Set<string>()

export function _resetVigiaDoNavegador(): void {
  avisados.clear()
}

function projeto(id: string) {
  return useApp.getState().projects.find((p) => p.id === id) ?? null
}

async function verificarOrfaos(): Promise<void> {
  const orfaos = await invoke<NavegadorOrfao[]>("browser_orfaos").catch(() => [])
  if (orfaos.length === 0) return
  toast(avisoDeOrfaos(orfaos, (id) => projeto(id)?.name ?? null), {
    duration: Infinity,
    action: {
      label: orfaos.length === 1 ? "Encerrar" : "Encerrar todos",
      onClick: () => {
        void Promise.allSettled(orfaos.map((o) => invoke("browser_encerrar_orfao", { pid: o.pid }))).then(
          (resultados) => {
            const falhas = resultados.filter((r) => r.status === "rejected").length
            if (falhas === 0) toast.success("Navegador antigo encerrado.")
            else toast.error("Não consegui encerrar todos os navegadores antigos.")
          },
        )
      },
    },
  })
}

/** Liga o vigia. Devolve a função que desliga. */
export function startVigiaDoNavegador(): () => void {
  if (!isTauri()) return () => {}
  let desfazer: (() => void) | null = null
  let cancelado = false
  void listenWorkEvents((event) => {
    if (event.kind !== "process_exited" || !event.data.process) return
    const queda = quedaDoNavegador(event.data.process)
    if (!queda || avisados.has(event.data.process.id)) return
    avisados.add(event.data.process.id)
    const p = projeto(queda.projectId)
    toast.error(`O navegador do projeto${p ? ` ${p.name}` : ""} parou sozinho.`, {
      description: queda.exitCode != null ? `O processo saiu com código ${queda.exitCode}.` : undefined,
      duration: 15_000,
      action: p
        ? {
            label: "Ligar de novo",
            onClick: () => {
              void startProjectBrowser(p.path).catch((err) =>
                toast.error(err instanceof Error ? err.message : String(err)),
              )
            },
          }
        : undefined,
    })
  }).then((fn) => {
    if (cancelado) fn()
    else desfazer = fn
  })
  void verificarOrfaos()
  return () => {
    cancelado = true
    desfazer?.()
  }
}
