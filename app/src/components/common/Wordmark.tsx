import { cn } from "@/lib/utils"

/** Marca "instrumento": um retículo de cockpit. Centro + cruz em brass. */
export function Reticle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={cn("text-foreground", className)}
      aria-hidden="true"
    >
      <rect
        x="0.75"
        y="0.75"
        width="18.5"
        height="18.5"
        rx="5.5"
        stroke="currentColor"
        strokeOpacity="0.22"
      />
      <circle
        cx="10"
        cy="10"
        r="4.6"
        stroke="currentColor"
        strokeOpacity="0.4"
      />
      <path
        d="M10 1.6V5M10 15v3.4M1.6 10H5M15 10h3.4"
        className="stroke-brass"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="1.7" className="fill-brass" />
    </svg>
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
