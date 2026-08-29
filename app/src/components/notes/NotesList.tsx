import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { COLOR_STYLES } from "@/components/notes/StickyNoteCard"
import { carimboCurto, type GrupoDeNotas } from "@/components/notes/noteGroups"
import { tituloEPreview } from "@/components/notes/noteText"
import { alvosDeNota } from "@/components/notes/noteTargets"
import type { StickyNoteTarget } from "@/components/notes/types"

/** As mesmas pílulas de antes: o filtro por agent de destino. Vive DENTRO da
 *  coluna da lista porque é ela que ele filtra. Sem lista (desenho B) o filtro
 *  não existe, e nem deveria: com duas notas não há o que peneirar. */

export interface NotesListProps {
  grupos: readonly GrupoDeNotas[]
  agora: number
  selectedId?: string
  busca: string
  filtro: StickyNoteTarget | "all"
  onBusca: (termo: string) => void
  onSelect: (id: string) => void
  onFiltro: (filtro: StickyNoteTarget | "all") => void
}

/**
 * A coluna da esquerda do desenho A: busca, filtro e a lista em seções.
 *
 * Puramente apresentacional (recebe grupos já montados pelo núcleo puro) — o
 * que ela decide é pixel, não conteúdo.
 */
export function NotesList({
  grupos,
  agora,
  selectedId,
  busca,
  filtro,
  onBusca,
  onSelect,
  onFiltro,
}: NotesListProps) {
  const vazia = grupos.length === 0

  return (
    <div className="flex w-[214px] shrink-0 flex-col border-r border-border/60 bg-secondary/30">
      <div className="shrink-0 p-2.5 pb-1.5">
        <label className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-[12px] text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/50">
          <Search className="size-3 shrink-0" />
          <input
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar nas notas"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {/* Quebra de linha em vez de rolagem horizontal: numa coluna de 214px os
          cinco rótulos não cabem, e rolar esconderia opção atrás de um gesto
          que ninguém adivinha (além de acender uma barra de rolagem dentro de
          um popover de 420px). Duas linhas custam 20px e mostram tudo. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-2.5 pb-1.5">
        {alvosDeNota().map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onFiltro(chip.id)}
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors",
              filtro === chip.id
                ? "bg-sel text-foreground"
                : "text-muted-foreground hover:bg-sel-hover hover:text-foreground",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {vazia ? (
          <p className="px-3 py-4 text-[12px] text-muted-foreground">
            Nenhuma nota com esse texto.
          </p>
        ) : (
          grupos.map((grupo) => (
            <section key={grupo.id}>
              {/* Escopo por fora, tempo por dentro. O cabeçalho de escopo só
                  aparece no PRIMEIRO grupo dele, senão "Do projeto" se repete
                  três vezes numa coluna de 214px. */}
              {grupo.abreEscopo && (
                <h4 className="px-3 pt-3 pb-0.5 text-[11px] font-semibold text-foreground/80">
                  {grupo.rotuloEscopo}
                </h4>
              )}
              <h5 className="px-3 pt-1 pb-0.5 text-[11px] text-muted-foreground">
                {grupo.rotuloFaixa}
              </h5>
              {grupo.notas.map((nota) => {
                const { titulo, preview, vazia: semTexto } = tituloEPreview(nota.content)
                const ativa = nota.id === selectedId
                return (
                  <button
                    key={nota.id}
                    type="button"
                    onClick={() => onSelect(nota.id)}
                    aria-current={ativa ? "true" : undefined}
                    className={cn(
                      "mx-1.5 flex w-[calc(100%-0.75rem)] flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors",
                      ativa ? "bg-sel" : "hover:bg-sel-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "flex w-full min-w-0 items-center gap-1.5 text-[12px] font-semibold",
                        semTexto ? "text-muted-foreground italic" : "text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          (COLOR_STYLES[nota.color] ?? COLOR_STYLES.sand).dot,
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{titulo}</span>
                    </span>
                    <span className="flex w-full min-w-0 items-baseline gap-1.5 pl-3 text-[11px] text-muted-foreground">
                      <span className="shrink-0 tabular-nums">
                        {carimboCurto(nota.updatedAt, agora)}
                      </span>
                      {/* A lista NUNCA resolve URL de anexo: seriam N blobs
                          presos na memória, um por linha visível. Ela DIZ que
                          existe; a nota aberta é que mostra. */}
                      {!!nota.attachments?.length && (
                        <span className="shrink-0">
                          {nota.attachments.length}{" "}
                          {nota.attachments.length === 1 ? "anexo" : "anexos"}
                        </span>
                      )}
                      {preview && <span className="min-w-0 flex-1 truncate">{preview}</span>}
                    </span>
                  </button>
                )
              })}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
