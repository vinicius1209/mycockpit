// O GATE DE DIRETÓRIO, lado da RESOLUÇÃO. (A detecção é heurística e pura, em
// `lib/blockedDir.ts`.)
//
// Liberar a pasta é DUAS coisas, e elas têm prazos diferentes:
//
//  1. **Persistir** o `extra_dirs` no `.frota/config.toml` + memória. Vale
//     imediatamente, e é o que o botão promete de verdade.
//  2. **Reenviar** o último pedido. Isso é um TURNO NOVO, e só cabe com a
//     conversa parada: o `--add-dir` entra no `build_command` do spawn
//     (`src-tauri/src/adapters.rs`), então o processo vivo não ganha a pasta
//     nem com resume nativo (o `agy` tem `sessionResume`, e ele não muda flag).
//
// O incidente 2026-08-16 fez as duas de uma vez com o turno vivo: o reenvio
// caiu na fila do humano, o `finally` drenou, e o mesmo prompt rodou por
// inteiro pela segunda vez (~2,4M de tokens a mais). Aqui a segunda parte é
// condicional e o estado lido é FRESCO, depois do `await` do write.
//
// Isto mora fora do `ChatPanel` porque é uma decisão com estado, prazo e
// caminho de falha, e no componente ela não tinha teste nenhum.

import { toast } from "sonner"
import { writeProjectConfig } from "@/lib/configDoProjeto"
import { avisoDeDescarte, PASTA_LIBERADA } from "@/lib/sendOrigin"
import type { Project } from "@/lib/types"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** O que a liberação fez de fato. Enum, não boolean: cada saída é um estado
 *  diferente do mundo, e o teste cobra qual aconteceu. */
export type ResultadoDaLiberacao =
  /** A pasta já estava no `extra_dirs` (corrida de dois cliques). */
  | "ja-liberada"
  /** O `.frota/config.toml` não aceitou a escrita. Nada mudou. */
  | "falha-ao-salvar"
  /** Persistiu, mas o turno está vivo: reenviar agora duplicaria o trabalho. */
  | "turno-em-voo"
  /** Persistiu e não havia pedido do usuário para reenviar. */
  | "sem-pedido"
  /** Persistiu e reenviou o último pedido num turno novo. */
  | "reenviada"

/** A primeira metade da liberação, sozinha: grava a pasta no `extra_dirs` do
 *  projeto. É também o "Liberar sempre" do cartão de arquivo solto (ADR-252),
 *  que não reenvia nada: o pedido ainda nem saiu. */
export async function gravarPastaLiberada(
  project: Project,
  dir: string,
): Promise<"ja-liberada" | "falha-ao-salvar" | "liberada"> {
  const app = useApp.getState()
  const cur = app.projectConfigs[project.id]
  if (cur?.extraDirs?.includes(dir)) return "ja-liberada"
  const next = [...(cur?.extraDirs ?? []), dir]
  try {
    await writeProjectConfig(project.path, { extraDirs: next })
  } catch {
    toast.error("Não consegui salvar a pasta permitida no config.")
    return "falha-ao-salvar"
  }
  app.setProjectConfig(project.id, {
    exists: true,
    // Sem config lido do Rust ainda: a pasta é a de hoje, que é onde a escrita foi.
    pasta: cur?.pasta ?? ".frota",
    permission: cur?.permission ?? project.permissionMode ?? "padrao",
    helper: cur?.helper ?? "haiku",
    mode: cur?.mode ?? "linear",
    extraDirs: next,
  })
  return "liberada"
}

/** Libera a pasta detectada e, SÓ com a conversa parada, reenvia o último
 *  pedido do usuário. `reenviar` recebe o texto e é chamado no máximo uma vez;
 *  quem passa é o dono do envio (o `ChatPanel`), com origem de SISTEMA. */
export async function allowBlockedDir(args: {
  convId: string | null
  project: Project
  dir: string
  reenviar: (texto: string) => void
}): Promise<ResultadoDaLiberacao> {
  const { convId, project, dir } = args
  const gravada = await gravarPastaLiberada(project, dir)
  if (gravada === "ja-liberada") {
    // já liberado (corrida) → só limpa o aviso.
    if (convId) useChat.getState().clearBlockedDir(convId)
    return "ja-liberada"
  }
  if (gravada === "falha-ao-salvar") return "falha-ao-salvar"
  if (convId) useChat.getState().clearBlockedDir(convId)
  // Estado FRESCO (o write acima é `await`: um turno pode ter começado, ou o
  // que estava rodando ainda não acabou). Com turno vivo a pasta fica valendo e
  // o reenvio NÃO acontece: um turno novo só nasce depois deste.
  const conv = convId ? useChat.getState().byId[convId] : undefined
  if (conv?.running || conv?.finalizing) {
    toast.success(avisoDeDescarte(PASTA_LIBERADA))
    return "turno-em-voo"
  }
  const items = conv?.items ?? []
  let lastUser = ""
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "user") {
      lastUser = it.text
      break
    }
  }
  if (!lastUser) {
    toast.success("Pasta liberada.")
    return "sem-pedido"
  }
  toast.success("Pasta liberada. Reenviando o pedido…")
  args.reenviar(lastUser)
  return "reenviada"
}
