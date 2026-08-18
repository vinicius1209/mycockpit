// PERMISSÃO e "PLANEJAR PRIMEIRO" — os dois controles de COMO o próximo turno
// roda, sempre visíveis no rodapé do composer (mockup de referência, Paseo.sh
// — decisão registrada em ADR-051; reverte o colapso atrás de um letreiro só
// que a ADR-049 tinha medido e implementado).
//
// Extraído de ComposerParts.tsx só pela catraca de tamanho (o arquivo passou
// do teto de 700 quando esses dois controles entraram nele) — DIVIDA O
// ARQUIVO, não sobe o teto.

import { useState } from "react"
import { ChevronDown, Eye, ListChecks, Lock, MessageSquareCode, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PERMISSION_DESCRIPTION, PERMISSION_LABEL } from "@/lib/permission"
import type { PermissionMode } from "@/lib/types"
import { cn } from "@/lib/utils"

const MODES: PermissionMode[] = ["leitura", "padrao", "liberado"]

function permissionIcon(mode: PermissionMode) {
  if (mode === "liberado") return ShieldAlert
  if (mode === "padrao") return MessageSquareCode
  return Eye
}

export function PermissionSelect({
  value,
  onValueChange,
  disabled,
}: {
  value: PermissionMode
  onValueChange: (mode: PermissionMode) => void
  disabled?: boolean
}) {
  const Icon = permissionIcon(value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2.5 text-[12px] font-medium transition-colors",
            value === "liberado"
              ? "bg-st-warning/15 text-st-warning hover:bg-st-warning/25 hover:text-st-warning"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          title="Permissões do projeto"
          aria-label="Permissões do projeto"
        >
          <Icon className="size-3.5 shrink-0" />
          <span>{PERMISSION_LABEL[value]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-1.5">
        <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Permissões do Projeto
        </div>
        <DropdownMenuSeparator className="my-1" />
        {/* `DropdownMenuRadioGroup`/`Item` de verdade (Radix), não `role="radio"`
            forçado numa `DropdownMenuItem` comum: o menu do Radix já gerencia
            foco/teclado por semântica de radiogroup quando o primitive é este —
            forçar o papel por fora deixa ARIA e comportamento divergindo. O
            indicador padrão (pl-8 + bolinha) é trocado pelo ícone do modo, que
            já cumpre esse papel visualmente. */}
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onValueChange(v as PermissionMode)}
        >
          {MODES.map((m) => {
            const active = m === value
            const MIcon = permissionIcon(m)
            return (
              <DropdownMenuRadioItem
                key={m}
                value={m}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md p-2 pl-2 text-left [&>span:first-child]:hidden",
                  active
                    ? m === "liberado"
                      ? "bg-st-warning/15 text-st-warning focus:bg-st-warning/20 focus:text-st-warning"
                      : "bg-accent text-foreground focus:bg-accent focus:text-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <MIcon className="size-3.5" />
                  {PERMISSION_LABEL[m]}
                </div>
                <div
                  className={cn(
                    "text-[11px]",
                    active && m === "liberado"
                      ? "text-st-warning/80"
                      : "text-muted-foreground",
                  )}
                >
                  {PERMISSION_DESCRIPTION[m]}
                </div>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A porta pra agent/modelo/esforço (e preset, quando existe): UMA pílula de
 *  TEXTO puro (`resumoDaIdentidade`, sem "(alias)" — usa o `pill` curto, não o
 *  `label` de menu), sem ícone de fornecedor (você já está DENTRO da
 *  conversa; o ícone era redundância decorativa que só competia com o pixel
 *  que decide, a permissão). Clique revela os seletores crus INLINE, sem
 *  portal: `IdentityControls` usa `Select` do Radix (via `RichSelect`), e
 *  Select dentro de `DropdownMenu`/`Popover` briga por foco — o mesmo motivo
 *  que já tinha tirado a identidade de trás de um popover na ADR-049. */
export function IdentityDoor({
  label,
  locked,
  children,
}: {
  label: string
  locked?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Agent, modelo e esforço"
        className="h-8 gap-1.5 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span className="max-w-[220px] truncate">{label}</span>
        {locked && <Lock className="size-3 shrink-0 opacity-70" />}
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {open && children}
    </>
  )
}

/** "Planejar primeiro": rótulo VISÍVEL de propósito, não só ícone com tooltip
 *  no hover. É o único controle do rodapé cuja frequência de uso é
 *  DESCONHECIDA (nenhuma telemetria grava toggle — furo §7.1 do plano do
 *  colapso, docs/mocks/composer-README.md); esconder atrás de hover reduziria
 *  a descoberta de um controle que já não temos dado nenhum sobre. */
export function PlanFirstToggle({
  active,
  onToggle,
}: {
  active?: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      aria-pressed={!!active}
      aria-label="Planejar primeiro"
      title="Planejar primeiro: o agent propõe um plano e só executa depois da sua aprovação"
      className={cn(
        "h-8 gap-1.5 px-2.5 text-[12px] font-medium transition-colors",
        active
          ? "bg-brass/10 text-brass hover:bg-brass/20 hover:text-brass"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <ListChecks className="size-3.5 shrink-0" />
      <span>Planejar</span>
    </Button>
  )
}
