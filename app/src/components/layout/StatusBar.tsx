// <StatusBar> — a faixa de 24px do rodapé da janela. AMBIENTE, e só.
//
// Regra de ocupação (pura e testada em lib/statusBar): entra o que é verdade
// permanente enquanto você trabalha — janela do plano, custo da sessão, build
// em execução. NÃO entra o agora do turno: a linha viva é dona do agora e mora
// no composer (§6 do STYLEGUIDE, "dono único do agora"; dois relógios narrando
// o mesmo agora foi o bug dos builds 181/182).
//
// Anatomia decidida:
//   SEM hairline e SEM fundo próprio: a faixa É o piso da janela (ADR-043,
//   Fase 3). Hairline de largura total só termina em aresta reta, e a janela
//   do macOS é arredondada (raio real 10px, o mesmo que a moldura de risco
//   teve que aprender em lib/climate.ts) — a borda morria no meio do arco, o
//   retângulo de fundo era decepado, e o olho lia "recorte", não "moldura".
//   Quem separa agora é o inset de 8px do conteúdo, que deixa 8px de rail
//   visível acima da faixa.
//   `px-4` (16px ≥ raio 10px): o conteúdo começa DEPOIS do arco. Era px-3, e
//   a UsagePill entrava em cima da curva.
//   altura FIXA de 24px (h-6), nunca cresce com o conteúdo.
//   `select-none` — é instrumento, não texto pra copiar.
//   zona vazia não desenha NADA: sem divisor órfão, sem placeholder. Cada item
//   se esconde sozinho, e o que sobra é fundo.
//   11px mono, `tabular-nums`, cinza. Tom só sobe por régua do §2.

import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { UsagePill } from "@/components/layout/UsagePill"
import { METER_TEXT } from "@/lib/meter"
import { statusBuildItem, statusCostItem, type StatusItem } from "@/lib/statusBar"
import { sessionCost, useActiveConv } from "@/store/chat"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/** Um item de telemetria: etiqueta em sussurro + valor tabular. */
function Item({ item }: { item: StatusItem }) {
  return (
    <span
      className="flex items-center gap-1 whitespace-nowrap"
      title={item.title}
    >
      {item.label && (
        <span className="text-muted-foreground/70">{item.label}</span>
      )}
      <span className={cn("tabular-nums", METER_TEXT[item.tone])}>
        {item.text}
      </span>
    </span>
  )
}

function SessionCostItem() {
  const conv = useActiveConv()
  const limit = useApp((s) => s.settings.sessionCostLimit)
  const item = statusCostItem(sessionCost(conv.items), limit)
  if (!item) return null
  return <Item item={item} />
}

function BuildItem() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {}) // browser (vite dev): sem versão, fica "local"
  }, [])
  return <Item item={statusBuildItem(version)} />
}

export function StatusBar() {
  return (
    <footer
      // `role="status"` seria promessa de anúncio a cada mudança: aqui os
      // números mudam sozinhos o tempo todo e o leitor de tela viraria uma
      // metralhadora. É região complementar, alcançável, nunca anunciada.
      role="complementary"
      aria-label="Telemetria do app"
      // `pb-2` + `px-4` = a faixa também respeita o inset de 8px da janela.
      // Ela era o ÚNICO elemento encostado na borda (medido no build 207: folga
      // zero embaixo, enquanto todo o resto flutuava 8px pra dentro), e os 10px
      // de baixo dela caíam dentro do arco do canto do macOS. Daí o "parece
      // cortada" que sobreviveu à Fase 3: não era impressão, era a faixa
      // ocupando justamente a parte que o sistema recorta.
      // O `px-4` (16px) alinha o texto com o CONTEÚDO dos cartões, não com a
      // borda deles (8px): o que tem que bater é texto com texto.
      className="mb-2 flex h-6 shrink-0 items-center gap-3 px-4 font-mono text-[11px] text-muted-foreground select-none"
    >
      {/* ESQUERDA — telemetria. Cada peça some sozinha sem dado (a pill já tem
          as 4 camadas de esconder; o custo exige ≥2 turnos e gasto real). */}
      <UsagePill compact />
      <SessionCostItem />

      {/* DIREITA — só dado que já existia. Hoje: o build em execução, herdado
          do rodapé da sidebar (lá ele sumia junto com a sidebar fechada).
          Branch/alterações NÃO entra nesta passada: o diff é carregado por
          efeito local do ContextPanel/DiffPanel e não há fonte compartilhada;
          criar uma segunda leitura de git pra encher a faixa daria dois donos
          pro mesmo número. */}
      <div className="ml-auto flex items-center gap-3">
        <BuildItem />
      </div>
    </footer>
  )
}
