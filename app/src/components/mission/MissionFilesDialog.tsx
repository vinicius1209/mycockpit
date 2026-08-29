// Viewer dos artefatos de uma missão (onda 3): lê a pasta isolada
// (.mycockpit/missions/<slug>/) e mostra plano/relatórios/handoffs NO APP —
// resolve o "concern 2" (o plano deixava de ser legível: virava um teaser no
// chat + um plan.md gitignorado que só abria no Finder). Painel de arquivos à
// esquerda, conteúdo à direita (Markdown p/ .md, código p/ o resto), com
// "Promover pra docs/" nos relatórios que valem versionar.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { FileText, FolderOpen, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/common/Markdown"
import {
  listMissionFiles,
  promoteToDocs,
  readMissionFile,
} from "@/lib/missionFiles"
import { cn } from "@/lib/utils"

/** Ordena p/ leitura humana: plan.md primeiro, relatórios, notas, handoffs por
 *  último, run-state escondido (é bookkeeping). */
function rank(f: string): number {
  if (f === "plan.md") return 0
  if (f.startsWith("reports/")) return 1
  if (f.endsWith("-notes.md")) return 2
  if (f.endsWith(".md")) return 3
  return 4
}

/** Relatórios/notas em markdown valem "promover"; handoffs/run-state não. */
function canPromote(f: string): boolean {
  return f.endsWith(".md") && f !== "run-state.json"
}

export function MissionFilesDialog({
  open,
  onOpenChange,
  cwd,
  dir,
  slug,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cwd: string
  dir: string
  slug: string
}) {
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    void listMissionFiles(cwd, dir).then((fs) => {
      if (!alive) return
      const sorted = [...fs]
        .filter((f) => f !== "run-state.json")
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      setFiles(sorted)
      setSelected(sorted[0] ?? null)
    })
    return () => {
      alive = false
    }
  }, [open, cwd, dir])

  useEffect(() => {
    if (!open || !selected) {
      setContent(null)
      return
    }
    let alive = true
    setLoading(true)
    void readMissionFile(cwd, dir, selected).then((c) => {
      if (!alive) return
      setContent(c)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [open, selected, cwd, dir])

  async function promote(f: string) {
    try {
      const r = await promoteToDocs(cwd, dir, f, slug)
      if (r.alreadyThere) {
        toast(`Já estava em ${r.path} (idêntico)`)
      } else {
        toast.success(`Promovido para ${r.path} (versionado no git)`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao promover")
    }
  }

  const isMd = selected?.endsWith(".md") ?? false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <FolderOpen className="size-4 text-brass" />
            Arquivos da missão
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            {dir}
          </DialogDescription>
        </DialogHeader>

        {files.length === 0 ? (
          <div className="grid flex-1 place-items-center text-[13px] text-muted-foreground">
            Nenhum artefato nesta missão ainda.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* lista de arquivos */}
            <div className="w-56 shrink-0 overflow-y-auto border-r py-2">
              {files.map((f) => (
                <button
                  key={f}
                  onClick={() => setSelected(f)}
                  className={cn(
                    "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] transition-colors",
                    selected === f
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{f}</span>
                </button>
              ))}
            </div>

            {/* conteúdo */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                  {selected ?? "—"}
                </span>
                {selected && canPromote(selected) && (
                  <Button
                    size="padrao"
                    variant="outline"
                    className="h-7 gap-1.5 text-[12px]"
                    onClick={() => void promote(selected)}
                    title="Copia este relatório pra docs/<slug>/ (versionado no git)"
                  >
                    <Upload className="size-3" />
                    Promover pra docs/
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {loading ? (
                  <p className="text-[13px] text-muted-foreground">Lendo…</p>
                ) : content == null ? (
                  <p className="text-[13px] text-muted-foreground">
                    Não consegui ler o arquivo.
                  </p>
                ) : isMd ? (
                  <Markdown text={content} />
                ) : (
                  <pre className="overflow-x-auto rounded-md bg-secondary/40 p-3 font-mono text-[12px] leading-relaxed">
                    {content}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
