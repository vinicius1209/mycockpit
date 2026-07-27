import { useState } from "react"
import { ChevronDown, Lock, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { ContextRing } from "@/components/chat/ContextRing"
import { PLAN_FIRST_TOOLTIP } from "@/lib/planMode"
import { permissionNote } from "@/lib/permissionNote"
import { useApp } from "@/store/app"
import {
  PERMISSION_LABEL,
  setProjectPermissionEverywhere,
} from "@/lib/permission"
import type { PermissionMode, Project } from "@/lib/types"

const MODES: PermissionMode[] = ["leitura", "padrao", "liberado"]

/**
 * Linha de EXECUÇÃO — a faixa acima do campo de texto onde mora tudo que muda
 * *como* o próximo turno roda. Nasceu da revisão de UI: o composer tinha 13
 * alvos de clique do mesmo peso, quatro deles congelados desde o 1º envio, e o
 * controle de maior consequência (permissão) não estava lá — morava no painel
 * de contexto, a três cliques, e o composer só falava do assunto DEPOIS que
 * você tinha liberado, num selo passivo.
 *
 * Regra de ocupação: aqui entra ESTADO que afeta o turno (permissão, planejar
 * primeiro, contexto, identidade). O que MODIFICA a mensagem (anexo, ditado) e
 * o que a DESPACHA (enviar/disputa/missão) ficam no rodapé, junto do campo.
 *
 * A permissão é do PROJETO (não da conversa) e o `--permission-mode` é fixo no
 * spawn — então com turno rodando a troca vale só no PRÓXIMO. A linha diz isso
 * na cara: sem esse aviso o controle mentiria.
 */
export function ExecutionRow({
  project,
  convAgent,
  planFirst,
  onTogglePlanFirst,
  running,
  identity,
  identityLabel,
  identityLocked,
}: {
  project: Project | null
  /** Agent EFETIVO da conversa (travado no 1º run) — quem obedece, ou não, ao modo. */
  convAgent: string | null
  planFirst?: boolean
  onTogglePlanFirst?: () => void
  running?: boolean
  /** Os seletores crus (preset/agent/modelo/esforço), revelados ao expandir. */
  identity: React.ReactNode
  /** Resumo colapsado, ex. "Claude Code · Opus 5 · xhigh". */
  identityLabel: string
  /** true = travados desde o 1º envio (o cadeado explica por quê). */
  identityLocked?: boolean
}) {
  const [identityOpen, setIdentityOpen] = useState(false)
  // ASSINA o store (não `getState()`): sem a subscrição, clicar no segmented
  // gravava o modo mas a linha não re-renderizava — o controle parecia morto.
  // Mesma precedência do `effectivePermission`: config do .mycockpit vence o
  // cache do projeto (o helper puro segue sendo a fonte da regra, testado).
  const mode = useApp((s) =>
    project
      ? (s.mycockpit[project.id]?.permission ??
        s.projects.find((p) => p.id === project.id)?.permissionMode ??
        "padrao")
      : "padrao",
  )
  const note = convAgent ? permissionNote(convAgent, mode) : null

  function pick(next: PermissionMode) {
    if (!project || next === mode) return
    setProjectPermissionEverywhere(project, next)
  }

  /** Setas ← → andam no segmented (é um radiogroup, não 3 botões soltos). */
  function onKey(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const i = MODES.indexOf(mode)
    pick(MODES[(i + delta + MODES.length) % MODES.length])
  }

  return (
    // stopPropagation: o cartão do ComposerShell foca o textarea a cada clique
    // (focusRing). Sem barrar aqui, clicar no segmented mandava o foco pro campo
    // de texto e as setas ←→ paravam de andar entre os modos.
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-1.5 px-3 pt-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="font-mono text-[9.5px] tracking-[0.12em] text-muted-foreground uppercase">
          Execução
        </span>

        <div
          role="radiogroup"
          aria-label="Permissões do projeto"
          onKeyDown={onKey}
          className="flex items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5"
        >
          {MODES.map((m) => {
            const on = m === mode
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                disabled={!project}
                onClick={() => pick(m)}
                title={
                  m === "liberado"
                    ? "O agente executa e escreve sem pedir confirmação"
                    : m === "leitura"
                      ? "O agente só lê e relata"
                      : "O agente pede confirmação antes de agir"
                }
                className={cn(
                  "flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors",
                  !on && "text-muted-foreground hover:text-foreground",
                  on && m === "liberado" && "bg-st-warning/15 text-st-warning",
                  on && m === "leitura" && "bg-card text-st-success shadow-[var(--shadow-sm)]",
                  on && m === "padrao" && "bg-card text-foreground shadow-[var(--shadow-sm)]",
                )}
              >
                {m === "liberado" && on && <TriangleAlert className="size-3" />}
                {PERMISSION_LABEL[m]}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onTogglePlanFirst}
          aria-pressed={!!planFirst}
          title={PLAN_FIRST_TOOLTIP}
          className={cn(
            "flex h-6 items-center rounded-md px-2 text-[11.5px] transition-colors",
            planFirst
              ? "bg-brass/15 text-brass ring-1 ring-brass/40"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Planeja antes
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <ContextRing />
          <button
            type="button"
            onClick={() => setIdentityOpen((v) => !v)}
            aria-expanded={identityOpen}
            title={
              identityLocked
                ? "Agent e modelo ficam fixos a partir do 1º envio desta conversa"
                : "Escolher agent, modelo e esforço"
            }
            className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {/* Expandido, os seletores logo abaixo já dizem tudo — repetir o
                rótulo aqui era a mesma informação duas vezes na mesma caixa. */}
            {!identityOpen && (
              <span className="max-w-[220px] truncate">{identityLabel}</span>
            )}
            {identityLocked && <Lock className="size-3 shrink-0 opacity-70" />}
            <ChevronDown
              className={cn(
                "size-3 shrink-0 transition-transform",
                identityOpen && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {/* Aviso honesto: o gate é fixo no spawn. Trocar com turno em voo vale só
          no próximo — sem esta linha o segmented pareceria agir agora. */}
      {running && (
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          Turno em andamento: a permissão vale a partir do próximo envio.
        </p>
      )}
      {/* O modo é do projeto, mas quem obedece é a CLI da conversa — e elas
          divergem (o agy não tem canal de aprovação nenhum). */}
      {note && (
        <p
          className={cn(
            "text-[10.5px] leading-snug",
            note.tone === "warn" ? "text-st-warning/90" : "text-muted-foreground",
          )}
        >
          {note.text}
        </p>
      )}

      {/* Identidade expandida INLINE (sem portal): Select do Radix dentro de
          dropdown/popover briga por foco — aqui os seletores são os mesmos de
          sempre, só revelados sob demanda. */}
      {identityOpen && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
          {identity}
        </div>
      )}
    </div>
  )
}
