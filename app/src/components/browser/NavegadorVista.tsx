// A cara do navegador do projeto, só com props: barra (histórico, endereço,
// página, piloto) e o quadro ao vivo. Quem decide ONDE ela mora (aba principal
// ou janela separada) é o contêiner; a lógica é do `useNavegadorDoProjeto`.
//
// O quadro é imagem no DOM de propósito (navegador PRD, decisão 1): menus,
// modais e Lightbox passam por cima, e nada nativo disputa camada.

import { useRef, useState } from "react"
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Crosshair,
  Eye,
  ImageDown,
  MousePointer2,
  Paperclip,
  RefreshCw,
  Plus,
  RotateCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { controle } from "@/components/ui/controle"
import type { BrowserPage } from "@/lib/browser"
import { cn } from "@/lib/utils"
import type { BrowserPreviewFrame } from "@/lib/browser"
import { MarcacaoNoQuadro } from "./MarcacaoNoQuadro"
import { SeletorDeTamanho } from "./SeletorDeTamanho"
import { useTamanhoDaPagina } from "./useTamanhoDaPagina"
import { ehPadrao, medidaDoTamanho } from "@/lib/tamanhoDaPagina"
import type { NavegadorDoProjeto } from "./useNavegadorDoProjeto"

function pageLabel(page: BrowserPage): string {
  return page.title.trim() || page.displayUrl || "Página sem título"
}

export function NavegadorVista({
  nav,
  acoes,
}: {
  nav: NavegadorDoProjeto
  /** Botões do contêiner no fim da barra (ex.: fechar, flutuar). */
  acoes?: React.ReactNode
}) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const { frame, selected, ownsPilot, pilot, input } = nav
  // B3: o quadro do momento em que "Marcar" foi apertado; enquanto existe, a
  // vista mostra ele parado em vez do stream.
  const [congelado, setCongelado] = useState<BrowserPreviewFrame | null>(null)
  const [enviandoMarcacao, setEnviandoMarcacao] = useState(false)
  const tamanho = useTamanhoDaPagina(nav.projectPath)

  const framePoint = (clientX: number, clientY: number) => {
    const image = imageRef.current
    if (!image) return null
    const rect = image.getBoundingClientRect()
    const width = frame?.width ?? image.naturalWidth
    const height = frame?.height ?? image.naturalHeight
    if (!rect.width || !rect.height || !width || !height) return null
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    }
  }

  return (
    <div className="@container/navegador flex h-full min-h-0 flex-col">
      <form
        className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          input({ kind: "navigate", url: nav.address })
        }}
      >
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={!ownsPilot}
          aria-label="Voltar"
          title="Voltar"
          onClick={() => input({ kind: "history", direction: "back" })}
        >
          <ArrowLeft />
        </Button>
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={!ownsPilot}
          aria-label="Avançar"
          title="Avançar"
          onClick={() => input({ kind: "history", direction: "forward" })}
        >
          <ArrowRight />
        </Button>
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={!ownsPilot || !selected}
          aria-label="Recarregar"
          title="Recarregar"
          onClick={() => {
            if (selected) input({ kind: "navigate", url: selected.url })
          }}
        >
          <RotateCw />
        </Button>
        <Input
          value={nav.address}
          onChange={(event) => nav.setAddress(event.target.value)}
          disabled={!ownsPilot || !selected}
          aria-label="Endereço da página"
          className="h-7 min-w-0 flex-1 font-mono text-[12px]"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={selected ? selected.url : "Páginas abertas"}
              className={cn(
                controle("compacto"),
                "max-w-24 shrink-0 text-muted-foreground hover:bg-sel-hover hover:text-foreground data-[state=open]:bg-sel @min-[600px]/navegador:max-w-32 @min-[720px]/navegador:max-w-48",
              )}
            >
              <span className="truncate">
                {selected ? pageLabel(selected) : "Páginas"}
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 border-border/40">
            {nav.pages.length ? (
              nav.pages.map((page) => (
                <DropdownMenuItem
                  key={page.id}
                  onSelect={() => nav.selectPage(page)}
                  className="items-start text-[12px]"
                >
                  <Check
                    className={cn(
                      "mt-0.5",
                      page.id === selected?.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{pageLabel(page)}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {page.displayUrl}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">
                Nenhuma página observável está aberta.
              </p>
            )}
            <DropdownMenuSeparator className="bg-border/40" />
            {nav.abrirPagina && nav.pages.length === 0 && (
              <DropdownMenuItem onSelect={nav.abrirPagina} className="text-[12px]">
                <Plus />
                Abrir uma página aqui
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={nav.refreshPages} className="text-[12px]">
              <RefreshCw />
              Atualizar páginas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {nav.projectPath && <SeletorDeTamanho t={tamanho} />}
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={!selected || !frame}
          aria-pressed={congelado != null}
          aria-label="Marcar uma região para o agente"
          title="Marcar uma região para o agente"
          className={cn(congelado && "bg-sel text-foreground")}
          onClick={() => setCongelado(congelado ? null : frame)}
        >
          <Crosshair />
        </Button>
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={!selected}
          aria-label="Anexar a página à conversa"
          title="Anexar a página à conversa"
          onClick={nav.anexarPagina}
        >
          <Paperclip />
        </Button>
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={!selected}
          aria-label="Copiar imagem da página"
          title="Copiar imagem da página"
          onClick={nav.copiarImagem}
        >
          <ImageDown />
        </Button>
        <span
          className="flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground"
          title={pilot?.label}
        >
          {pilot?.mode === "human" ? (
            <MousePointer2 className="size-3" />
          ) : (
            <Eye className="size-3" />
          )}
          <span className="hidden max-w-32 truncate @min-[640px]/navegador:inline">
            {pilot?.label ?? "Consultando piloto"}
          </span>
        </span>
        {/* Estreito (flutuante), o controle vira só ícone: o endereço é o que
            não pode sumir da barra. */}
        {ownsPilot ? (
          <Button
            type="button"
            size="compacto"
            variant="outline"
            aria-label="Liberar controle"
            title="Liberar controle"
            onClick={nav.release}
          >
            <ShieldOff />
            <span className="hidden @min-[600px]/navegador:inline">Liberar controle</span>
          </Button>
        ) : (
          <Button
            type="button"
            size="compacto"
            aria-label="Assumir controle"
            title="Assumir controle"
            onClick={nav.acquire}
            disabled={!pilot?.canTakeOver}
          >
            <ShieldCheck />
            <span className="hidden @min-[600px]/navegador:inline">Assumir controle</span>
          </Button>
        )}
        {acoes}
      </form>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-card/30 p-3">
        {frame && !congelado && !ehPadrao(tamanho.tamanho) && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center font-mono text-[11px] text-faint">
            {medidaDoTamanho(tamanho.tamanho)}
          </span>
        )}
        {congelado ? (
          <MarcacaoNoQuadro
            quadro={congelado}
            enviando={enviandoMarcacao}
            onCancelar={() => setCongelado(null)}
            onMarcar={(regiao) => {
              setEnviandoMarcacao(true)
              void nav.marcar(regiao).then((ok) => {
                setEnviandoMarcacao(false)
                if (ok) setCongelado(null)
              })
            }}
          />
        ) : frame ? (
          <button
            type="button"
            disabled={!ownsPilot}
            aria-label={
              ownsPilot
                ? "Visualização da página, clique para interagir"
                : "Visualização da página em modo observação"
            }
            className="mx-auto flex h-full max-w-full items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
            onClick={(event) => {
              const point = framePoint(event.clientX, event.clientY)
              if (point) input({ kind: "click", ...point })
            }}
            onWheel={(event) => {
              if (!ownsPilot) return
              const point = framePoint(event.clientX, event.clientY)
              if (point) {
                event.preventDefault()
                input({ kind: "scroll", ...point, deltaX: event.deltaX, deltaY: event.deltaY })
              }
            }}
            onKeyDown={(event) => {
              if (!ownsPilot || event.metaKey || event.ctrlKey || event.altKey) return
              event.preventDefault()
              if (event.key.length === 1) input({ kind: "text", text: event.key })
              else input({ kind: "key", key: event.key, code: event.code })
            }}
          >
            <img
              ref={imageRef}
              src={`data:image/jpeg;base64,${frame.data}`}
              alt="Página observada no navegador do projeto"
              draggable={false}
              className="block max-h-full max-w-full rounded-lg border border-border bg-background object-contain shadow-[var(--shadow-sm)]"
            />
          </button>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Eye className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-[13px] font-medium">
                {nav.loading
                  ? "Conectando ao navegador"
                  : selected && nav.deFundo
                    ? "Esta página está atrás de outra"
                    : selected
                    ? "Aguardando o primeiro quadro"
                    : nav.abrirPagina
                      ? "Esta conversa ainda não tem página"
                      : "Nenhuma página aberta"}
              </p>
              <p className="mt-1 max-w-[420px] text-[12px] text-muted-foreground">
                {!nav.loading && selected && nav.deFundo
                  ? "Ela divide a janela do navegador com outra página, e só a da frente é desenhada. Numa janela própria ela aparece aqui sem tirar a outra da frente; a página recarrega, e o login continua."
                  : !nav.loading && !selected && nav.abrirPagina
                  ? "Cada conversa usa as próprias páginas do navegador do projeto."
                  : "A imagem é do navegador deste projeto, sem abrir outra janela."}
              </p>
              {/* ADR-257: gesto, não automático, porque recarrega a página. */}
              {!nav.loading && selected && nav.deFundo && (
                <Button size="compacto" variant="secondary" className="mt-3" onClick={nav.abrirEmJanelaPropria}>
                  <AppWindow />
                  Abrir numa janela própria
                </Button>
              )}
              {!nav.loading && !selected && nav.abrirPagina && (
                <Button size="compacto" variant="secondary" className="mt-3" onClick={nav.abrirPagina}>
                  <Plus />
                  Abrir uma página aqui
                </Button>
              )}
            </div>
          </div>
        )}
        {!ownsPilot && frame && !congelado && (
          <div className="pointer-events-none absolute right-5 bottom-5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-[var(--shadow-sm)]">
            Observando, {pilot?.label.toLowerCase() ?? "sem piloto"}
          </div>
        )}
      </div>

      {nav.error && (
        <div
          role="alert"
          className="shrink-0 border-t border-st-error/30 bg-st-error/5 px-3 py-2 text-[12px] text-st-error"
        >
          {nav.error}
        </div>
      )}
    </div>
  )
}
