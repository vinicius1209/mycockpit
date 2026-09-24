import { AgentLogo, agentLogoLabel } from "@/components/common/AgentLogo"

/**
 * Marca do motor: IDENTIDADE, e só (STYLEGUIDE §2, ADR-043).
 *
 * A 1ª versão usava uma INICIAL em quadradinho colorido ("C", "X", "A") e falhou
 * no primeiro contato — "o que é esse C?". Era código que só o autor lia. Agora
 * são os logos oficiais de cada produto (ver AgentLogo).
 *
 * A 2ª versão carregava um SELO DE ESTADO por cima (padrão do Warp). O selo
 * saiu: numa linha de lista, identidade e estado disputando o mesmo pixel
 * fazem o usuário perder de vista se aquilo é QUEM ou COMO ESTÁ. Estado mudou
 * pro slot direito, que tem dono único e ordem fechada
 * (`ConversationSlot.tsx`), e a marca ficou com a única coisa que ela nunca
 * deixa de responder: qual motor é este. A perda deliberada está registrada no
 * ADR-043 (o selo verde de "terminou bem" era estado ambiente permanente, que
 * o §9 item 4 já tinha condenado; quem responde "isto andou?" agora é o tempo
 * relativo, em texto).
 *
 * Distingue por SILHUETA, nunca por cor: pintar cada motor gastaria o
 * orçamento de tinta do §2 e traria de volta a colisão que o ADR-043 resolveu.
 */
export function AgentMark({
  agent,
  title,
  tamanho = 14,
}: {
  agent: string
  title?: string
  /** 12px na lista de conversas da barra lateral (ADR-245): a marca identifica
   *  sem disputar com o título. O slot segue de 16px, e o alinhamento não muda. */
  tamanho?: 12 | 14
}) {
  return (
    <span
      className="relative grid size-4 shrink-0 place-items-center"
      title={title ?? agentLogoLabel(agent)}
      aria-label={title ?? agentLogoLabel(agent)}
    >
      <AgentLogo agent={agent} className={tamanho === 12 ? "size-3 text-muted-foreground" : "size-3.5 text-muted-foreground"} />
    </span>
  )
}
