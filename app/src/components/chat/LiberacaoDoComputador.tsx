// A faixa "o agente pode controlar o computador neste turno", com o Revogar
// (ADR-261). Mora na conversa dona, acima do composer; se você está noutra
// conversa, uma versão curta aparece no canto, com a origem. Some sozinha
// quando o turno acaba: quem manda é o `desktop_state` do backend.

import { Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { avisar, mensagemDe } from "@/lib/avisos"
import { desktopRevokeRun } from "@/lib/resources"
import { useLiberacoes } from "@/store/liberacoes"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

function revogar(runId: string, convId: string) {
  void desktopRevokeRun(runId).catch((err) =>
    avisar.erro("Não consegui revogar o computador.", { origem: { conversa: convId }, detalhe: mensagemDe(err) }),
  )
}

function Faixa({ runId, convId, origem }: { runId: string; convId: string; origem: string | null }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2" data-liberacao={runId}>
      <Monitor className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-[13px] text-foreground">
        {origem && <span className="block truncate text-[11px] text-muted-foreground">{origem}</span>}O agente pode
        ver a tela e controlar o computador neste turno.
      </p>
      <Button variant="outline" size="compacto" onClick={() => revogar(runId, convId)}>
        Revogar
      </Button>
    </div>
  )
}

/** Na conversa dona. */
export function LiberacaoNaConversa({ convId }: { convId: string }) {
  const porRun = useLiberacoes((s) => s.porRun)
  const runs = Object.entries(porRun).filter(([, c]) => c === convId)
  if (runs.length === 0) return null
  return (
    <>
      {runs.map(([runId]) => (
        <Faixa key={runId} runId={runId} convId={convId} origem={null} />
      ))}
    </>
  )
}

/** No canto: as liberações de conversas que não estão na tela. */
export function LiberacoesForaDaTela() {
  const porRun = useLiberacoes((s) => s.porRun)
  const visivel = useChat((s) => s.activeId)
  const linear = useApp((s) => s.viewMode === "linear")
  const projetos = useApp((s) => s.projects)
  const chat = useChat.getState()
  const fora = Object.entries(porRun).filter(([, c]) => !(linear && c === visivel))
  if (fora.length === 0) return null
  return (
    <>
      {fora.map(([runId, convId]) => {
        const projectId = chat.byId[convId]?.projectId
        const projeto = projetos.find((p) => p.id === projectId)?.name ?? "Projeto"
        const titulo =
          (chat.conversationsByProject[projectId ?? ""] ?? chat.conversations).find((c) => c.id === convId)?.title ??
          "Conversa"
        return <Faixa key={runId} runId={runId} convId={convId} origem={`${projeto} · ${titulo}`} />
      })}
    </>
  )
}
