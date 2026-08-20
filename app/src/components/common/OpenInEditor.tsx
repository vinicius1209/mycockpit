// "Abrir no editor" — o gesto do M1, numa peça só, pras várias superfícies.
//
// Regra de aparição (§5 do STYLEGUIDE, degradação honesta): sem editor
// detectado o botão NÃO existe. Nada de item cinza prometendo o que a máquina
// não faz.
//
// Regra de escolha: com um editor, clicar abre. Com vários, clicar abre no
// preferido e o menu (botão direito, ou o chevron) escolhe outro — e a escolha
// VIRA a preferência. Assim a pergunta só aparece quando ela existe de verdade,
// e nunca vira uma seção em Configurações que você configura uma vez e esquece.

import { useEffect } from "react"
import { toast } from "sonner"
import { SquareArrowOutUpRight } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { openInEditor, pickEditor } from "@/lib/editors"
import { useEditors } from "@/store/editors"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/**
 * A mesma ação como ITEM de menu, pro menu de contexto do projeto na sidebar.
 *
 * Componente separado, e não uma prop do `OpenInEditor`: aquele monta um
 * `ContextMenu` próprio quando há vários editores, e menu dentro de menu é
 * exatamente o tipo de aninhamento que quebra foco no Radix. Aqui não há
 * escolha a oferecer — abre no preferido, e quem quiser trocar usa o botão do
 * diff, que é onde a decisão aparece com frequência.
 */
export function OpenProjectInEditorItem({ projectPath }: { projectPath: string }) {
  const detected = useEditors((s) => s.detected)
  const ensure = useEditors((s) => s.ensure)
  const preferred = useApp((s) => s.settings.preferredEditor)
  useEffect(() => ensure(), [ensure])

  const escolhido = pickEditor(detected ?? [], preferred)
  if (!escolhido) return null // sem editor, sem item (§5, degradação honesta)
  return (
    <ContextMenuItem
      onSelect={() => {
        void openInEditor({ editor: escolhido.id, projectPath, rel: "" }).catch(
          (e: unknown) =>
            toast.error(
              typeof e === "string" && e ? e : "Não consegui abrir no editor",
            ),
        )
      }}
    >
      <SquareArrowOutUpRight /> Abrir no {escolhido.label}
    </ContextMenuItem>
  )
}

export function OpenInEditor({
  projectPath,
  rel,
  line,
  className,
  /** O que dizer no tooltip depois de "Abrir no": um arquivo ou o projeto. */
  alvo,
}: {
  projectPath: string
  rel: string
  line?: number | null
  className?: string
  alvo: string
}) {
  const detected = useEditors((s) => s.detected)
  const ensure = useEditors((s) => s.ensure)
  const preferred = useApp((s) => s.settings.preferredEditor)
  const setSettings = useApp((s) => s.setSettings)

  // Quem PRECISA do dado é quem pede. A store dedupe (uma vez por sessão),
  // então N botões na tela não viram N probes.
  useEffect(() => ensure(), [ensure])

  const eds = detected ?? []
  const escolhido = pickEditor(eds, preferred)
  if (!escolhido) return null

  async function abrir(editor: string, lembrar: boolean) {
    if (lembrar) setSettings({ preferredEditor: editor })
    try {
      await openInEditor({ editor, projectPath, rel, line })
    } catch (e) {
      // O Rust já devolve o motivo (não instalado, fora do projeto, spawn
      // falhou). Engolir aqui deixaria o clique sem resposta nenhuma.
      toast.error(typeof e === "string" && e ? e : "Não consegui abrir no editor")
    }
  }

  const botao = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation() // o cabeçalho do diff é um botão de expandir
        void abrir(escolhido.id, false)
      }}
      title={
        `Abrir ${alvo} no ${escolhido.label}${line ? ` (linha ${line})` : ""}` +
        (eds.length > 1 ? " · botão direito pra escolher outro" : "")
      }
      className={cn(
        "rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <SquareArrowOutUpRight className="size-3.5" />
      <span className="sr-only">Abrir no {escolhido.label}</span>
    </button>
  )

  // Um editor só: não há escolha a oferecer, então não há menu.
  if (eds.length === 1) return botao

  // Botão direito, e não um chevron ao lado: o clique ESQUERDO precisa fazer a
  // coisa óbvia (abrir). Um trigger de dropdown no mesmo botão roubaria o
  // clique, e um segundo botão só pro menu põe dois controles onde a decisão é
  // uma só, e rara.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{botao}</ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="min-w-40"
      >
        {eds.map((ed) => (
          <ContextMenuItem
            key={ed.id}
            onSelect={() => void abrir(ed.id, true)}
            className="text-[12px]"
          >
            {ed.label}
            {ed.id === escolhido.id && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                padrão
              </span>
            )}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
