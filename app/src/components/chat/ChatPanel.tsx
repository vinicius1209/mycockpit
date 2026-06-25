import { toast } from "sonner"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject } from "@/store/app"

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

export function ChatPanel() {
  const project = useActiveProject()
  const greeting = greetingFor(new Date())

  function handleSend(text: string, destinationId: string) {
    // M1: ainda não há runner de agent (chega no M3). Confirma o caminho da UI.
    toast("Console pronto — agents entram no M3", {
      description: `“${text.slice(0, 60)}${text.length > 60 ? "…" : ""}” → ${destinationId}`,
    })
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-background">
      {/* halo brass sutil subindo do console (atmosfera) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(62%_80%_at_50%_100%,var(--brass-soft),transparent_72%)] opacity-70" />

      <div className="relative flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[760px] flex-col items-center justify-center px-6 py-10">
          <div className="animate-cockpit-rise text-center">
            <Reticle className="mx-auto mb-6 size-8" />
            <h1 className="font-display text-[42px] leading-[1.1] tracking-[-0.01em] text-foreground">
              {greeting}, Vinícius.
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              {project
                ? `Abra um chat e coloque seu time de agents para trabalhar em ${project.name}.`
                : "Selecione ou adicione um projeto na barra lateral para começar."}
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 shrink-0 px-6 pb-6">
        <div className="mx-auto max-w-[760px]">
          <CommandConsole onSend={handleSend} disabled={!project} />
        </div>
      </div>
    </section>
  )
}
