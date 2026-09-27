import { ChevronDown } from "lucide-react"
import { PillSelect } from "@/components/ui/PillSelect"
import { controle } from "@/components/ui/controle"
import { Selo } from "@/components/settings/parts"
import { pendencias } from "@/components/settings/pendencias"
import type { ProjetoDasConfiguracoes } from "@/components/settings/projetoDasConfiguracoes"
import {
  precisaDeAtencao,
  sectionDef,
  sectionsByGroup,
  type FatosDoRail,
  type SectionId,
  type SettingsSection,
} from "@/components/settings/sections"
import { cn } from "@/lib/utils"

/** Etiqueta de zona: rótulo, não controle, então a `etiqueta` da casa (§3). */
function Zona({ children }: { children: string }) {
  return <div className="etiqueta px-2 pt-3 pb-1">{children}</div>
}

function Item({
  section,
  selected,
  facts,
  onSelect,
  recuo,
}: {
  section: SettingsSection
  selected: SectionId
  facts: FatosDoRail
  onSelect: (section: SectionId) => void
  /** Item dentro de um grupo aberto: o glifo recua para ler como filho. */
  recuo: boolean
}) {
  return (
    <button
      data-section={section.id}
      onClick={() => onSelect(section.id)}
      className={cn(
        controle("padrao"),
        "w-full text-left transition-colors",
        recuo && "pl-3",
        selected === section.id
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <section.icon className="size-4" />
      </span>
      <span className="min-w-0 truncate">{section.label}</span>
      {section.badge && (
        <span className="ml-auto">
          <Selo>{section.badge}</Selo>
        </span>
      )}
      {precisaDeAtencao(section.id, facts) && (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-st-warning",
            !section.badge && "ml-auto",
          )}
          title="Precisa de atenção"
          aria-label="Precisa de atenção"
        />
      )}
    </button>
  )
}

/** Navegação por pergunta (ADR-268). No topo, o que espera por você. Depois a
 * zona "Neste Mac", por domínio, e só o grupo da seção selecionada expande. Por
 * último a zona "No projeto", com UM seletor que vale para todas as seções
 * dela. Busca e deep links continuam apontando direto para cada seção. */
export function SettingsRail({
  available,
  selected,
  facts,
  onSelect,
  projeto,
}: {
  available: readonly SectionId[]
  selected: SectionId
  facts: FatosDoRail
  onSelect: (section: SectionId) => void
  /** Sem projeto (nenhum cadastrado, teste), a zona mostra só as seções. */
  projeto?: ProjetoDasConfiguracoes
}) {
  const selectedGroup = sectionDef(selected).group
  const grupos = sectionsByGroup(available)
  const inicio = grupos.find((g) => g.group.id === "inicio")
  const doMac = grupos.filter((g) => g.group.zona === "mac" && g.group.id !== "inicio")
  const doProjeto = grupos.filter((g) => g.group.zona === "projeto")
  const quantas = pendencias(facts).length

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-rail p-2">
      {inicio?.sections.map((section) => (
        <button
          key={section.id}
          data-section={section.id}
          onClick={() => onSelect(section.id)}
          className={cn(
            controle("padrao"),
            "w-full text-left font-medium transition-colors",
            selected === section.id
              ? "bg-accent text-foreground"
              : "text-foreground hover:bg-accent/50",
          )}
        >
          <span className="grid size-5 shrink-0 place-items-center">
            <section.icon className="size-4" />
          </span>
          <span className="min-w-0 truncate">{section.label}</span>
          {quantas > 0 && (
            <span className="ml-auto font-mono text-[11px] text-st-warning tabular-nums">
              {quantas}
            </span>
          )}
        </button>
      ))}

      <Zona>Neste Mac</Zona>
      {doMac.map(({ group, sections }) =>
        sections.length === 1 ? (
          <Item
            key={group.id}
            section={sections[0]}
            selected={selected}
            facts={facts}
            onSelect={onSelect}
            recuo={false}
          />
        ) : (
          <div key={group.id}>
            <button
              type="button"
              aria-expanded={selectedGroup === group.id}
              onClick={() => onSelect(sections[0].id)}
              className={cn(
                controle("compacto"),
                // Grupo é CONTROLE (abre o grupo), então vai em caixa normal e
                // sans: caixa-alta com tracking é roupa de rótulo (§3).
                "w-full justify-between text-left transition-colors",
                selectedGroup === group.id
                  ? "font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {group.label}
              <span className="flex items-center gap-1.5">
                {selectedGroup !== group.id &&
                  sections.some((s) => precisaDeAtencao(s.id, facts)) && (
                    <span
                      className="size-1.5 rounded-full bg-st-warning"
                      aria-label="Precisa de atenção"
                    />
                  )}
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    selectedGroup !== group.id && "-rotate-90",
                  )}
                />
              </span>
            </button>
            {selectedGroup === group.id && (
              <div className="mt-0.5 space-y-0.5">
                {sections.map((section) => (
                  <Item
                    key={section.id}
                    section={section}
                    selected={selected}
                    facts={facts}
                    onSelect={onSelect}
                    recuo
                  />
                ))}
              </div>
            )}
          </div>
        ),
      )}

      {doProjeto.length > 0 && (
        <>
          <Zona>No projeto</Zona>
          {projeto?.project && (
            <div className="mb-1">
              <PillSelect
                value={projeto.project.id}
                onValueChange={projeto.escolher}
                options={projeto.projects.map((p) => ({ value: p.id, label: p.name }))}
                triggerClassName={cn(controle("compacto"), "w-full justify-between text-foreground data-[size=default]:h-7")}
                title="Vale para todas as seções do projeto; não muda o projeto ativo do app"
                aria-label="Projeto das configurações"
              />
            </div>
          )}
          {doProjeto.flatMap(({ sections }) =>
            sections.map((section) => (
              <Item
                key={section.id}
                section={section}
                selected={selected}
                facts={facts}
                onSelect={onSelect}
                recuo={false}
              />
            )),
          )}
        </>
      )}
    </nav>
  )
}
