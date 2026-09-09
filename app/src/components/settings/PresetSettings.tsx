// Settings · Presets de persona (Sprint 3 · E2, S3.6): CRUD dos agent_presets.
// Lista + criar/editar (nome, personality, skills, policy, backend/modelo/
// esforço) com preview AO VIVO do digest (8 primeiros hex) — o usuário vê a
// identidade da versão mudar enquanto edita. Visual segue as Settings.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { RichSelect } from "@/components/ui/RichSelect"
import {
  DESTINATIONS,
  agentEfforts,
  agentModels,
  normalizeModelValue,
} from "@/lib/agents"
import type { AgentPresetInput } from "@/lib/db"
import type { AgentDef, PresetScope } from "@/lib/agentDefs"
import { parseSkillsText, presetDigest, shortDigest } from "@/lib/presets"
import { usePresets } from "@/store/presets"
import { useActiveProject } from "@/store/app"

const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"

interface Draft {
  /** null = criando; senão editando o preset deste id. */
  id: string | null
  /** Onde o arquivo mora. Só editável na CRIAÇÃO — mudar depois moveria o
   *  arquivo e quebraria o carimbo das conversas que apontam pra ele. */
  scope: PresetScope
  name: string
  personalityMd: string
  /** Skills como texto (uma por linha ou separadas por vírgula). */
  skillsText: string
  policy: string
  backend: string
  model: string
  effort: string
  /** E2 — identidade/marketplace. Aqui (fallback) só passam adiante; a UI rica
   *  (categoria/rubrica/avatar) mora no marketplace (Especialistas). */
  category: string
  rubric: string[]
  avatarStyle: string
  avatarSeed: string
}

function emptyDraft(scope: PresetScope): Draft {
  return {
    id: null,
    scope,
    name: "",
    personalityMd: "",
    skillsText: "",
    policy: "",
    backend: "claude-code",
    model: "default",
    effort: "default",
    category: "Geral",
    rubric: [],
    // vazio = default do sistema (thumbs); a cor vem da categoria (lib/avatar).
    avatarStyle: "",
    avatarSeed: "",
  }
}

function draftFrom(p: AgentDef): Draft {
  return {
    id: p.id,
    scope: p.scope,
    name: p.name,
    personalityMd: p.personalityMd,
    skillsText: p.skills.join("\n"),
    policy: p.policy ?? "",
    backend: p.backend,
    model: p.model ?? "default",
    effort: p.effort ?? "default",
    category: p.category,
    rubric: p.rubric,
    avatarStyle: p.avatarStyle,
    avatarSeed: p.avatarSeed,
  }
}

function toInput(d: Draft): AgentPresetInput {
  return {
    name: d.name.trim(),
    personalityMd: d.personalityMd,
    skills: parseSkillsText(d.skillsText),
    policy: d.policy.trim() ? d.policy.trim() : null,
    backend: d.backend,
    model: d.model === "default" ? null : d.model,
    effort: d.effort === "default" ? null : d.effort,
    category: d.category.trim() || "Geral",
    rubric: d.rubric,
    avatarStyle: d.avatarStyle,
    // seed vazia = default (= slug), resolvido no serialize/parse.
    avatarSeed: d.avatarSeed,
  }
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function PresetSettings() {
  const list = usePresets((s) => s.list)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [digestPreview, setDigestPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const project = useActiveProject()
  const projectPath = project?.path ?? null
  useEffect(() => {
    void usePresets.getState().load(projectPath)
  }, [projectPath])

  // Preview do digest AO VIVO: recomputa a cada mudança do draft (sha256 é
  // barato; o token de corrida descarta resultados atrasados).
  const digestInput = useMemo(
    () => (draft ? toInput(draft) : null),
    [draft],
  )
  useEffect(() => {
    if (!digestInput) {
      setDigestPreview(null)
      return
    }
    let cancelled = false
    void presetDigest(digestInput).then((d) => {
      if (!cancelled) setDigestPreview(d)
    })
    return () => {
      cancelled = true
    }
  }, [digestInput])

  async function save() {
    if (!draft) return
    const input = toInput(draft)
    if (!input.name || !input.personalityMd.trim()) return
    setSaving(true)
    try {
      if (draft.id) await usePresets.getState().update(draft.id, input)
      else await usePresets.getState().create(input, draft.scope)
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    !!draft && !!draft.name.trim() && !!draft.personalityMd.trim() && !saving

  return (
    <div>
      {/* pr-9: o "Novo preset" não passa por baixo do X do dialog (DialogCloseX). */}
      <div className="mb-2 flex items-center justify-between pr-9">
        <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          Presets de persona
        </h3>
        {!draft && (
          <button
            onClick={() => setDraft(emptyDraft(projectPath ? "projeto" : "global"))}
            className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="size-3.5" />
            Novo preset
          </button>
        )}
      </div>

      {list.length === 0 && !draft && (
        <p className="text-[13px] leading-snug text-muted-foreground">
          Nenhum preset ainda. Um preset dá nome, personalidade, skills e
          política a um agent; a conversa iniciada com ele fica carimbada com a
          versão exata (digest) da persona.
        </p>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {list.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-foreground">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 rounded border px-1 py-px text-[11px] tracking-wide text-muted-foreground uppercase">
                    v{p.version}
                  </span>
                  {/* Escopo: persona de projeto some ao trocar de projeto — o
                      selo evita a impressão de que ela "sumiu". */}
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-px text-[11px] font-medium tracking-wide uppercase",
                      p.scope === "projeto"
                        ? "bg-brass/15 text-brass"
                        : "bg-secondary text-muted-foreground/70",
                    )}
                    title={
                      p.scope === "projeto"
                        ? "Vale só neste projeto (.mycockpit/agents)"
                        : "Vale em todos os projetos (~/.mycockpit/agents)"
                    }
                  >
                    {p.scope}
                  </span>
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {p.backend}
                  {p.model ? ` · ${p.model}` : ""}
                  {p.skills.length > 0
                    ? ` · ${p.skills.length} skill${p.skills.length > 1 ? "s" : ""}`
                    : ""}
                  {" · "}
                  <span className="font-mono">{shortDigest(p.digest)}</span>
                </div>
              </div>
              <Button
                size="icone-padrao"
                variant="ghost"
                onClick={() => setDraft(draftFrom(p))}
                aria-label={`Editar ${p.name}`}
                title="Editar"
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icone-padrao"
                variant="ghost"
                onClick={() => void usePresets.getState().remove(p.id)}
                aria-label={`Excluir ${p.name}`}
                title="Excluir (conversas antigas mantêm o carimbo e avisam)"
                className="text-muted-foreground hover:text-st-error"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="mt-3 flex flex-col gap-4 rounded-lg border border-border/50 bg-secondary/10 p-4">
          {/* Escopo só na CRIAÇÃO: trocar depois moveria o arquivo e as
              conversas carimbadas passariam a achar a persona apagada. */}
          {!draft.id && (
            <FieldRow label="Onde vale">
              <div className="flex items-center gap-0.5 self-start rounded-lg bg-secondary/70 p-0.5">
                {(["projeto", "global"] as PresetScope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={s === "projeto" && !projectPath}
                    onClick={() => setDraft({ ...draft, scope: s })}
                    title={
                      s === "projeto"
                        ? projectPath
                          ? `Só neste projeto · ${projectPath}/.mycockpit/agents`
                          : "Abra um projeto para criar uma persona só dele"
                        : "Em todos os projetos · ~/.mycockpit/agents"
                    }
                    className={cn(
                      "h-6 rounded-md px-2.5 text-[12px] transition-colors disabled:opacity-40",
                      draft.scope === s
                        ? "bg-card text-foreground shadow-[var(--shadow-sm)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s === "projeto" ? "Este projeto" : "Todos os projetos"}
                  </button>
                ))}
              </div>
            </FieldRow>
          )}
          <FieldRow label="Nome">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="ex.: UI Engineer"
              className="h-8 text-[13px]"
              aria-label="Nome do preset"
            />
          </FieldRow>
          <FieldRow label="Personalidade (markdown, vai no 1º turno da conversa)">
            <Textarea
              value={draft.personalityMd}
              onChange={(e) =>
                setDraft({ ...draft, personalityMd: e.target.value })
              }
              placeholder="Quem é esta persona, como trabalha, o que prioriza…"
              className="min-h-[110px] text-[13px]"
              aria-label="Personalidade do preset"
            />
          </FieldRow>
          <FieldRow label="Skills do projeto (uma por linha ou vírgulas; validadas no 1º envio)">
            <Textarea
              value={draft.skillsText}
              onChange={(e) =>
                setDraft({ ...draft, skillsText: e.target.value })
              }
              placeholder={"revisar-pr\ntestes"}
              className="min-h-[60px] font-mono text-[13px]"
              aria-label="Skills do preset"
            />
          </FieldRow>
          <FieldRow label="Política (opcional, uma linha de conduta)">
            <Input
              value={draft.policy}
              onChange={(e) => setDraft({ ...draft, policy: e.target.value })}
              placeholder="ex.: nunca commita; sempre roda os testes antes de entregar"
              className="h-8 text-[13px]"
              aria-label="Política do preset"
            />
          </FieldRow>
          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="Agent">
              <RichSelect
                value={draft.backend}
                onValueChange={(v) =>
                  setDraft({ ...draft, backend: v, model: "default", effort: "default" })
                }
                options={DESTINATIONS.filter((d) => d.available).map((d) => ({
                  value: d.id,
                  label: d.label,
                }))}
                triggerClassName={SELECT_TRIGGER}
                aria-label="Agent do preset"
              />
            </FieldRow>
            <FieldRow label="Modelo">
              <RichSelect
                value={
                  normalizeModelValue(
                    draft.backend,
                    draft.model === "default" ? null : draft.model,
                  ) ?? "default"
                }
                onValueChange={(v) => setDraft({ ...draft, model: v })}
                options={agentModels(draft.backend)}
                triggerClassName={SELECT_TRIGGER}
                aria-label="Modelo do preset"
              />
            </FieldRow>
            <FieldRow label="Esforço">
              <RichSelect
                value={draft.effort}
                onValueChange={(v) => setDraft({ ...draft, effort: v })}
                options={
                  agentEfforts(draft.backend, draft.model).length > 0
                    ? agentEfforts(draft.backend, draft.model)
                    : [{ value: "default", label: "Padrão" }]
                }
                triggerClassName={SELECT_TRIGGER}
                aria-label="Esforço do preset"
              />
            </FieldRow>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[11px] text-muted-foreground"
              title="Identidade desta versão da persona (sha256 dos campos). Muda quando qualquer campo muda; conversas antigas guardam o digest com que começaram."
            >
              digest {digestPreview ? shortDigest(digestPreview) : "…"}
              {draft.id ? " · salvar cria uma versão nova" : ""}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="padrao" variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button size="padrao" onClick={() => void save()} disabled={!canSave}>
                {draft.id ? "Salvar versão" : "Criar preset"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
        O preset entra no 1º turno da conversa (bloco de persona no prompt) e
        trava agent, modelo e esforço de uma vez. Skill referenciada que não
        existe no projeto aborta o envio antes de gastar turno.
      </p>
    </div>
  )
}
