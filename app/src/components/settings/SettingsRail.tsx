import { ChevronDown } from "lucide-react"
import { controle } from "@/components/ui/controle"
import { Selo } from "@/components/settings/parts"
import {
  precisaDeAtencao,
  sectionDef,
  sectionsByGroup,
  type FatosDoRail,
  type SectionId,
} from "@/components/settings/sections"
import { cn } from "@/lib/utils"

/** Navegação por domínio. Só o grupo da seção selecionada expande; busca e
 * deep links continuam apontando diretamente para cada seção do registro. */
export function SettingsRail({
  available,
  selected,
  facts,
  onSelect,
}: {
  available: readonly SectionId[]
  selected: SectionId
  facts: FatosDoRail
  onSelect: (section: SectionId) => void
}) {
  const selectedGroup = sectionDef(selected).group

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-rail p-2">
      {sectionsByGroup(available).map(({ group, sections }) => (
        <div key={group.id} className="mt-1 first:mt-0">
          <button
            type="button"
            aria-expanded={selectedGroup === group.id}
            onClick={() => onSelect(sections[0].id)}
            className={cn(
              controle("compacto"),
              // Grupo é CONTROLE (abre o grupo), então vai em caixa normal e
              // sans: caixa-alta com tracking é roupa de rótulo (§3). Em mono
              // e caixa alta os sete grupos pareciam títulos, não navegação.
              "w-full justify-between text-left transition-colors",
              selectedGroup === group.id
                ? "font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {group.label}
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                selectedGroup !== group.id && "-rotate-90",
              )}
            />
          </button>
          {selectedGroup === group.id && (
            <div className="mt-0.5 space-y-0.5">
              {sections.map((section) => (
                <button
                  key={section.id}
                  data-section={section.id}
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    controle("padrao"),
                    "w-full text-left transition-colors",
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
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
