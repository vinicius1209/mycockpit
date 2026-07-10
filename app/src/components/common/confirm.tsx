import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/lib/confirm"

/** Host único (montar 1x no root). Renderiza o modal do confirm corrente.
 *  A API imperativa vive em @/lib/confirm — `await confirm({...})`. */
export function ConfirmHost() {
  const req = useConfirm((s) => s.req)
  const close = useConfirm((s) => s.close)
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => {
        if (!o) close(false)
      }}
    >
      <DialogContent className="sm:max-w-sm">
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
            autoFocus
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
