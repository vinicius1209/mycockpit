import { cn } from "@/lib/utils"

/** O trecho que não pode passar pelo parser (ADR-210): sai inteiro, na ordem,
 *  só sem formatação. Nada de paginar: a pessoa precisa ler o resultado do
 *  começo ao fim, e um `<pre>` grande custa layout, não parse (143 KB numa
 *  linha = 29 ms medidos no Chromium). */
export function TextoCru({
  texto,
  aviso,
  limitarAltura = true,
}: {
  texto: string
  aviso: string
  /** Trecho pesado no meio da mensagem ganha rolagem própria para não empurrar
   *  o resto do fio; mensagem inteira em modo cru sai sem teto. */
  limitarAltura?: boolean
}) {
  return (
    <div data-plain-text className="min-w-0 space-y-1">
      <p className="text-[12px] text-muted-foreground">{aviso}</p>
      <pre
        data-selectable
        className={cn(
          "overflow-auto font-mono text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]",
          limitarAltura && "max-h-96",
        )}
      >
        {texto}
      </pre>
    </div>
  )
}
