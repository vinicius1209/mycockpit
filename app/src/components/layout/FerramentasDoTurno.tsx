// "Ferramentas deste turno" na aba "O que o agente vê" (ADR-239, mock aprovado
// em docs/mocks/capacidades-do-turno.html): o inventário que antes a faixa
// "Capacidades deste run" despejava acima do composer em todo turno.
//
// Uma linha por fonte, com a contagem e quem controla, em palavras. Os nomes
// das ferramentas só abrem por fonte. O que ficou fora aparece como "fora", com
// o motivo. E a superfície opaca do motor NUNCA vira lista vazia segura: se ele
// pode ter recursos que a Frota não enumerou, a aba diz.

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { MOTIVO_DA_OMISSAO } from "@/lib/excecoesDoTurno"
import { resourceKindLabel, resourceOwnerLabel } from "@/lib/resources"
import type { EffectiveRunManifest, EffectiveToolSource } from "@/lib/tooling"
import { cn } from "@/lib/utils"

/** Título da fonte: a nativa leva o nome do motor. Puro. */
export function tituloDaFonte(fonte: EffectiveToolSource, motor: string): string {
  return fonte.kind === "provider-native" ? `Do próprio ${motor}` : fonte.label
}

/** Quem controla, em palavras. Puro. */
export function quemControla(fonte: EffectiveToolSource): string {
  const controle = fonte.enforceability === "hard" ? "a Frota controla" : "o motor decide como usar"
  return fonte.kind === "external-mcp" ? `MCP que você ligou · ${controle}` : controle
}

/** A contagem, sem inventar zero: desconhecido é dito como desconhecido. */
export function contagemDaFonte(fonte: EffectiveToolSource): string {
  if (fonte.observedCount != null) return String(fonte.observedCount)
  return fonte.inventory === "runtime-count" ? "aguardando" : "não observado"
}

export function FerramentasDoTurno({
  manifest,
  motor,
}: {
  manifest: EffectiveRunManifest | undefined
  motor: string
}) {
  const [aberta, setAberta] = useState<string | null>(null)
  if (!manifest) {
    return (
      <p className="text-[12px] leading-snug text-muted-foreground/70">
        Aparece depois do primeiro envio desta conversa: é o que o motor recebeu de fato.
      </p>
    )
  }
  const total = manifest.sources.reduce((soma, f) => soma + (f.observedCount ?? 0), 0)
  const instrucoes = manifest.instructions ?? []
  return (
    <div className="flex flex-col gap-0.5">
      <p className="-mt-1 mb-1.5 text-[11px] leading-snug text-muted-foreground/70">
        O que o motor recebeu de fato no último envio{total > 0 ? `. ${total} ao todo.` : "."}
      </p>
      {manifest.sources.map((fonte) => {
        const temNomes = fonte.toolNames.length > 0
        const estaAberta = aberta === fonte.id
        return (
          <div key={fonte.id} className={cn("rounded-md px-2.5 py-1.5", estaAberta && "bg-accent/40")}>
            <button
              type="button"
              disabled={!temNomes}
              onClick={() => setAberta(estaAberta ? null : fonte.id)}
              aria-expanded={temNomes ? estaAberta : undefined}
              className="flex w-full items-center gap-2 text-left disabled:cursor-default"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
                {tituloDaFonte(fonte, motor)}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {contagemDaFonte(fonte)}
              </span>
              {temNomes && (
                <ChevronDown
                  className={cn("size-3 text-muted-foreground transition-transform", estaAberta && "rotate-180")}
                />
              )}
            </button>
            <p className="text-[11px] text-muted-foreground/70">{quemControla(fonte)}</p>
            {estaAberta && (
              <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {fonte.toolNames.join(" · ")}
              </p>
            )}
          </div>
        )
      })}
      {instrucoes.map((instrucao) => (
        <div key={instrucao.id} className="rounded-md px-2.5 py-1.5">
          <p className="truncate text-[13px] text-foreground/90">{instrucao.label}</p>
          <p className="text-[11px] text-muted-foreground/70">instrução de plugin · a Frota controla</p>
        </div>
      ))}
      {manifest.resources.map((recurso) => (
        <div key={recurso.id} className="rounded-md px-2.5 py-1.5">
          <p className="truncate text-[13px] text-foreground/90">{resourceKindLabel(recurso.kind)}</p>
          <p className="text-[11px] text-muted-foreground/70">
            via {recurso.via} · {resourceOwnerLabel(recurso.owner)} ·{" "}
            {recurso.state === "blocked" ? "bloqueado" : "pronto"}
          </p>
        </div>
      ))}
      {(manifest.omissions ?? []).map((o) => (
        <div key={`${o.sourceId}:${o.code}`} className="rounded-md px-2.5 py-1.5">
          <p className="truncate text-[13px] text-muted-foreground">
            {o.sourceLabel} <span className="font-mono text-[11px]">· fora</span>
          </p>
          <p className="text-[11px] text-muted-foreground/70">{MOTIVO_DA_OMISSAO[o.code]}</p>
        </div>
      ))}
      {manifest.notices.map((aviso) => (
        <p key={aviso} className="px-2.5 py-1 text-[11px] leading-snug text-muted-foreground/70">
          {aviso}
        </p>
      ))}
      {manifest.unobservedResources && !manifest.externalBrowserMcps?.length && (
        <p className="px-2.5 py-1 text-[11px] leading-snug text-muted-foreground/70">
          O {motor} pode ter recursos próprios, pela configuração dele, que a Frota não enumerou nem filtrou.
        </p>
      )}
    </div>
  )
}
