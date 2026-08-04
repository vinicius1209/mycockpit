import { useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { writeSkill, type SkillDraft } from "@/lib/skills"

interface SkillDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Caminho do projeto ativo (onde grava `.mycockpit/commands/`). */
  projectPath: string | null
  /** Rascunho do Haiku; null enquanto ainda está rascunhando (loading). */
  draft: SkillDraft | null
}

/** Dialog de promoção de skill (M5): campos editáveis Nome/Descrição/Corpo +
 *  [Salvar skill]/[Cancelar]. Aprovação humana OBRIGATÓRIA: nada grava sem o
 *  clique aqui. Enquanto o Haiku rascunha (draft null), mostra loading. */
export function SkillDraftDialog({
  open,
  onOpenChange,
  projectPath,
  draft,
}: SkillDraftDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)

  // Hidrata os campos quando o rascunho chega (não sobrescreve edições depois).
  useEffect(() => {
    if (draft) {
      setName(draft.name)
      setDescription(draft.description)
      setBody(draft.body)
    }
  }, [draft])

  async function onSave() {
    if (!projectPath) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Dê um nome à skill.")
      return
    }
    // Descrição vira frontmatter do command (a descoberta do app lê
    // `description:`; na expansão app-side o frontmatter é removido do prompt).
    // JSON.stringify = string JSON-quoted (YAML aceita): aspas/':'/quebras na
    // descrição não quebram o frontmatter.
    const content = description.trim()
      ? `---\ndescription: ${JSON.stringify(description.trim())}\n---\n\n${body}`
      : body
    setSaving(true)
    try {
      const rel = await writeSkill(projectPath, trimmed, content)
      toast.success(`Skill salva em ${rel}`)
      onOpenChange(false)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const loading = draft === null

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          Salvar como skill
        </span>
      }
      description={
        <>
          Promova este workflow a um /command reutilizável em
          {" "}.mycockpit/commands/ (vale para qualquer agent). Revise antes de
          salvar.
        </>
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={loading || saving || !projectPath}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Salvar skill
          </Button>
        </>
      }
    >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Rascunhando a skill…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="skill-name" className="text-sm font-medium">
                Nome (slug)
              </label>
              <Input
                id="skill-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="deploy-no-repo"
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="skill-desc" className="text-sm font-medium">
                Descrição
              </label>
              <Input
                id="skill-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Quando usar esta skill."
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="skill-body" className="text-sm font-medium">
                Corpo (markdown)
              </label>
              <Textarea
                id="skill-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-48 font-mono text-xs"
                disabled={saving}
              />
            </div>
          </div>
        )}
    </AppDialog>
  )
}
