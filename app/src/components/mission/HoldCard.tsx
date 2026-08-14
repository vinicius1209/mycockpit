// A missão SEGURANDO (R7): ou você pediu, ou você interrompeu a fase. Nos dois
// casos nada roda agora e a próxima só começa por gesto seu. Âmbar, como o
// gate, porque é exatamente isso: precisa de você.
//
// O preço de parar vem do ESTADO (ele escala com o plano), nunca escrito à mão.

export function HoldCard({
  reason,
  phaseNumber,
  nextLabel,
  price,
  onRelease,
}: {
  reason: "pedido" | "interrompida"
  phaseNumber: number
  /** Rótulo da próxima fase; null no fim do plano. */
  nextLabel: string | null
  price: string
  onRelease: () => void
}) {
  const interrompida = reason === "interrompida"
  return (
    <div className="relative mb-4">
      <span className="absolute top-[11px] -left-[28px] z-[1] size-3.5 rounded-full border-2 border-st-warning bg-st-warning" />
      <div className="rounded-[9px] border border-st-warning/45 bg-st-warning/[0.06] px-3 py-2.5">
        <div className="text-[13px] font-semibold text-st-warning">
          {interrompida
            ? `Fase ${phaseNumber} interrompida por você`
            : `Segurando no fim da fase ${phaseNumber}`}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {interrompida
            ? "O processo morreu. O que ela escreveu continua no worktree, e a fase ficou incompleta."
            : "A fase terminou normal. A próxima não começa sem você."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRelease}
            className="rounded-md bg-brass px-3 py-1 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            Continuar para {nextLabel ?? "o fim"}
          </button>
          {/* o preço de parar, ao lado do gesto de seguir: quem para aqui
              precisa saber o que perde ANTES de clicar no vermelho */}
          <span className="text-[11px] text-faint">{price}</span>
        </div>
      </div>
    </div>
  )
}
