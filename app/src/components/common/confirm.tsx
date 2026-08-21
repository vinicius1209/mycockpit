import { useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { enterConfirma, useConfirm } from "@/lib/confirm"

/** Host único (montar 1x no root). Renderiza o modal do confirm corrente.
 *  A API imperativa vive em @/lib/confirm — `await confirm({...})`. */
export function ConfirmHost() {
  const req = useConfirm((s) => s.req)
  const close = useConfirm((s) => s.close)
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => {
        if (!o) close(false)
      }}
    >
      <DialogContent
        ref={contentRef}
        className="sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          // Radix foca o primeiro controle ao abrir. Num confirm isso fazia o
          // anel âmbar parecer uma seleção antes de qualquer gesto do usuário.
          // Mantemos o foco DENTRO do modal, mas no próprio conteúdo (outline
          // neutro); Tab continua revelando o foco normal dos botões.
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
        onKeyDown={(event) => {
          // Esc já é do Radix; Enter volta a ser nosso (a regra e o porquê
          // moram em `enterConfirma`, que é testável sem DOM).
          if (!enterConfirma(event)) return
          event.preventDefault()
          close(true)
        }}
      >
        <DialogHeader>
          <DialogTitle>{req?.title}</DialogTitle>
          {req?.description && (
            <DialogDescription>{req.description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {req?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            variant={req?.danger ? "destructive" : "default"}
            onClick={() => close(true)}
          >
            {req?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
