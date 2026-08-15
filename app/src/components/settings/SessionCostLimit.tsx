// Teto de gasto POR SESSÃO em US$ — bloco da seção "Uso e custo".
//
// Por que isto existe: o custo da sessão (topo do fio) é um MEDIDOR, e medidor
// saudável é cinza (STYLEGUIDE §2). Percentual tem teto natural, dólar não —
// então não existe valor em que NÓS possamos pintar o número de vermelho sem
// opinar. Quem sabe quanto é caro é o usuário. Enquanto ele não disser, o
// número fica cinza; assim que disser, o custo vira percentual DESSE teto e
// entra na régua única (`absoluteTone` em lib/meter).
//
// Não é um freio: nada é bloqueado nem interrompido. É só a régua da cor.

import { useEffect, useState } from "react"
import { BlockTitle, Note } from "@/components/settings/parts"
import { useApp } from "@/store/app"

/** Texto digitado → US$ (aceita vírgula do pt-BR). null = sem teto. */
export function parseLimit(raw: string): number | null {
  const t = raw.trim().replace(",", ".")
  if (t === "") return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** US$ → o que aparece no campo (vírgula decimal). null/0 = campo vazio. */
export function limitToInput(limit: number | null): string {
  if (limit == null || limit <= 0) return ""
  return String(limit).replace(".", ",")
}

export function SessionCostLimit() {
  const limit = useApp((s) => s.settings.sessionCostLimit)
  const setSettings = useApp((s) => s.setSettings)
  const [raw, setRaw] = useState(() => limitToInput(limit))

  // o campo segue o estado salvo quando ele muda por fora (outra janela, reset).
  useEffect(() => {
    setRaw(limitToInput(limit))
  }, [limit])

  function commit(next: string) {
    const parsed = parseLimit(next)
    setSettings({ sessionCostLimit: parsed })
    setRaw(limitToInput(parsed))
  }

  return (
    <div>
      <BlockTitle hint="A partir de quanto o custo da sessão para de ser só informação. Sem teto ele fica cinza: não temos como saber se US$ 5 é caro pra você.">
        Teto por sessão
      </BlockTitle>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[13px] text-foreground">Avisar a partir de</div>
          <div className="text-[12px] leading-snug text-muted-foreground">
            {limit
              ? "O número no topo da conversa fica âmbar em 60% do teto e vermelho em 80%."
              : "Vazio = sem teto, o número fica cinza sempre."}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[13px] text-muted-foreground">US$</span>
          <input
            type="text"
            inputMode="decimal"
            value={raw}
            placeholder="sem teto"
            aria-label="Teto de custo por sessão em dólares"
            onChange={(e) => setRaw(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
              if (e.key === "Escape") setRaw(limitToInput(limit))
            }}
            className="h-8 w-24 rounded-md border border-border bg-secondary/40 px-2 text-right font-mono text-[13px] tabular-nums text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <Note>
        O teto muda só a COR do custo, nada é bloqueado nem interrompido.
      </Note>
    </div>
  )
}
