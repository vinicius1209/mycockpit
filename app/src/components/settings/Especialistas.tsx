// Marketplace de Especialistas (E2 · S2.3/S2.4) — Dialog shadcn LARGO sobre a
// conversa, padrão blocks.so Member-List → grid de cards. Três vistas no MESMO
// dialog: lista (grid + busca + categoria), detalhe (briefing/rubrica/config/
// como invocar) e criar (form + preview ao vivo + seletor de estilo DiceBear +
// "variar" + rubrica + categoria + escopo). Reusa o CRUD existente (usePresets
// create/update/remove → saveAgentDef); NÃO reimplementa disco. Fonte de
// verdade continua o arquivo .mycockpit/agents/*.md. Referência: o mock
// docs/mocks/marketplace.html.

import { useMemo, useState } from "react"
import {
  ArrowLeft,
  Copy,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { shortDigest } from "@/lib/presets"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"
import {
  ALL_CATEGORY,
  categoriaDe,
  duplicateFormState,
  especialistaResumo,
  filterEspecialistas,
  marketplaceCategories,
  type CreateFormState,
} from "@/lib/marketplace"
import type { AgentDef, PresetScope } from "@/lib/agentDefs"
import { isTauri } from "@/lib/db"
import { usePresets } from "@/store/presets"
import { useActiveProject } from "@/store/app"
import { cn } from "@/lib/utils"
import { CreateView } from "./EspecialistaCreateView"

type View =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  /** editId null = criando novo ou duplicando; senão editando aquela persona. */
  | {
      kind: "create"
      editId: string | null
      initialForm?: CreateFormState
      initialScope?: PresetScope
    }

/** Tag pequena (categoria/modelo/escopo) do card e do detalhe. */
function Tag({ children, forte }: { children: React.ReactNode; forte?: boolean }) {
  return (
    <span
      className={cn(
        // Metadado não tem tinta (§2): `brass` virou `forte`, por CONTRASTE.
        "rounded-full border px-2 py-px text-[11px]",
        forte ? "border-border-strong text-foreground" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function modelTag(d: Pick<AgentDef, "backend" | "model">): string {
  return d.model ? `${d.backend} · ${d.model}` : d.backend
}

/** Um card do grid. */
function EspecialistaCard({
  def,
  onOpen,
  onEdit,
  onDuplicate,
}: {
  def: AgentDef
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
}) {
  return (
    // O cartão NÃO é um `role="button"`. Ele contém dois botões reais (editar,
    // duplicar), e botão dentro de algo com papel de botão é aninhamento
    // inválido: o leitor de tela anuncia um controle só e as ações internas
    // somem. O clique no cartão continua existindo como CONVENIÊNCIA de mouse;
    // quem carrega o teclado e a semântica é o botão do nome, abaixo.
    <div
      onClick={onOpen}
      className="group flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-3.5 text-left transition-colors hover:border-border/80 hover:bg-card cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <AgentAvatar def={def} size={40} />
          <div className="min-w-0">
            {/* O nome é o controle de abrir: um `<button>` de verdade, então
                ganha foco, Enter e Espaço de graça, sem reimplementar teclado.
                `text-left` porque botão centraliza por padrão e o nome alinha
                pelo glifo com a categoria de baixo (§14). */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              className="block max-w-full truncate text-left text-[14px] font-semibold text-foreground"
            >
              {def.name}
            </button>
            <div className="truncate text-[12px] text-muted-foreground">
              {categoriaDe(def)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
          <Button
            size="chip"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            title="Editar especialista"
            aria-label={`Editar ${def.name}`}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            size="chip"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            title="Duplicar especialista"
            aria-label={`Duplicar ${def.name}`}
          >
            <Copy className="size-3" />
          </Button>
        </div>
      </div>
      <p className="line-clamp-2 min-h-[34px] text-[12px] leading-snug text-muted-foreground">
        {especialistaResumo(def.personalityMd) || "Sem briefing ainda."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Tag>{categoriaDe(def)}</Tag>
        <Tag forte>{modelTag(def)}</Tag>
        <Tag>{def.scope}</Tag>
      </div>
      <div className="mt-0.5 flex items-center justify-between border-t border-border/60 pt-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          @{def.slug}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground/70">
          v{def.version} · {shortDigest(def.digest)}
        </span>
      </div>
    </div>
  )
}

/** Vista de detalhe (mesmo dialog). */
function DetailView({
  def,
  onBack,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  def: AgentDef
  onBack: () => void
  onEdit: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
        <AgentAvatar def={def} size={48} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {def.name}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {categoriaDe(def)} · conselheiro (só leitura)
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <SectionLabel>Briefing</SectionLabel>
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">
          {def.personalityMd.trim() || "Sem briefing definido."}
        </div>

        {def.rubric.length > 0 && (
          <>
            <SectionLabel>Rubrica, o que ele checa</SectionLabel>
            <ul className="list-disc pl-5 text-[13px] text-foreground/90">
              {def.rubric.map((r, i) => (
                <li key={i} className="mb-1">{r}</li>
              ))}
            </ul>
          </>
        )}

        <SectionLabel>Configuração</SectionLabel>
        <div className="text-[13px]">
          <KV k="Categoria" v={categoriaDe(def)} />
          <KV k="Agent" v={def.backend} />
          <KV k="Modelo" v={def.model ?? "padrão"} />
          {def.effort && <KV k="Esforço" v={def.effort} />}
          {def.skills.length > 0 && (
            <KV k="Skills" v={def.skills.map((s) => `/${s}`).join(", ")} />
          )}
          {def.policy && <KV k="Política" v={def.policy} />}
          <KV
            k="Escopo"
            v={def.scope === "projeto" ? "Só neste projeto" : "Todos os projetos"}
          />
          <KV k="Versão" v={`v${def.version} · ${shortDigest(def.digest)}`} mono />
        </div>

        <SectionLabel>Como invocar</SectionLabel>
        <p className="text-[13px] text-muted-foreground">
          No composer, mencione{" "}
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            @{def.name.toLowerCase()}
          </span>{" "}
          (ou{" "}
          <span className="font-mono text-[12px] text-foreground">
            @{def.slug}
          </span>
          ) para ele ler o contexto atual e dar um parecer inline.
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-border/60 px-6 py-3">
        <Button size="padrao" variant="ghost" onClick={onBack} className="mr-auto">
          <ArrowLeft className="size-3.5" /> Voltar
        </Button>
        {isTauri() && def.path && (
          <Button
            size="padrao"
            variant="ghost"
            onClick={() => void revealItemInDir(def.path)}
            title="Mostrar na pasta"
          >
            <FolderOpen className="size-3.5" /> Mostrar na pasta
          </Button>
        )}
        <Button
          size="padrao"
          variant="ghost"
          onClick={onRemove}
          className="text-muted-foreground hover:text-st-error"
        >
          <Trash2 className="size-3.5" /> Excluir
        </Button>
        <Button size="padrao" variant="outline" onClick={onDuplicate}>
          <Copy className="size-3.5" /> Duplicar
        </Button>
        <Button size="padrao" onClick={onEdit}>
          <Pencil className="size-3.5" /> Editar
        </Button>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-2 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase first:mt-0">
      {children}
    </div>
  )
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("text-right text-foreground", mono && "font-mono")}>
        {v}
      </span>
    </div>
  )
}



/** Miolo do marketplace (grid + detalhe + criar), reusável: vai INLINE nas
 *  Configurações e também dentro do Dialog do atalho da conversa. `onClose`
 *  presente = mostra "Fechar" (só no modo dialog). */
export function EspecialistasContent({ onClose }: { onClose?: () => void }) {
  const list = usePresets((s) => s.list)
  const project = useActiveProject()
  const projectPath = project?.path ?? null

  const [view, setView] = useState<View>({ kind: "list" })
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState(ALL_CATEGORY)
  const [installing, setInstalling] = useState(false)

  const categories = useMemo(() => marketplaceCategories(list), [list])
  const filtered = useMemo(
    () => filterEspecialistas(list, category, query),
    [list, category, query],
  )
  const selected =
    view.kind === "detail" ? list.find((d) => d.id === view.id) ?? null : null

  function backToList() {
    setView({ kind: "list" })
  }

  function duplicate(def: AgentDef) {
    setView({
      kind: "create",
      editId: null,
      initialForm: duplicateFormState(def),
      initialScope: def.scope,
    })
  }

  async function remove(def: AgentDef) {
    await usePresets.getState().remove(def.id)
    backToList()
  }

  async function instalarEquipe() {
    if (installing) return
    setInstalling(true)
    try {
      await usePresets.getState().installStarterTeam()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view.kind === "list" && (
        <>
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-[14px] font-semibold text-foreground">
              Especialistas
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Personas do projeto e globais. Mencione uma com @ na conversa,
              ela lê o contexto e opina. Você supervisiona.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
            <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                aria-label="Buscar especialista"
                className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  category === c ? SELECTED_FILL : UNSELECTED,
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 overflow-y-auto border-t border-border/60 p-4">
            {list.length === 0 ? (
              // cold start → AÇÃO, não beco: instala a equipe inicial ou cria do zero.
              <div className="col-span-full flex flex-col items-center gap-3.5 py-12 text-center">
                {/* §2: ícone de empty state não é brass. */}
                <div className="grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <Users className="size-5" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-foreground">
                    Comece com uma equipe pronta
                  </div>
                  <p className="mx-auto mt-1 max-w-[380px] text-[13px] leading-snug text-muted-foreground">
                    Seis especialistas (arquitetura, segurança, produto, custo,
                    design e testes) prontos pra mencionar com @ na conversa.
                    Edite ou remova quando quiser.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="padrao"
                    onClick={() => void instalarEquipe()}
                    disabled={installing}
                  >
                    <Sparkles className="size-3.5" />
                    {installing ? "Instalando…" : "Instalar equipe inicial"}
                  </Button>
                  <Button
                    size="padrao"
                    variant="ghost"
                    onClick={() => setView({ kind: "create", editId: null })}
                  >
                    Criar especialista
                  </Button>
                </div>
              </div>
            ) : (
              filtered.length === 0 && (
                <div className="col-span-full py-10 text-center text-[13px] text-muted-foreground">
                  Nada encontrado com esse filtro.
                </div>
              )
            )}
            {filtered.map((def) => (
              <EspecialistaCard
                key={def.id}
                def={def}
                onOpen={() => setView({ kind: "detail", id: def.id })}
                onEdit={() => setView({ kind: "create", editId: def.id })}
                onDuplicate={() => duplicate(def)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-border/60 px-6 py-3">
            <span className="mr-auto text-[12px] text-muted-foreground">
              <b className="text-foreground">{list.length}</b>{" "}
              {list.length === 1 ? "especialista" : "especialistas"}
            </span>
            {/* No estado vazio o CTA do centro ("Instalar equipe" + "Criar")
                já manda; o botão do footer só entra com o grid populado, pra não
                duplicar o "Criar especialista". */}
            {list.length > 0 && (
              <Button
                size="padrao"
                onClick={() => setView({ kind: "create", editId: null })}
              >
                <Plus className="size-3.5" /> Criar especialista
              </Button>
            )}
            {onClose && (
              <Button size="padrao" variant="ghost" onClick={onClose}>
                Fechar
              </Button>
            )}
          </div>
        </>
      )}

      {view.kind === "detail" &&
        (selected ? (
          <DetailView
            def={selected}
            onBack={backToList}
            onEdit={() => setView({ kind: "create", editId: selected.id })}
            onDuplicate={() => duplicate(selected)}
            onRemove={() => void remove(selected)}
          />
        ) : (
          // a persona sumiu (apagada em outra aba/à mão) — volta pra lista
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
            <p className="text-[13px] text-muted-foreground">
              Esse especialista não está mais na lista.
            </p>
            <Button size="padrao" variant="outline" onClick={backToList}>
              Voltar
            </Button>
          </div>
        ))}

      {view.kind === "create" && (
        <CreateView
          editing={
            view.editId ? list.find((d) => d.id === view.editId) ?? null : null
          }
          initialForm={view.initialForm}
          initialScope={view.initialScope}
          projectPath={projectPath}
          onBack={backToList}
          onSaved={backToList}
        />
      )}
    </div>
  )
}

/** Wrapper Dialog: o mesmo miolo, aberto SOBRE a conversa (atalho do composer/
 *  topo). Nas Configurações o miolo entra inline, sem dialog-sobre-dialog.
 *  Usa o <AppDialog> (size xl = a largura do marketplace); o corpo controla a
 *  própria altura/scroll via className (p-0 + altura fixa + overflow-hidden) e o
 *  X padrão do AppDialog cuida do fechar. */
export function Especialistas({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      className="flex h-[min(88vh,660px)] w-[94vw] flex-col gap-0 overflow-hidden rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)]"
    >
      <EspecialistasContent />
    </AppDialog>
  )
}
