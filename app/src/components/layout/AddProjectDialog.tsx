import { useEffect, useState } from "react"
import { Ban, Check, Folder, FolderOpen, Loader2 } from "lucide-react"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LABEL_COLORS } from "@/lib/labelColors"
import { createProject, pickProjectDirectory } from "@/lib/projects"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

export function AddProjectDialog() {
  const open = useApp((s) => s.addProjectOpen)
  const setOpen = useApp((s) => s.setAddProjectOpen)

  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  // `undefined` = não mexi na cor. Distinto de `null` ("escolhi sem cor"): no
  // re-add de uma pasta já cadastrada, sem essa diferença o diálogo apagava a
  // cor que o projeto já tinha só por ter sido aberto.
  const [color, setColor] = useState<string | null | undefined>(undefined)
  const [path, setPath] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Reseta o formulário ao abrir o diálogo
  useEffect(() => {
    if (open) {
      setName("")
      setNameTouched(false)
      setColor(undefined)
      setPath("")
      setSubmitting(false)
    }
  }, [open])

  // A pasta escolhida já é um projeto? O aviso vem ANTES de confirmar: clicar
  // em "Adicionar" e o app EDITAR um projeto existente em silêncio é a coisa
  // errada acontecendo com o nome certo.
  const jaCadastrado = useApp((s) =>
    path.trim() ? s.projects.find((p) => p.path === path.trim()) : undefined,
  )

  async function handlePickPath() {
    const selected = await pickProjectDirectory()
    if (!selected) return
    setPath(selected)
    // Se o usuário ainda não personalizou o nome manualmente ou o campo está vazio,
    // preenche com o nome da pasta selecionada.
    if (!nameTouched || !name.trim()) {
      const derived = selected.split("/").filter(Boolean).pop() ?? selected
      setName(derived)
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!path.trim() || submitting) return

    setSubmitting(true)
    const res = await createProject({
      name,
      path,
      color,
    })
    setSubmitting(false)
    if (res) {
      setOpen(false)
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Adicionar projeto"
      description="Conecte uma pasta ou repositório local ao Cockpit."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-1">
        {/* 1. Nome do projeto */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="project-name"
            className="text-[12px] font-medium text-foreground"
          >
            Nome do projeto
          </label>
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameTouched(true)
            }}
            placeholder="ex: Meu Projeto"
            className="text-[13px]"
          />
        </div>

        {/* 2. Cor de identificação */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-foreground">
            Cor de identificação
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {/* Opção sem cor */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setColor(null)}
                  aria-label="Sem cor"
                  className={cn(
                    "grid size-6 place-items-center rounded-full border border-border/80 text-muted-foreground/70 transition hover:text-foreground",
                    (color === null || color === undefined) &&
                      "ring-2 ring-foreground/60 ring-offset-2 ring-offset-background",
                  )}
                >
                  <Ban className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">
                Sem cor
              </TooltipContent>
            </Tooltip>

            {/* Paleta canônica */}
            {LABEL_COLORS.map((c) => {
              const selected = color === c.hex
              return (
                <Tooltip key={c.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setColor(c.hex)}
                      aria-label={c.name}
                      style={{ background: c.hex }}
                      className={cn(
                        "grid size-6 place-items-center rounded-full transition hover:scale-105",
                        selected &&
                          "ring-2 ring-foreground/60 ring-offset-2 ring-offset-background",
                      )}
                    >
                      {selected && (
                        <Check className="size-3 text-background stroke-[3]" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">
                    {c.name}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>

        {/* 3. Pasta no disco */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-foreground">
            Pasta no disco
          </label>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-muted/20 px-3 text-[12px]",
                path ? "font-mono text-foreground" : "text-muted-foreground",
              )}
              title={path || undefined}
            >
              <span className="truncate">
                {path || "Nenhuma pasta selecionada"}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="padrao"
              onClick={handlePickPath}
              className="h-9 shrink-0 gap-1.5 text-[12px]"
            >
              <FolderOpen className="size-3.5" />
              Escolher pasta
            </Button>
          </div>
        </div>

        {jaCadastrado && (
          <p className="text-[11px] text-muted-foreground">
            Essa pasta já é o projeto{" "}
            <span className="font-medium text-foreground">
              {jaCadastrado.name}
            </span>
            . Confirmar atualiza o nome e a cor dele, não cria um segundo.
          </p>
        )}

        {/* 4. Pré-visualização na barra lateral */}
        {/* Uma superfície só (§4): antes era um cartão com borda DENTRO de um
            cartão com borda, dentro do diálogo — três hairlines aninhadas. E a
            linha de dentro ficou sem borda também por fidelidade: ela imita uma
            linha da sidebar, e linha de sidebar não tem contorno. */}
        <div className="rounded-lg bg-muted/25 p-2.5">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            Pré-visualização
          </div>
          <div className="flex items-center gap-2.5 rounded-md bg-background/60 px-3 py-2">
            <span className="grid size-5 shrink-0 place-items-center">
              <Folder
                className={cn(
                  "size-[18px]",
                  !color && "text-muted-foreground/70",
                )}
                style={color ? { color } : undefined}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {name.trim() || "Nome do projeto"}
            </span>
            {path && (
              <span className="min-w-0 max-w-[160px] truncate font-mono text-[11px] text-muted-foreground">
                {path.split("/").slice(-2).join("/")}
              </span>
            )}
          </div>
        </div>

        {/* Rodapé com botões de ação */}
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="padrao"
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="text-[12px]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            size="padrao"
            disabled={!path.trim() || submitting}
            className="gap-1.5 text-[12px]"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {jaCadastrado ? "Atualizar projeto" : "Adicionar projeto"}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
