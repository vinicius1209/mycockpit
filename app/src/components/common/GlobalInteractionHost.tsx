import { InteractionHost } from "@/components/chat/InteractionHost"

/** GlobalInteractionHost — montagem GLOBAL do InteractionHost (§6.1 item 4 do
 *  docs/agent-office.md, doc histórico). Antes o host morava dentro do
 *  ChatPanel e sumia quando o painel ficava `hidden` (modo painel/sdd) — um
 *  approval pendente deixava o turno pausado sem NENHUM card na tela.
 *
 *  Aqui ele vira overlay fixo, sempre visível em qualquer viewMode: card
 *  compacto no canto inferior DIREITO (right-4 bottom-12, max-w-[420px]),
 *  empilhando para cima — fora da coluna do composer, então não cobre o campo
 *  de digitação no modo linear.
 *
 *  Aprovações CONTEXTUAIS (Backlog §8): o InteractionHost renderiza só o lado
 *  GLOBAL do split (useContextualSplit) — pedidos da conversa VISÍVEL aparecem
 *  inline no fluxo (MissionTimeline/ChatPanel) e este toast os suprime.
 *
 *  z-40 DE PROPÓSITO: abaixo de Dialog/CommandMenu (z-50) e do Onboarding
 *  (z-[100]) — um overlay clicável acima de um modal furaria o focus-trap.
 *
 *  Integrador: montar `<GlobalInteractionHost />` no App.tsx, como irmão de
 *  `<CommandMenu />` (fora dos painéis redimensionáveis). Nada mais a passar.
 *
 *  pointer-events: a raiz é none (não bloqueia o que está por baixo); só o
 *  card com conteúdo volta a ser auto — e some via empty:hidden quando a fila
 *  está vazia. O fundo `bg-background` devolve a base opaca que o card
 *  translúcido (bg-brass/[0.07]) tinha dentro do painel — sem ela o card
 *  vazaria o que estiver atrás. */
export function GlobalInteractionHost() {
  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-40 flex w-full max-w-[420px] flex-col-reverse">
      <div className="pointer-events-auto empty:hidden rounded-lg bg-background shadow-[var(--shadow-pop)]">
        <InteractionHost />
      </div>
    </div>
  )
}
