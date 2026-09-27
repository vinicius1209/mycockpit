import {
  CalendarClock,
  CircleSlash,
  Download,
  LogIn,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import type { ToolHealthItem } from "@/lib/toolHealth"
import { cn } from "@/lib/utils"

/** Uma linha de SAÚDE DE FERRAMENTA do sino: CLI sem login, CLI com update, e
 *  (desde o M3 do model-autonomy-plan) notícia de MODELO daquele motor.
 *
 *  Mora fora do `InboxBell.tsx` porque aquele arquivo passou do teto de
 *  tamanho e esta linha é folha: só recebe o item já decidido por
 *  `lib/toolHealth` e dois callbacks. Nenhum texto é escrito aqui — as frases
 *  das notícias de modelo vêm da regra pura, com o motivo do fornecedor junto.
 *
 *  Tom, pela tabela do STYLEGUIDE §2: "sem login" é âmbar (precisa de você,
 *  bloqueia o envio) e aposentadoria anunciada também (é decisão sua trocar);
 *  "atualização disponível", "modelo novo" e "candidato reprovado" são CINZA
 *  (informação, nada quebrou). Duas cores de status no recorte, dentro do
 *  orçamento de tinta.
 *
 *  Ação: todas abrem a seção de Configurações onde o gesto JÁ existe (Agentes
 *  na máquina pro update/login; Modelos pra procedência e pro "Tirar do
 *  seletor"). O dropdown fecha no clique, então nenhum botão é duplicado aqui. */
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
    <DropdownMenuItem
      onSelect={onOpen}
      className="flex-col items-start gap-0.5 py-2"
    >
      <span
        className={cn(
          "group/tool flex w-full items-center gap-2 text-[13px]",
          alarme ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {onDismiss && (
          <button
            onClick={(e) => {
              // dispensa SEM navegar (a linha some na hora).
              e.stopPropagation()
              e.preventDefault()
              onDismiss()
            }}
            title="Dispensar este aviso"
            aria-label="Dispensar este aviso"
            className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors group-hover/tool:block hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </span>
      <span className="w-full truncate pl-[22px] text-[11px] text-muted-foreground">
        {detail}
      </span>
    </DropdownMenuItem>
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
