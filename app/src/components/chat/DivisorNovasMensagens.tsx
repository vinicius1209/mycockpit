/** O divisor "novas mensagens" (unseen-divider-plan D1). É a ÚNICA peça do fio
 *  que se desenha ao abrir uma conversa (ADR-179): ele nasce com a visita e é a
 *  notícia dela, enquanto todo o resto chega pronto. Os filetes riscam do
 *  centro para fora e o rótulo acende logo depois. Com movimento reduzido tudo
 *  aparece desenhado de uma vez. */
export function DivisorNovasMensagens() {
  return (
    <div role="separator" aria-label="novas mensagens" className="flex items-center gap-3">
      <span className="fio-risca h-px flex-1 origin-right bg-st-warning/40" />
      <span className="fio-nasce text-[11px] font-medium tracking-wide text-st-warning/90 uppercase [animation-delay:160ms]">
        novas mensagens
      </span>
      <span className="fio-risca h-px flex-1 origin-left bg-st-warning/40" />
    </div>
  )
}
