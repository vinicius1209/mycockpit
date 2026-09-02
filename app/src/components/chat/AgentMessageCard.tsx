// Cartão delimitado de superfície neutra (E1) para respostas do agent no chat.
// Envelopa o conteúdo markdown em uma caixa discreta com fundo de cartão e borda canônica,
// espelhando a linguagem visual do balão do usuário sem introduzir filetes decorativos.

import { Markdown } from "@/components/common/Markdown"

export function AgentMessageCard({ text }: { text: string }) {
  return (
    <div className="agent-message-card max-w-full rounded-2xl rounded-tl-md border border-border/40 bg-card p-4 shadow-xs text-[14px] leading-relaxed text-foreground">
      <Markdown text={text} />
    </div>
  )
}
