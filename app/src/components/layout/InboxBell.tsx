// O sino (ADR-271) responde duas perguntas, nesta ordem: o que está parado
// esperando você agora, e o que aconteceu enquanto você não olhava.
//
// A primeira é derivada de estado vivo (`lib/sino/esperando`) e some sozinha;
// a segunda é o feed, agrupado por conversa e dia (`lib/sino/agrupar`). É um
// painel de conteúdo, não uma lista de comandos, por isso `Popover` (§12).

import { useState } from "react"
import { Bell, CheckCheck, Ellipsis, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { secaoDoMotor } from "@/components/settings/sections"
import { ToolsSection, useToolsSection } from "@/components/layout/ToolsSection"
import { SecaoEsperando } from "@/components/layout/sino/SecaoEsperando"
import { SecaoAtividade, type AcoesDaAtividade } from "@/components/layout/sino/SecaoAtividade"
import { useEsperandoVoce } from "@/components/layout/sino/useEsperandoVoce"
import { abrirConversa, abrirEspera } from "@/components/layout/sino/navegar"
import { avisar } from "@/lib/avisos"
import { agruparAtividade, soNaoLidas } from "@/lib/sino/agrupar"
import { conversationTitle } from "@/lib/traySnapshot"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { dispensarProposta, varrerDecisoes } from "@/store/filaDeDecisoes"
import { useNotifs } from "@/store/notifications"

function limparAtividade() {
  const antes = useNotifs.getState().items
  useNotifs.getState().clear()
  avisar.feito("Atividade limpa.", {
    acao: { rotulo: "Desfazer", fazer: () => useNotifs.getState().restore(antes) },
  })
}

function Segmento({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        controle("chip"),
        "transition-colors",
        ativo ? "bg-sel text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function InboxBell() {
  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState<"tudo" | "naoLidas">("tudo")
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const projects = useApp((s) => s.projects)
  const titulos = useChat((s) => s.conversationsByProject)
  const notifs = useNotifs((s) => s.items)
  const tools = useToolsSection()
  const esperando = useEsperandoVoce(tools.authItems)

  const naoLidas = notifs.filter((n) => !n.read).length
  // A idade das linhas é lida a cada render, não um relógio que tica.
  const now = Date.now()
  const todosOsDias = aberto ? agruparAtividade(notifs, now) : []
  const dias = filtro === "naoLidas" ? soNaoLidas(todosOsDias) : todosOsDias

  const abrirMotor = (agent: string) => setSettingsOpen(true, secaoDoMotor(agent))
  const fechar = () => setAberto(false)

  const acoes: AcoesDaAtividade = {
    tituloDe: (convId, projectId) => conversationTitle(titulos, convId, projectId),
    projetoDe: (projectId) => projects.find((p) => p.id === projectId)?.name ?? null,
    abrirGrupo: (g) => {
      fechar()
      useNotifs.getState().markConvRead(g.convId)
      void abrirConversa(g.projectId, g.convId)
    },
    abrirItem: (n) => {
      fechar()
      useNotifs.getState().markRead(n.id)
      void abrirConversa(n.projectId, n.convId)
    },
    tirar: (ids) => {
      for (const id of ids) useNotifs.getState().remove(id)
    },
  }

  const nada = esperando.itens.length === 0 && notifs.length === 0 && !tools.hasSection

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v)
        if (v) {
          // Decisão tomada em outro lugar aparece certa na hora de abrir.
          tools.reloadModels()
          void varrerDecisoes()
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icone-padrao"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          title="Notificações"
          aria-label={
            esperando.total > 0
              ? `Notificações, ${esperando.total} esperando você`
              : "Notificações"
          }
        >
          {/* O selo ancora no GLIFO, não no botão: o centro dele fica no canto
              do desenho, e o offset é metade do tamanho (size-4 → -2, size-2
              → -1). O anel na cor do trilho recorta o selo do desenho. */}
          <span className="relative flex size-4 items-center justify-center">
            <Bell className="size-4" />
            {/* Número âmbar só para o que espera você, com a conta da bandeja
                (por conversa). Não visto é só um ponto: somar os dois faria
                "3" ser ambíguo entre esperas e turnos. A tinta do dígito é
                `st-warning-foreground` pelo contraste no tema claro. */}
            {esperando.total > 0 ? (
              <span className="absolute -top-2 -right-2 grid size-4 place-items-center rounded-full bg-st-warning text-[11px] font-semibold text-st-warning-foreground ring-2 ring-rail">
                {esperando.total > 9 ? "9+" : esperando.total}
              </span>
            ) : naoLidas > 0 ? (
              <span
                className="absolute -top-1 -right-1 size-2 rounded-full bg-muted-foreground ring-2 ring-rail"
                title={`${naoLidas} não vistas`}
              />
            ) : null}
          </span>
        </Button>
      </PopoverTrigger>
      {/* z-[120]: o header da TitleBar é z-[110], e no z-50 padrão a borda de
          cima do painel ficava atrás da faixa de título. */}
      <PopoverContent align="end" className="z-[120] max-h-[75vh] w-96 overflow-y-auto p-1">
        <div className="sticky top-0 z-10 -mx-1 -mt-1 flex items-center gap-1 bg-popover px-3 pt-2 pb-1">
          <span className="flex-1 text-[13px] font-semibold">Notificações</span>
          {notifs.length > 0 && (
            <>
              <Segmento ativo={filtro === "tudo"} onClick={() => setFiltro("tudo")}>
                Tudo
              </Segmento>
              <Segmento ativo={filtro === "naoLidas"} onClick={() => setFiltro("naoLidas")}>
                Não vistas{naoLidas > 0 ? ` ${naoLidas}` : ""}
              </Segmento>
              <button
                type="button"
                onClick={() => useNotifs.getState().markAllRead()}
                disabled={naoLidas === 0}
                title="Marcar tudo como visto"
                aria-label="Marcar tudo como visto"
                className={cn(
                  controle("chip", { quadrado: true }),
                  "text-muted-foreground transition-colors hover:bg-sel hover:text-foreground disabled:opacity-40",
                )}
              >
                <CheckCheck className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Mais"
                    aria-label="Mais ações da atividade"
                    className={cn(
                      controle("chip", { quadrado: true }),
                      "text-muted-foreground transition-colors hover:bg-sel hover:text-foreground",
                    )}
                  >
                    <Ellipsis className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[130]">
                  <DropdownMenuItem onSelect={limparAtividade}>
                    <Trash2 />
                    Limpar a atividade
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>

        <SecaoEsperando
          esperando={esperando}
          now={now}
          onAbrir={(e) => {
            fechar()
            abrirEspera(e, abrirMotor)
          }}
          onDispensarProposta={(id) =>
            void dispensarProposta(id).catch((err) => {
              // Falhou = a proposta fica na fila, e o motivo não some.
              console.warn("[sino] falha ao dispensar a proposta", err)
              avisar.erro("Falha ao dispensar a proposta")
            })
          }
        />

        <SecaoAtividade
          dias={dias}
          now={now}
          vazio={notifs.length > 0 && filtro === "naoLidas" ? "Nada por ver." : null}
          acoes={acoes}
        />

        <ToolsSection state={tools} openSettings={(secao) => setSettingsOpen(true, secao)} />

        {nada && (
          <div className="px-2 py-4 text-center text-[13px] text-muted-foreground">
            Tudo em dia. Nada por aqui.
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
