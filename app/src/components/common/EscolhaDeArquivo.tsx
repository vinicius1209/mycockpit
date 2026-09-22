// O menu de escolha quando um nome citado no fio casa com mais de um arquivo.
// Mesma primitiva do menu do app (`PointMenu`, ADR-042): escolher entre
// opções no ponto do clique é o gesto dele. Mora no entry, ao lado do
// `AppContextMenu`, para abrir sobre qualquer superfície.
import { PointMenu, PointMenuItem } from "@/components/ui/context-menu"
import { useApp } from "@/store/app"
import { useEscolhaDeArquivo } from "@/store/escolhaDeArquivo"

export function EscolhaDeArquivo() {
  const pedido = useEscolhaDeArquivo((s) => s.pedido)
  const fechar = useEscolhaDeArquivo((s) => s.fechar)
  if (!pedido) return null
  return (
    <PointMenu
      // Remonta a cada pedido: o Radix ancora na montagem.
      key={`${pedido.x}:${pedido.y}:${pedido.nome}`}
      x={pedido.x}
      y={pedido.y}
      open
      onOpenChange={(aberto) => {
        if (!aberto) fechar()
      }}
    >
      {pedido.candidatos.map((caminho) => {
        const corte = caminho.lastIndexOf("/")
        const pasta = corte >= 0 ? caminho.slice(0, corte + 1) : ""
        const nome = caminho.slice(corte + 1)
        return (
          <PointMenuItem
            key={caminho}
            title={caminho}
            onSelect={() => useApp.getState().openFileTab(caminho)}
          >
            <span className="min-w-0 truncate font-mono text-[12px]">
              <span className="text-muted-foreground">{pasta}</span>
              <span className="text-foreground">{nome}</span>
            </span>
          </PointMenuItem>
        )
      })}
    </PointMenu>
  )
}
