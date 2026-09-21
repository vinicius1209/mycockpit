// Fronteira de erro: o que quebra, quebra NO SEU LUGAR.
//
// Até 21/09/2026 o app não tinha nenhuma (só a do editor Lexical). Uma exceção
// em qualquer render ou efeito subia até a raiz, o React desmontava a árvore
// inteira e a janela ficava preta. Foi o que se viu abrindo o painel direito:
// `Layout not found for Panel context`, lançado por um efeito de largura, e a
// Frota inteira sumiu por causa de uma régua de painel.
//
// Lei da casa aplicada ao erro (fail-open no render): a área que falhou mostra
// o que houve e oferece tentar de novo; a conversa, o composer e o resto
// seguem de pé. O erro vai pro `console.error`, que o `runtimeLogging` grava no
// Frota.log, então a tela bonita nunca esconde o motivo.

import { Component, type ErrorInfo, type ReactNode } from "react"
import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  /** Como a pessoa chama esta área, com artigo: "o painel lateral". */
  area: string
  /** `janela` é a última rede, na raiz: além de tentar de novo, recarrega. */
  variante?: "area" | "janela"
  /** Mudou, a fronteira se refaz sozinha (trocar de aba sai do erro). */
  resetKey?: string | number | null
  className?: string
  children: ReactNode
}

interface State {
  erro: Error | null
  resetKey: Props["resetKey"]
}

export class Fronteira extends Component<Props, State> {
  state: State = { erro: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(erro: unknown): Partial<State> {
    return { erro: erro instanceof Error ? erro : new Error(String(erro)) }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null
    return { erro: null, resetKey: props.resetKey }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error(`[fronteira] ${this.props.area} quebrou:`, erro, info.componentStack)
  }

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children
    const janela = this.props.variante === "janela"
    return (
      <div
        role="alert"
        className={cn(
          "flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 px-6 py-8 text-center",
          janela && "h-screen bg-rail text-foreground",
          this.props.className,
        )}
      >
        <CircleAlert aria-hidden className="size-5 shrink-0 text-st-error" />
        <div className="flex max-w-sm flex-col gap-1">
          <p className="text-[13px] font-medium text-foreground">Algo quebrou em {this.props.area}.</p>
          <p className="text-[12px] text-muted-foreground">
            {janela
              ? "Suas conversas estão salvas. Tente de novo ou recarregue a janela."
              : "O resto da Frota continua funcionando. O erro foi registrado no log."}
          </p>
        </div>
        <p
          data-selectable
          className="max-h-24 max-w-sm overflow-auto font-mono text-[11px] break-words text-muted-foreground"
        >
          {erro.message || String(erro)}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="compacto" onClick={() => this.setState({ erro: null })}>
            Tentar de novo
          </Button>
          {janela && (
            <Button type="button" variant="ghost" size="compacto" onClick={() => window.location.reload()}>
              Recarregar a janela
            </Button>
          )}
        </div>
      </div>
    )
  }
}
