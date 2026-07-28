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
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { RichSelect } from "@/components/ui/RichSelect"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import {
  DESTINATIONS,
  agentEfforts,
  agentModels,
  normalizeModelValue,
} from "@/lib/agents"
import { shortDigest } from "@/lib/presets"
import {
  ALL_CATEGORY,
  buildCreateInput,
  canCreate,
  categoriaDe,
  emptyCreateForm,
  especialistaResumo,
  filterEspecialistas,
  marketplaceCategories,
  previewSeed,
  type CreateFormState,
} from "@/lib/marketplace"
import type { AgentDef, PresetScope } from "@/lib/agentDefs"
import { usePresets } from "@/store/presets"
import { useActiveProject } from "@/store/app"
import { cn } from "@/lib/utils"

const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"

type View =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  /** editId null = criando novo; senão editando aquela persona. */
  | { kind: "create"; editId: string | null }

/** Tag pequena (categoria/modelo/escopo) do card e do detalhe. */
function Tag({ children, brass }: { children: React.ReactNode; brass?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-px text-[10.5px]",
        brass
          ? "border-brass/30 text-brass"
          : "border-border text-muted-foreground",
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
}: {
  def: AgentDef
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-3.5 text-left transition-colors hover:border-border/80 hover:bg-card"
    >
      <div className="flex items-center gap-3">
        <AgentAvatar def={def} size={40} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {def.name}
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {categoriaDe(def)}
          </div>
        </div>
      </div>
      <p className="line-clamp-2 min-h-[34px] text-[12px] leading-snug text-muted-foreground">
        {especialistaResumo(def.personalityMd) || "Sem briefing ainda."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Tag>{categoriaDe(def)}</Tag>
        <Tag brass>{modelTag(def)}</Tag>
        <Tag>{def.scope}</Tag>
      </div>
      <div className="mt-0.5 flex items-center justify-between border-t border-border/60 pt-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          @{def.slug}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground/70">
          v{def.version} · {shortDigest(def.digest)}
        </span>
      </div>
    </button>
  )
}

/** Vista de detalhe (mesmo dialog). */
function DetailView({
  def,
  onBack,
  onEdit,
  onRemove,
}: {
  def: AgentDef
  onBack: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
        <AgentAvatar def={def} size={48} />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-foreground">
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
            <ul className="list-disc pl-5 text-[12.5px] text-foreground/90">
              {def.rubric.map((r, i) => (
                <li key={i} className="mb-1">
                  {r}
                </li>
              ))}
            </ul>
          </>
        )}

        <SectionLabel>Configuração</SectionLabel>
        <div className="text-[12.5px]">
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
        <p className="text-[12.5px] text-muted-foreground">
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
        <Button size="sm" variant="ghost" onClick={onBack} className="mr-auto">
          <ArrowLeft className="size-3.5" /> Voltar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          className="text-muted-foreground hover:text-st-error"
        >
          <Trash2 className="size-3.5" /> Excluir
        </Button>
        <Button size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" /> Editar
        </Button>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-2 text-[10.5px] font-medium tracking-wide text-muted-foreground/70 uppercase first:mt-0">
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

/** Vista de criar/editar (form à esquerda, preview ao vivo à direita). */
function CreateView({
  editing,
  projectPath,
  onBack,
  onSaved,
}: {
  /** Persona sendo editada (null = criar novo). */
  editing: AgentDef | null
  projectPath: string | null
  onBack: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<CreateFormState>(() =>
    editing
      ? {
          name: editing.name,
          category: categoriaDe(editing),
          personalityMd: editing.personalityMd,
          rubric: editing.rubric,
          skillsText: editing.skills.join(", "),
          policy: editing.policy ?? "",
          backend: editing.backend,
          model: editing.model ?? "default",
          effort: editing.effort ?? "default",
          avatarStyle: editing.avatarStyle,
          avatarSalt: 0,
        }
      : emptyCreateForm(),
  )
  const [scope, setScope] = useState<PresetScope>(
    editing?.scope ?? (projectPath ? "projeto" : "global"),
  )
  const [rubDraft, setRubDraft] = useState("")
  const [saving, setSaving] = useState(false)

  // Editando, a seed original é preservada (salt 0 = seed do arquivo); criando,
  // a seed vem do nome. O preview usa a mesma regra do que será gravado.
  const previewDef = useMemo<
    Pick<AgentDef, "avatarStyle" | "avatarSeed" | "slug" | "name">
  >(() => {
    const seed =
      editing && form.avatarSalt === 0
        ? editing.avatarSeed
        : previewSeed(form.name, form.avatarSalt)
    return {
      avatarStyle: form.avatarStyle,
      avatarSeed: seed,
      slug: editing?.slug ?? previewSeed(form.name, 0),
      name: form.name,
    }
  }, [editing, form.name, form.avatarStyle, form.avatarSalt])

  function set<K extends keyof CreateFormState>(k: K, v: CreateFormState[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function addRubrica() {
    const t = rubDraft.trim()
    if (!t) return
    set("rubric", [...form.rubric, t])
    setRubDraft("")
  }

  async function salvar() {
    if (!canCreate(form) || saving) return
    setSaving(true)
    try {
      const input = buildCreateInput(form)
      const store = usePresets.getState()
      // Editando preserva a seed do arquivo quando não variou (buildCreateInput
      // recomputa do nome; aqui respeitamos o preview já resolvido).
      input.avatarSeed = previewDef.avatarSeed
      if (editing) await store.update(editing.id, input)
      else await store.create(input, scope)
      onSaved()
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/60 px-6 py-4">
        <div className="text-[16px] font-semibold text-foreground">
          {editing ? "Editar especialista" : "Novo especialista"}
        </div>
        <div className="text-[12px] text-muted-foreground">
          Identidade, briefing e rubrica. O card à direita monta ao vivo.
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] overflow-hidden">
        {/* Form */}
        <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-6 py-4">
          {/* Escopo (S2.4) — só na criação (mover o arquivo quebraria carimbos). */}
          {!editing && (
            <Fld label="Onde vale">
              <div className="flex w-fit items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5">
                {(["projeto", "global"] as PresetScope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={s === "projeto" && !projectPath}
                    onClick={() => setScope(s)}
                    className={cn(
                      "h-6 rounded-md px-2.5 text-[12px] transition-colors disabled:opacity-40",
                      scope === s
                        ? "bg-card text-foreground shadow-[var(--shadow-sm)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title={
                      s === "projeto"
                        ? projectPath
                          ? `Só neste projeto · ${projectPath}/.mycockpit/agents`
                          : "Abra um projeto para criar uma persona só dele"
                        : "Em todos os projetos · ~/.mycockpit/agents"
                    }
                  >
                    {s === "projeto" ? "Este projeto" : "Todos os projetos"}
                  </button>
                ))}
              </div>
            </Fld>
          )}

          {/* Avatar DERIVADO: a cor vem da categoria, a forma da seed (nome).
              Nada de picker de estilo cru — o time é sempre uma família. */}
          <Fld label="Identidade, avatar">
            <div className="flex items-center gap-3.5">
              <AgentAvatar
                style={form.avatarStyle}
                seed={previewDef.avatarSeed}
                category={form.category}
                size={56}
              />
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => set("avatarSalt", form.avatarSalt + 1)}
                  className="w-fit"
                >
                  <RefreshCw className="size-3.5" /> Variar
                </Button>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  A cor vem da categoria; variar muda a forma.
                </span>
              </div>
            </div>
          </Fld>

          <div className="grid grid-cols-2 gap-3">
            <Fld label="Nome">
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="ex.: Aline"
                className="h-8 text-[13px]"
                aria-label="Nome do especialista"
              />
            </Fld>
            <Fld label="Categoria">
              <Input
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="ex.: Engenharia"
                className="h-8 text-[13px]"
                aria-label="Categoria do especialista"
              />
            </Fld>
          </div>

          <Fld label="Briefing, como ele pensa (vai no parecer/1º turno)">
            <Textarea
              value={form.personalityMd}
              onChange={(e) => set("personalityMd", e.target.value)}
              placeholder="Você é um arquiteto rigoroso. Antes de aprovar qualquer código, verifica fronteiras, acoplamento e corridas…"
              className="min-h-[90px] text-[13px]"
              aria-label="Briefing do especialista"
            />
          </Fld>

          <Fld label="Rubrica, o que ele checa">
            {form.rubric.length > 0 && (
              <ul className="mb-1.5 flex flex-col gap-1">
                {form.rubric.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-[12.5px] text-foreground"
                  >
                    <span className="text-muted-foreground">•</span>
                    <span className="min-w-0 flex-1 truncate">{r}</span>
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "rubric",
                          form.rubric.filter((_, j) => j !== i),
                        )
                      }
                      aria-label={`Remover item ${i + 1} da rubrica`}
                      className="text-muted-foreground hover:text-st-error"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                value={rubDraft}
                onChange={(e) => setRubDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addRubrica()
                  }
                }}
                placeholder="Adicionar item da rubrica…"
                className="h-8 text-[13px]"
                aria-label="Novo item da rubrica"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addRubrica}
                disabled={!rubDraft.trim()}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </Fld>

          <Fld label="Skills do projeto (vírgulas; validadas no 1º envio)">
            <Input
              value={form.skillsText}
              onChange={(e) => set("skillsText", e.target.value)}
              placeholder="revisar-pr, testes"
              className="h-8 font-mono text-[12.5px]"
              aria-label="Skills do especialista"
            />
          </Fld>

          <Fld label="Política (opcional)">
            <Input
              value={form.policy}
              onChange={(e) => set("policy", e.target.value)}
              placeholder="ex.: nunca escreve; só aponta"
              className="h-8 text-[13px]"
              aria-label="Política do especialista"
            />
          </Fld>

          <div className="grid grid-cols-3 gap-3">
            <Fld label="Agent">
              <RichSelect
                value={form.backend}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    backend: v,
                    model: "default",
                    effort: "default",
                  }))
                }
                options={DESTINATIONS.filter((d) => d.available).map((d) => ({
                  value: d.id,
                  label: d.label,
                }))}
                triggerClassName={SELECT_TRIGGER}
                aria-label="Agent do especialista"
              />
            </Fld>
            <Fld label="Modelo">
              <RichSelect
                value={
                  normalizeModelValue(
                    form.backend,
                    form.model === "default" ? null : form.model,
                  ) ?? "default"
                }
                onValueChange={(v) => set("model", v)}
                options={agentModels(form.backend)}
                triggerClassName={SELECT_TRIGGER}
                aria-label="Modelo do especialista"
              />
            </Fld>
            <Fld label="Esforço">
              <RichSelect
                value={form.effort}
                onValueChange={(v) => set("effort", v)}
                options={
                  agentEfforts(form.backend).length > 0
                    ? agentEfforts(form.backend)
                    : [{ value: "default", label: "Padrão" }]
                }
                triggerClassName={SELECT_TRIGGER}
                aria-label="Esforço do especialista"
              />
            </Fld>
          </div>
        </div>

        {/* Preview ao vivo */}
        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-border/60 bg-rail px-4 py-4">
          <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            Prévia do card
          </div>
          <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-3.5">
            <div className="flex items-center gap-3">
              <AgentAvatar
                style={form.avatarStyle}
                seed={previewDef.avatarSeed}
                category={form.category}
                size={40}
              />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-foreground">
                  {form.name || "Sem nome"}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {form.category.trim() || "Geral"}
                </div>
              </div>
            </div>
            <p className="min-h-[34px] text-[12px] leading-snug text-muted-foreground">
              {especialistaResumo(form.personalityMd) ||
                "O resumo aparece a partir do briefing."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Tag>{form.category.trim() || "Geral"}</Tag>
              <Tag brass>
                {form.model === "default"
                  ? form.backend
                  : `${form.backend} · ${form.model}`}
              </Tag>
            </div>
            <div className="border-t border-border/60 pt-2.5">
              {/* editando, o slug é FIXO (= o do arquivo); criando é o slug-base
                  (o slugLivre pode somar sufixo se já existir no escopo). */}
              <span className="font-mono text-[11px] text-muted-foreground">
                @{previewDef.slug}
                {!editing && " (pode ganhar sufixo se já existir)"}
              </span>
            </div>
          </div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            Grava em{" "}
            <span className="font-mono">
              {scope === "projeto"
                ? ".mycockpit/agents"
                : "~/.mycockpit/agents"}
            </span>
            . Editar o arquivo à mão também vale, o app relê.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-6 py-3">
        <Button size="sm" variant="ghost" onClick={onBack} className="mr-auto">
          <ArrowLeft className="size-3.5" /> Voltar
        </Button>
        <Button size="sm" onClick={() => void salvar()} disabled={!canCreate(form) || saving}>
          {editing ? "Salvar versão" : "Criar especialista"}
        </Button>
      </div>
    </div>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      {children}
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
            <h2 className="text-[17px] font-semibold text-foreground">
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
                  category === c
                    ? "border-brass/40 bg-brass/10 text-brass"
                    : "border-border text-muted-foreground hover:text-foreground",
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
                <div className="grid size-11 place-items-center rounded-full border border-brass/30 bg-brass/10 text-brass">
                  <Users className="size-5" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-foreground">
                    Comece com uma equipe pronta
                  </div>
                  <p className="mx-auto mt-1 max-w-[380px] text-[12.5px] leading-snug text-muted-foreground">
                    Seis especialistas (arquitetura, segurança, produto, custo,
                    design e testes) prontos pra mencionar com @ na conversa.
                    Edite ou remova quando quiser.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void instalarEquipe()}
                    disabled={installing}
                  >
                    <Sparkles className="size-3.5" />
                    {installing ? "Instalando…" : "Instalar equipe inicial"}
                  </Button>
                  <Button
                    size="sm"
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
                size="sm"
                onClick={() => setView({ kind: "create", editId: null })}
              >
                <Plus className="size-3.5" /> Criar especialista
              </Button>
            )}
            {onClose && (
              <Button size="sm" variant="ghost" onClick={onClose}>
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
            onRemove={() => void remove(selected)}
          />
        ) : (
          // a persona sumiu (apagada em outra aba/à mão) — volta pra lista
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
            <p className="text-[13px] text-muted-foreground">
              Esse especialista não está mais na lista.
            </p>
            <Button size="sm" variant="outline" onClick={backToList}>
              Voltar
            </Button>
          </div>
        ))}

      {view.kind === "create" && (
        <CreateView
          editing={
            view.editId ? list.find((d) => d.id === view.editId) ?? null : null
          }
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
