// A linha de um PROJETO na sidebar: o ícone-pasta, o nome (com renomear
// inline), o drag & drop de reordenação e o menu de contexto.
//
// Extraído de Sidebar.tsx (que estava no teto do ratchet) quando o "Abrir no
// editor" (M1) precisou de mais um item no menu. Recorte fechado, não pedaço
// partido pra caber: `ProjectFolder` só existe pra esta linha, e veio junto. O
// arrasto em si mora em `lib/arrastoInterno.ts`, compartilhado com a linha de
// conversa desde que o spike S2 mostrou por que ele não funcionava no app.

import { useState } from "react"
import { toast } from "sonner"
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  Folder,
  Pencil,
} from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ColorSubmenu } from "@/components/layout/ColorSubmenu"
import { OpenProjectInEditorItem } from "@/components/common/OpenInEditor"
import { useApp } from "@/store/app"
import { useEpocaDaJanela } from "@/lib/janelaViva"
import type { AgentStatus, Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  cargaArrastada,
  comecarArrasto,
  concluirArrasto,
  pairarSobre,
} from "@/lib/arrastoInterno"

/** Ícone do projeto: pasta TINGIDA da cor-rótulo (cinza se sem cor), com um
 *  pulso no canto quando o projeto tem um turno rodando. Marcador do container. */
function ProjectFolder({
  color,
  status,
  awaiting = false,
}: {
  color?: string | null
  status: AgentStatus
  /** Alguma conversa do projeto está esperando você: permissão OU pergunta
   *  pendente (os dois param o turno). */
  awaiting?: boolean
}) {
  // ADR-071: só o âmbar precisa — o ponto azul de "rodando" é estático.
  const epoca = useEpocaDaJanela()
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <Folder
        className={cn("size-[18px]", !color && "text-muted-foreground/70")}
        style={color ? { color } : undefined}
      />
      {/* Espera VENCE rodando no mesmo canto: um projeto que roda sozinho não
          precisa de você; um que parou pra te perguntar algo, sim. S3.2 —
          pulso SÓ no "esperando você" (o único evento que interrompe o
          humano); rodando é presença calma → dot estático. */}
      {awaiting ? (
        <span
          key={epoca}
          title="Este projeto parou esperando você"
          className="animate-cockpit-pulse absolute -top-0.5 -right-0.5 size-2 rounded-full bg-st-warning ring-2 ring-rail"
        />
      ) : (
        status === "running" && (
          <span
            title="Turno rodando neste projeto"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-st-running ring-2 ring-rail"
          />
        )
      )}
    </span>
  )
}

// S1.2 — tipo do payload de drag de PROJETO (HTML5 dnd; não há lib de dnd no
// repo). `types` é legível no dragover (getData não é), então o tipo é o
// discriminador do que se aceita soltar.

export function ProjectRow({
  project,
  active,
  expanded,
  status,
  awaiting = false,
  problemaNaPasta,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggle,
  onDelete,
}: {
  project: Project
  active: boolean
  expanded: boolean
  status: AgentStatus
  /** Pedido pendente (permissão ou pergunta) em alguma conversa do projeto:
   *  ponto âmbar na pasta. */
  awaiting?: boolean
  /** S1.2 — bordas da lista (desabilita "Mover para cima/baixo" no menu). */
  canMoveUp: boolean
  canMoveDown: boolean
  /** A pasta sumiu (ou não é pasta). Fica VISÍVEL com o motivo dito — §5:
   *  não-configurado esconde, configurado com ERRO fica. Some da lista seria
   *  pior: quem cadastrou merece saber por que parou de funcionar. */
  problemaNaPasta?: string
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const renameProject = useApp((s) => s.renameProject)
  const setProjectColor = useApp((s) => s.setProjectColor)
  const reorderProjects = useApp((s) => s.reorderProjects)
  const moveProject = useApp((s) => s.moveProject)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(project.name)

  function commit() {
    setEditing(false)
    const v = val.trim()
    if (v && v !== project.name) renameProject(project.id, v)
    else setVal(project.name)
  }

  // Cor-rótulo = pasta TINGIDA (a tinta de linha inteira competia com o
  // preenchimento de seleção — 3 sinais no mesmo canal). Seleção é dona do bg.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          // S1.2 — drag & drop reordena projetos (teclado cobre via context
          // menu). Draggable sai durante a edição pra não brigar com a seleção
          // de texto do input de renomear.
          draggable={!editing}
          onDragStart={(e) => {
            comecarArrasto({ tipo: "projeto", id: project.id })
            // O `dataTransfer` fica só com o visual: o tipo próprio não
            // atravessa o pasteboard do sistema, e era isso que matava o gesto
            // no app instalado (spike S2, `lib/arrastoInterno.ts`).
            e.dataTransfer.setData("text/plain", project.name)
            e.dataTransfer.effectAllowed = "move"
          }}
          onDragOver={(e) => {
            if (cargaArrastada()?.tipo !== "projeto") return
            e.preventDefault()
            pairarSobre(project.id)
          }}
          onDrop={(e) => {
            e.preventDefault()
            const feito = concluirArrasto(project.id)
            if (feito?.carga.tipo === "projeto") reorderProjects(feito.carga.id, feito.alvo)
          }}
          onDragEnd={() => {
            // Rede de segurança: sem `drop` entregue, o gesto se fecha aqui,
            // com o último alvo por onde passou.
            const feito = concluirArrasto()
            if (feito?.carga.tipo === "projeto") reorderProjects(feito.carga.id, feito.alvo)
          }}
          className={cn(
            "group relative flex w-full items-center rounded-md transition-colors",
            // SELEÇÃO NÃO É COR (§2, ADR-043): preenchimento neutro + peso.
            active ? "bg-sel" : "hover:bg-sel-hover",
          )}
        >
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-2 pl-3">
              <ProjectFolder color={project.color} status={status} awaiting={awaiting} />
              <input
                autoFocus
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit()
                  if (e.key === "Escape") {
                    setVal(project.name)
                    setEditing(false)
                  }
                }}
                className="min-w-0 flex-1 rounded border border-brass/40 bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
              />
            </div>
          ) : (
            <button
              onClick={onSelect}
              // pl-3 (12px) + pasta (20px) + gap-2.5 (10px) = 42px, que é
              // exatamente onde o título da conversa começa (pl-[18px] + marca
              // 16px + gap-2). O recuo de 12px é o que abre o gutter do pip.
              className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-1 pl-3 text-left"
            >
              {/* Pasta TINGIDA da cor do projeto (Codex-like): é o marcador do
                  container. Path saiu da linha → vira tooltip (menos ruído). */}
              <ProjectFolder color={project.color} status={status} awaiting={awaiting} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] font-medium",
                  // Nome esmaecido + selo: o projeto continua clicável (você
                  // pode querer conferir as conversas dele), mas a linha para
                  // de afirmar que está tudo bem.
                  problemaNaPasta ? "text-muted-foreground" : "text-foreground",
                )}
                title={problemaNaPasta ? `${problemaNaPasta}\n${project.path}` : project.path}
              >
                {project.name}
              </span>
              {problemaNaPasta && (
                <span
                  title={problemaNaPasta}
                  className="shrink-0 rounded bg-st-error/15 px-1.5 py-0.5 text-[11px] font-medium text-st-error"
                >
                  pasta sumiu
                </span>
              )}
            </button>
          )}
          {/* S1.4 — arquivamento saiu da linha (mora SÓ no context menu): a
              lixeira materializava no hover COLADA no chevron e o caminho do
              cursor cruzava a zona de arquivar. O chevron fica sozinho na
              borda direita. */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            title={expanded ? "Retrair" : "Expandir"}
            aria-label={expanded ? "Retrair projeto" : "Expandir projeto"}
            aria-expanded={expanded}
            className="mr-1 shrink-0 rounded p-1.5 text-muted-foreground/50 transition-colors hover:bg-sel hover:text-muted-foreground"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem
          onSelect={() => {
            setVal(project.name)
            setEditing(true)
          }}
        >
          <Pencil /> Renomear
        </ContextMenuItem>
        <ColorSubmenu
          current={project.color}
          onPick={(c) => setProjectColor(project.id, c)}
        />
        <ContextMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(project.path)
            toast.success("Caminho copiado")
          }}
        >
          <Copy /> Copiar caminho
        </ContextMenuItem>
        {/* M1 — vizinho natural do "Copiar caminho": os dois respondem "quero
            mexer nisso fora do cockpit". Some sozinho sem editor detectado. */}
        <OpenProjectInEditorItem projectPath={project.path} />
        {/* S1.2 — reordenação por teclado (o drag não cobre acessibilidade). */}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!canMoveUp}
          onSelect={() => moveProject(project.id, -1)}
        >
          <ArrowUp /> Mover para cima
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canMoveDown}
          onSelect={() => moveProject(project.id, 1)}
        >
          <ArrowDown /> Mover para baixo
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete}>
          <Archive /> Arquivar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
