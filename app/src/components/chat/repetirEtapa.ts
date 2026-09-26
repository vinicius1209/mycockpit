// "Repetir"/"Retomar" uma etapa do fio (o botão da linha da ferramenta). Saiu
// do ChatPanel pela catraca de tamanho, e trocou o `window.confirm` nativo
// pelo `confirm()` do app (ADR-261): a caixa do sistema não segue o tema, não
// diz de qual conversa é e trava a janela inteira.

import type { ToolItem } from "@/components/chat/messageNodes"
import { avisar, mensagemDe } from "@/lib/avisos"
import { confirm } from "@/lib/confirm"
import { HUMANO, type OrigemDoEnvio } from "@/lib/sendOrigin"
import { presentTool } from "@/lib/toolview"
import { retryManagedProcess, startManagedProcess } from "@/lib/work"
import { deferredLabel, deferredResumePrompt } from "@/store/chat"

type Enviar = (prompt: string, a: undefined, anexos: [], origem: OrigemDoEnvio) => unknown

export async function repetirEtapa(tool: ToolItem, enviar: Enviar): Promise<void> {
  const label = presentTool(tool.name, tool.input).label
  // Retomar ≠ repetir (decisão 3 do deferred-work-plan): trabalho diferido
  // interrompido RETOMA de onde parou (cache do workflow); relançar do zero
  // pagaria os subagentes de novo. running/completed não têm ação.
  if (tool.deferred) {
    const prompt = deferredResumePrompt(tool.deferred)
    if (!prompt) return
    const ok = await confirm({
      title: `Retomar “${deferredLabel(tool.deferred)}” de onde parou?`,
      description: "O que já foi executado volta do cache, sem pagar de novo.",
      confirmLabel: "Retomar",
    })
    if (ok) void enviar(prompt, undefined, [], HUMANO)
    return
  }
  if (tool.managedProcess) {
    const ok = await confirm({ title: `Repetir “${label}” como um novo processo gerenciado?`, confirmLabel: "Repetir" })
    if (!ok) return
    const restart =
      tool.managedProcess.status === "orphaned"
        ? startManagedProcess(tool.managedProcess)
        : retryManagedProcess(tool.managedProcess.id)
    void restart.catch((error) => avisar.erro("Não consegui repetir o processo.", { detalhe: mensagemDe(error) }))
    return
  }
  const ok = await confirm({
    title: `Repetir “${label}” em um novo turno?`,
    description: "A etapa pode produzir efeitos novamente.",
    confirmLabel: "Repetir",
  })
  if (!ok) return
  void enviar(
    `Repita somente a etapa “${label}” do turno anterior. Reavalie o estado atual antes de executar para não duplicar efeitos já aplicados.`,
    undefined,
    [],
    HUMANO,
  )
}
