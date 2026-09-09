import { useMemo, useState } from "react"
import { ArrowLeft, Plus, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
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
import {
  buildCreateInput,
  canCreate,
  categoriaDe,
  emptyCreateForm,
  especialistaResumo,
  previewSeed,
  type CreateFormState,
} from "@/lib/marketplace"
import type { AgentDef, PresetScope } from "@/lib/agentDefs"
import { usePresets } from "@/store/presets"
import { cn } from "@/lib/utils"

const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Tag({ children, forte }: { children: React.ReactNode; forte?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-px text-[11px]",
        forte ? "border-border-strong text-foreground" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

/** Vista de criar/editar/duplicar (form à esquerda, preview ao vivo à direita). */
export function CreateView({
  editing,
  initialForm,
  initialScope,
  projectPath,
  onBack,
  onSaved,
}: {
  /** Persona sendo editada (null = criar novo ou duplicando). */
  editing: AgentDef | null
  initialForm?: CreateFormState
  initialScope?: PresetScope
  projectPath: string | null
  onBack: () => void
  onSaved: () => void
}) {
  const isDuplicating = !editing && !!initialForm
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
      : initialForm ?? emptyCreateForm(),
  )
  const [scope, setScope] = useState<PresetScope>(
    editing?.scope ?? initialScope ?? (projectPath ? "projeto" : "global"),
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
      <div className="border-b border-border/40 px-6 py-4">
        <div className="text-[14px] font-semibold text-foreground">
          {editing
            ? "Editar especialista"
            : isDuplicating
              ? "Duplicar especialista"
              : "Novo especialista"}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {isDuplicating
            ? "Crie uma cópia ajustando nome, motor, escopo ou rubrica."
            : "Identidade, briefing e rubrica. O card à direita monta ao vivo."}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] overflow-hidden">
        {/* Form */}
        <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-6 py-4">
          {/* Escopo: só na criação/duplicação (mover o arquivo quebraria carimbos). */}
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
                      controle("chip"),
                      "transition-colors disabled:opacity-40",
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
                  size="padrao"
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
                    className="flex items-center gap-2 text-[13px] text-foreground"
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
                size="padrao"
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
              className="h-8 font-mono text-[13px]"
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
                  agentEfforts(form.backend, form.model).length > 0
                    ? agentEfforts(form.backend, form.model)
                    : [{ value: "default", label: "Padrão" }]
                }
                triggerClassName={SELECT_TRIGGER}
                aria-label="Esforço do especialista"
              />
            </Fld>
          </div>
        </div>

        {/* Preview ao vivo */}
        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-border/40 bg-rail px-4 py-4">
          <div className="text-[11px] font-medium text-muted-foreground/70">
            Prévia do card
          </div>
          <div className="flex flex-col gap-2.5 rounded-md border border-border bg-card/60 p-3.5">
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
                <div className="truncate text-[12px] text-muted-foreground">
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
              <Tag forte>
                {form.model === "default"
                  ? form.backend
                  : `${form.backend} · ${form.model}`}
              </Tag>
            </div>
            <div className="border-t border-border/40 pt-2.5">
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

      <div className="flex items-center gap-2 border-t border-border/40 px-6 py-3">
        <Button size="padrao" variant="ghost" onClick={onBack} className="mr-auto">
          <ArrowLeft className="size-3.5" /> Voltar
        </Button>
        <Button size="padrao" onClick={() => void salvar()} disabled={!canCreate(form) || saving}>
          {editing ? "Salvar versão" : isDuplicating ? "Criar cópia" : "Criar especialista"}
        </Button>
      </div>
    </div>
  )
}
