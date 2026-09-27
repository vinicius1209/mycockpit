// Buscar e substituir dentro do arquivo (spec §7.8). O painel padrão do
// CodeMirror não mostra contagem, não tem Ctrl+H e desenha controles fora das
// escalas §3 e §13; este é nosso, sobre a MESMA API de busca dele.
//
// A verdade é o `SearchQuery` do CodeMirror. O React só espelha: o painel é
// redesenhado a cada atualização relevante do editor (`update`).

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { runScopeHandlers, type EditorView } from "@codemirror/view"
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search"
import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import { SUPERFICIE_DO_PAINEL } from "@/components/ui/popover"
import { contarAchados, rotuloDaContagem, type Contagem } from "@/lib/edicao/regras"
import { cn } from "@/lib/utils"
import { campoDeSubstituir, mostrarSubstituir } from "@/components/editor/estadoDaBusca"

const TETO = 1000

function contar(view: EditorView, q: SearchQuery): Contagem | null {
  if (!q.search) return { atual: 0, total: 0, passou: false }
  if (!q.valid) return null
  const cursor = q.getCursor(view.state)
  return contarAchados({ [Symbol.iterator]: () => cursor }, view.state.selection.main, TETO)
}

const ALTERNANCIA = cn(
  controle("chip", { quadrado: true }),
  "font-mono text-muted-foreground hover:bg-sel-hover aria-pressed:bg-sel aria-pressed:text-foreground",
)

export function BuscaNoArquivo({ view, tique }: { view: EditorView; tique: number }) {
  const q = getSearchQuery(view.state)
  const gravavel = !view.state.readOnly
  const substituir = gravavel && view.state.field(campoDeSubstituir, false) === true
  const [termo, setTermo] = useState(q.search)
  const [troca, setTroca] = useState(q.replace)
  const [contagem, setContagem] = useState<Contagem | null>(() => contar(view, q))
  const campo = useRef<HTMLInputElement>(null)

  // Quem mudou a busca por fora (⌘F com outra seleção) vence o campo.
  useEffect(() => {
    setTermo((atual) => (atual === q.search ? atual : q.search))
  }, [q.search])

  // A contagem roda no máximo uma vez por quadro, mesmo numa rajada de teclas.
  useEffect(() => {
    const id = requestAnimationFrame(() => setContagem(contar(view, getSearchQuery(view.state))))
    return () => cancelAnimationFrame(id)
  }, [tique, view])

  useEffect(() => {
    campo.current?.focus()
    campo.current?.select()
  }, [])

  const mudar = (parcial: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    const atual = getSearchQuery(view.state)
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: atual.search,
          caseSensitive: atual.caseSensitive,
          regexp: atual.regexp,
          wholeWord: atual.wholeWord,
          replace: atual.replace,
          ...parcial,
        }),
      ),
    })
  }

  const teclar = (e: KeyboardEvent<HTMLInputElement>, noEnter: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault()
      noEnter()
      return
    }
    // Esc, ⌘F, ⌘G, F3: os atalhos de busca do CodeMirror valem aqui dentro.
    if (runScopeHandlers(view, e.nativeEvent, "search-panel")) e.preventDefault()
  }

  const rotulo = contagem === null ? "Expressão inválida" : rotuloDaContagem(contagem)
  const semAchado = !contagem || contagem.total === 0

  return (
    <div className={cn(SUPERFICIE_DO_PAINEL, "flex w-[392px] flex-col gap-1.5 p-1.5 font-sans")}>
      <div className="flex items-center gap-1">
        {gravavel ? (
          <button
            type="button"
            className={cn(controle("chip", { quadrado: true }), "text-muted-foreground hover:bg-sel-hover")}
            aria-label={substituir ? "Esconder substituir" : "Mostrar substituir"}
            aria-expanded={substituir}
            onClick={() => view.dispatch({ effects: mostrarSubstituir.of(!substituir) })}
          >
            {substituir ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <div
          className={cn(
            controle("compacto"),
            "min-w-0 flex-1 gap-1 border bg-background pr-0.5 font-mono",
            contagem === null && "border-destructive",
          )}
        >
          <input
            ref={campo}
            main-field="true"
            aria-label="Buscar no arquivo"
            placeholder="Buscar"
            value={termo}
            spellCheck={false}
            onChange={(e) => {
              setTermo(e.target.value)
              mudar({ search: e.target.value })
            }}
            onKeyDown={(e) => teclar(e, () => (e.shiftKey ? findPrevious(view) : findNext(view)))}
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
          />
          <button type="button" className={ALTERNANCIA} aria-pressed={q.caseSensitive} title="Diferenciar maiúsculas" onClick={() => mudar({ caseSensitive: !q.caseSensitive })}>
            Aa
          </button>
          <button type="button" className={ALTERNANCIA} aria-pressed={q.wholeWord} title="Palavra inteira" onClick={() => mudar({ wholeWord: !q.wholeWord })}>
            ab
          </button>
          <button type="button" className={ALTERNANCIA} aria-pressed={q.regexp} title="Expressão regular" onClick={() => mudar({ regexp: !q.regexp })}>
            .*
          </button>
        </div>
        <span
          aria-live="polite"
          className={cn(
            "min-w-[52px] shrink-0 text-right font-mono text-[11px] tabular-nums",
            contagem === null ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {rotulo}
        </span>
        <Button variant="ghost" size="icone-chip" aria-label="Anterior" disabled={semAchado} onClick={() => findPrevious(view)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icone-chip" aria-label="Próximo" disabled={semAchado} onClick={() => findNext(view)}>
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icone-chip" aria-label="Fechar a busca" onClick={() => closeSearchPanel(view)}>
          <X />
        </Button>
      </div>
      {substituir && (
        <div className="flex items-center gap-1 pl-7">
          <div className={cn(controle("compacto"), "min-w-0 flex-1 border bg-background font-mono")}>
            <input
              aria-label="Substituir por"
              placeholder="Substituir"
              value={troca}
              spellCheck={false}
              onChange={(e) => {
                setTroca(e.target.value)
                mudar({ replace: e.target.value })
              }}
              onKeyDown={(e) => teclar(e, () => replaceNext(view))}
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
            />
          </div>
          <Button variant="secondary" size="chip" disabled={semAchado} onClick={() => replaceNext(view)}>
            Substituir
          </Button>
          <Button variant="secondary" size="chip" disabled={semAchado} onClick={() => replaceAll(view)}>
            Todas
          </Button>
        </div>
      )}
    </div>
  )
}
