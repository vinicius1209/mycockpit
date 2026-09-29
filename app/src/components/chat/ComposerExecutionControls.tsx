// A PORTA da identidade (agent/modelo/esforço) no rodapé do composer.
//
// Aqui moravam também a PERMISSÃO e o toggle "Planejar primeiro" (ADR-051).
// Os dois saíram no M2 dos modos de sessão: viraram UM controle
// (`ModeSelect.tsx`), porque nunca foram dois eixos — o `adapters.rs` já
// substituía o `--permission-mode` no turno de plano, com um braço vazio no
// match só pra isso.
//
// Extraído de ComposerParts.tsx pela catraca de tamanho, e o nome do arquivo
// ficou: renomear obrigaria a mexer nos call sites por estética.

import { useEffect, useRef, useState } from "react"
import { ArrowRightLeft, ChevronDown } from "lucide-react"
import { AgentLogo } from "@/components/common/AgentLogo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** A porta pra agent/modelo/esforço (e preset, quando existe): logo e NOME do
 *  motor, à direita, perto do enviar (ADR-282). Modelo e esforço ficam no
 *  `title` e no seletor: a linha de baixo só diz quem responde, e o cadeado
 *  saiu para a dica ("trocar vira revezamento"). Clique revela um cartão ANCORADO no botão, sem
 *  portal: `IdentityPicker` usa `cmdk` (não Radix `Select`), então não briga
 *  por foco dentro de outro popover — o mesmo motivo que ADR-049 documentou
 *  pra identidade nunca ter ficado atrás de um `DropdownMenu`/`Popover`
 *  continua valendo, só que agora o filho É um cartão flutuante de verdade
 *  (antes eram seletores soltos no fluxo normal do DOM, que não precisavam de
 *  contexto de posicionamento próprio). Fecha-fora/Esc copiado de
 *  `ContextRing.tsx`, mesma linha do rodapé. */
export function IdentityDoor({
  label,
  agent,
  detalhe,
  locked,
  staged,
  children,
}: {
  /** O nome do motor ("Claude Code"). */
  label: string
  /** Id do motor, para o logo. Sem ele, só o nome. */
  agent?: string
  /** Motor · modelo · esforço, para a dica. */
  detalhe?: string
  locked?: boolean
  staged?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    // `data-foco-proprio`: o cartão do composer foca o editor em qualquer clique
    // dentro dele, e este painel mora dentro do cartão. Sem a marca, o campo de
    // busca do seletor nunca segurava o cursor (ver `ComposerShell`).
    <div ref={wrapRef} data-foco-proprio data-cede className="relative min-w-0">
      <Button
        variant="ghost"
        size="padrao"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          staged
            ? "Revezamento preparado para o próximo envio"
            : [detalhe ?? label, locked ? "trocar de motor vira revezamento, com sessão nova" : null]
                .filter(Boolean)
                .join(" · ")
        }
        className={cn(
          "h-8 max-w-full min-w-0 gap-1.5 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          staged && "text-foreground",
        )}
      >
        {agent && <AgentLogo agent={agent} className="size-4 shrink-0" />}
        <span className="max-w-[220px] min-w-0 truncate">{label}</span>
        {staged && <ArrowRightLeft className="size-3 shrink-0 text-muted-foreground" />}
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")}
        />
      </Button>
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-pop)]">
          {children}
        </div>
      )}
    </div>
  )
}

/** "Planejar primeiro": rótulo VISÍVEL de propósito, não só ícone com tooltip
 *  no hover. É o único controle do rodapé cuja frequência de uso é
 *  DESCONHECIDA (nenhuma telemetria grava toggle — furo §7.1 do plano do
 *  colapso, docs/mocks/composer-README.md); esconder atrás de hover reduziria
 *  a descoberta de um controle que já não temos dado nenhum sobre. */
