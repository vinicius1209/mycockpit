import {
  CalendarClock,
  CircleSlash,
  Download,
  LogIn,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { LinhaDoSino } from "@/components/layout/sino/LinhaDoSino"
import type { ToolHealthItem } from "@/lib/toolHealth"

/** Uma linha de SAÚDE DE FERRAMENTA do sino: CLI sem login, CLI com update, e
 *  notícia de MODELO ou de MODOS daquele motor.
 *
 *  Nenhum texto é escrito aqui: as frases vêm de `lib/toolHealth`, com o
 *  motivo do fornecedor junto.
 *
 *  Tom, pela tabela do STYLEGUIDE §2: "sem login" é âmbar (precisa de você,
 *  bloqueia o envio) e aposentadoria anunciada também (é decisão sua trocar);
 *  "atualização disponível", "modelo novo" e "candidato reprovado" são CINZA
 *  (informação, nada quebrou).
 *
 *  Ação: todas abrem a seção de Configurações onde o gesto JÁ existe, então
 *  nenhum botão é duplicado aqui. */
export function ToolHealthRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: ToolHealthItem
  onOpen: () => void
  /** Só o que é conveniência se dispensa (impedimento não se dispensa). */
  onDismiss?: () => void
}) {
  const { icon, alarme, title, detail } = linha(item)
  return (
    <LinhaDoSino
      icone={icon}
      titulo={title}
      meta={detail}
      lida={!alarme}
      onAbrir={onOpen}
      acoes={onDismiss ? [{ icone: X, rotulo: "Dispensar este aviso", fazer: onDismiss }] : undefined}
    />
  )
}

/** O desenho de cada tipo, num lugar só. `alarme` = o título vem em tinta
 *  cheia (o que pede decisão), não em sussurro. */
function linha(item: ToolHealthItem): {
  icon: React.ReactNode
  alarme: boolean
  title: string
  detail: string
} {
  if (item.kind === "auth")
    return {
      icon: <LogIn className="size-3.5 shrink-0 text-st-warning" />,
      alarme: true,
      title: `${item.label} sem login`,
      detail: "Bloqueia o envio. Entre pela CLI no terminal, depois Verificar agora.",
    }
  if (item.kind === "update")
    return {
      icon: <Download className="size-3.5 shrink-0 text-muted-foreground" />,
      alarme: false,
      title: `Atualização do ${item.label} disponível`,
      detail: `v${item.current ?? "?"} → v${item.latest ?? "?"} · Atualizar em Configurações ▸ Motores ▸ ${item.label}`,
    }
  if (item.kind === "modes")
    return {
      // Sem alarme: o cardápio de modos mudar não impede trabalhar. Inflar o
      // sino aqui tiraria peso do que de fato bloqueia (CLI deslogada).
      icon: <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />,
      alarme: false,
      title: `Modos do ${item.label} mudaram`,
      detail: item.detail,
    }
  return {
    icon:
      item.tone === "retired" ? (
        <CalendarClock className="size-3.5 shrink-0 text-st-warning" />
      ) : item.tone === "blocked" ? (
        <CircleSlash className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
      ),
    alarme: item.tone === "retired",
    title: item.title,
    detail: item.detail,
  }
}
