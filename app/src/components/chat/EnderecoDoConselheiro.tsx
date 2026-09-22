// "para Aline · na fila" — o endereçamento da bolha quando a fala foi PARA um
// conselheiro, e não para o piloto.
//
// Componente próprio porque a informação depende da FILA (store), e o item da
// lista é `memo`: ler a fila aqui deixa a memoização do fio intacta e evita
// passar mais uma prop por toda a cadeia do MessageList.

import { rotuloDoDestinatario } from "@/lib/filaDeConselheiros"
import { useChat } from "@/store/chat"
import { useFilaDeConselheiros } from "@/store/filaConselheiros"

export function EnderecoDoConselheiro({
  destinatario,
}: {
  destinatario: { id: string; name: string }
}) {
  const fila = useFilaDeConselheiros(
    (s) => s.porConversa[useChat.getState().activeId ?? ""],
  )
  return (
    <span className="text-[11px] text-muted-foreground">
      {rotuloDoDestinatario(destinatario, fila)}
    </span>
  )
}
