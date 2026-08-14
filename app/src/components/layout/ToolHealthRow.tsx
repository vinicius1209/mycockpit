import { Download, LogIn, X } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import type { ToolHealthItem } from "@/lib/toolHealth"
import { cn } from "@/lib/utils"

/** Uma linha de SAÚDE DE FERRAMENTA (CLI sem login / com update) do sino.
 *
 *  Mora fora do `InboxBell.tsx` porque aquele arquivo passou do teto de
 *  tamanho e esta linha é folha: só recebe o item já decidido por
 *  `lib/toolHealth` e dois callbacks.
 *
 *  Tom, pela tabela do STYLEGUIDE §2: "sem login" é âmbar (precisa de você,
 *  bloqueia o envio); "atualização disponível" é CINZA (informação, nada
 *  quebrou). É a hierarquia da lista virando pixel, não só ordem.
 *
 *  Ação: as duas abrem Configurações ▸ Agentes na máquina, que é onde os gestos
 *  JÁ existem ("Verificar agora" depois de logar pelo terminal da CLI, e o
 *  "Atualizar" que dispara o job). O botão de update não foi duplicado aqui de
 *  propósito: ele carrega estado que esta linha não tem como mostrar (spinner
 *  do job vivo, travar enquanto outro job roda, o aviso de N instalações no
 *  PATH), e o dropdown fecha no clique. Um dono só pro gesto. */
export function ToolHealthRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: ToolHealthItem
  onOpen: () => void
  /** Só o update é dispensável (impedimento não se dispensa). */
  onDismiss?: () => void
}) {
  const isAuth = item.kind === "auth"
  return (
    <DropdownMenuItem
      onSelect={onOpen}
      className="flex-col items-start gap-0.5 py-2"
    >
      <span
        className={cn(
          "group/tool flex w-full items-center gap-2 text-[13px]",
          isAuth ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {isAuth ? (
          <LogIn className="size-3.5 shrink-0 text-st-warning" />
        ) : (
          <Download className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {isAuth
            ? `${item.label} sem login`
            : `Atualização do ${item.label} disponível`}
        </span>
        {onDismiss && (
          <button
            onClick={(e) => {
              // dispensa SEM navegar (a linha some na hora).
              e.stopPropagation()
              e.preventDefault()
              onDismiss()
            }}
            title="Dispensar esta versão"
            aria-label="Dispensar esta versão"
            className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors group-hover/tool:block hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </span>
      <span className="w-full truncate pl-[22px] text-[11px] text-muted-foreground">
        {isAuth
          ? "Bloqueia o envio. Entre pela CLI no terminal, depois Verificar agora."
          : `v${item.current ?? "?"} → v${item.latest ?? "?"} · Atualizar em Configurações ▸ Agentes na máquina`}
      </span>
    </DropdownMenuItem>
  )
}
