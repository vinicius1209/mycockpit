import type { ReactNode } from "react"
import { Check, FileText, FolderGit2, Minus, PanelRight } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useActiveProject } from "@/store/app"
import { shortPath } from "@/lib/utils"

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label-mono">{title}</span>
        {note && (
          <span className="text-[10px] text-muted-foreground/70">{note}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function DetectRow({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5">
      <span className="flex items-center gap-2 font-mono text-[12.5px] text-foreground/90">
        <FileText className="size-3.5 text-muted-foreground" />
        {label}
      </span>
      {present ? (
        <Check className="size-3.5 text-st-success" />
      ) : (
        <Minus className="size-3.5 text-muted-foreground/45" />
      )}
    </div>
  )
}

export function ContextPanel() {
  const project = useActiveProject()

  return (
    <aside className="reveal-right flex w-80 shrink-0 flex-col border-l bg-rail">
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <PanelRight className="size-3.5 text-muted-foreground" />
        <span className="label-mono">Contexto</span>
      </header>

      {!project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Nenhum projeto selecionado.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-center gap-2">
              <FolderGit2 className="size-4 shrink-0 text-brass" />
              <span className="truncate text-[14px] font-medium text-foreground">
                {project.name}
              </span>
            </div>
            <div
              data-selectable
              className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            >
              {shortPath(project.path)}
            </div>
          </div>

          <Separator className="my-1" />

          <Section title="O que o sistema sabe" note="lê do disco no M2">
            <div className="flex flex-col gap-0.5">
              <DetectRow label="CLAUDE.md" present={!!project.hasClaudeMd} />
              <DetectRow label="AGENTS.md" present={!!project.hasAgentsMd} />
              <DetectRow label=".claude/" present={!!project.hasClaudeMd} />
            </div>
          </Section>

          <Separator className="my-1" />

          {["Specs", "Regras", "Personas", "Memórias"].map((s) => (
            <Section key={s} title={s}>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground/70">
                Será populado ao conectar o projeto.
              </p>
            </Section>
          ))}
        </ScrollArea>
      )}
    </aside>
  )
}
