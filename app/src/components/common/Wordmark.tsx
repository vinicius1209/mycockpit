import { cn } from "@/lib/utils"
import appIcon from "@/assets/app-icon.png"

/** Marca do app: o ícone horizonte (instrumento de cockpit), renderizado como
 *  imagem arredondada. Unifica titlebar, empty state e onboarding num só lugar. */
export function Reticle({ className }: { className?: string }) {
  return (
    <img
      src={appIcon}
      alt=""
      aria-hidden="true"
      className={cn("rounded-[26%] object-contain select-none", className)}
    />
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <Reticle className="size-[18px]" />
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
        MyCockpit
      </span>
    </div>
  )
}
