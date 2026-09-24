import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// O tema chega por prop de App.tsx (<Toaster theme={theme} />) via {...props}.
// next-themes era inócuo aqui (nunca houve ThemeProvider), então foi removido.
//
// Todo aviso se fecha (`closeButton`). Visto em 24/09/2026: dois "o navegador
// do projeto parou sozinho" empilhados, e a pessoa clicava no ⊗ à esquerda
// achando que era o fechar. Era o ÍCONE de erro (`OctagonX`), e não havia
// botão de fechar nenhum; o aviso de navegador antigo (`duration: Infinity`)
// não saía nunca. Por isso o erro usa um ícone que não é um X.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <CircleAlertIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
