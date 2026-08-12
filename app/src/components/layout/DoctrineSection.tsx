// DOUTRINA DO PROJETO no painel — o editor de `.mycockpit/instructions.md`.
//
// Por que tem UI própria em vez de "edite o arquivo à mão": a doutrina é a única
// instrução que alcança TODOS os agents (o app injeta), então ela precisa ser
// tão fácil de escrever quanto trocar a permissão. E ela nasce quase sempre de
// um CLAUDE.md/AGENTS.md que já existe — daí o botão de semear, que evita o
// pior desfecho: duas fontes de regra divergindo em silêncio.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BookText, Check, FileInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogCloseX,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  DOCTRINE_PATH,
  readDoctrine,
  readDoctrineSeed,
  writeDoctrine,
} from "@/lib/doctrine"
import { fmtBytes } from "@/lib/format"

/** Nome de um arquivo de instrução de CLI que já existe no projeto e pode
 *  semear a doutrina. Só o NOME viaja: o conteúdo é lido na hora, integral
 *  (o inventário do painel vem truncado em 8k pra preview). */
export type DoctrineSeed = string

export function DoctrineSection({
  projectPath,
  seeds,
}: {
  projectPath: string
  /** CLAUDE.md / AGENTS.md presentes, p/ semear a 1ª versão. */
  seeds: DoctrineSeed[]
}) {
  const [content, setContent] = useState("")
  const [exists, setExists] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readDoctrine(projectPath).then((d) => {
      if (cancelled) return
      setContent(d.content)
      setExists(d.exists && d.content.trim().length > 0)
    })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  function abrir() {
    setDraft(content)
    setOpen(true)
  }

  /** Copia INTEGRALMENTE um CLAUDE.md/AGENTS.md pro rascunho (não grava ainda —
   *  o usuário revisa e salva). Falha avisa: semear "quase tudo" seria pior. */
  async function semear(name: string) {
    try {
      setDraft(await readDoctrineSeed(projectPath, name))
    } catch (e) {
      console.error("[doutrina] falha ao ler a semente", name, e)
      toast.error(`Não consegui ler o ${name}.`)
    }
  }

  async function salvar() {
    setSaving(true)
    try {
      await writeDoctrine(projectPath, draft)
      setContent(draft)
      setExists(draft.trim().length > 0)
      setOpen(false)
      toast.success("Doutrina salva, vale a partir do próximo envio.")
    } catch (e) {
      // erro de escrita NÃO pode passar batido: o usuário acharia que escreveu
      // regra que não existe (mesma lição do saveLesson).
      console.error("[doutrina] falha ao gravar", e)
      toast.error("Não consegui gravar a doutrina. O arquivo não foi alterado.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <BookText className="size-3.5 shrink-0" />
          <span className="truncate">Regras do projeto</span>
        </span>
        <button
          onClick={abrir}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-brass/60 hover:text-brass"
        >
          {exists ? "Editar" : "Escrever"}
        </button>
      </div>

      {exists ? (
        <p className="line-clamp-2 text-[11px] leading-snug text-foreground/70">
          {primeiraLinha(content)}
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          O único texto de instrução que chega em <b>todos</b> os agents — o app
          injeta no prompt. Sem ele, cada CLI depende do arquivo do próprio
          fornecedor.
        </p>
      )}

      <p className="text-[10.5px] text-muted-foreground/55">
        {exists ? (
          <>
            <span className="font-mono">{DOCTRINE_PATH}</span> ·{" "}
            {fmtBytes(new TextEncoder().encode(content).length)} · versionado no
            git
          </>
        ) : (
          <>
            será salvo em <span className="font-mono">{DOCTRINE_PATH}</span>
          </>
        )}
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 py-3 text-left">
            <DialogTitle className="text-[15px]">Regras do projeto</DialogTitle>
            <DialogDescription className="text-[12px]">
              Injetado no primeiro turno de qualquer agent (e em toda fase de
              missão e disputa). Markdown; escreva no imperativo.
            </DialogDescription>
            <DialogCloseX />
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-4">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={"- Testes em pt-BR, no mesmo arquivo do módulo.\n- Não use `any`.\n- Rode `bun run lint` antes de dizer que terminou."}
              className="min-h-[280px] flex-1 resize-none font-mono text-[12.5px] leading-relaxed"
              spellCheck={false}
            />
            {/* Semear: quase todo projeto já tem a regra escrita em algum lugar.
                Copiar é melhor que reescrever — e o botão só aparece com o campo
                vazio, pra nunca atropelar texto do usuário. */}
            {draft.trim().length === 0 && seeds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground/70">
                  Começar a partir de:
                </span>
                {seeds.map((name) => (
                  <button
                    key={name}
                    onClick={() => void semear(name)}
                    className="flex h-6 items-center gap-1 rounded-md border border-border/60 px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-brass/60 hover:text-brass"
                  >
                    <FileInput className="size-3" />
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={() => void salvar()} disabled={saving}>
              <Check className="size-3.5" />
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 1ª linha com conteúdo, sem marcação de título — o resumo colapsado. */
function primeiraLinha(md: string): string {
  const l = md
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x.length > 0 && !x.startsWith("---"))
  return (l ?? "").replace(/^#+\s*/, "").replace(/^[-*]\s*/, "")
}
