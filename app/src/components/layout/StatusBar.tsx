// <StatusBar> — a faixa de 24px do rodapé da janela. AMBIENTE, e só.
//
// Regra de ocupação (pura e testada em lib/statusBar): entra o que é verdade
// permanente enquanto você trabalha — os planos de todos os motores, o gasto
// de hoje e desta conversa, a máquina (memória e CPU, ADR-262), o build em
// execução. NÃO entra o agora do turno: a linha viva é dona do agora e mora
// no composer (§6 do STYLEGUIDE, "dono único do agora"; dois relógios narrando
// o mesmo agora foi o bug dos builds 181/182).
//
// Anatomia decidida:
//   SEM hairline e SEM fundo próprio: a faixa É o piso da janela (ADR-043,
//   Fase 3). Hairline de largura total só termina em aresta reta, e a janela
//   do macOS é arredondada (raio real 10px, titleBarStyle Overlay) — a borda
//   morria no meio do arco, o retângulo de fundo era decepado, e o olho lia
//   "recorte", não "moldura".
//   Quem separa agora é o inset de 8px do conteúdo, que deixa 8px de rail
//   visível acima da faixa.
//   `px-4` (16px ≥ raio 10px): o conteúdo começa DEPOIS do arco. Era px-3, e
//   a UsagePill entrava em cima da curva.
//   altura FIXA de 24px (h-6), nunca cresce com o conteúdo.
//   `select-none` — é instrumento, não texto pra copiar.
//   zona vazia não desenha NADA: sem divisor órfão, sem placeholder. Cada item
//   se esconde sozinho, e o que sobra é fundo.
//   11px mono, `tabular-nums`, cinza. Tom só sobe por régua do §2.

import { useCallback, useEffect, useState } from "react"
import { UsagePill } from "@/components/layout/UsagePill"
import { METER_TEXT } from "@/lib/meter"
import {
  statusProcessosItem,
  statusUpdateItem,
  statusWorktreeItem,
  type StatusItem,
} from "@/lib/statusBar"
import { ProcessosPopover } from "@/components/layout/ProcessosPopover"
import {
  listarProcessos,
  resumirProcessos,
  type ProcessoDeMotor,
} from "@/lib/processos"
import { GastoDaFaixa } from "@/components/layout/GastoDaFaixa"
import { MaquinaDaFaixa } from "@/components/layout/MaquinaDaFaixa"
import { VersaoDaFaixa } from "@/components/layout/VersaoDaFaixa"
import { DivisorDaFaixa, GatilhoDaFaixa } from "@/components/layout/statusBarChrome"
import { labelOf, useUpdates } from "@/lib/updates"
import { looseWorktrees } from "@/lib/worktrees"
import { WorktreesPainel } from "@/components/layout/WorktreesPainel"
import { useChat } from "@/store/chat"
import { useWorktrees } from "@/store/worktrees"
import { useActiveProject } from "@/store/app"
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

function UpdateItem() {
  const byAgent = useUpdates((s) => s.byAgent)
  const running = Object.values(byAgent)
    .filter((j) => j.status === "running")
    .map((j) => labelOf(j.agent))
  const item = statusUpdateItem(running)
  if (!item) return null
  return <Item item={item} />
}

/**
 * Worktrees soltos do projeto ATIVO. Constata na faixa, detalha no diálogo.
 *
 * Lê a store (dono único do git aqui) e cruza com os `worktreePath` de TODAS as
 * conversas — inclusive de outros projetos, porque uma conversa de qualquer
 * projeto apontando pra aquela pasta ainda é alguém usando.
 *
 * `refresh` roda na troca de projeto e mais nada: worktree solto não muda
 * sozinho. Um poll gastaria processo de git pra confirmar um número parado.
 */
function WorktreeItem() {
  const [open, setOpen] = useState(false)
  const project = useActiveProject()
  const entries = useWorktrees((s) => (project ? s.byProject[project.id] : undefined))
  const refresh = useWorktrees((s) => s.refresh)
  // Objeto CRU no seletor: derivar a lista aqui dentro criaria array novo a
  // cada render e o zustand re-renderizaria em laço.
  const porProjeto = useChat((s) => s.conversationsByProject)

  // Dependência nos CAMPOS, não no objeto: `useActiveProject` devolve o item
  // do array de projetos, que é recriado a cada mexida em Configurações —
  // depender do objeto spawnaria git a cada uma delas, pra confirmar o mesmo
  // número.
  const projectId = project?.id ?? null
  const projectPath = project?.path ?? null
  useEffect(() => {
    if (projectId && projectPath) void refresh(projectId, projectPath)
  }, [projectId, projectPath, refresh])

  if (!project || !entries) return null
  const usados = Object.values(porProjeto).flatMap((cs) =>
    cs.map((c) => c.worktreePath),
  )
  const loose = looseWorktrees(entries, usados)
  const item = statusWorktreeItem(loose.length)
  if (!item) return null
  return (
    <WorktreesPainel
      open={open}
      onOpenChange={setOpen}
      projectId={project.id}
      projectPath={project.path}
      loose={loose}
    >
      <GatilhoDaFaixa>
        <Item item={item} />
      </GatilhoDaFaixa>
    </WorktreesPainel>
  )
}

/**
 * Sessões de motor rodando FORA do app.
 *
 * Poll de 5 minutos, e não menos: sessão esquecida é um estado que se mede em
 * dias — perguntar de segundo em segundo gastaria um `ps` por nada. A primeira
 * leitura é no boot, porque é lá que o dado costuma ser mais feio (o que
 * sobrou de ontem).
 */
function ProcessosItem() {
  const [open, setOpen] = useState(false)
  const [lista, setLista] = useState<ProcessoDeMotor[]>([])

  const recarregar = useCallback(() => {
    void listarProcessos().then(setLista)
  }, [])

  useEffect(() => {
    recarregar()
    const id = window.setInterval(recarregar, 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [recarregar])

  const item = statusProcessosItem(resumirProcessos(lista))
  if (!item) return null
  return (
    <ProcessosPopover
      open={open}
      onOpenChange={setOpen}
      lista={lista}
      onMudou={recarregar}
    >
      <GatilhoDaFaixa>
        <Item item={item} />
      </GatilhoDaFaixa>
    </ProcessosPopover>
  )
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
      <div className="flex items-center gap-3">
        <UsagePill compact />
        <DivisorDaFaixa />
        <GastoDaFaixa />
      </div>

      {/* DIREITA — o build em execução, herdado do rodapé da sidebar (lá ele
          sumia junto com a sidebar fechada), e os worktrees soltos.
          Branch/alterações continua FORA, e o motivo segue de pé: o diff é
          carregado por efeito local do ContextPanel/DiffPanel, então uma
          segunda leitura de git pra encher a faixa daria dois donos pro mesmo
          número. Worktree solto passa por essa mesma régua em vez de furá-la —
          ninguém mais mostra esse dado, e quem lê o git é UM (store/worktrees),
          não um efeito de tela. */}
      <div className="ml-auto flex items-center gap-3">
        <MaquinaDaFaixa />
        <ProcessosItem />
        <WorktreeItem />
        <UpdateItem />
        <DivisorDaFaixa />
        <VersaoDaFaixa />
      </div>
    </footer>
  )
}
