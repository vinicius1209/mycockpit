// Aba "Bastidores" do painel direito (ADR-200): o índice do que roda fora da
// resposta principal da conversa. É daqui que se abre o terminal na própria
// aba. Teclado como no CLI: ↑/↓ percorre, Enter abre na aba em foco do
// terminal, F abre em outra aba, Esc fecha as vistas.
//
// Contêiner (`IndiceDeBastidores`) lê os stores; `IndiceView` recebe por props,
// para o teste renderizar sem o estado congelado do SSR.

import { useEffect, useState, type KeyboardEvent } from "react"
import { Pin, SquareTerminal } from "lucide-react"
import { PontoDeEstado, RotuloDeTempo } from "@/components/bastidores/BastidorVista"
import { useBastidoresDaConversa } from "@/components/bastidores/useBastidoresDaConversa"
import { Button } from "@/components/ui/button"
import type { Bastidor } from "@/lib/bastidores"
import { cn } from "@/lib/utils"
import { useBastidores, vistasDa } from "@/store/bastidores"

export function IndiceDeBastidores() {
  const { convId, lista } = useBastidoresDaConversa()
  const vistas = useBastidores((s) => s.vistas)
  const foco = useBastidores((s) => s.foco)
  if (!convId) return null
  const acoes = useBastidores.getState()
  const abertas = vistasDa(vistas, convId).map((v) => v.itemId)
  return (
    <IndiceView
      lista={lista}
      abertas={abertas}
      itemEmFoco={abertas[Math.min(foco, abertas.length - 1)]}
      onAbrir={(itemId) => acoes.abrir(convId, itemId)}
      onFixar={(itemId) => acoes.fixar(convId, itemId)}
      onFecharTodas={() => acoes.fecharTodas(convId)}
      onVoltar={abertas.length ? () => acoes.verIndice(false) : undefined}
    />
  )
}

export function IndiceView({
  lista,
  abertas,
  itemEmFoco,
  onAbrir,
  onFixar,
  onFecharTodas,
  onVoltar,
}: {
  lista: Bastidor[]
  /** itemIds com vista aberta ao lado da conversa. */
  abertas: string[]
  itemEmFoco: string | undefined
  onAbrir: (itemId: string) => void
  onFixar: (itemId: string) => void
  onFecharTodas: () => void
  /** Há vistas abertas e você veio à lista sem fechá-las: o caminho de volta. */
  onVoltar?: () => void
}) {
  const [sel, setSel] = useState(() => Math.max(0, lista.findIndex((b) => b.itemId === itemEmFoco)))
  // A seleção segue a vista em foco quando ELA muda (abrir pela linha do fio,
  // fechar tudo e reabrir). Sem isto a seleção ficava no item antigo e as setas
  // pareciam mortas (visto na validação de 16/09/2026).
  useEffect(() => {
    const i = lista.findIndex((b) => b.itemId === itemEmFoco)
    if (i >= 0) setSel(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a troca do foco move a seleção
  }, [itemEmFoco])
  const vivos = lista.filter((b) => b.estado === "vivo").length
  const selecionado = lista[Math.min(sel, lista.length - 1)]

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setSel((i) => Math.max(0, Math.min(lista.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))))
    } else if (e.key === "Enter" && selecionado) {
      e.preventDefault()
      onAbrir(selecionado.itemId)
    } else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && selecionado) {
      e.preventDefault()
      onFixar(selecionado.itemId)
    } else if (e.key === "Escape" && abertas.length) {
      e.preventDefault()
      onFecharTodas()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-8 items-center gap-2 pt-1 pr-2.5 pb-2 pl-5">
        <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          {vivos ? `${vivos} em andamento nesta conversa` : "Nada em andamento nesta conversa."}
        </p>
        {onVoltar && (
          <Button type="button" variant="ghost" size="chip" onClick={onVoltar} className="text-muted-foreground hover:text-foreground">
            <SquareTerminal className="size-3.5" />
            Voltar ao terminal ({abertas.length})
          </Button>
        )}
      </div>
      <ul
        role="listbox"
        aria-label="Trabalhos desta conversa"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto px-2.5 pb-2 outline-none"
      >
        {lista.length === 0 && (
          <li className="px-2.5 py-2 text-[12px] leading-snug text-muted-foreground/80">
            Quando um motor deixar um comando, um subagente ou um workflow rodando, ele aparece aqui para você acompanhar ao lado da conversa.
          </li>
        )}
        {lista.map((b, i) => {
          const aberta = abertas.includes(b.itemId)
          return (
            <li
              key={b.itemId}
              role="option"
              aria-selected={i === sel}
              onClick={() => {
                setSel(i)
                onAbrir(b.itemId)
              }}
              className={cn(
                "group/indice flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5",
                i === sel ? "bg-sel" : "hover:bg-sel-hover",
              )}
            >
              <PontoDeEstado estado={b.estado} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  aberta ? "font-medium text-foreground" : "text-foreground/85",
                )}
                title={b.titulo}
              >
                {b.titulo}
              </span>
              <RotuloDeTempo b={b} />
              <Button
                type="button"
                variant="ghost"
                size="icone-chip"
                onClick={(e) => {
                  e.stopPropagation()
                  onFixar(b.itemId)
                }}
                title="Abrir em outra aba do terminal"
                aria-label={`Abrir ${b.titulo} em outra aba`}
                className="text-muted-foreground opacity-0 group-hover/indice:opacity-100 focus-visible:opacity-100 hover:text-foreground"
              >
                <Pin className="size-3.5" />
              </Button>
            </li>
          )
        })}
      </ul>
      {lista.length > 0 && (
        <p className="border-t border-border/40 px-5 py-2 text-[11px] text-muted-foreground">
          ↑↓ percorre · Enter abre no terminal · F abre em outra aba · Esc fecha as vistas
        </p>
      )}
    </div>
  )
}
