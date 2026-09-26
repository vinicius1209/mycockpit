// O CORPO de um aviso (ADR-261, mock `docs/mocks/avisos.html`): a primeira
// linha diz DE QUEM é (o quadradinho da cor do projeto, o projeto e, quando
// houver, a conversa), depois o fato e no máximo uma linha de detalhe.
//
// Visto em 25/09/2026: "Navegador do projeto ligado", mas qual projeto? O
// toast não dizia de onde vinha. Aqui a origem é a primeira coisa que se lê.

import { cn } from "@/lib/utils"

export interface IdentidadeDoAviso {
  projeto: string
  cor: string | null
  conversa: string | null
}

export function CorpoDoAviso({
  identidade,
  erro = false,
  texto,
  detalhe,
}: {
  identidade: IdentidadeDoAviso | null
  /** Só marca (`data-aviso`): o ícone de alerta vem do `toast.error`. */
  erro?: boolean
  texto: string
  detalhe?: string | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-aviso={erro ? "erro" : "aviso"}>
      {identidade && (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-[2px]", !identidade.cor && "bg-muted-foreground/50")}
            style={identidade.cor ? { background: identidade.cor } : undefined}
          />
          <span className="truncate">
            {identidade.projeto}
            {identidade.conversa && (
              <>
                <span className="mx-1 opacity-50">·</span>
                {identidade.conversa}
              </>
            )}
          </span>
        </span>
      )}
      <span className="text-[13px] leading-snug font-medium text-foreground">{texto}</span>
      {detalhe && <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{detalhe}</span>}
    </div>
  )
}
