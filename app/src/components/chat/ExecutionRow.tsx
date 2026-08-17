import { useState } from "react"
import { Check, ChevronDown, ListChecks, Lock, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { ContextRing } from "@/components/chat/ContextRing"
import { PLAN_FIRST_DESCRIPTION, PLAN_FIRST_LABEL } from "@/lib/planMode"
import { permissionNote } from "@/lib/permissionNote"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import { Switch } from "@/components/ui/switch"
import { useApp } from "@/store/app"
import {
  PERMISSION_DESCRIPTION,
  PERMISSION_LABEL,
  resolvePermission,
  setProjectPermissionEverywhere,
} from "@/lib/permission"
import type { PermissionMode, Project } from "@/lib/types"

const MODES: PermissionMode[] = ["leitura", "padrao", "liberado"]

/**
 * Linha de EXECUÇÃO — a faixa acima do campo de texto onde mora tudo que muda
 * *como* o próximo turno roda.
 *
 * Colapso (docs/mocks/composer-README.md): permissão, "Planeja antes" e
 * identidade (agent/modelo/esforço) eram três alvos sempre visíveis — um
 * segmented de 3 posições, um toggle, um chevron — para controles que a
 * medição real (406 turnos, 30 dias) mostra travados no 1º envio ou parados
 * há semanas. Viraram UM letreiro só: mostra o modo de permissão SEMPRE (é o
 * sinal de maior consequência do app, ADR-048 — "modo de risco é DITO, não
 * emoldurado" — e aqui é onde ele é dito), e abre inline o painel com as três
 * decisões. Sem portal, de propósito: Select do Radix dentro de
 * dropdown/popover briga por foco (documentado quando a identidade ainda era
 * a única coisa atrás de um chevron); a mesma revelação inline que já
 * funcionava pra ela agora serve às três.
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
  /** Os seletores crus (preset/agent/modelo/esforço), revelados dentro do painel. */
  identity: React.ReactNode
  /** Resumo de agent/modelo/esforço, mostrado só com o painel aberto (repouso
   *  já diz o que importa mais: o modo). */
  identityLabel: string
  /** true = travados desde o 1º envio (o cadeado explica por quê). */
  identityLocked?: boolean
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  // ASSINA o store (não `getState()`): sem a subscrição, clicar no painel
  // gravava o modo mas a linha não re-renderizava — o controle parecia morto.
  // A precedência é a do `resolvePermission` (config do .mycockpit vence o cache
  // do SQLite) e vem de lá, não copiada: o seletor é que é próprio desta faixa
  // (ela lê o projeto ATIVO), a regra é da casa.
  const mode = useApp((s) =>
    project
      ? resolvePermission(
          s.mycockpit[project.id]?.permission,
          s.projects.find((p) => p.id === project.id)?.permissionMode,
        )
      : "padrao",
  )
  const note = convAgent ? permissionNote(convAgent, mode) : null

  function pick(next: PermissionMode) {
    if (!project || next === mode) return
    setProjectPermissionEverywhere(project, next)
  }

  /** Setas andam na lista de modos (é um radiogroup vertical, não 3 botões
   *  soltos) — ↑/↓ é o par natural da lista; ←/→ segue funcionando por
   *  compatibilidade com quem tinha o hábito do segmented horizontal antigo. */
  function onKey(e: React.KeyboardEvent) {
    const delta =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0
    if (!delta) return
    e.preventDefault()
    const i = MODES.indexOf(mode)
    pick(MODES[(i + delta + MODES.length) % MODES.length])
  }

  return (
    // stopPropagation: o cartão do ComposerShell foca o textarea a cada clique
    // (focusRing). Sem barrar aqui, clicar no letreiro/painel mandava o foco pro
    // campo de texto e as setas ↑↓ paravam de andar entre os modos.
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-1.5 px-3 pt-2.5"
    >
      <div className="flex items-center gap-2">
        {/* O LETREIRO — porta única pro painel de permissão + planejar antes +
            identidade. Mostra o modo SEMPRE (nunca trunca, ADR-048): é o único
            sinal de risco que a tela dá, então não pode virar redundância
            escondida atrás do painel — precisa continuar lido de relance. */}
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          aria-haspopup="true"
          // Estável (não muda com o modo): é o alvo que localiza o controle,
          // o VALOR quem diz é o texto visível dentro dele.
          aria-label="Como o próximo turno roda"
          title={
            panelOpen
              ? "Fechar"
              : "Permissão, planejar primeiro, agent, modelo e esforço"
          }
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors",
            mode === "liberado"
              ? "bg-st-warning/15 text-st-warning"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {mode === "liberado" && <TriangleAlert className="size-3 shrink-0" />}
          {PERMISSION_LABEL[mode]}
          {/* "Planeja antes" ligado é por-turno e não persiste (§7 furo 1 do
              plano do colapso) — fácil de esquecer que está ativo se sumir de
              vez do letreiro. Este ponto é o resto do sinal, sem reviver o
              botão inteiro sempre visível. */}
          {planFirst && (
            <ListChecks
              className="size-3 shrink-0 text-brass"
              aria-label="Planeja antes ligado"
            />
          )}
          {identityLocked && <Lock className="size-3 shrink-0 opacity-70" />}
          <ChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform",
              panelOpen && "rotate-180",
            )}
          />
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <ContextRing />
        </div>
      </div>

      {/* Aviso honesto: o gate é fixo no spawn. Trocar com turno em voo vale só
          no próximo — sem esta linha o painel pareceria agir agora. */}
      {running && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Turno em andamento: a permissão vale a partir do próximo envio.
        </p>
      )}
      {/* O modo é do projeto, mas quem obedece é a CLI da conversa — e elas
          divergem (o agy não tem canal de aprovação nenhum). */}
      {note && (
        <p
          className={cn(
            "text-[11px] leading-snug",
            note.tone === "warn" ? "text-st-warning/90" : "text-muted-foreground",
          )}
        >
          {note.text}
        </p>
      )}

      {/* O painel INTEIRO, revelado sob demanda (sem portal — ver cabeçalho do
          arquivo). Três blocos, na ordem de consequência: permissão (o que
          decide se o agente executa sozinho), planejar antes (modificador do
          próximo turno), identidade (quem roda). */}
      {panelOpen && (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <div
            role="radiogroup"
            aria-label="Permissões do projeto"
            onKeyDown={onKey}
            className="flex flex-col gap-0.5"
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
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                    on && m === "liberado"
                      ? "border-transparent bg-st-warning/15 text-st-warning"
                      : on
                        ? SELECTED_FILL
                        : UNSELECTED,
                  )}
                >
                  <span className="flex flex-col gap-0">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium">
                      {m === "liberado" && <TriangleAlert className="size-3 shrink-0" />}
                      {PERMISSION_LABEL[m]}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        on && m === "liberado"
                          ? "text-st-warning/80"
                          : "text-muted-foreground/70",
                      )}
                    >
                      {PERMISSION_DESCRIPTION[m]}
                    </span>
                  </span>
                  {on && <Check className="size-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>

          <div className="my-1 border-t border-border/60" />

          <label className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
            <span className="flex flex-col gap-0">
              <span className="text-[12px] font-medium text-foreground">
                {PLAN_FIRST_LABEL}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                {PLAN_FIRST_DESCRIPTION}
              </span>
            </span>
            <Switch
              checked={!!planFirst}
              onCheckedChange={() => onTogglePlanFirst?.()}
              aria-label={PLAN_FIRST_LABEL}
            />
          </label>

          <div className="my-1 border-t border-border/60" />

          {/* Resumo textual (some quando os seletores crus já dizem tudo) +
              os seletores em si — os mesmos de sempre, só revelados aqui em
              vez de atrás do próprio chevron que existia só pra eles. Travado,
              o porquê fica visível em vez de só no hover do cadeado — o mesmo
              texto que o chip colapsado do composer já usa como `title`
              (`ComposerParts.tsx`), repetido aqui de propósito: são duas
              superfícies diferentes lendo o mesmo fato, não uma fonte só. */}
          <p className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground/70">
            {identityLocked && <Lock className="size-3 shrink-0 opacity-70" />}
            {identityLocked
              ? "Agent e modelo ficam fixos a partir do 1º envio desta conversa"
              : identityLabel}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 px-2">
            {identity}
          </div>
        </div>
      )}
    </div>
  )
}
